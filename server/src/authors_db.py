"""The `authors` database in Corelamo: one document per scientist in the library.

Each document holds the scientist's OpenAlex profile (works, citations, h-index,
institutions, ORCID, topics) and what we know of them locally (their papers in the
library and those papers' fields). The mafia map sizes authors by their citations
from here, and the author panel reads the profile from here.
"""
import os
import time

import requests

from src import corelamo
from src.metadata_analyser import USER_AGENT

AUTHORS_DB = os.getenv("CORELAMO_AUTHORS_DB", "authors")
OPENALEX_AUTHORS = "https://api.openalex.org/authors"
PROFILE_FIELDS = "id,display_name,orcid,works_count,cited_by_count,summary_stats,last_known_institutions,topics"
UPSERT_CHUNK = 500
REFRESH_AFTER_S = 30 * 24 * 3600   # career numbers change slowly

POLICY = {
    "id": {"$type": "id"},
    "name": {"$type": "text", "$weight": {"min": 90, "max": 95}, "$exact": True},
    "orcid": {"$type": "text", "$searchable": False},
    "works_count": {"$type": "int", "$searchable": True},
    "cited_by_count": {"$type": "int", "$searchable": True},
    "h_index": {"$type": "int", "$searchable": True},
    "i10_index": {"$type": "int", "$searchable": True},
    "institutions": [{"$type": "text", "$weight": {"min": 60, "max": 70}}],
    "countries": [{"$type": "text", "$exact": True}],
    "topics": [{"$type": "text", "$weight": {"min": 50, "max": 60}}],
    "library_paper_ids": [{"$type": "text"}],
    "library_papers": {"$type": "int", "$searchable": True},
    "library_fields": [{"$type": "int", "$searchable": True}],
    "profile_updated": {"$type": "int", "$searchable": True},
}


def _request(method, path, body=None):
    return corelamo._c().request(method, f"/api/databases/{AUTHORS_DB}{path}", body)


def ensure_db():
    """Creates the authors database (with its policy) if it doesn't exist yet."""
    resp = corelamo._c().request("GET", "/api/list-databases", None)
    resp.raise_for_status()
    names = {d["name"] for d in resp.json()["data"]["databases"]}
    if AUTHORS_DB in names:
        return False
    _request("POST", "/create-database", {"shard_count": 2}).raise_for_status()
    _request("POST", "/set-policy", POLICY).raise_for_status()
    print(f"[authors_db] Created database '{AUTHORS_DB}'")
    return True


def load_all():
    """Every author document, by id."""
    resp = _request("POST", "/search", {
        "query": "", "docs": 1_000_000,
        "filters": {"cited_by_count": {"range": ">=0"}},
    })
    resp.raise_for_status()
    return {d["id"]: d["data"] for d in resp.json().get("data", [])}


def fetch_profiles(author_ids):
    """OpenAlex profiles for many authors, 50 per request. {id: profile fields}."""
    ids = [a for a in author_ids if a.startswith("A")]
    out = {}
    for start in range(0, len(ids), 50):
        chunk = ids[start:start + 50]
        try:
            resp = requests.get(OPENALEX_AUTHORS, params={
                "filter": "openalex:" + "|".join(chunk), "per-page": 50, "select": PROFILE_FIELDS,
            }, headers={"User-Agent": USER_AGENT}, timeout=30)
        except requests.exceptions.RequestException as e:
            print(f"[authors_db] OpenAlex request failed: {e}")
            continue
        if resp.status_code != 200:
            print(f"[authors_db] OpenAlex HTTP {resp.status_code}")
            continue
        for a in resp.json().get("results", []):
            stats = a.get("summary_stats") or {}
            insts = a.get("last_known_institutions") or []
            out[a["id"].replace("https://openalex.org/", "")] = {
                "name": a.get("display_name") or "",
                "orcid": a.get("orcid") or "",
                "works_count": a.get("works_count") or 0,
                "cited_by_count": a.get("cited_by_count") or 0,
                "h_index": stats.get("h_index") or 0,
                "i10_index": stats.get("i10_index") or 0,
                "institutions": [i.get("display_name") or "" for i in insts[:3]],
                "countries": sorted({i.get("country_code") for i in insts[:3] if i.get("country_code")}),
                "topics": [t.get("display_name") or "" for t in (a.get("topics") or [])[:5]],
            }
    return out


def sync(papers, names, refresh=False, log=print):
    """Brings the authors database in line with the library.

    papers: {paper_id: {"authors": [author ids], "category_id": int}}
    names:  {author_id: display name} (used when OpenAlex has no profile)
    New authors get their OpenAlex profile; everyone's library papers / fields are
    kept current; profiles older than REFRESH_AFTER_S (or all, with refresh) are
    fetched again. Returns all author documents by id.
    """
    ensure_db()
    existing = load_all()

    library = {}
    for pid, p in papers.items():
        for aid in p["authors"]:
            entry = library.setdefault(aid, {"papers": set(), "fields": set()})
            entry["papers"].add(pid)
            if p["category_id"]:
                entry["fields"].add(p["category_id"])

    now = int(time.time())
    # authors known only by name (no OpenAlex id) have no profile to fetch
    stale = [aid for aid in library if aid.startswith("A") and (
        refresh or aid not in existing
        or now - (existing[aid].get("profile_updated") or 0) > REFRESH_AFTER_S)]
    if stale:
        log(f"[authors_db] fetching {len(stale)} OpenAlex profiles")
    profiles = fetch_profiles(stale) if stale else {}

    changed = []
    for aid, lib in library.items():
        doc = dict(existing.get(aid) or {})
        doc.pop("id", None)
        if aid in profiles:
            doc.update(profiles[aid])
            doc["profile_updated"] = now
        elif not doc:
            # no OpenAlex profile (or not fetched): keep the name, zero career numbers
            doc = {"name": names.get(aid, ""), "orcid": "", "works_count": 0, "cited_by_count": 0,
                   "h_index": 0, "i10_index": 0, "institutions": [], "countries": [], "topics": [],
                   "profile_updated": now if aid.startswith("A") else 0}
        doc["library_paper_ids"] = sorted(lib["papers"])
        doc["library_papers"] = len(lib["papers"])
        doc["library_fields"] = sorted(lib["fields"])
        if doc != {k: v for k, v in (existing.get(aid) or {}).items() if k != "id"}:
            changed.append({"id": aid, **doc})
        existing[aid] = {"id": aid, **doc}

    for start in range(0, len(changed), UPSERT_CHUNK):
        resp = _request("POST", "/upsert", changed[start:start + UPSERT_CHUNK])
        if resp.status_code not in (200, 207):
            log(f"[authors_db] upsert failed: HTTP {resp.status_code} {resp.text[:200]}")
        log(f"[authors_db] saved {min(start + UPSERT_CHUNK, len(changed))}/{len(changed)}")
    return existing
