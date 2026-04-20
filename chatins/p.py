import fitz
import ollama
import json
import sys
import requests

# ── config ────────────────────────────────────────────────────────────────────
MODEL = "gemma4:e4b"
CROSSREF_CANDIDATES = 5  # how many results to fetch and let model pick from
# ─────────────────────────────────────────────────────────────────────────────

def log(msg: str):
    print(f"  → {msg}", file=sys.stderr)

def extract_text(pdf_path: str) -> str:
    log(f"Opening PDF: {pdf_path}")
    doc = fitz.open(pdf_path)
    text = ""
    for i, page in enumerate(doc[:2]):
        page_text = page.get_text()
        text += page_text
        log(f"Page {i+1}: extracted {len(page_text)} characters")
    doc.close()
    log(f"Total text extracted: {len(text)} characters (using first 3000)")
    return text

EXTRACT_PROMPT = """Extract the title, authors, and DOI from this academic paper.
Return ONLY a valid JSON object with exactly these fields:
- "title": string
- "authors": list of strings
- "doi": string, or "" if not found
No explanation, no markdown, no code fences. Just the raw JSON."""

def extract_from_pdf(pdf_path: str) -> dict:
    text = extract_text(pdf_path)

    log(f"Sending text to model ({MODEL}) for metadata extraction...")
    response = ollama.chat(
        model=MODEL,
        messages=[
            {"role": "system", "content": "You are a metadata extraction assistant. Return only raw JSON, nothing else."},
            {"role": "user", "content": f"{EXTRACT_PROMPT}\n\nPaper text:\n{text[:3000]}"}
        ]
    )

    raw = response["message"]["content"].strip()
    log(f"Model raw response: {raw[:200]}{'...' if len(raw) > 200 else ''}")

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
        log("Stripped markdown fences from response")

    result = json.loads(raw)
    log(f"Extracted title:   {result.get('title', '(none)')}")
    log(f"Extracted authors: {', '.join(result.get('authors', [])) or '(none)'}")
    log(f"Extracted DOI:     {result.get('doi') or '(not found in PDF)'}")
    return result

def query_crossref(title: str, authors: list[str]) -> list[dict]:
    log(f"Querying CrossRef for: \"{title}\"")
    log(f"Using first author as filter: {authors[0] if authors else '(none)'}")

    params = {
        "query.title": title,
        "query.author": authors[0] if authors else "",
        "rows": CROSSREF_CANDIDATES,
        "select": "DOI,title,author,published,container-title,score"
    }

    try:
        r = requests.get(
            "https://api.crossref.org/works",
            params=params,
            headers={"User-Agent": "pdf-metadata-extractor/1.0"},
            timeout=10
        )
        r.raise_for_status()
        items = r.json()["message"]["items"]
        log(f"CrossRef returned {len(items)} candidates")

        # Log each candidate
        for i, item in enumerate(items):
            candidate_title = item.get("title", ["(no title)"])[0]
            candidate_doi = item.get("DOI", "(no DOI)")
            candidate_score = item.get("score", "?")
            log(f"  Candidate {i+1} [score={candidate_score:.1f}]: {candidate_title[:80]} | DOI: {candidate_doi}")

        return items
    except Exception as e:
        log(f"CrossRef request failed: {e}")
        return []

def pick_best_candidate(original: dict, candidates: list[dict]) -> str:
    """Ask the model to pick the best CrossRef match. Returns DOI or ''."""

    simplified = []
    for i, c in enumerate(candidates):
        simplified.append({
            "index": i + 1,
            "title": c.get("title", [""])[0],
            "authors": [
                f"{a.get('given', '')} {a.get('family', '')}".strip()
                for a in c.get("author", [])[:4]
            ],
            "published": c.get("published", {}).get("date-parts", [[None]])[0][0],
            "journal": c.get("container-title", [""])[0],
            "doi": c.get("DOI", ""),
            "score": round(c.get("score", 0), 2)
        })

    pick_prompt = f"""I extracted metadata from a PDF and got these details:

Title:   {original['title']}
Authors: {', '.join(original['authors'])}

I then queried CrossRef and got these {len(simplified)} candidates:

{json.dumps(simplified, indent=2)}

Which candidate best matches the original paper? Consider title similarity and author overlap.
If none are a confident match, say so.

Return ONLY a JSON object with these fields:
- "chosen_index": number (1-{len(simplified)}), or 0 if no confident match
- "doi": the DOI of the chosen candidate, or "" if no match
- "reasoning": one sentence explaining your choice

No markdown, no code fences. Raw JSON only."""

    log(f"Asking model to pick best CrossRef match from {len(simplified)} candidates...")
    response = ollama.chat(
        model=MODEL,
        messages=[
            {"role": "system", "content": "You are a careful academic metadata assistant. Return only raw JSON."},
            {"role": "user", "content": pick_prompt}
        ]
    )

    raw = response["message"]["content"].strip()
    log(f"Model raw pick response: {raw[:300]}{'...' if len(raw) > 300 else ''}")

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    pick = json.loads(raw)
    log(f"Model chose candidate #{pick.get('chosen_index', 0)}")
    log(f"Reasoning: {pick.get('reasoning', '(none)')}")

    return pick.get("doi", "")

def extract_metadata(pdf_path: str) -> dict:
    print("\n[1/3] Extracting metadata from PDF", file=sys.stderr)
    result = extract_from_pdf(pdf_path)

    if not result.get("doi"):
        print("\n[2/3] DOI not found in PDF — querying CrossRef", file=sys.stderr)
        candidates = query_crossref(result["title"], result["authors"])

        if candidates:
            print("\n[3/3] Asking model to pick best match", file=sys.stderr)
            doi = pick_best_candidate(result, candidates)
            if doi:
                log(f"Final DOI confirmed: {doi}")
                result["doi"] = doi
            else:
                log("Model found no confident match — DOI set to empty")
                result["doi"] = ""
        else:
            print("\n[3/3] CrossRef returned no results", file=sys.stderr)
            result["doi"] = ""
    else:
        print("\n[2/3] DOI found in PDF, skipping CrossRef", file=sys.stderr)
        print("\n[3/3] Done", file=sys.stderr)

    return result

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract.py paper.pdf")
        sys.exit(1)

    print("=" * 60, file=sys.stderr)
    print(" PDF Metadata Extractor", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    result = extract_metadata(sys.argv[1])

    print("\n" + "=" * 60, file=sys.stderr)
    print(" Final Result", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print(json.dumps(result, indent=2, ensure_ascii=False))
