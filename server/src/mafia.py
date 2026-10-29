"""Science mafia map: authors linked by co-authorship and by cross-citation.

Papers come from Corelamo, author identities from OpenAlex authorships (stable
author ids, so name variants of one person merge). Authorships are cached on
disk and only fetched for papers that are new since the last build.
"""
import collections
import json
import os
import re
import threading
import time
import unicodedata

from src import authors_db, corelamo
from src.categories import get_all_categories
import requests

from src.metadata_analyser import openalex_batch, USER_AGENT

CACHE_DIR = os.path.join(os.path.dirname(__file__), "../files/mafia")
AUTHORSHIPS_FILE = os.path.join(CACHE_DIR, "authorships.json")

# Papers with huge author lists (consortia) would add thousands of
# co-author pairs that say nothing about who works with whom.
MAX_COAUTHORS = 25
REBUILD_AFTER_S = 15 * 60
# How many search hits a topic query scopes the map to.
TOPIC_HITS = 400
TOPIC_MIN_TIES = 2
TOPIC_MIN_SHARE = 0.25

_lock = threading.Lock()
_state = None  # {"built_at", "doc_count", "papers", "authors", "citations", "profiles"}


# ── Building the paper / author index ─────────────────────────────────────────

def _all_docs():
    fields = {"title": True, "authors": True, "category_id": True, "date": True,
              "referenced_work_ids": True, "openalex_id": True,
              "stub_document": True, "cited_by_count": True, "file": True,
              "author_ids": True}
    docs = {}
    for stub in ("yes", "no"):
        resp = corelamo.search("", docs=100000,
                               filters={"stub_document": {"exact": stub}},
                               return_fields=fields)
        resp.raise_for_status()
        for d in resp.json().get("data", []):
            docs[d["id"]] = d["data"]
    return docs


def _name_key(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return "name:" + re.sub(r"[^a-z]+", " ", s.lower()).strip()


def _load_authorships():
    try:
        with open(AUTHORSHIPS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_authorships(data):
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = AUTHORSHIPS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, AUTHORSHIPS_FILE)


def _build():
    docs = _all_docs()
    authorships = _load_authorships()

    # papers carry their authors' ids (`author_ids`); OpenAlex is only asked about papers
    # that have neither those nor a cached authorship list
    missing = [(d.get("openalex_id") or pid).upper() for pid, d in docs.items()
               if not d.get("author_ids") and (d.get("openalex_id") or pid).upper() not in authorships]
    if missing:
        works = openalex_batch(missing, select="id,authorships")
        for wid in missing:
            work = works.get(wid)
            if work is None:
                continue
            authorships[wid] = [
                [a["author"]["id"].replace("https://openalex.org/", ""),
                 a["author"].get("display_name") or ""]
                for a in work.get("authorships", [])
                if (a.get("author") or {}).get("id")
            ]
        _save_authorships(authorships)

    known_names = {aid: name for listed in authorships.values() for aid, name in listed}
    papers, authors = {}, {}
    for pid, d in docs.items():
        listed = authorships.get((d.get("openalex_id") or pid).upper())
        if d.get("author_ids") and len(d["author_ids"]) == len(d.get("authors") or []):
            listed = [[aid, known_names.get(aid) or name] for aid, name in zip(d["author_ids"], d["authors"])]
        elif d.get("author_ids"):
            listed = [[aid, known_names.get(aid, "")] for aid in d["author_ids"]]
        if listed is None:
            # Not resolvable in OpenAlex: fall back to normalised names.
            listed = [[_name_key(n), n] for n in (d.get("authors") or []) if n.strip()]
        aids = []
        for aid, name in listed:
            if aid not in authors:
                authors[aid] = name
            if aid not in aids:
                aids.append(aid)
        papers[pid] = {
            "title": d.get("title") or "",
            "year": d.get("date"),
            "category_id": d.get("category_id") or 0,
            "stub": d.get("stub_document") == "yes",
            "cited_by_count": d.get("cited_by_count") or 0,
            "file": d.get("file") or "",
            "authors": aids,
        }

    citations = [(pid, ref) for pid, d in docs.items()
                 for ref in set(d.get("referenced_work_ids") or [])
                 if ref in papers and ref != pid]
    # how many citation links each paper has inside the library (in + out)
    degree = collections.Counter()
    for src_pid, dst_pid in citations:
        degree[src_pid] += 1
        degree[dst_pid] += 1

    # every author is saved to the authors database with their OpenAlex profile;
    # new ones (from papers added since the last build) are fetched here
    try:
        profiles = authors_db.sync(papers, authors)
    except Exception as e:
        print(f"[mafia] authors database sync failed: {e}")
        profiles = {}

    return {"built_at": time.time(), "doc_count": len(docs), "papers": papers,
            "authors": authors, "citations": citations, "degree": degree,
            "profiles": profiles}


def _get_state(refresh=False):
    global _state
    with _lock:
        stale = _state is None or time.time() - _state["built_at"] > REBUILD_AFTER_S
        if refresh or stale:
            _state = _build()
        return _state


# ── Network for a selection of papers ─────────────────────────────────────────

def topic_papers(query, expand=False):
    """Paper ids matching a search query, over every paper (stubs included).

    With expand, also the papers tied to the hits by citation, so the map shows who
    works around a topic, not only who wrote the matching titles. A paper qualifies
    when it cites (or is cited by) at least TOPIC_MIN_TIES hits AND at least
    TOPIC_MIN_SHARE of all its citation links in the library go to or from the hits:
    the second rule keeps out the classics everybody cites (a 1951 protein assay is
    tied to every topic, but only a sliver of its links are about any one of them).
    """
    st = _get_state()
    resp = corelamo.search(query, docs=TOPIC_HITS, return_fields={"title": True})
    resp.raise_for_status()
    hits = {d["id"] for d in resp.json().get("data", []) if d["id"] in st["papers"]}
    if expand:
        ties = collections.Counter()
        for src_pid, dst_pid in st["citations"]:
            if dst_pid in hits and src_pid not in hits:
                ties[src_pid] += 1
            elif src_pid in hits and dst_pid not in hits:
                ties[dst_pid] += 1
        degree = st["degree"]
        hits |= {pid for pid, n in ties.items()
                 if n >= TOPIC_MIN_TIES and n / max(1, degree[pid]) >= TOPIC_MIN_SHARE}
    return hits


_selection_cache = collections.OrderedDict()
SELECTION_CACHE_SIZE = 8


def _selection(category_ids=None, year_from=None, year_to=None, paper_ids=None,
               query=None, expand=False, full_only=False):
    """Everything the map needs for one filter selection: the papers, who wrote
    them, and how often each pair of authors co-authors / cites. Cached, so
    expanding an author doesn't recompute it."""
    st = _get_state()
    key = (st["built_at"], frozenset(category_ids or ()), year_from, year_to,
           frozenset(paper_ids) if paper_ids is not None else None,
           query or None, bool(expand), bool(full_only))
    with _lock:
        if key in _selection_cache:
            _selection_cache.move_to_end(key)
            return _selection_cache[key]

    papers = st["papers"]
    if query:
        found = topic_papers(query, expand)
        paper_ids = found if paper_ids is None else set(paper_ids) & found

    def selected(pid):
        p = papers[pid]
        if paper_ids is not None and pid not in paper_ids:
            return False
        if full_only and p["stub"]:
            return False
        if category_ids and p["category_id"] not in category_ids:
            return False
        if year_from and (p["year"] or 0) < year_from:
            return False
        if year_to and (p["year"] or 9999) > year_to:
            return False
        return True

    sel = {pid for pid in papers if selected(pid)}

    author_papers = collections.defaultdict(list)
    for pid in sel:
        for aid in papers[pid]["authors"]:
            author_papers[aid].append(pid)

    coauthor = collections.Counter()
    for pid in sel:
        aids = sorted(papers[pid]["authors"])
        if len(aids) > MAX_COAUTHORS:
            continue
        for i in range(len(aids)):
            for j in range(i + 1, len(aids)):
                coauthor[(aids[i], aids[j])] += 1

    cites = collections.Counter()
    field_matrix = collections.Counter()
    for src_pid, dst_pid in st["citations"]:
        if src_pid not in sel or dst_pid not in sel:
            continue
        field_matrix[(papers[src_pid]["category_id"], papers[dst_pid]["category_id"])] += 1
        dst_authors = papers[dst_pid]["authors"]
        for a in papers[src_pid]["authors"]:
            for b in dst_authors:
                if a != b:
                    cites[(a, b)] += 1

    cites_out, cites_in = collections.Counter(), collections.Counter()
    for (a, b), w in cites.items():
        cites_out[a] += w
        cites_in[b] += w
    coauthored = collections.Counter()
    for (a, b), w in coauthor.items():
        coauthored[a] += w
        coauthored[b] += w

    # each author's neighbours with the strongest link of either kind
    neighbours = collections.defaultdict(dict)
    for counter in (cites, coauthor):
        for (a, b), w in counter.items():
            if w > neighbours[a].get(b, 0):
                neighbours[a][b] = w
            if w > neighbours[b].get(a, 0):
                neighbours[b][a] = w

    result = {
        "sel": sel, "author_papers": author_papers, "coauthor": coauthor,
        "cites": cites, "field_matrix": field_matrix, "cites_out": cites_out,
        "cites_in": cites_in, "coauthored": coauthored, "neighbours": neighbours,
    }
    with _lock:
        _selection_cache[key] = result
        while len(_selection_cache) > SELECTION_CACHE_SIZE:
            _selection_cache.popitem(last=False)
    return result


def _author_row(st, sx, aid, shown, min_weight):
    papers = st["papers"]
    fields = collections.Counter(papers[pid]["category_id"] for pid in sx["author_papers"][aid])
    real = [c for c in fields if c != 0]
    profile = st.get("profiles", {}).get(aid) or {}
    return {
        "id": aid,
        "name": st["authors"].get(aid, ""),
        "papers": len(sx["author_papers"][aid]),
        "fields": {str(c): n for c, n in fields.most_common()},
        "category_id": real[0] if len(real) == 1 else (None if real else 0),
        "multi": len(real) > 1,
        "cites_out": sx["cites_out"][aid],
        "cited_in": sx["cites_in"][aid],
        "coauthored": sx["coauthored"][aid],
        "more": _hidden_count(sx, aid, shown, min_weight),
        # their whole career, from the authors database
        "citations": profile.get("cited_by_count") or 0,
        "h_index": profile.get("h_index") or 0,
    }


def _hidden_count(sx, aid, shown, min_weight):
    """How many authors this one links to (at min_weight) that aren't on the map."""
    return sum(1 for b, w in sx["neighbours"].get(aid, {}).items()
               if w >= min_weight and b not in shown)


def _links_between(sx, new, everyone, min_weight):
    """Links (at min_weight) with at least one end in `new`, both ends in `everyone`."""
    links = []
    for kind, counter in (("cite", sx["cites"]), ("coauthor", sx["coauthor"])):
        for (a, b), w in counter.items():
            if w >= min_weight and (a in new or b in new) and a in everyone and b in everyone:
                links.append({"from": a, "to": b, "type": kind, "weight": w})
    return links


def _pick_connected(ranked, neighbours, min_weight, limit):
    """The best-ranked authors such that every one links (at min_weight) to at least
    one other picked author: walking down the ranking, an author joins once someone
    they link to has joined (or is waiting, then both join)."""
    picked, picked_set = [], set()
    waiting = {}   # author -> rank position, linked to nobody picked yet

    def add(a):
        picked.append(a)
        picked_set.add(a)
        waiting.pop(a, None)

    for i, a in enumerate(ranked):
        if len(picked) >= limit:
            break
        linked = [b for b, w in neighbours.get(a, {}).items() if w >= min_weight]
        if any(b in picked_set for b in linked):
            joined = [a]
        else:
            partner = min((b for b in linked if b in waiting), key=waiting.get, default=None)
            # a pair joins only together: one of them alone would have no link
            if partner is None or len(picked) + 2 > limit:
                waiting[a] = i
                continue
            joined = [partner, a]
        # newcomers, then whoever was waiting for one of them, best-ranked first
        while joined and len(picked) < limit:
            newcomer = joined.pop(0)
            if newcomer in picked_set:
                continue
            add(newcomer)
            joined += sorted((b for b in waiting
                              if neighbours.get(b, {}).get(newcomer, 0) >= min_weight), key=waiting.get)
    return picked


def network(category_ids=None, year_from=None, year_to=None, paper_ids=None,
            query=None, expand=False, full_only=False,
            limit=250, min_weight=1, include=None, linked_only=True, refresh=False):
    st = _get_state(refresh)
    papers = st["papers"]
    sx = _selection(category_ids, year_from, year_to, paper_ids, query, expand, full_only)
    sel, author_papers = sx["sel"], sx["author_papers"]

    # When there are more authors than fit, show the most cited scientists (career
    # citations, OpenAlex) among those in this selection, how connected they are here
    # breaking ties. With linked_only ("hide unconnected"), only authors who link to
    # someone else on the map are picked, so `limit` connected authors are shown;
    # without it, simply the top `limit` (some of them alone).
    profiles = st.get("profiles", {})

    def connectivity(aid):
        return (sx["cites_in"][aid] + sx["cites_out"][aid] + sx["coauthored"][aid]
                + len(author_papers[aid]))

    def rank(aid):
        return ((profiles.get(aid) or {}).get("cited_by_count") or 0, connectivity(aid))

    order = sorted(author_papers, key=rank, reverse=True)
    if linked_only:
        ranked = _pick_connected(order, sx["neighbours"], min_weight, max(1, limit))
    else:
        ranked = order[:max(1, limit)]
    # authors the user expanded into the map stay on it while they're in the selection
    extra = [a for a in (include or ()) if a in author_papers and a not in set(ranked)]
    ranked += extra
    shown = set(ranked)

    out_authors = [_author_row(st, sx, aid, shown, min_weight) for aid in ranked]
    links = _links_between(sx, shown, shown, min_weight)

    field_matrix = sx["field_matrix"]
    used_cats = sorted({c for pair in field_matrix for c in pair}
                       | {papers[p]["category_id"] for p in sel})
    matrix = [[field_matrix.get((s, d), 0) for d in used_cats] for s in used_cats]
    years = [papers[p]["year"] for p in papers if papers[p]["year"]]
    per_category = collections.Counter(papers[p]["category_id"] for p in sel)

    return {
        "authors": out_authors,
        "links": links,
        "linked_only": linked_only,
        "field_matrix": {"category_ids": used_cats, "counts": matrix,
                         "papers": [per_category.get(c, 0) for c in used_cats]},
        "categories": get_all_categories(),
        "stats": {
            "papers": len(sel),
            "authors_total": len(author_papers),
            "authors_shown": len(out_authors),
            "cite_links": sum(1 for l in links if l["type"] == "cite"),
            "coauthor_links": sum(1 for l in links if l["type"] == "coauthor"),
            "paper_citations": sum(field_matrix.values()),
            "year_min": min(years) if years else None,
            "year_max": max(years) if years else None,
        },
    }


def expand_author(author_id, shown, count=12, min_weight=1, **filters):
    """The `count` strongest connections of an author that aren't on the map yet,
    with their links to everyone on it, and the new hidden-connection counts."""
    st = _get_state()
    sx = _selection(**filters)
    shown = set(shown) | {author_id}
    candidates = sorted(
        ((b, w) for b, w in sx["neighbours"].get(author_id, {}).items()
         if w >= min_weight and b not in shown),
        key=lambda bw: -bw[1],
    )[:max(1, count)]
    new = {b for b, _ in candidates}
    everyone = shown | new

    links = _links_between(sx, new, everyone, min_weight)
    touched = new | {author_id} | {l["from"] for l in links} | {l["to"] for l in links}
    return {
        "authors": [_author_row(st, sx, b, everyone, min_weight) for b, _ in candidates],
        "links": links,
        # hidden counts that changed: the new authors, and everyone they link to
        "more": {a: _hidden_count(sx, a, everyone, min_weight) for a in touched if a in everyone},
    }


def author_papers(author_id):
    st = _get_state()
    out = [{"id": pid, **{k: p[k] for k in ("title", "year", "category_id",
                                             "stub", "cited_by_count", "file")}}
           for pid, p in st["papers"].items() if author_id in p["authors"]]
    out.sort(key=lambda p: -(p["year"] or 0))
    return {"id": author_id, "name": st["authors"].get(author_id, ""), "papers": out}


# ── Career profile (OpenAlex, not just what's in our library) ─────────────────

PROFILE_TTL_S = 24 * 3600
_profiles = {}  # author id -> (fetched_at, profile)


def author_profile(author_id):
    """The scientist's whole record from OpenAlex: works, citations, h-index,
    institutions, ORCID, main topics. None for authors without an OpenAlex id."""
    if not re.match(r"^A\d+$", author_id or ""):
        return None
    saved = (_state or {}).get("profiles", {}).get(author_id)
    if saved and saved.get("profile_updated"):
        return {
            "id": author_id, "name": saved.get("name") or "", "orcid": saved.get("orcid") or None,
            "works": saved.get("works_count") or 0, "citations": saved.get("cited_by_count") or 0,
            "h_index": saved.get("h_index"), "i10_index": saved.get("i10_index"),
            "institutions": [{"name": n, "country": None} for n in saved.get("institutions") or []],
            "topics": saved.get("topics") or [],
        }
    cached = _profiles.get(author_id)
    if cached and time.time() - cached[0] < PROFILE_TTL_S:
        return cached[1]
    resp = requests.get(
        f"https://api.openalex.org/authors/{author_id}",
        params={"select": "id,display_name,orcid,works_count,cited_by_count,"
                          "summary_stats,last_known_institutions,topics"},
        headers={"User-Agent": USER_AGENT}, timeout=15,
    )
    if resp.status_code != 200:
        return None
    d = resp.json()
    stats = d.get("summary_stats") or {}
    profile = {
        "id": author_id,
        "name": d.get("display_name") or "",
        "orcid": d.get("orcid"),
        "works": d.get("works_count") or 0,
        "citations": d.get("cited_by_count") or 0,
        "h_index": stats.get("h_index"),
        "i10_index": stats.get("i10_index"),
        "mean_citedness_2yr": stats.get("2yr_mean_citedness"),
        "institutions": [
            {"name": i.get("display_name"), "country": i.get("country_code")}
            for i in (d.get("last_known_institutions") or [])[:3]
        ],
        "topics": [t.get("display_name") for t in (d.get("topics") or [])[:4]],
    }
    _profiles[author_id] = (time.time(), profile)
    return profile

