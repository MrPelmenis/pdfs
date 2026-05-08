import re
import requests

OPENALEX_BASE = "https://api.openalex.org/works"
CROSSREF_BASE = "https://api.crossref.org/works"
USER_AGENT    = "pdf-magic/1.0 (mailto:normunds@email.com)"
TIMEOUT       = 10

SELECT_FIELDS = (
    "id,display_name,authorships,publication_year,doi,"
    "abstract_inverted_index,cited_by_count,topics,concepts,"
    "keywords,referenced_works,related_works,primary_topic"
)

CR_MIN_SCORE_ABSOLUTE   = 80
CR_MIN_SCORE_FLOOR      = 15
CR_SMALL_GAP_THRESH     = 0.05
CR_TITLE_OVERLAP_THRESH = 0.85


def openalex_by_id(openalex_id: str) -> dict:
    if not openalex_id:
        return {}

    endpoint = _build_id_endpoint(openalex_id)
    try:
        resp = requests.get(
            endpoint,
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
    except requests.exceptions.RequestException as e:
        print(f"[metadata_analyser] Request failed for {openalex_id}: {e}")
        return {}

    if resp.status_code == 404:
        print(f"[metadata_analyser] 404 for: {openalex_id}")
        return {}
    if resp.status_code != 200:
        print(f"[metadata_analyser] HTTP {resp.status_code} for: {openalex_id}")
        return {}

    return _parse_work(resp.json())


def openalex_by_title(title: str, authors: list) -> dict:
    if not title:
        return {}

    result = _cr_search(title, "")

    needs_retry = (
        result.get("similar_titles") or
        result.get("small_gap")      or
        result.get("low_confidence")
    )

    if not needs_retry:
        return _resolve_doi(result)

    if not authors:
        return _resolve_doi(result)

    author_terms = " ".join(_extract_surname(a) for a in authors[:2]).strip()
    result_with_authors = _cr_search(title, author_terms)

    if result_with_authors and not any(
        result_with_authors.get(k)
        for k in ("low_confidence", "similar_titles", "small_gap")
    ):
        return _resolve_doi(result_with_authors)

    items = _cr_fetch_items(title, author_terms)
    if items:
        best, _ = _cr_tiebreak_by_year(items)
        return _resolve_doi(_cr_parse_item(best))

    score_1 = result.get("score", 0)              if result              else 0
    score_2 = result_with_authors.get("score", 0) if result_with_authors else 0
    return _resolve_doi(result_with_authors if score_2 > score_1 else (result or {}))


def _resolve_doi(crossref_result: dict) -> dict:
    if not crossref_result:
        return {}
    if crossref_result.get("low_confidence") or \
       crossref_result.get("similar_titles") or \
       crossref_result.get("small_gap"):
        return {}
    doi = crossref_result.get("doi")
    if not doi:
        return {}
    return openalex_by_id(doi)


def _build_id_endpoint(raw: str) -> str:
    raw = raw.strip()
    if raw.lower().startswith("https://openalex.org/"):
        bare = raw.replace("https://openalex.org/", "").replace("https://OPENALEX.ORG/", "")
        return f"{OPENALEX_BASE}/{bare.upper()}"
    if re.match(r"^[Ww]\d+$", raw):
        return f"{OPENALEX_BASE}/{raw.upper()}"
    doi = re.sub(r"^https?://doi\.org/", "", raw)
    return f"{OPENALEX_BASE}/doi:{doi}"


def _parse_work(work: dict) -> dict:
    if not work:
        return {}

    raw_id      = work.get("id") or ""
    openalex_id = raw_id.replace("https://openalex.org/", "").strip().upper() or None

    raw_doi = work.get("doi") or ""
    doi     = re.sub(r"^https?://doi\.org/", "", raw_doi).strip() or None

    title  = work.get("display_name") or work.get("title") or None
    year   = work.get("publication_year") or None
    cited  = work.get("cited_by_count") or 0

    authors = [
        a["author"]["display_name"]
        for a in work.get("authorships", [])
        if a.get("author", {}).get("display_name")
    ]

    abstract = _reconstruct_abstract(work.get("abstract_inverted_index"))

    topics = [
        t["display_name"]
        for t in work.get("topics", [])
        if t.get("display_name")
    ]

    concepts = [
        c["display_name"]
        for c in work.get("concepts", [])
        if c.get("display_name") and c.get("score", 0) > 0.3 and c.get("level", 0) > 0
    ]

    keywords = [
        k["display_name"]
        for k in work.get("keywords", [])
        if k.get("display_name")
    ]

    referenced_work_ids = [
        url.replace("https://openalex.org/", "").upper()
        for url in work.get("referenced_works", [])
        if url
    ]

    related_work_ids = [
        url.replace("https://openalex.org/", "").upper()
        for url in work.get("related_works", [])
        if url
    ]

    # ── Field extraction from primary_topic ──────────────────────────────────
    # primary_topic.field.display_name → fallback to primary_topic.domain.display_name
    field = None
    primary_topic = work.get("primary_topic") or {}
    if primary_topic:
        field_obj  = primary_topic.get("field")  or {}
        domain_obj = primary_topic.get("domain") or {}
        field = (
            field_obj.get("display_name")
            or domain_obj.get("display_name")
            or None
        )

    return {
        "openalex_id":         openalex_id,
        "doi":                 doi,
        "title":               title,
        "authors":             authors,
        "abstract":            abstract,
        "year":                year,
        "cited_by_count":      cited,
        "topics":              topics,
        "concepts":            concepts,
        "keywords":            keywords,
        "referenced_work_ids": referenced_work_ids,
        "related_work_ids":    related_work_ids,
        "field":               field,          # NEW — used for auto-categorisation
    }


def _cr_search(title: str, author_terms: str) -> dict:
    query = f"{title} {author_terms}".strip()
    try:
        resp = requests.get(
            CROSSREF_BASE,
            params={
                "query.bibliographic": query,
                "rows":   5,
                "select": "DOI,title,author,abstract,published,score",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"[metadata_analyser] Crossref search failed: {e}")
        return {}

    items = resp.json().get("message", {}).get("items", [])
    if not items:
        print(f"[metadata_analyser] Crossref: no results")
        return {}

    best, reason = _cr_pick_best(items)

    if reason.startswith("similar_titles"):
        return {"similar_titles": True, "score": items[0].get("score", 0)}
    if reason.startswith("small_gap"):
        return {"small_gap": True, "score": items[0].get("score", 0)}
    if best is None:
        print(f"[metadata_analyser] Crossref: rejected — {reason}")
        return {"low_confidence": True, "score": items[0].get("score", 0)}

    print(f"[metadata_analyser] Crossref accepted: {title[:60]}, doi: {best.get('DOI')}")
    return _cr_parse_item(best)


def _cr_pick_best(items: list) -> tuple:
    if not items:
        return None, "no results"
    top   = items[0]
    score = top.get("score", 0)
    if score < CR_MIN_SCORE_FLOOR:
        return None, f"score={score:.1f} too low"
    if score >= CR_MIN_SCORE_ABSOLUTE:
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
    if title_overlap > CR_TITLE_OVERLAP_THRESH:
        return None, f"similar_titles (overlap={title_overlap:.0%}, gap={gap:.0%})"
    if gap < CR_SMALL_GAP_THRESH:
        return None, f"small_gap (score={score:.1f}, gap={gap:.0%})"
    return top, f"gap dominant ({score:.1f} vs {second:.1f}, gap={gap:.0%})"


def _cr_fetch_items(title: str, author_terms: str) -> list:
    query = f"{title} {author_terms}".strip()
    try:
        resp = requests.get(
            CROSSREF_BASE,
            params={
                "query.bibliographic": query,
                "rows":   5,
                "select": "DOI,title,author,abstract,published,score",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("items", [])
    except requests.exceptions.RequestException:
        return []


def _cr_tiebreak_by_year(items: list) -> tuple:
    def get_year(item):
        parts = item.get("published", {}).get("date-parts", [[9999]])
        return parts[0][0] if parts and parts[0] else 9999
    oldest = min(items[:2], key=get_year)
    return oldest, f"oldest publication ({get_year(oldest)})"


def _cr_parse_item(item: dict) -> dict:
    doi = re.sub(r"^https?://doi\.org/", "", item.get("DOI", "")).strip()
    return {"doi": doi or None}


def _reconstruct_abstract(inverted_index: dict) -> str:
    if not inverted_index:
        return ""
    words = {}
    for word, positions in inverted_index.items():
        for pos in positions:
            words[pos] = word
    return " ".join(words[i] for i in sorted(words))


def _extract_surname(full_name: str) -> str:
    parts = full_name.strip().split()
    return parts[-1] if parts else full_name
