#!/bin/bash

count=0
missing=()

for id in $(seq 1 117); do
  result=$(curl -s http://localhost:8081/api/databases/pdfs/retrieve \
    -u "a:a" \
    -d "<document><id>$id</id></document>" | grep -o '<doi_number>[^<]*</doi_number>')
  
  if [ -n "$result" ]; then
    ((count++))
    echo "[$id] ✓ $result"
  else
    missing+=($id)
    echo "[$id] ✗ no doi_number"
  fi
done

echo ""
echo "================================"
echo "Successful: $count / 117"
echo "Missing IDs: ${missing[*]}"
