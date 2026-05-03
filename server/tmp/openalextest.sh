#!/usr/bin/env bash
# Tests the NEW OpenAlex search strategy for metadata_analyser.py
#
# Strategy:
#   Pass 1: ?search=TITLE                          broad, scored
#   Pass 2: ?filter=title.search:TITLE             strict title-only field
#           + client-side author surname check
#
# Run: bash test_openalex_strategy.sh
# Requires: curl, python3

EMAIL="normunds@email.com"
BASE="https://api.openalex.org/works"
SEL="id,display_name,authorships,publication_year,relevance_score,doi"

# ── helpers ──────────────────────────────────────────────────────────────────

# Pass 1: broad ?search=TITLE (5 results, scored)
search_broad() {
    local label="$1"
    local title="$2"
    local expected_id="$3"   # OpenAlex W-id we expect, or "unknown"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "PASS 1 — BROAD │ $label"
    echo "QUERY: $title"
    echo "──────────────────────────────────────────────────────"
    curl -s -G "$BASE" \
        --data-urlencode "search=$title" \
        -d "per_page=5" \
        -d "select=$SEL" \
        -H "User-Agent: pdf-magic/1.0 (mailto:$EMAIL)" \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('results', [])
expected = '$expected_id'
if not results:
    print('  NO RESULTS → return {}')
else:
    for i, r in enumerate(results):
        score  = r.get('relevance_score', 0)
        title  = (r.get('display_name') or '')[:75]
        year   = r.get('publication_year', '?')
        oa_id  = r.get('id', '').replace('https://openalex.org/', '')
        doi    = (r.get('doi') or '').replace('https://doi.org/', '')
        authors = [a['author']['display_name'] for a in r.get('authorships', [])[:3]]
        hit = ' ← MATCH' if oa_id == expected else ''
        print(f'  [{i+1}] score={score:.2f} | {year} | {oa_id}{hit}')
        print(f'       title={title}')
        print(f'       authors={authors}')
        print(f'       doi={doi}')
    if len(results) >= 2:
        s1 = results[0].get('relevance_score', 0)
        s2 = results[1].get('relevance_score', 0)
        gap = (s1 - s2) / s2 if s2 > 0 else 1.0
        verdict = 'ACCEPT (gap large)' if gap >= 0.60 else ('RETRY (gap small)' if s1 >= 30 else 'REJECT (score floor)')
        print(f'  → gap={gap:.1%}  top={s1:.2f}  second={s2:.2f}  → {verdict}')
"
    sleep 1
}

# Pass 2: strict ?filter=title.search:TITLE + client-side author check
search_strict() {
    local label="$1"
    local title="$2"
    local surnames="$3"       # comma-separated expected surnames e.g. "Stojanovic,Anic"
    local expected_id="$4"

    echo ""
    echo "  PASS 2 — STRICT TITLE FILTER │ $label"
    echo "  filter=title.search:$title"
    echo "  checking surnames: $surnames"
    echo "  ──────────────────────────────────────────────────"
    curl -s -G "$BASE" \
        --data-urlencode "filter=title.search:$title" \
        -d "per_page=5" \
        -d "select=$SEL" \
        -H "User-Agent: pdf-magic/1.0 (mailto:$EMAIL)" \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('results', [])
expected = '$expected_id'
surnames = [s.strip().lower() for s in '$surnames'.split(',') if s.strip()]
if not results:
    print('  NO RESULTS → return {}')
else:
    for i, r in enumerate(results):
        score  = r.get('relevance_score', 0)
        title  = (r.get('display_name') or '')[:75]
        year   = r.get('publication_year', '?')
        oa_id  = r.get('id', '').replace('https://openalex.org/', '')
        doi    = (r.get('doi') or '').replace('https://doi.org/', '')
        all_authors = [a['author']['display_name'] for a in r.get('authorships', [])]
        authors_lower = ' '.join(all_authors).lower()
        # client-side surname check
        matched = [s for s in surnames if s in authors_lower]
        author_hit = f'AUTHOR MATCH ({matched})' if matched else 'no author match'
        hit = ' ← MATCH' if oa_id == expected else ''
        print(f'  [{i+1}] score={score:.2f} | {year} | {oa_id}{hit}')
        print(f'       title={title}')
        print(f'       {author_hit} | authors={all_authors[:3]}')
        print(f'       doi={doi}')
    if len(results) >= 2:
        s1 = results[0].get('relevance_score', 0)
        s2 = results[1].get('relevance_score', 0)
        gap = (s1 - s2) / s2 if s2 > 0 else 1.0
        print(f'  → gap={gap:.1%}  top={s1:.2f}  second={s2:.2f}')
"
    sleep 1
}

# ── TESTS ────────────────────────────────────────────────────────────────────

echo "============================================================"
echo " OpenAlex NEW STRATEGY Calibration Tests"
echo " Thresholds under test:"
echo "   MIN_SCORE_FLOOR    = 30   (reject if top < this)"
echo "   MIN_SCORE_ABSOLUTE = 1000 (accept immediately if top >= this)"
echo "   SMALL_GAP_THRESH   = 0.60 (retry if gap < this)"
echo "============================================================"


# ── TEST 1: Clean modern title ────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo " TEST 1: Clean modern title + known authors"
echo "════════════════════════════════════════════════════════════"

search_broad \
    "Clean title, no authors" \
    "Nickel-calcium phosphate hydroxyapatite catalysts for partial oxidation of methane to syngas characterization and activation" \
    "unknown"

# if gap < 0.60 on pass 1, run pass 2:
search_strict \
    "Clean title strict + author check" \
    "Nickel-calcium phosphate hydroxyapatite catalysts partial oxidation methane syngas" \
    "Stojanovic,Anic,Najdanovic" \
    "unknown"


# ── TEST 2: Heavy OCR / old typewriter title ──────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo " TEST 2: Old typewriter OCR noise title"
echo "════════════════════════════════════════════════════════════"

# As GROBID/vision would see it (garbled)
search_broad \
    "Raw OCR garbled version" \
    "T H E SYSTEM P205-CaO-H20 AXD T H E RECRYSTALLIZATIOS O F lIO OCALCIU I PHOSPHATE" \
    "unknown"

# Cleaned version (what a good vision extractor might produce)
search_broad \
    "Cleaned version of old title" \
    "The system P2O5 CaO H2O and the recrystallization of monocalcium phosphate" \
    "unknown"

search_strict \
    "Strict filter cleaned old title" \
    "system P2O5 CaO recrystallization monocalcium phosphate" \
    "" \
    "unknown"


# ── TEST 3: Long descriptive title ───────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo " TEST 3: Long descriptive title"
echo "════════════════════════════════════════════════════════════"

search_broad \
    "Full long title" \
    "Effect of Storage at Specified Temperature and Humidity on Properties of Three Directly Compressible Tablet Formulations" \
    "unknown"

search_broad \
    "Truncated long title (GROBID line-break cut)" \
    "Effect of Storage at Specified Temperature and Humidity on Properties of" \
    "unknown"

search_strict \
    "Strict filter long title" \
    "Storage Temperature Humidity Directly Compressible Tablet Formulations" \
    "" \
    "unknown"


# ── TEST 4: Score floor validation (should reject) ────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo " TEST 4: Should be REJECTED (score floor = 30)"
echo "════════════════════════════════════════════════════════════"

search_broad \
    "Mildly noisy GROBID (split words, wrong chars)" \
    "Nickle calciurn phosphate hydroxapatite cataly sts partial oxida tion methan" \
    "unknown"

search_broad \
    "Completely wrong title (wrong paper loaded)" \
    "Introduction to polymer chemistry reaction kinetics" \
    "unknown"


# ── TEST 5: Gap threshold validation (small gap = needs retry) ────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo " TEST 5: Gap threshold — similar titles should trigger retry"
echo "════════════════════════════════════════════════════════════"

search_broad \
    "Ambiguous phosphate title (many similar papers)" \
    "Calcium phosphate crystallization" \
    "unknown"

search_broad \
    "Short ambiguous chemistry title" \
    "Hydroxyapatite synthesis characterization" \
    "unknown"


echo ""
echo "============================================================"
echo " SUMMARY — calibration targets:"
echo "   MIN_SCORE_FLOOR    = 30   → all scores below this = return {}"
echo "   MIN_SCORE_ABSOLUTE = 1000 → accept without gap check"
echo "   SMALL_GAP_THRESH   = 0.60 → below this triggers Pass 2"
echo ""
echo " Pass 2 logic: filter=title.search + client-side surname match"
echo "   if any surname matches top result → accept"
echo "   if no surname matches any result  → return {}"
echo "============================================================"
