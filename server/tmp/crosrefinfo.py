"""
fetch_doi.py
Queries the Crossref API for a given DOI and writes structured metadata to output.json.

Output includes:
  - Title, journal, year, publisher
  - Authors with ORCID (when available)
  - references_count       : how many papers this paper cites
  - cited_by_count         : how many times this paper has been cited (Crossref's is-referenced-by-count)
  - references             : list of cited DOIs (where deposited by publisher)
"""

import json
import requests

# ── Config ────────────────────────────────────────────────────────────────────
DOI = "10.3181/00379727-21-3"
OUTPUT_FILE = "./output.json"
CROSSREF_URL = f"https://api.crossref.org/works/{DOI}"

# Crossref asks you to identify yourself via a User-Agent (polite pool = faster)
HEADERS = {
    "User-Agent": "doi-fetcher/1.0 (mailto:your@email.com)"
}
# ─────────────────────────────────────────────────────────────────────────────


def fetch_crossref(doi: str) -> dict:
    """Fetch raw Crossref work metadata for a DOI."""
    response = requests.get(CROSSREF_URL, headers=HEADERS, timeout=15)
    response.raise_for_status()
    data = response.json()
    if data.get("status") != "ok":
        raise ValueError(f"Crossref returned status: {data.get('status')}")
    return data["message"]


def extract_authors(message: dict) -> list[dict]:
    """
    Extract author list with name and ORCID.
    ORCID is only present when the author registered it — many entries will be null.
    """
    authors = []
    for author in message.get("author", []):
        given  = author.get("given", "")
        family = author.get("family", "")
        orcid  = author.get("ORCID")  # full URL, e.g. "http://orcid.org/0000-0002-1234-5678"

        # Normalise ORCID to bare ID (0000-0002-...) for cleanliness
        if orcid:
            orcid = orcid.rstrip("/").split("/")[-1]

        authors.append({
            "given":       given,
            "family":      family,
            "full_name":   f"{given} {family}".strip(),
            "orcid":       orcid,          # None if not available
            "affiliation": [a.get("name") for a in author.get("affiliation", [])],
        })
    return authors


def extract_references(message: dict) -> list[dict]:
    """
    Extract the reference list. Each entry may or may not have a DOI —
    publishers deposit reference data selectively.
    """
    refs = []
    for ref in message.get("reference", []):
        refs.append({
            "key":          ref.get("key"),
            "doi":          ref.get("DOI"),           # None if not deposited
            "unstructured": ref.get("unstructured"),  # raw citation string fallback
            "year":         ref.get("year"),
            "journal":      ref.get("journal-title"),
            "article_title":ref.get("article-title"),
            "author":       ref.get("author"),
        })
    return refs


def build_output(message: dict) -> dict:
    """Assemble the final structured output dict."""
    # Title is a list in Crossref (multilingual support) — take first entry
    titles = message.get("title", [])
    title  = titles[0] if titles else None

    # Journal / container title
    container = message.get("container-title", [])
    journal   = container[0] if container else None

    # Publication year (from issued date-parts)
    year = None
    issued = message.get("issued", {}).get("date-parts", [[]])
    if issued and issued[0]:
        year = issued[0][0]

    references = extract_references(message)

    return {
        "doi":              message.get("DOI"),
        "title":            title,
        "journal":          journal,
        "publisher":        message.get("publisher"),
        "year":             year,
        "type":             message.get("type"),
        "url":              message.get("URL"),

        # Authors
        "authors":          extract_authors(message),

        # Citation counts
        "references_count": message.get("references-count"),   # papers this paper cites
        "cited_by_count":   message.get("is-referenced-by-count"),  # papers that cite this

        # Reference list (DOIs where available)
        "references_with_doi_count": sum(1 for r in references if r["doi"]),
        "references":       references,
    }


def main():
    print(f"Fetching metadata for DOI: {DOI}")
    try:
        message = fetch_crossref(DOI)
    except requests.HTTPError as e:
        print(f"HTTP error: {e}")
        return
    except requests.ConnectionError:
        print("Connection error — check your internet connection.")
        return

    output = build_output(message)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # ── Summary ────────────────────────────────────────────────────────────────
    print(f"\n✓ Saved to {OUTPUT_FILE}")
    print(f"  Title           : {output['title']}")
    print(f"  Authors         : {len(output['authors'])} found")
    orcid_count = sum(1 for a in output['authors'] if a['orcid'])
    print(f"  ORCIDs          : {orcid_count} / {len(output['authors'])}")
    print(f"  References count: {output['references_count']}  (papers this paper cites)")
    print(f"  Cited-by count  : {output['cited_by_count']}  (papers that cite this)")
    print(f"  Refs with DOI   : {output['references_with_doi_count']} / {len(output['references'])}")


if __name__ == "__main__":
    main()
