import re
import os
from xml.etree.ElementTree import Element, SubElement, tostring
import xml.dom.minidom
import pdfplumber

#siis divas ir gadijumaa ja acc kkads random vajadziigs pdf tad prosta extract text ar jau zinamiem lidzekliem
def extract_fallback_text(pdf_path: str) -> str:
    text = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text.append(page_text)
    return "\n\n".join(text)


def grobid_confidence(info: dict) -> tuple[str, list[str]]:
    if not info:
        return "bad", ["all"]

    mandatory = ["title", "authors", "abstract", "doi", "full_text", "references"]
    missing   = [f for f in mandatory if not info.get(f)]

    if len(missing) == 0:
        return "good", []
    if len(missing) <= 2:
        return "partial", missing
    return "bad", missing


def strip_jats(text: str) -> str:
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", "", text)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def get_preview_path(image_path: str) -> str:
    if not image_path:
        return ""
    return image_path if image_path.startswith("./") else f"./{image_path}"


def build_xml(doi_info: dict | None, grobid_info: dict | None, image_path: str) -> str:
    doi   = doi_info   or {}
    grobi = grobid_info or {}

    title    = doi.get("title")    or grobi.get("title")    or "Unknown"
    abstract = doi.get("abstract") or grobi.get("abstract") or ""
    abstract = strip_jats(abstract)

    doi_number = doi.get("doi", "")

    date_val = ""
    if doi.get("year"):
        date_val = str(doi["year"])
    elif grobi.get("date"):
        date_val = grobi["date"]
    else:
        date_val = "Unknown"

    if doi.get("authors"):
        authors = doi["authors"]
    elif grobi.get("authors"):
        authors = grobi["authors"]
    else:
        authors = []

    file_path = grobi.get("file", "")

    doc = Element("document")

    SubElement(doc, "file").text            = file_path
    SubElement(doc, "title").text           = title
    SubElement(doc, "date").text            = date_val
    SubElement(doc, "doi_number").text      = doi_number
    SubElement(doc, "img_preview_path").text = get_preview_path(image_path)

    authors_el = SubElement(doc, "authors")
    for author in authors:
        SubElement(authors_el, "author").text = author

    SubElement(doc, "abstract").text = abstract

    methods_el = SubElement(doc, "methods")
    for method in grobi.get("methods", []):
        method_el = SubElement(methods_el, "method")
        SubElement(method_el, "heading").text = method.get("heading", "")
        SubElement(method_el, "text").text    = method.get("text", "")

    SubElement(doc, "full_text").text = grobi.get("full_text", "")

    refs_el = SubElement(doc, "references")
    for ref in grobi.get("references", []):
        ref_el = SubElement(refs_el, "reference")
        SubElement(ref_el, "title").text = ref.get("title") or ""
        ref_authors_el = SubElement(ref_el, "authors")
        for ra in ref.get("authors", []):
            SubElement(ref_authors_el, "author").text = ra
        SubElement(ref_el, "date").text = str(ref.get("date") or "")


    doi_refs = doi.get("references", [])
    if doi_refs:
        ref_dois_el = SubElement(doc, "reference_dois")
        for doi_ref in doi_refs:
            raw_doi = doi_ref.get("DOI", "")
            if raw_doi:
                SubElement(ref_dois_el, "number").text = f"DOI-{raw_doi}"


    raw_xml = tostring(doc, encoding="unicode", xml_declaration=False)
    pretty  = xml.dom.minidom.parseString(raw_xml).toprettyxml(indent="\t")
    lines   = pretty.split("\n")
    if lines[0].startswith("<?xml"):
        lines = lines[1:]
    return "\n".join(lines)


def upload_xml(xml_string: str, cp_url: str, cp_user: str, cp_pass: str) -> dict:
    import requests
 
    url = f"{cp_url.rstrip('/')}/api/databases/pdfs/insert"
    try:
        resp = requests.post(
            url,
            data=xml_string,
            auth=(cp_user, cp_pass),
            headers={"Content-Type": "text/xml"},
            timeout=30,
        )
        resp.raise_for_status()
        return {"success": True, "status_code": resp.status_code, "response": resp.text}
    except requests.exceptions.HTTPError as e:
        return {"success": False, "status_code": resp.status_code, "response": resp.text, "error": str(e)}
    except requests.exceptions.RequestException as e:
        return {"success": False, "status_code": None, "response": None, "error": str(e)}
 


def save_xml(xml_string: str, output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(xml_string)
