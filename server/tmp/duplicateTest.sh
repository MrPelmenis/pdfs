#!/bin/bash

declare -A doi_map
duplicates=0
found=0

for id in $(seq 1 117); do
  doi=$(curl -s http://localhost:8081/api/databases/pdfs/retrieve \
    -u "a:a" \
    -d "<document><id>$id</id></document>" | grep -o '<doi_number>[^<]*</doi_number>' | sed 's/<[^>]*>//g')

  if [ -n "$doi" ]; then
    ((found++))
    if [ -n "${doi_map[$doi]}" ]; then
      echo "DUPLICATE: '$doi' found in id=$id and id=${doi_map[$doi]}"
      ((duplicates++))
    else
      doi_map[$doi]=$id
    fi
  else
    echo "[$id] no doi_number"
  fi
done

echo ""
echo "================================"
echo "Total with DOI : $found / 117"
echo "Unique DOIs    : ${#doi_map[@]}"
echo "Duplicates     : $duplicates"
