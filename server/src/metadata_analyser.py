import re
import requests

OPENALEX_BASE        = "https://api.openalex.org/works"
USER_AGENT           = "pdf-magic/1.0 (mailto:normunds@email.com)"
TIMEOUT              = 10

MIN_SCORE_FLOOR      = 40
MIN_SCORE_ABSOLUTE   = 1000
SMALL_GAP_THRESH     = 0.60
TITLE_OVERLAP_THRESH = 0.30
PASS2_SOFT_GAP       = 0.80

SELECT_FIELDS = "id,display_name,authorships,publication_year,relevance_score,doi,abstract_inverted_index,cited_by_count,topics,concepts,keywords,referenced_works,related_works"


# ── Public API ────────────────────────────────────────────────────────────────

def openalex_by_id(openalex_id: str) -> dict:
    """
    Primary lookup. openalex_id can be:
      - bare OpenAlex ID:  'W2031190677'
      - full OpenAlex URL: 'https://openalex.org/W2031190677'
      - DOI string:        '10.2138/am.2011.3544'  (with or without https://doi.org/ prefix)
    Returns parsed dict or {} if not found.
    """
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
    """
    Two-pass title search.
    Pass 1: broad ?search=TITLE  (scored)
    Pass 2: ?filter=title.search:TITLE + client-side author surname check
    Returns parsed dict or {}.
    """
    if not title:
        return {}

    result, needs_pass2 = _pass1(title)
    if not needs_pass2:
        return result

    return _pass2(title, authors)


# ── Endpoint builder ──────────────────────────────────────────────────────────

def _build_id_endpoint(raw: str) -> str:
    """Return the correct OpenAlex works endpoint for a bare ID, full URL, or DOI."""
    raw = raw.strip()

    # Full OpenAlex URL → extract bare ID
    if raw.lower().startswith("https://openalex.org/"):
        bare = raw.replace("https://openalex.org/", "").replace("https://OPENALEX.ORG/", "")
        return f"{OPENALEX_BASE}/{bare.upper()}"

    # Bare OpenAlex ID (W followed by digits) — case-insensitive match, always uppercase
    if re.match(r"^[Ww]\d+$", raw):
        return f"{OPENALEX_BASE}/{raw.upper()}"

    # DOI — strip any https://doi.org/ prefix
    doi = re.sub(r"^https?://doi\.org/", "", raw)
    return f"{OPENALEX_BASE}/doi:{doi}"


# ── Pass 1: broad search ──────────────────────────────────────────────────────

def _pass1(title: str) -> tuple[dict, bool]:
    """
    Returns (result_dict, needs_pass2).
    result_dict is {} if rejected, parsed dict if accepted.
    needs_pass2 is True when we should try Pass 2.
    """
    try:
        resp = requests.get(
            OPENALEX_BASE,
            params={
                "search":   title,
                "per_page": 5,
                "select":   SELECT_FIELDS,
            },
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"[metadata_analyser] Pass1 request failed: {e}")
        return {}, False

    results = resp.json().get("results", [])

    print(f"[metadata_analyser] Pass1 query: {title[:80]}")
    if not results:
        print(f"[metadata_analyser] Pass1: NO RESULTS")
        return {}, False

    s2_score = (results[1].get("relevance_score", 0) or 0) if len(results) >= 2 else 0
    for i, r in enumerate(results):
        score   = r.get("relevance_score", 0) or 0
        rtitle  = (r.get("display_name") or "")
        year    = r.get("publication_year", "?")
        oa_id   = (r.get("id") or "").replace("https://openalex.org/", "")
        overlap = _title_overlap(title, rtitle)
        gap_str = f"  gap={((score - s2_score) / s2_score * 100):.0f}%" if i == 0 and s2_score > 0 else ""
        print(f"  [{i+1}] score={score:>8.2f} | overlap={overlap:.0%} | {year} | {oa_id}{gap_str}")
        print(f"       {rtitle[:90]}")

    top    = results[0]
    s1     = top.get("relevance_score", 0) or 0
    title1 = top.get("display_name") or ""
    ov1    = _title_overlap(title, title1)

    # Below floor → hard reject
    if s1 < MIN_SCORE_FLOOR:
        print(f"[metadata_analyser] Pass1 REJECT: score {s1:.1f} < floor {MIN_SCORE_FLOOR}")
        return {}, False

    # Above absolute threshold
    if s1 >= MIN_SCORE_ABSOLUTE:
        if ov1 < TITLE_OVERLAP_THRESH:
            print(f"[metadata_analyser] Pass1 REJECT: absolute score but overlap {ov1:.0%} too low")
            return {}, False
        oa_id = (top.get("id") or "").replace("https://openalex.org/", "").upper()
        print(f"[metadata_analyser] found: {oa_id} → {title1[:70]}")
        return _fetch_full(top), False

    # Between floor and absolute — check gap
    if len(results) >= 2:
        s2  = results[1].get("relevance_score", 0) or 0
        gap = (s1 - s2) / s2 if s2 > 0 else 1.0
    else:
        gap = 1.0

    if gap < SMALL_GAP_THRESH:
        print(f"[metadata_analyser] Pass1 → RETRY pass2: gap={gap:.1%} too small")
        return {}, True  # needs pass2

    # Gap is large enough — check overlap
    if ov1 < TITLE_OVERLAP_THRESH:
        print(f"[metadata_analyser] Pass1 REJECT: gap={gap:.1%} ok but overlap {ov1:.0%} too low")
        return {}, False

    oa_id = (top.get("id") or "").replace("https://openalex.org/", "").upper()
    print(f"[metadata_analyser] found: {oa_id} → {title1[:70]}")
    return _fetch_full(top), False


# ── Pass 2: strict title filter + author check ────────────────────────────────

def _pass2(title: str, authors: list) -> dict:
    """
    Strict ?filter=title.search:TITLE + client-side surname check.
    """
    try:
        resp = requests.get(
            OPENALEX_BASE,
            params={
                "filter":   f"title.search:{title}",
                "per_page": 5,
                "select":   SELECT_FIELDS,
            },
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"[metadata_analyser] Pass2 request failed: {e}")
        return {}

    results = resp.json().get("results", [])

    print(f"[metadata_analyser] Pass2 filter=title.search: {title[:80]}")
    if not results:
        print(f"[metadata_analyser] Pass2: NO RESULTS")
        return {}

    s2_score = (results[1].get("relevance_score", 0) or 0) if len(results) >= 2 else 0
    for i, r in enumerate(results):
        score      = r.get("relevance_score", 0) or 0
        rtitle     = (r.get("display_name") or "")
        year       = r.get("publication_year", "?")
        oa_id      = (r.get("id") or "").replace("https://openalex.org/", "")
        gap_str    = f"  gap={((score - s2_score) / s2_score * 100):.0f}%" if i == 0 and s2_score > 0 else ""
        auth_names = [a["author"]["display_name"] for a in r.get("authorships", [])[:3] if a.get("author", {}).get("display_name")]
        print(f"  [{i+1}] score={score:>8.2f} | {year} | {oa_id}{gap_str}")
        print(f"       {rtitle[:90]}")
        print(f"       authors: {auth_names}")

    top = results[0]

    # Client-side surname check
    surnames = [_extract_surname(a) for a in (authors or []) if a]
    all_result_authors = " ".join(
        a["author"]["display_name"]
        for a in top.get("authorships", [])
        if a.get("author", {}).get("display_name")
    ).lower()

    print(f"[metadata_analyser] Pass2 checking surnames {surnames} against: {all_result_authors[:120]}")
    matched = [s for s in surnames if s.lower() in all_result_authors]

    if matched:
        oa_id  = (top.get("id") or "").replace("https://openalex.org/", "").upper()
        title1 = top.get("display_name") or ""
        print(f"[metadata_analyser] found: {oa_id} → {title1[:70]}")
        return _fetch_full(top)

    # Soft gap gate — accept without author match if gap is large
    if len(results) >= 2:
        s1  = results[0].get("relevance_score", 0) or 0
        s2  = results[1].get("relevance_score", 0) or 0
        gap = (s1 - s2) / s2 if s2 > 0 else 1.0
    else:
        gap = 1.0

    if gap > PASS2_SOFT_GAP:
        oa_id  = (top.get("id") or "").replace("https://openalex.org/", "").upper()
        title1 = top.get("display_name") or ""
        print(f"[metadata_analyser] found: {oa_id} → {title1[:70]}")
        return _fetch_full(top)

    print(f"[metadata_analyser] Pass2 REJECT: no author match, gap={gap:.1%} <= {PASS2_SOFT_GAP:.0%}")
    return {}


# ── Full record fetch ─────────────────────────────────────────────────────────

def _fetch_full(slim_work: dict) -> dict:
    """
    The search SELECT already includes all fields we need — parse directly.
    No second HTTP call needed since SELECT_FIELDS covers everything.
    """
    return _parse_work(slim_work)


# ── Parser ────────────────────────────────────────────────────────────────────

def _parse_work(work: dict) -> dict:
    """Convert raw OpenAlex work object → normalised dict."""
    if not work:
        return {}

    # OpenAlex ID — bare, no URL prefix
    raw_id      = work.get("id") or ""
    openalex_id = raw_id.replace("https://openalex.org/", "").strip().upper() or None

    # DOI — bare, no https://doi.org/ prefix
    raw_doi = work.get("doi") or ""
    doi     = re.sub(r"^https?://doi\.org/", "", raw_doi).strip() or None

    title   = work.get("display_name") or work.get("title") or None
    year    = work.get("publication_year") or None
    cited   = work.get("cited_by_count") or 0

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

    # Skip level 0 (broadest tags like "Chemistry", "Biology") — too generic
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
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _reconstruct_abstract(inverted_index: dict) -> str:
    if not inverted_index:
        return ""
    words = {}
    for word, positions in inverted_index.items():
        for pos in positions:
            words[pos] = word
    return " ".join(words[i] for i in sorted(words))


def _title_overlap(query: str, result_title: str) -> float:
    query_words  = set(query.lower().split())
    result_words = set((result_title or "").lower().split())
    if not query_words:
        return 0.0
    return len(query_words & result_words) / len(query_words)


def _extract_surname(full_name: str) -> str:
    parts = full_name.strip().split()
    return parts[-1] if parts else full_name
