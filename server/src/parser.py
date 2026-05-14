import re
from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import PdfFormatOption

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
ACKNOWLEDGEMENT_KEYWORDS = [
    "acknowledgement", "acknowledgment", "funding", "support",
]
SKIP_LABELS = {"page_header", "page_footer", "footnote"}


_ILLEGAL_XML = re.compile(r'[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]')
def _sanitize(text) -> str:
    if not text:
        return ""
    return _ILLEGAL_XML.sub('', text)

def _build_converter() -> DocumentConverter:
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = True
    pipeline_options.do_table_structure = True
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )

_converter = _build_converter()


def extract_paper_data(pdf_path: str) -> dict:
    result = _converter.convert(pdf_path)
    doc    = result.document
    raw    = doc.export_to_dict()

    # Lookup table: self_ref -> text item
    texts_by_ref = {t["self_ref"]: t for t in raw.get("texts", [])}

    # ── Title: first level-1 section_header on page 1 ────────────────────────
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

    # ── Authors: heuristic — comma-separated line on page 1 ──────────────────
    authors = []
    for t in raw.get("texts", []):
        if (
            t.get("label") == "text"
            and t.get("content_layer") == "body"
            and t.get("prov")
            and t["prov"][0].get("page_no") == 1
        ):
            text = t["text"].strip()
            if (
                "," in text
                and any(c.isupper() for c in text)
                and len(text) < 200
                and not any(kw in text.lower() for kw in [
                    "journal", "elsevier", "springer", "department",
                    "universidad", "university", "received", "accepted",
                ])
            ):
                authors = [p.strip() for p in text.split(",") if p.strip()]
                break

    # ── Abstract: text item after "Abstract" section_header ──────────────────
    abstract = None
    found_abstract_header = False
    for t in raw.get("texts", []):
        if found_abstract_header:
            if t.get("label") == "text" and t.get("content_layer") == "body":
                abstract = t["text"].strip()
                break
        if (
            t.get("label") == "section_header"
            and "abstract" in t.get("text", "").lower()
        ):
            found_abstract_header = True

    # ── DOI and date: regex scan ──────────────────────────────────────────────
    doi = None
    pub_date = None
    doi_pattern  = re.compile(r'10\.\d{4,}/\S+', re.IGNORECASE)
    date_pattern = re.compile(r'\b(19|20)\d{2}\b')

    for t in raw.get("texts", []):
        text = t.get("text", "")
        if doi is None:
            m = doi_pattern.search(text)
            if m:
                doi = m.group(0).rstrip(".,)")
        if pub_date is None and any(
            kw in text.lower()
            for kw in ["received", "accepted", "revised", "published"]
        ):
            m = date_pattern.search(text)
            if m:
                pub_date = m.group(0)

    # ── Journal: first meaningful page_header on page 1 ──────────────────────
    journal = None
    for t in raw.get("texts", []):
        if (
            t.get("label") == "page_header"
            and t.get("content_layer") == "furniture"
            and t.get("prov")
            and t["prov"][0].get("page_no") == 1
        ):
            text = t["text"].strip()
            if len(text) > 10 and not text.isdigit():
                journal = text
                break

    keywords_extracted = []
    for t in raw.get("texts", []):
        text = t.get("text", "")
        if re.match(r'keywords?\s*:', text, re.IGNORECASE):
            raw_kw = re.sub(r'^keywords?\s*:\s*', '', text, flags=re.IGNORECASE)
            keywords_extracted = [k.strip() for k in re.split(r'[;,]', raw_kw) if k.strip()]
            break

    full_text_parts      = []
    sections             = []
    methods_sections     = []
    conclusions_sections = []
    acknowledgements     = None
    current_heading      = None
    in_acknowledgements  = False

    for t in raw.get("texts", []):
        label = t.get("label", "")
        layer = t.get("content_layer", "")
        text  = t.get("text", "").strip()

        if not text or label in SKIP_LABELS or layer == "furniture":
            continue

        if label == "section_header":
            current_heading     = text
            in_acknowledgements = any(k in text.lower() for k in ACKNOWLEDGEMENT_KEYWORDS)
            sections.append(text)
            continue

        if label in ("text", "paragraph"):
            if in_acknowledgements:
                acknowledgements = (acknowledgements + " " + text) if acknowledgements else text
                continue

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

    figures = []
    for pic in raw.get("pictures", []):
        page = None
        if pic.get("prov"):
            page = pic["prov"][0].get("page_no")

        caption_texts = []
        for cap_ref in pic.get("captions", []):
            item = texts_by_ref.get(cap_ref.get("$ref"))
            if item and item.get("text"):
                caption_texts.append(item["text"].strip())

        caption = " ".join(caption_texts) if caption_texts else None

        figure_label = None
        if caption:
            m = re.match(r'^(Fig\.?\s*\d+\.?|Figure\s*\d+\.?)', caption, re.IGNORECASE)
            if m:
                figure_label = m.group(0).strip()

        if caption:
            figures.append({
                "figure_label": figure_label,
                "caption":      caption,
                "page":         page,
            })

    tables = []
    for tbl in raw.get("tables", []):
        page = None
        if tbl.get("prov"):
            page = tbl["prov"][0].get("page_no")

        caption_texts = []
        for cap_ref in tbl.get("captions", []):
            item = texts_by_ref.get(cap_ref.get("$ref"))
            if item and item.get("text"):
                caption_texts.append(item["text"].strip())
        caption = " ".join(caption_texts) if caption_texts else None

        grid = []
        for row in tbl.get("data", {}).get("grid", []):
            grid.append([cell.get("text", "") for cell in row])

        flat_cells = [cell.strip() for row in grid for cell in row if cell.strip()]
        content    = " | ".join(flat_cells)

        tables.append({
            "caption": caption,
            "page":    page,
            "content": content,
            "grid":    grid,
        })

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
    #zbl xmbl
    return {
        "file":       pdf_path,
        "title":      _sanitize(title),
        "date":       pub_date,
        "doi":        doi,
        "authors":    [_sanitize(a) for a in authors],
        "abstract":   _sanitize(abstract),
        "full_text":  _sanitize(full_text),
        "methods":    [{"heading": _sanitize(m["heading"]), "text": _sanitize(m["text"])} for m in methods_sections],
        "conclusions":        [{"heading": _sanitize(c["heading"]), "text": _sanitize(c["text"])} for c in conclusions_sections],
        "sections":           [_sanitize(s) for s in sections],
        "figures":            [{"figure_label": _sanitize(f["figure_label"]), "caption": _sanitize(f["caption"]), "page": f["page"]} for f in figures],
        "tables":             [{"caption": _sanitize(t["caption"]), "page": t["page"], "content": _sanitize(t["content"]), "grid": [[_sanitize(c) for c in row] for row in t["grid"]]} for t in tables],
        "keywords_extracted": [_sanitize(k) for k in keywords_extracted],
        "journal":            _sanitize(journal),
        "acknowledgements":   _sanitize(acknowledgements),
    }
