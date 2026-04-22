import re
import requests

CROSSREF_BASE       = "https://api.crossref.org/works"
USER_AGENT           = "pdf-magic/1.0 (mailto:normunds@email.com)"
TIMEOUT              = 10
MIN_SCORE_ABSOLUTE   = 80    # accept unconditionally above this
MIN_SCORE_FLOOR      = 15    # minimum score to consider anything
SMALL_GAP_THRESH     = 0.05  # gap below this → retry with authors
TITLE_OVERLAP_THRESH = 0.85  # title word overlap above this → retry with authors


def crossref_by_doi(doi: str) -> dict:
    if not doi:
        return {}
    doi = re.sub(r"^https?://doi\.org/", "", doi.strip().lower())
    try:
        resp = requests.get(
            f"{CROSSREF_BASE}/{doi}",
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
    except requests.exceptions.RequestException as e:
        print(f"[crossref] DOI request failed: {e}")
        return {}
    if resp.status_code == 404:
        print(f"[crossref] DOI not found: {doi}")
        return {}
    if resp.status_code != 200:
        print(f"[crossref] DOI lookup returned {resp.status_code}")
        return {}
    return _parse_item(resp.json().get("message", {}))


def crossref_by_title(title: str, authors: list) -> dict:
    #saakumaa title, tad ar autoriem, nu ja slikti tad vecaako peec gada, ja VISPAAR tad do kuram lielaks score
    if not title:
        return {}

    # ── Attempt 1: title only ─────────────────────────────────────────────────
    result = _search(title, "")

    needs_retry = (
        result.get("similar_titles") or
        result.get("small_gap")      or
        result.get("low_confidence")
    )

    if not needs_retry:
        return result

    # ── Attempt 2: title + author surnames ────────────────────────────────────
    if not authors:
        print(f"[crossref] Would retry but no authors available")
        return result

    author_terms = " ".join(_extract_surname(a) for a in authors[:2]).strip()
    reason = (
        "similar titles" if result.get("similar_titles") else
        "small gap"      if result.get("small_gap")      else
        "low confidence"
    )
    print(f"[crossref] Retrying with authors ({reason}): {title[:80]}")
    print(f"[crossref] Author terms: {author_terms}")

    result_with_authors = _search(title, author_terms)

    if result_with_authors and not any(
        result_with_authors.get(k)
        for k in ("low_confidence", "similar_titles", "small_gap")
    ):
        return result_with_authors

    print(f"[crossref] Both attempts uncertain — applying year tiebreak")
    items = _fetch_items(title, author_terms)

    if items:
        best, reason = _tiebreak_by_year(items)
        print(f"[crossref] Accepted after year tiebreak — {reason} — doi: {best.get('DOI')}")
        return _parse_item(best)

    score_1 = result.get("score", 0)             if result             else 0
    score_2 = result_with_authors.get("score", 0) if result_with_authors else 0
    print(f"[crossref] Fallback — picking higher score ({score_1:.1f} vs {score_2:.1f})")
    return result_with_authors if score_2 > score_1 else (result or {})


def _fetch_items(title: str, author_terms: str) -> list:
    """Raw Crossref fetch returning item list, used for year tiebreak."""
    query = f"{title} {author_terms}".strip()
    try:
        resp = requests.get(
            CROSSREF_BASE,
            params={
                "query.bibliographic": query,
                "rows": 5,
                "select": "DOI,title,author,abstract,published,score",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("items", [])
    except requests.exceptions.RequestException:
        return []


def _tiebreak_by_year(items: list) -> tuple:
    def get_year(item):
        parts = item.get("published", {}).get("date-parts", [[9999]])
        return parts[0][0] if parts and parts[0] else 9999

    candidates = items[:2]
    oldest     = min(candidates, key=get_year)
    year       = get_year(oldest)

    print(f"[crossref] Year tiebreak → {year} — doi: {oldest.get('DOI')}")
    return oldest, f"oldest publication ({year})"


def _search(title: str, author_terms: str) -> dict:
    query = f"{title} {author_terms}".strip()

    try:
        resp = requests.get(
            CROSSREF_BASE,
            params={
                "query.bibliographic": query,
                "rows": 5,
                "select": "DOI,title,author,abstract,published,score",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"[crossref] Search request failed: {e}")
        return {}

    items = resp.json().get("message", {}).get("items", [])

    print(f"\n[crossref] query: {query}")
    for i, item in enumerate(items[:5]):
        print(f"  [{i+1}] score={item.get('score', 0):.2f} | "
              f"doi={item.get('DOI', 'n/a')} | "
              f"title={item.get('title', [''])[0]}")

    if not items:
        print(f"[crossref] No results")
        return {}

    best, reason = _pick_best_result(items)

    if reason.startswith("similar_titles"):
        print(f"[crossref] Similar titles — need authors to disambiguate")
        return {"similar_titles": True, "score": items[0].get("score", 0)}

    if reason.startswith("small_gap"):
        print(f"[crossref] Small gap — need authors to disambiguate")
        return {"small_gap": True, "score": items[0].get("score", 0)}

    if best is None:
        print(f"[crossref] Rejected — {reason}")
        return {"low_confidence": True, "score": items[0].get("score", 0)}

    print(f"[crossref] Accepted — {reason} — doi: {best.get('DOI')}")
    return _parse_item(best)


def _pick_best_result(items: list) -> tuple:
    if not items:
        return None, "no results"

    top   = items[0]
    score = top.get("score", 0)

    if score < MIN_SCORE_FLOOR:
        return None, f"score={score:.1f} too low"

    if score >= MIN_SCORE_ABSOLUTE:
        return top, f"absolute score {score:.1f}"

    if len(items) < 2:
        return top, f"only result, score {score:.1f}"

    second = items[1].get("score", 0)
    gap    = (score - second) / second if second > 0 else 1.0

    top_title    = (items[0].get("title") or [""])[0].lower()
    second_title = (items[1].get("title") or [""])[0].lower()
    top_words    = set(top_title.split())
    second_words = set(second_title.split())
    title_overlap = (
        len(top_words & second_words) / max(len(top_words), 1)
        if top_words else 0
    )

    if title_overlap > TITLE_OVERLAP_THRESH:
        return None, f"similar_titles (overlap={title_overlap:.0%}, gap={gap:.0%})"

    if gap < SMALL_GAP_THRESH:
        return None, f"small_gap (score={score:.1f}, gap={gap:.0%})"

    return top, f"gap dominant ({score:.1f} vs {second:.1f}, gap={gap:.0%})"


def _parse_item(item: dict) -> dict:
    authors = [
        f"{a.get('given', '')} {a.get('family', '')}".strip()
        for a in item.get("author", [])
        if a.get("family")
    ]
    date_parts = item.get("published", {}).get("date-parts", [[None]])
    year       = date_parts[0][0] if date_parts and date_parts[0] else None
    title_list = item.get("title", [])
    title      = title_list[0] if title_list else None
    abstract   = _strip_jats(item.get("abstract", ""))
    doi        = re.sub(r"^https?://doi\.org/", "", item.get("DOI", "")).strip()
    return {
        "doi":      doi      or None,
        "title":    title    or None,
        "authors":  authors,
        "abstract": abstract,
        "year":     year,
    }


def _extract_surname(full_name: str) -> str:
    parts = full_name.strip().split()
    return parts[-1] if parts else full_name


def _strip_jats(text: str) -> str:
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", clean).strip()
