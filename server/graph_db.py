import sqlite3
import os
import math

DB_PATH = os.path.join(os.path.dirname(__file__), "chart_data.db")

YEAR_COLORS = [
    (2000, "rgba(149,117,205,0.85)"),   # pre-2000 — purple
    (2005, "rgba(66,165,245,0.85)"),    # 2000–2005 — blue
    (2010, "rgba(38,198,218,0.85)"),    # 2006–2010 — cyan
    (2015, "rgba(102,187,106,0.85)"),   # 2011–2015 — green
    (9999, "rgba(255,167,38,0.85)"),    # 2016+     — orange
]

def year_to_color(year):
    if not year:
        return "rgba(150,150,150,0.85)"
    for cutoff, color in YEAR_COLORS:
        if year <= cutoff:
            return color
    return YEAR_COLORS[-1][1]

def citation_to_radius(count):
    if not count or count <= 0:
        return 10
    return max(10, math.sqrt(count) * 3)

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS papers (
            doi       TEXT PRIMARY KEY,
            title     TEXT,
            year      INTEGER,
            citation_count INTEGER DEFAULT 0,
            filename  TEXT
        );
        CREATE TABLE IF NOT EXISTS authors (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE
        );
        CREATE TABLE IF NOT EXISTS paper_authors (
            doi       TEXT,
            author_id INTEGER,
            PRIMARY KEY (doi, author_id)
        );
        CREATE TABLE IF NOT EXISTS citations (
            from_doi TEXT,
            to_doi   TEXT,
            PRIMARY KEY (from_doi, to_doi)
        );
    """)
    conn.commit()
    conn.close()

def upsert_paper(doi, title, year, citation_count, filename, authors, references):
    if not doi:
        return
    doi = doi.lower()
    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        INSERT INTO papers (doi, title, year, citation_count, filename)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(doi) DO UPDATE SET
            title          = excluded.title,
            year           = excluded.year,
            citation_count = excluded.citation_count,
            filename       = excluded.filename
    """, (doi, title, year, citation_count or 0, filename))

    for name in authors:
        name = name.strip()
        if not name:
            continue
        c.execute("INSERT OR IGNORE INTO authors (name) VALUES (?)", (name,))
        c.execute("SELECT id FROM authors WHERE name = ?", (name,))
        aid = c.fetchone()[0]
        c.execute("INSERT OR IGNORE INTO paper_authors (doi, author_id) VALUES (?, ?)", (doi, aid))

    for ref in references:
        ref_doi = ref.get("DOI")
        if ref_doi:
            c.execute("INSERT OR IGNORE INTO citations (from_doi, to_doi) VALUES (?, ?)",
                      (doi, ref_doi.lower()))

    conn.commit()
    conn.close()


def build_document_graph(year_from=None, year_to=None, linked_only=False):
    conn = get_conn()
    c = conn.cursor()

    query = "SELECT * FROM papers WHERE doi IS NOT NULL"
    params = []
    if year_from:
        query += " AND year >= ?"
        params.append(year_from)
    if year_to:
        query += " AND year <= ?"
        params.append(year_to)

    c.execute(query, params)
    papers = [dict(r) for r in c.fetchall()]

    if not papers:
        conn.close()
        return {"nodes": [], "links": []}

    doi_set = {p["doi"] for p in papers}
    ph = ",".join("?" * len(doi_set))
    doi_list = list(doi_set)

    c.execute(f"""
        SELECT from_doi, to_doi FROM citations
        WHERE from_doi IN ({ph}) AND to_doi IN ({ph})
    """, doi_list + doi_list)
    citations = [dict(r) for r in c.fetchall()]

    conn.close()

    if linked_only:
        linked_dois = set()
        for ci in citations:
            linked_dois.add(ci["from_doi"])
            linked_dois.add(ci["to_doi"])
        papers = [p for p in papers if p["doi"] in linked_dois]

    nodes = [
        {
            "id":     p["doi"],
            "loaded": True,
            "style":  {
                "fillColor": year_to_color(p["year"]),
                "label":     p["title"] or p["doi"],
                "radius":    citation_to_radius(p["citation_count"]),
            }
        }
        for p in papers
    ]

    links = [
        {
            "id":    f"{ci['from_doi']}->{ci['to_doi']}",
            "from":  ci["from_doi"],
            "to":    ci["to_doi"],
            "style": {
                "fillColor":    "rgba(255,255,255,0.3)",
                "toDecoration": "arrow",
            }
        }
        for ci in citations
        if ci["from_doi"] in {p["doi"] for p in papers}
        and ci["to_doi"]   in {p["doi"] for p in papers}
    ]

    return {"nodes": nodes, "links": links}


def build_author_graph():
    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        SELECT a.id, a.name
        FROM authors a
        JOIN paper_authors pa ON a.id = pa.author_id
        GROUP BY a.id
    """)
    authors = [dict(r) for r in c.fetchall()]

    # Co-authorship edges (same paper) — count shared papers for width
    c.execute("""
        SELECT pa1.author_id AS a1, pa2.author_id AS a2, COUNT(*) AS shared
        FROM paper_authors pa1
        JOIN paper_authors pa2
          ON pa1.doi = pa2.doi AND pa1.author_id < pa2.author_id
        GROUP BY pa1.author_id, pa2.author_id
    """)
    coauthors = [dict(r) for r in c.fetchall()]

    # Cross-reference edges (author A's paper cites author B's paper)
    c.execute("""
        SELECT DISTINCT pa1.author_id AS from_a, pa2.author_id AS to_a
        FROM citations ci
        JOIN paper_authors pa1 ON ci.from_doi = pa1.doi
        JOIN paper_authors pa2 ON ci.to_doi   = pa2.doi
        WHERE pa1.author_id != pa2.author_id
    """)
    crossrefs = [dict(r) for r in c.fetchall()]

    conn.close()

    author_ids = {a["id"] for a in authors}

    nodes = [
        {
            "id":     f"a{a['id']}",
            "loaded": True,
            "style":  {
                "fillColor": "rgba(236,46,46,0.85)",
                "label":     a["name"],
                "radius":    12,
            }
        }
        for a in authors
    ]

    links = []

    for co in coauthors:
        if co["a1"] in author_ids and co["a2"] in author_ids:
            links.append({
                "id":    f"co-{co['a1']}-{co['a2']}",
                "from":  f"a{co['a1']}",
                "to":    f"a{co['a2']}",
                "style": {
                    "fillColor": "rgba(102,187,106,0.7)",
                    "width":     1 + co["shared"] * 2,  # thicker per shared paper
                }
            })

    existing_link_ids = {l["id"] for l in links}
    for cr in crossrefs:
        if cr["from_a"] in author_ids and cr["to_a"] in author_ids:
            lid = f"cr-{cr['from_a']}-{cr['to_a']}"
            if lid not in existing_link_ids:
                links.append({
                    "id":    lid,
                    "from":  f"a{cr['from_a']}",
                    "to":    f"a{cr['to_a']}",
                    "style": {
                        "fillColor":    "rgba(255,167,38,0.7)",
                        "toDecoration": "arrow",
                        "width":        2,
                    }
                })

    return {"nodes": nodes, "links": links}
