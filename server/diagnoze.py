"""
Diagnose why the citation graph is sparse.

Run from the same directory as graph_db.py:
    python diagnose_graph.py

Or with a custom path:
    python diagnose_graph.py /path/to/graph.db
"""
import sqlite3
import sys
import os
import re
from collections import Counter

DB_PATH = sys.argv[1] if len(sys.argv) > 1 else "./chart-data/graph.db"

if not os.path.exists(DB_PATH):
    print(f"ERROR: DB not found at {DB_PATH}")
    sys.exit(1)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

def q(sql, params=()):
    return conn.execute(sql, params).fetchall()

def one(sql, params=()):
    r = conn.execute(sql, params).fetchone()
    return r[0] if r else None

print("=" * 70)
print(f" DB: {DB_PATH}")
print("=" * 70)

# ── 1. High-level counts ────────────────────────────────────────────────
print("\n[1] HIGH-LEVEL COUNTS")
print("-" * 70)
total_docs      = one("SELECT COUNT(*) FROM documents")
real_doi_docs   = one("SELECT COUNT(*) FROM documents WHERE has_real_doi = 1")
orphan_docs     = one("SELECT COUNT(*) FROM documents WHERE has_real_doi = 0")
total_citations = one("SELECT COUNT(*) FROM citations")
total_pending   = one("SELECT COUNT(*) FROM pending_citations")
total_authors   = one("SELECT COUNT(*) FROM authors")

print(f"  Documents total:          {total_docs}")
print(f"    with real DOI:          {real_doi_docs}")
print(f"    orphans (no DOI):       {orphan_docs}")
print(f"  Citations (internal):     {total_citations}")
print(f"  Pending citations:        {total_pending}  ← refs to docs not yet in DB")
print(f"  Authors:                  {total_authors}")

# ── 2. Are pending_citations the main issue? ───────────────────────────
print("\n[2] PENDING CITATIONS (refs to DOIs not in DB)")
print("-" * 70)
if total_pending > 0:
    # Top targets: DOIs that many of your docs cite but you don't have the PDF for
    top_targets = q("""
        SELECT to_doi, COUNT(*) as n
        FROM pending_citations
        GROUP BY to_doi
        ORDER BY n DESC
        LIMIT 10
    """)
    print("  Most-cited missing DOIs (you don't have these PDFs uploaded):")
    for r in top_targets:
        print(f"    {r['n']:3}×  {r['to_doi']}")

    # How many of your own docs have at least one pending ref?
    docs_with_pending = one("""
        SELECT COUNT(DISTINCT from_doi) FROM pending_citations
    """)
    print(f"\n  {docs_with_pending}/{real_doi_docs} of your DOI'd docs have pending refs")
else:
    print("  None. Every referenced DOI is in the DB (or no docs have refs).")

# ── 3. Docs with ZERO references from Crossref ────────────────────────
print("\n[3] REFERENCE COVERAGE FROM CROSSREF")
print("-" * 70)
# Reconstruct: for each doc, how many refs (realized or pending) did it contribute?
ref_stats = q("""
    SELECT d.doi, d.title, d.filename,
           (SELECT COUNT(*) FROM citations         WHERE from_doi = d.doi) AS realized,
           (SELECT COUNT(*) FROM pending_citations WHERE from_doi = d.doi) AS pending
    FROM documents d
    WHERE d.has_real_doi = 1
""")

with_refs    = [r for r in ref_stats if (r["realized"] + r["pending"]) > 0]
without_refs = [r for r in ref_stats if (r["realized"] + r["pending"]) == 0]

print(f"  Docs with ≥1 outgoing ref (realized or pending): {len(with_refs)}")
print(f"  Docs with ZERO outgoing refs from Crossref:      {len(without_refs)}")

if without_refs:
    print(f"\n  ⚠ These {len(without_refs)} docs returned NO references from Crossref:")
    print(f"    (likely cause: older papers, non-indexed journals, or Crossref just")
    print(f"     doesn't have their reference list)")
    for r in without_refs[:10]:
        title = (r["title"] or r["filename"] or "?")[:60]
        print(f"    • {r['doi']}  {title}")
    if len(without_refs) > 10:
        print(f"    ... and {len(without_refs) - 10} more")

# ── 4. Distribution of outgoing-ref counts ─────────────────────────────
print("\n[4] OUTGOING-REFERENCE DISTRIBUTION")
print("-" * 70)
totals = [r["realized"] + r["pending"] for r in ref_stats]
if totals:
    buckets = Counter()
    for t in totals:
        if t == 0:          buckets["0"] += 1
        elif t <= 5:        buckets["1-5"] += 1
        elif t <= 20:       buckets["6-20"] += 1
        elif t <= 50:       buckets["21-50"] += 1
        else:               buckets["50+"] += 1
    for k in ["0", "1-5", "6-20", "21-50", "50+"]:
        bar = "█" * min(40, buckets[k])
        print(f"    {k:6} refs: {buckets[k]:4}  {bar}")
    print(f"\n  Mean refs/doc:   {sum(totals)/len(totals):.1f}")
    print(f"  Median refs/doc: {sorted(totals)[len(totals)//2]}")

# ── 5. Conversion rate: what % of Crossref refs are in your library? ──
print("\n[5] 'HIT RATE' — % OF REFS THAT LANDED AS REAL EDGES")
print("-" * 70)
total_realized = sum(r["realized"] for r in ref_stats)
total_pending_per_doc = sum(r["pending"] for r in ref_stats)
total_refs_seen = total_realized + total_pending_per_doc

if total_refs_seen > 0:
    hit_rate = 100 * total_realized / total_refs_seen
    print(f"  Crossref gave you:        {total_refs_seen} total reference DOIs")
    print(f"  You have the PDF for:     {total_realized} of them  ({hit_rate:.1f}%)")
    print(f"  Missing (pending):        {total_pending_per_doc}  ({100-hit_rate:.1f}%)")
    print()
    if hit_rate < 5:
        print("  ⚠ HIT RATE IS VERY LOW.")
        print("    Your library is too sparse — papers rarely cite each other's")
        print("    DOIs within your uploaded set. This is EXPECTED unless you're")
        print("    uploading papers from a tight research cluster. Solutions:")
        print("      • Upload more papers from the same field/author network")
        print("      • Focus uploads on papers that cite each other")
        print("      • Accept that most edges will come from a dense core")
else:
    print("  No refs extracted at all — Crossref returned empty for every doc.")

# ── 6. DOI format sanity check ─────────────────────────────────────────
print("\n[6] DOI FORMAT SANITY CHECK")
print("-" * 70)
sample_dois    = [r[0] for r in q("SELECT doi FROM documents WHERE has_real_doi=1 LIMIT 20")]
sample_pending = [r[0] for r in q("SELECT to_doi FROM pending_citations LIMIT 20")]

def looks_weird(d):
    # Real DOIs start with "10." followed by 4-9 digits then "/"
    return not re.match(r"^10\.\d{4,9}/", d or "")

weird_docs     = [d for d in sample_dois    if looks_weird(d)]
weird_pending  = [d for d in sample_pending if looks_weird(d)]

print(f"  Sample doc DOIs checked:     {len(sample_dois)}, weird: {len(weird_docs)}")
if weird_docs:
    for d in weird_docs[:5]:
        print(f"    ⚠ {d}")

print(f"  Sample pending DOIs checked: {len(sample_pending)}, weird: {len(weird_pending)}")
if weird_pending:
    for d in weird_pending[:5]:
        print(f"    ⚠ {d}")

# Case mismatch check
mixed_case_docs = one("""
    SELECT COUNT(*) FROM documents WHERE doi != LOWER(doi) AND has_real_doi=1
""")
mixed_case_refs = one("""
    SELECT COUNT(*) FROM pending_citations WHERE to_doi != LOWER(to_doi)
""")
print(f"\n  Uppercase DOIs in documents:         {mixed_case_docs}  (should be 0)")
print(f"  Uppercase DOIs in pending_citations: {mixed_case_refs}  (should be 0)")

# Bonus: near-miss check — pending DOI that matches a doc DOI case-insensitively
near_miss = q("""
    SELECT pc.to_doi, d.doi
    FROM pending_citations pc
    JOIN documents d ON LOWER(pc.to_doi) = LOWER(d.doi)
    WHERE pc.to_doi != d.doi
    LIMIT 10
""")
if near_miss:
    print(f"\n  ⚠ {len(near_miss)} CASE-MISMATCH NEAR MISSES — these would become edges after cleanup:")
    for r in near_miss:
        print(f"    pending: {r['to_doi']}  vs  doc: {r['doi']}")

# ── 7. Top "hub" docs (most internally cited) ──────────────────────────
print("\n[7] TOP 10 HUB DOCS (most internally cited)")
print("-" * 70)
hubs = q("""
    SELECT doi, title, filename, internal_citation_count, cited_by_count
    FROM documents
    WHERE internal_citation_count > 0
    ORDER BY internal_citation_count DESC
    LIMIT 10
""")
if hubs:
    for r in hubs:
        title = (r["title"] or r["filename"] or "?")[:55]
        print(f"    {r['internal_citation_count']:3}× internal / {r['cited_by_count']:5} crossref  {title}")
else:
    print("  No docs are internally cited. Graph has no edges.")

# ── 8. Isolated docs (no edges in or out) ──────────────────────────────
print("\n[8] ISOLATED DOCS (no edges in or out)")
print("-" * 70)
isolated = one("""
    SELECT COUNT(*) FROM documents
    WHERE doi NOT IN (SELECT from_doi FROM citations)
      AND doi NOT IN (SELECT to_doi   FROM citations)
""")
print(f"  {isolated}/{total_docs} docs are isolated  ({100*isolated/max(total_docs,1):.0f}%)")

# ── Verdict ────────────────────────────────────────────────────────────
print("\n" + "=" * 70)
print(" LIKELY VERDICT")
print("=" * 70)
if total_refs_seen == 0:
    print(" → Crossref returned no references for any doc. Check crossref_by_doi()")
    print("   — is it actually being called in the DOI-found path?")
elif total_pending_per_doc > 10 * total_realized:
    print(" → Your library is SPARSE relative to citation space. Most refs point")
    print("   to DOIs you haven't uploaded. This is normal unless your uploads")
    print("   form a tight research cluster. Upload more closely-related papers.")
elif len(without_refs) > 0.5 * real_doi_docs:
    print(" → More than half your docs got ZERO refs from Crossref. Either those")
    print("   papers aren't well-indexed, or Crossref is being called with bad")
    print("   DOIs. Check server logs for 'Graph DB updated — 0 reference DOIs'.")
elif mixed_case_refs > 0 or mixed_case_docs > 0:
    print(" → DOI casing is inconsistent. Run the fix in graph_db.py (already")
    print("   done) and re-upload, OR run a migration to lowercase everything.")
else:
    print(" → Graph looks reasonable for its size. If it still feels sparse,")
    print("   you probably just need to upload more papers.")

conn.close()
