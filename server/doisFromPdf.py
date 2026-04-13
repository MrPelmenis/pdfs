import re
import time
import threading
import pdfminer.high_level
import requests
import pdf2doi

CROSSREF_URL = "https://api.crossref.org/works/{}"
CROSSREF_SEARCH = "https://api.crossref.org/works"
HEADERS = {"User-Agent": "pdfili/1.0 (normundspeld@gmail.com)"}

pdf2doi.config.set('verbose', False)

_pdf2doi_semaphore = threading.Semaphore(1)

def _extract_doi_from_text(pdf_path: str) -> str | None:
    try:
        text = pdfminer.high_level.extract_text(pdf_path, maxpages=3)
        match = re.search(r'10\.\d{4,9}/[^\s\"\'<>\]\[]+', text)
        return match.group(0).rstrip('.,);') if match else None
    except Exception:
        return None

def _doi_from_crossref_title(title: str) -> str | None:
    try:
        r = requests.get(
            CROSSREF_SEARCH,
            params={"query.title": title, "rows": 1},
            headers=HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        items = r.json().get("message", {}).get("items", [])
        return items[0].get("DOI") if items else None
    except Exception:
        return None

def _doi_from_pdf2doi(pdf_path: str) -> str | None:
    with _pdf2doi_semaphore:
        try:
            result = pdf2doi.pdf2doi(pdf_path)
            doi = result.get("identifier") if result else None
            time.sleep(1) 
            return doi
        except Exception:
            return None

def get_crossref_metadata(doi: str) -> dict | None:
    try:
        r = requests.get(CROSSREF_URL.format(doi), headers=HEADERS, timeout=10)
        r.raise_for_status()
        msg = r.json()["message"]
        return {
            "doi":            msg.get("DOI"),
            "title":          (msg.get("title") or [None])[0],
            "authors":        [
                f"{a.get('given', '')} {a.get('family', '')}".strip()
                for a in msg.get("author", [])
            ],
            "year":           (msg.get("published", {}).get("date-parts") or [[None]])[0][0],
            "journal":        (msg.get("container-title") or [None])[0],
            "publisher":      msg.get("publisher"),
            "abstract":       msg.get("abstract"),
            "citation_count": msg.get("is-referenced-by-count", 0),
            "references":     msg.get("reference", []),
        }
    except Exception:
        return None

#sakumaa meginam pasi dabuut, ja nav mekleejam aareejos resursos
def extract_doi_metadata(pdf_path: str, title: str = None) -> dict | None:
    doi = _extract_doi_from_text(pdf_path)
    if doi:
        return get_crossref_metadata(doi)

    if title:
        doi = _doi_from_crossref_title(title)
        if doi:
            return get_crossref_metadata(doi)

    doi = _doi_from_pdf2doi(pdf_path)
    if doi:
        return get_crossref_metadata(doi)

    return None
