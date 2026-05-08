"""
pip install docling
"""

import json
from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import PdfFormatOption

PDF_PATH = "/home/normunds/pdfs/server/files/pdf-files/0230_3964.pdf"
#PDF_PATH = "./0015.pdf"


METHOD_KEYWORDS = [
    "method", "experiment", "material", "procedure",
    "approach", "protocol", "technique", "setup",
    "characterization", "synthesis", "preparation",
    "recovery", "recycling process", "pretreatment",
]
CONCLUSION_KEYWORDS = [
    "conclusion", "summary", "discussion",
    "future work", "closing remarks",
]


def resolve_ref(ref_str, texts_by_ref):
    """Resolve a $ref string like '#/texts/41' to its text item."""
    return texts_by_ref.get(ref_str)


def extract_paper_data(pdf_path: str) -> dict:
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = True 
    pipeline_options.do_table_structure = True

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )

    result = converter.convert(pdf_path)
    doc = result.document
    raw = doc.export_to_dict()

    # --- Build a lookup: self_ref -> text item ---
    texts_by_ref = {t["self_ref"]: t for t in raw.get("texts", [])}

    # --- Title: first level-1 section_header on page 1 ---
    title = None
    for t in raw.get("texts", []):
        if (
            t.get("label") == "section_header"
            and t.get("level") == 1
            and t.get("prov")
            and t["prov"][0].get("page_no") == 1
        ):
            title = t["text"].strip()
            break

    # --- Authors: text items on page 1 after title, before abstract ---
    # They appear as plain "text" items near the top of page 1
    # We grab all text-label items on page 1 that are NOT headers/footers/captions
    authors_raw = []
    for t in raw.get("texts", []):
        if (
            t.get("label") == "text"
            and t.get("content_layer") == "body"
            and t.get("prov")
            and t["prov"][0].get("page_no") == 1
        ):
            text = t["text"].strip()
            # Authors line typically contains commas and initials
            # Stop when we hit affiliation/institution text (long lines)
            if len(text) > 0 and len(text) < 200:
                authors_raw.append(text)

    # Heuristic: author line usually contains multiple names separated by commas
    authors = []
    for line in authors_raw:
        if "," in line and any(c.isupper() for c in line):
            # Split by comma, clean up
            parts = [p.strip() for p in line.split(",") if p.strip()]
            # Filter out journal/publisher names
            if not any(kw in line.lower() for kw in ["journal", "elsevier", "springer", "department", "universidad"]):
                authors = parts
                break

    # --- Abstract: text item immediately after the "Abstract" section_header ---
    abstract = None
    found_abstract_header = False
    for t in raw.get("texts", []):
        if found_abstract_header:
            if t.get("label") == "text" and t.get("content_layer") == "body":
                abstract = t["text"].strip()
                break
        if t.get("label") == "section_header" and "abstract" in t.get("text", "").lower():
            found_abstract_header = True

    # --- DOI / date: scan all texts for patterns ---
    import re
    doi = None
    pub_date = None
    doi_pattern = re.compile(r'10\.\d{4,}/\S+', re.IGNORECASE)
    date_pattern = re.compile(r'\b(19|20)\d{2}\b')

    for t in raw.get("texts", []):
        text = t.get("text", "")
        if doi is None:
            m = doi_pattern.search(text)
            if m:
                doi = m.group(0).rstrip(".,)")
        if pub_date is None:
            # Look for date in submission/received lines
            if any(kw in text.lower() for kw in ["received", "accepted", "revised", "published"]):
                m = date_pattern.search(text)
                if m:
                    pub_date = m.group(0)

    # --- Full text, methods, conclusions ---
    # Walk texts in order, track current heading
    full_text_parts = []
    methods_sections = []
    conclusions_sections = []
    current_heading = None

    # We only want body text, not furniture (headers/footers)
    SKIP_LABELS = {"page_header", "page_footer", "footnote"}

    for t in raw.get("texts", []):
        label = t.get("label", "")
        layer = t.get("content_layer", "")
        text = t.get("text", "").strip()

        if not text or label in SKIP_LABELS or layer == "furniture":
            continue

        if label == "section_header":
            current_heading = text
            continue

        if label in ("text", "paragraph"):
            full_text_parts.append(text)

            if current_heading:
                heading_lower = current_heading.lower()

                if any(k in heading_lower for k in METHOD_KEYWORDS):
                    if methods_sections and methods_sections[-1]["heading"] == current_heading:
                        methods_sections[-1]["text"] += "\n\n" + text
                    else:
                        methods_sections.append({"heading": current_heading, "text": text})

                if any(k in heading_lower for k in CONCLUSION_KEYWORDS):
                    if conclusions_sections and conclusions_sections[-1]["heading"] == current_heading:
                        conclusions_sections[-1]["text"] += "\n\n" + text
                    else:
                        conclusions_sections.append({"heading": current_heading, "text": text})

    full_text = "\n\n".join(full_text_parts)

    # --- Figures: iterate pictures, resolve caption refs ---
    figures = []
    for pic in raw.get("pictures", []):
        page = None
        if pic.get("prov"):
            page = pic["prov"][0].get("page_no")

        # Get caption text via refs
        caption_texts = []
        for cap_ref in pic.get("captions", []):
            ref_str = cap_ref.get("$ref")
            item = texts_by_ref.get(ref_str)
            if item and item.get("text"):
                caption_texts.append(item["text"].strip())

        caption = " ".join(caption_texts) if caption_texts else None

        # Get figure label from caption text (e.g. "Fig. 1. ...")
        figure_label = None
        if caption:
            m = re.match(r'^(Fig\.?\s*\d+\.?|Figure\s*\d+\.?)', caption, re.IGNORECASE)
            if m:
                figure_label = m.group(0).strip()

        figures.append({
            "self_ref": pic.get("self_ref"),
            "figure_label": figure_label,
            "caption": caption,
            "page": page,
        })

    # --- Tables: same pattern as figures ---
    tables = []
    for tbl in raw.get("tables", []):
        page = None
        if tbl.get("prov"):
            page = tbl["prov"][0].get("page_no")

        caption_texts = []
        for cap_ref in tbl.get("captions", []):
            ref_str = cap_ref.get("$ref")
            item = texts_by_ref.get(ref_str)
            if item and item.get("text"):
                caption_texts.append(item["text"].strip())

        caption = " ".join(caption_texts) if caption_texts else None

        # Extract grid as list of rows
        grid_data = []
        grid = tbl.get("data", {}).get("grid", [])
        for row in grid:
            grid_data.append([cell.get("text", "") for cell in row])

        tables.append({
            "self_ref": tbl.get("self_ref"),
            "caption": caption,
            "page": page,
            "grid": grid_data,
        })

    # --- References: list group items near end of document ---
    # In the real data, references appear as list items in groups labeled 'list'
    references = []
    list_group_refs = set()
    for group in raw.get("groups", []):
        if group.get("label") == "list":
            for child in group.get("children", []):
                list_group_refs.add(child.get("$ref"))

    for t in raw.get("texts", []):
        if t.get("self_ref") in list_group_refs:
            text = t.get("text", "").strip()
            if text:
                references.append({"raw": text})

    return {
        "file": pdf_path,
        "title": title,
        "date": pub_date,
        "doi": doi,
        "authors": authors,
        "abstract": abstract,
        "full_text": full_text,
        "methods": methods_sections,
        "conclusions": conclusions_sections,
        "figures": figures,
        "tables": tables,
        "references": references,
    }


if __name__ == "__main__":
    data = extract_paper_data(PDF_PATH)
    print(json.dumps(data, indent=2, ensure_ascii=False))
