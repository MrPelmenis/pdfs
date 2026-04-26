# How many references does Crossref have for each paper?
for doi in \
  "10.1086/333129" \
  "10.3181/00379727-133-34663" \
  "10.3181/00379727-30-6771" \
  "10.3181/00379727-32-7801" \
  "10.3181/00379727-46-13015"; do
  count=$(curl -s "https://api.crossref.org/works/$doi" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('message',{}).get('reference',[])))")
  echo "$doi: $count references"
done
