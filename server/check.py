from src.graph_db import get_conn

def check_links():
    with get_conn() as conn:

        # ── 1. COVERAGE ───────────────────────────────────────────────────────
        total_docs = conn.execute(
            "SELECT COUNT(*) FROM documents"
        ).fetchone()[0]

        linked_docs = conn.execute(
            """
            SELECT COUNT(DISTINCT id) FROM documents
            WHERE id IN (SELECT from_id FROM document_links)
               OR id IN (SELECT to_id   FROM document_links)
            """
        ).fetchone()[0]

        isolated_docs = total_docs - linked_docs

        print("=" * 55)
        print("1. COVERAGE")
        print("=" * 55)
        print(f"  Total documents        : {total_docs}")
        print(f"  Linked (any edge)      : {linked_docs}  ({_pct(linked_docs, total_docs)})")
        print(f"  Isolated (no edges)    : {isolated_docs}  ({_pct(isolated_docs, total_docs)})")

        # ── 2. REFERENCE RESOLUTION RATE ─────────────────────────────────────
        total_refs = conn.execute(
            "SELECT COUNT(*) FROM document_references"
        ).fetchone()[0]

        resolved_refs = conn.execute(
            """
            SELECT COUNT(*) FROM document_references dr
            JOIN documents d ON LOWER(d.doi) = LOWER(dr.to_doi)
            WHERE dr.from_id != d.id
            """
        ).fetchone()[0]

        unresolved_refs = total_refs - resolved_refs

        print()
        print("=" * 55)
        print("2. REFERENCE RESOLUTION RATE")
        print("=" * 55)
        print(f"  Total raw references   : {total_refs}")
        print(f"  Resolved (in DB)       : {resolved_refs}  ({_pct(resolved_refs, total_refs)})")
        print(f"  Unresolved (missing)   : {unresolved_refs}  ({_pct(unresolved_refs, total_refs)})")

        # avg references per document
        avg_refs = conn.execute(
            """
            SELECT ROUND(AVG(c), 2) FROM (
                SELECT COUNT(*) AS c FROM document_references GROUP BY from_id
            )
            """
        ).fetchone()[0]
        avg_resolved = conn.execute(
            """
            SELECT ROUND(AVG(c), 2) FROM (
                SELECT COUNT(*) AS c FROM document_links GROUP BY from_id
            )
            """
        ).fetchone()[0]

        print(f"  Avg refs per doc       : {avg_refs}")
        print(f"  Avg resolved per doc   : {avg_resolved or 0}")

        # ── 3. AUTHOR LINK SANITY ─────────────────────────────────────────────
        total_authors         = conn.execute("SELECT COUNT(*) FROM authors").fetchone()[0]
        total_doc_links       = conn.execute("SELECT COUNT(*) FROM document_links").fetchone()[0]
        total_author_cit      = conn.execute("SELECT COUNT(*) FROM author_citation_links").fetchone()[0]
        total_coauthor        = conn.execute("SELECT COUNT(*) FROM coauthor_links").fetchone()[0]

        # expected author_citation_links = sum of (from_authors * to_authors) per doc_link
        expected_author_cit = conn.execute(
            """
            SELECT SUM(fa.cnt * ta.cnt)
            FROM document_links dl
            JOIN (SELECT doc_id, COUNT(*) AS cnt FROM authors GROUP BY doc_id) fa
                ON fa.doc_id = dl.from_id
            JOIN (SELECT doc_id, COUNT(*) AS cnt FROM authors GROUP BY doc_id) ta
                ON ta.doc_id = dl.to_id
            """
        ).fetchone()[0] or 0

        match = "OK" if total_author_cit == expected_author_cit else "MISMATCH"

        print()
        print("=" * 55)
        print("3. AUTHOR LINK SANITY")
        print("=" * 55)
        print(f"  Total authors          : {total_authors}")
        print(f"  Total document_links   : {total_doc_links}")
        print(f"  author_citation_links  : {total_author_cit}")
        print(f"  Expected (N*M sum)     : {expected_author_cit}  [{match}]")
        print(f"  coauthor_links         : {total_coauthor}")

        # docs with no authors at all
        docs_no_authors = conn.execute(
            """
            SELECT COUNT(*) FROM documents
            WHERE id NOT IN (SELECT DISTINCT doc_id FROM authors)
            """
        ).fetchone()[0]
        print(f"  Docs with no authors   : {docs_no_authors}")

        print()


def _pct(part, total):
    if not total:
        return "n/a"
    return f"{round(100 * part / total, 1)}%"


if __name__ == "__main__":
    check_links()
