#!/usr/bin/env bash


TOKEN=7d3ecf43d7c3664686d4e0beabca5fddea11729f9bd4e84e5818665161d89195

OUTPUT_FILE="search_results_output.txt"
ENDPOINT="http://localhost:6006/api/databases/pdfs/search"

# Initialize or clear the output file
> "$OUTPUT_FILE"

# Array of test queries
queries=(
    # --- Group 1: Special Characters & Greek Symbols (Tests tokenizer & symbol handling) ---
    "β-tricalcium phosphate"
    "Ca/P ratios"
    "5′-end structure"

    # --- Group 2: Exact Multi-Word Phrases (Tests positional index & phrase scoring) ---
    "Preparation and properties of nanoparticles"
    "Controlled release of drugs"
    "Antibacterial activity of hybrid chitosan"

    # --- Group 3: Complex Semantic Queries (Tests vector embedding fallback without fuzzy lexicals) ---
    "how do nanoparticles penetrate cell membranes"
    "bone regeneration using ceramic scaffolds and growth factors"
    "mechanisms of drug release from polymer matrices"

    # --- Group 4: Strict OOV / Negative Controls (Fuzzy is OFF—these test error handling & zero-hit behavior) ---
    "calcjum phosphaet nanoparticles"
    "xyzqwerty123456789"
    "batman"
)

echo "Running search benchmarks and saving to $OUTPUT_FILE..."
echo "--------------------------------------------------------"

for q in "${queries[@]}"; do
    {
        echo "========================================================"
        echo "QUERY: $q"
        echo "========================================================"
    } | tee -a "$OUTPUT_FILE"

    # Execute curl, parse with jq, and output to both terminal and file
    curl -s -X POST "$ENDPOINT" \
         -H "Content-Type: application/json" \
         -H "X-Corelamo-Key: $TOKEN" \
         -d "{\"query\": \"$q\"}" | \
    jq -r '.title, (.data[]?.data.title // empty)' | tee -a "$OUTPUT_FILE"

    echo -e "\n" | tee -a "$OUTPUT_FILE"
done

echo "Done! All results saved to $OUTPUT_FILE"
