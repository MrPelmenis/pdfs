import re
import unicodedata
import os
import json
import pdfplumber
import pytesseract
from pdf2image import convert_from_path


def extract_fallback_text(pdf_path: str) -> str:
    try:
        custom_config = r'--oem 3 --psm 6'
        pages = convert_from_path(pdf_path, dpi=250)
        text = []
        for page_img in pages:
            page_text = pytesseract.image_to_string(
                page_img, config=custom_config)
            if page_text.strip():
                text.append(page_text.strip())
        result = "\n\n".join(text)
        if len(result.split()) < 50:
            raise ValueError("OCR returned too little text")
        return result
    except Exception as e:
        print(f"[OCR] pytesseract failed: {e}, falling back to pdfplumber")
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
    mandatory = ["title", "authors", "abstract",
                 "doi", "full_text", "references"]
    missing = [f for f in mandatory if not info.get(f)]
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
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", "_", text)
    return text


def _clean_year(raw: str) -> str:
    if not raw:
        return ""
    m = re.search(r'\b(19|20)\d{2}\b', str(raw))
    return m.group(0) if m else ""


def build_document(metadata_info, grobid_info, image_path, stub=False, category_id=0) -> dict:
    meta = metadata_info or {}
    grobi = grobid_info or {}

    title = meta.get("title") or grobi.get("title") or "Unknown"
    abstract = strip_jats(meta.get("abstract") or grobi.get("abstract") or "")
    doi_number = meta.get("doi", "") or grobi.get("doi", "")
    cited_by_count = meta.get("cited_by_count", 1) or 0

    openalex_id = meta.get("openalex_id") or grobi.get("openalex_id") or ""
    doc_id = openalex_id if openalex_id else slugify(title)

    raw_date = ""
    if meta.get("year"):
        raw_date = str(meta["year"])
    elif grobi.get("date"):
        raw_date = str(grobi["date"])
    date_val = _clean_year(raw_date)

    authors = meta.get("authors") or grobi.get("authors") or []
    # ids in the authors database, parallel to `authors`; only when they came together
    # from OpenAlex (names read off a PDF have no ids)
    author_ids = meta.get("author_ids") or grobi.get("author_ids") or []
    if len(author_ids) != len(authors):
        author_ids = []
    file_path = grobi.get("file", "")

    doc = {
        "id":               doc_id,
        "file":             file_path,
        "title":            title,
        "cited_by_count":   int(cited_by_count),
        "doi_number":       doi_number,
        "img_preview_path": get_preview_path(image_path),
        "stub_document":    "yes" if stub else "no",
        "category_id":      int(category_id),
        "authors":          list(authors),
        "author_ids":       list(author_ids),
        "abstract":         abstract,
    }
    if openalex_id:
        doc["openalex_id"] = openalex_id
    if date_val:
        doc["date"] = int(date_val)

    topics = meta.get("topics") or grobi.get("topics") or []
    concepts = meta.get("concepts") or grobi.get("concepts") or []
    keywords = meta.get("keywords") or grobi.get("keywords") or []
    keywords_extracted = grobi.get("keywords_extracted") or []
    all_keywords = list(topics) + list(concepts) + \
        list(keywords) + list(keywords_extracted)
    doc["keywords_text"] = " ".join(str(k) for k in all_keywords)

    methods = grobi.get("methods") or []
    doc["methods"] = [
        {"heading": m.get("heading", ""), "text": m.get("text", "")}
        for m in methods
    ]
    mp = []
    for m in methods:
        if m.get("heading"):
            mp.append(m["heading"])
        if m.get("text"):
            mp.append(m["text"])
    doc["methods_text"] = " ".join(mp)

    conclusions = grobi.get("conclusions") or []
    doc["conclusions"] = [
        {"heading": c.get("heading", ""), "text": c.get("text", "")}
        for c in conclusions
    ]
    cp = []
    for c in conclusions:
        if c.get("heading"):
            cp.append(c["heading"])
        if c.get("text"):
            cp.append(c["text"])
    doc["conclusions_text"] = " ".join(cp)

    figures = grobi.get("figures") or []
    doc["figures"] = [
        {"figure_label": f.get("figure_label") or "", "caption": f.get(
            "caption") or "", "page": str(f.get("page") or "")}
        for f in figures
    ]
    fp = []
    for f in figures:
        if f.get("figure_label"):
            fp.append(f["figure_label"])
        if f.get("caption"):
            fp.append(f["caption"])
    doc["figures_text"] = " ".join(fp)

    tables = grobi.get("tables") or []
    doc["tables"] = [
        {"grid": [list(row) for row in (t.get("grid") or [])]}
        for t in tables
    ]
    tp = []
    for t in tables:
        grid = t.get("grid") or []
        if grid:
            tp.append("\n".join(" | ".join(str(c)
                      for c in row) for row in grid))
    doc["tables_text"] = "\n\n".join(tp)

    doc["full_text"] = grobi.get("full_text", "")

    ref_ids = grobi.get("referenced_work_ids") or meta.get(
        "referenced_work_ids") or []
    doc["referenced_work_ids"] = [w for w in ref_ids if w]

    rel_ids = grobi.get("related_work_ids") or meta.get(
        "related_work_ids") or []
    doc["related_work_ids"] = [w for w in rel_ids if w]

    return doc


def save_document(doc: dict, output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)


def upload_document(doc: dict) -> dict:
    import requests
    from src import corelamo

    resp = corelamo.insert(doc)
    try:
        data = resp.json()
    except Exception:
        data = {}

    if resp.status_code in (200, 201):
        return {"success": True, "status_code": resp.status_code, "response": json.dumps(data)}

    results = (data.get("data") or {}).get("results") or []
    if resp.status_code == 409 or any(r.get("status") == 409 for r in results):
        return {"success": False, "status_code": 409, "response": json.dumps(data), "error": "already exists"}

    return {"success": False, "status_code": resp.status_code, "response": resp.text, "error": str(resp.status_code)}
