import re
import unicodedata
import os
from xml.etree.ElementTree import Element, SubElement, tostring
import xml.dom.minidom
import pdfplumber

#siis divas ir gadijumaa ja acc kkads random vajadziigs pdf tad prosta extract text ar jau zinamiem lidzekliem
import pytesseract
from pdf2image import convert_from_path

import pytesseract
from pdf2image import convert_from_path

def extract_fallback_text(pdf_path: str) -> str:
    try:
        from pdf2image import convert_from_path
        import pytesseract
        
        #prieks jobaniem dokumentiem kur var but kkads "P H O S P H A T E"
        custom_config = r'--oem 3 --psm 6'
        
        pages = convert_from_path(pdf_path, dpi=250)
        text = []
        for page_img in pages:
            page_text = pytesseract.image_to_string(page_img, config=custom_config)
            if page_text.strip():
                text.append(page_text.strip())
        result = "\n\n".join(text)
        if len(result.split()) < 50:
            raise ValueError("OCR returned too little text")
        return result
    except Exception as e:
        print(f"[OCR] pytesseract failed: {e}, falling back to pdfplumber")
        import pdfplumber
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


def slugify(text: str) -> str:
    """Convert title to ASCII slug with underscores, Wikipedia-style."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", "_", text)
    return text


def build_xml(metadata_info: dict | None, grobid_info: dict | None, image_path: str, stub: bool = False) -> str:
    meta  = metadata_info or {}
    grobi = grobid_info   or {}

    title      = meta.get("title")    or grobi.get("title")    or "Unknown"
    abstract   = meta.get("abstract") or grobi.get("abstract") or ""
    abstract   = strip_jats(abstract)
    doi_number = meta.get("doi", "")  or grobi.get("doi", "")
    cited_by_count = meta.get("cited_by_count", 0) or 0

    openalex_id = meta.get("openalex_id") or grobi.get("openalex_id") or ""
    doc_id      = openalex_id if openalex_id else slugify(title)

    date_val = ""
    if meta.get("year"):
        date_val = str(meta["year"])
    elif grobi.get("date"):
        date_val = grobi["date"]
    else:
        date_val = "Unknown"

    if meta.get("authors"):
        authors = meta["authors"]
    elif grobi.get("authors"):
        authors = grobi["authors"]
    else:
        authors = []

    file_path = grobi.get("file", "")

    doc = Element("document")
    SubElement(doc, "id").text               = doc_id
    SubElement(doc, "openalex_id").text      = openalex_id
    SubElement(doc, "file").text             = file_path
    SubElement(doc, "title").text            = title
    SubElement(doc, "cited_by_count").text   = str(cited_by_count)
    SubElement(doc, "date").text             = date_val
    SubElement(doc, "doi_number").text       = doi_number
    SubElement(doc, "img_preview_path").text = get_preview_path(image_path)
    SubElement(doc, "stub_document").text    = "yes" if stub else "no"

    authors_el = SubElement(doc, "authors")
    for author in authors:
        SubElement(authors_el, "author").text = author

    SubElement(doc, "abstract").text    = abstract
    SubElement(doc, "category_id").text = "0"

    # Topics from OpenAlex
    topics = meta.get("topics") or grobi.get("topics") or []
    if topics:
        topics_el = SubElement(doc, "topics")
        for topic in topics:
            SubElement(topics_el, "topic").text = topic

    # Concepts from OpenAlex (level > 0, score > 0.3)
    concepts = meta.get("concepts") or grobi.get("concepts") or []
    if concepts:
        concepts_el = SubElement(doc, "concepts")
        for concept in concepts:
            SubElement(concepts_el, "concept").text = concept

    # Keywords from OpenAlex
    keywords = meta.get("keywords") or grobi.get("keywords") or []
    if keywords:
        keywords_el = SubElement(doc, "keywords")
        for keyword in keywords:
            SubElement(keywords_el, "keyword").text = keyword

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

    if not stub:
        # Referenced works (OpenAlex IDs — replaces old references_doi block)
        ref_ids = grobi.get("referenced_work_ids") or meta.get("referenced_work_ids") or []
        if ref_ids:
            ref_ids_el = SubElement(doc, "referenced_work_ids")
            for wid in ref_ids:
                if wid:
                    SubElement(ref_ids_el, "referenced_work_id").text = wid

        # Related works (OpenAlex IDs)
        rel_ids = grobi.get("related_work_ids") or meta.get("related_work_ids") or []
        if rel_ids:
            rel_ids_el = SubElement(doc, "related_work_ids")
            for wid in rel_ids:
                if wid:
                    SubElement(rel_ids_el, "related_work_id").text = wid

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
