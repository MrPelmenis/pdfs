import requests
import json

doi = "10.1016/j.materresbull.2008.09.047"
url = f"https://api.crossref.org/works/{doi}"

# Crossref "Polite" User-Agent
headers = {"User-Agent": "MetadataExplorer/1.0 (mailto:your-email@example.com)"}

response = requests.get(url, headers=headers)

if response.status_code == 200:
    full_metadata = response.json()['message']
    
    # Use json.dumps with indentation for a readable "pretty-print"
    print(json.dumps(full_metadata, indent=4))
else:
    print(f"Failed to retrieve data. Status code: {response.status_code}")
