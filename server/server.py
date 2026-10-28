from concurrent.futures import ThreadPoolExecutor
import math
import re
import random
import json
from flask_cors import CORS
from flask import Flask, request, jsonify, send_from_directory, make_response
import os
from src import corelamo
from src.pdfToImage import generate_preview
import traceback
from src.parser import extract_paper_data
from src.vision_extractor import extract_title_authors_from_image
from src.metadata_analyser import openalex_by_id, openalex_by_title
from src.queue_manager import add_dois_to_queue
from src.hasher import _file_hash, _is_duplicate_file, _register_hash
from src.categories import (get_all_categories, create_category, edit_category, delete_category,
                            assign_category_to_document, get_category_by_id, find_or_create_by_field, NONE_CATEGORY)
import datetime
from src.stub_worker import start_stub_worker, set_pdf_processing, fetch_document, delete_document
from src.json_builder import build_document, save_document, upload_document, extract_fallback_text

from dotenv import load_dotenv

load_dotenv()

from src.chatins import register_chat


background_executor = ThreadPoolExecutor(max_workers=1)


CORELAMO_URL = os.getenv("CORELAMO_URL",  "http://localhost:6006")
CORELAMO_USER = os.getenv("CORELAMO_USER", "pdf_fujaks")
CORELAMO_PASS = os.getenv("CORELAMO_PASS", "crtz1234")
DB_NAME = os.getenv("CORELAMO_DB", "pdfs")

corelamo.configure(CORELAMO_URL, CORELAMO_USER, CORELAMO_PASS, DB_NAME)


# prieks gadiem
YEAR_MIN = 1800
YEAR_MAX = datetime.date.today().year


app = Flask(__name__)
CORS(app)

PREVIEW_DIR = "./files/pdf-preview-images"
PDF_DIR = "./files/pdf-files"
DOCS_OUT_PATH = "./files/json-files"

os.makedirs(PDF_DIR,      exist_ok=True)
os.makedirs(PREVIEW_DIR,  exist_ok=True)
os.makedirs(DOCS_OUT_PATH,  exist_ok=True)


def process_file_background(filename, save_path):
    """New-document path after a PDF upload.

    Parse + enrich the PDF, resolve a category, replace any existing stub with
    the same id, then build a JSON document and insert it into Corelamo.
    """
    set_pdf_processing(True)
    try:
        # ── 1. Parse the PDF, vision, and OCR fallback ────────────────────────
        image_path = generate_preview(save_path, PREVIEW_DIR)
        parser_info = extract_paper_data(save_path)

        vision = extract_title_authors_from_image(image_path)
        if vision.get("title"):
            parser_info["title"] = vision["title"]
        if vision.get("authors"):
            parser_info["authors"] = vision["authors"]

        if len((parser_info.get("full_text") or "").split()) < 100:
            ocr_text = extract_fallback_text(save_path)
            if ocr_text.strip():
                parser_info["full_text"] = ocr_text

        # ── 2. Enrich from OpenAlex (by DOI, then by title) ───────────────────
        openalex_info = {}
        parser_doi = parser_info.get("doi")

        if parser_doi:
            openalex_info = openalex_by_id(parser_doi)

        if not openalex_info:
            openalex_info = openalex_by_title(
                title=parser_info.get("title", ""),
                authors=parser_info.get("authors", []),
            )

        if openalex_info:
            if openalex_info.get("openalex_id"):
                parser_info["openalex_id"] = openalex_info["openalex_id"]
            if openalex_info.get("doi"):
                parser_info["doi"] = openalex_info["doi"]
            if openalex_info.get("abstract"):
                parser_info["abstract"] = openalex_info["abstract"]
            if openalex_info.get("authors"):
                parser_info["authors"] = openalex_info["authors"]
            if openalex_info.get("referenced_work_ids"):
                parser_info["referenced_work_ids"] = openalex_info["referenced_work_ids"]
            if openalex_info.get("related_work_ids"):
                parser_info["related_work_ids"] = openalex_info["related_work_ids"]
            if openalex_info.get("topics"):
                parser_info["topics"] = openalex_info["topics"]

        # ── 3. Resolve the category from the OpenAlex field ───────────────────
        field = (openalex_info or {}).get("field")
        category = find_or_create_by_field(field) if field else NONE_CATEGORY
        category_id = category["id"]

        # ── 4. Resolve the document id and drop any old stub for it ──────────
        # id == openalex_id when available, otherwise a slug of the title.
        final_id = parser_info.get("openalex_id") or slugify(
            parser_info.get("title", ""))
        if final_id:
            existing = fetch_document(final_id)
            if existing and existing.get("stub_document") == "yes":
                delete_document(final_id)

        # ── 5. Build + persist + upload the JSON document ─────────────────────
        doc_json = build_document(
            openalex_info or None,
            parser_info,
            image_path,
            stub=False,
            category_id=category_id,
        )
        final_json_name = f"{
            DOCS_OUT_PATH}/{os.path.splitext(filename)[0]}.json"
        save_document(doc_json, final_json_name)

        upload_result = upload_document(doc_json)

        if upload_result["success"]:
            print(f"SUCCESS: [{filename[:20]}]")
            process_references = True
        else:
            # Corelamo insert of an existing id returns HTTP 409.
            if upload_result.get("status_code") == 409:
                print(f"SKIP: [{filename[:20]}] Already exists in database.")
                process_references = True
            else:
                print(f"ERROR: [{filename}] {upload_result['error']}")
                print(upload_result)
                process_references = False

        # ── 6. Queue references/related works for stub backfill ───────────────
        if process_references:
            ref_ids = parser_info.get("referenced_work_ids", [])
            rel_ids = parser_info.get("related_work_ids", [])
            all_ids = list(set(ref_ids + rel_ids))
            if all_ids:
                added = add_dois_to_queue(all_ids)
                print(f"[app] Added {added} OpenAlex IDs to stub queue")

    except Exception as e:
        print(f"FATAL: [{filename}] {str(e)}")
        traceback.print_exc()
    finally:
        set_pdf_processing(False)

# title kaa id openalexx id vietaa


def slugify(text: str) -> str:
    import unicodedata
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", "_", text)
    return text


def make_unique_filename(original_filename: str) -> str:
    stem = os.path.splitext(original_filename)[0]
    rand = random.randint(1000, 9999)
    return f"{stem}_{rand}.pdf"


def retrieve_document(doc_id: str) -> dict | None:
    resp = corelamo.retrieve([doc_id])
    if resp.status_code != 200:
        return None
    docs = resp.json().get("data", {}).get("documents", [])
    if not docs:
        return None
    d = docs[0].get("data", {})
    return {
        "openalex_id":         d.get("openalex_id", ""),
        "title":               d.get("title", ""),
        "doi":                 d.get("doi_number", ""),
        "abstract":            d.get("abstract", ""),
        "date":                str(d.get("date")) if d.get("date") is not None else "",
        "cited_by_count":      int(d.get("cited_by_count") or 0),
        "authors":             d.get("authors") or [],
        "topics":              [],
        "concepts":            [],
        "keywords":            [],
        "referenced_work_ids": d.get("referenced_work_ids") or [],
        "related_work_ids":    d.get("related_work_ids") or [],
        "category_id":         d.get("category_id"),
        "img_preview_path":    d.get("img_preview_path", ""),
        "file":                d.get("file", ""),
    }


def process_stub_upgrade(filename: str, save_path: str, openalex_id: str = "", doi: str = ""):
    """Upgrade a stub (metadata-only) document into a full parsed document.

    Resolves the OpenAlex id, fetches the existing stub's metadata from
    Corelamo, rebuilds a full JSON document and uploads it (replacing the stub).
    """
    try:
        print(f"[stub_upgrade] Starting for openalex_id={
              openalex_id} doi={doi} file={filename}")

        # ── 1. Resolve the document ID ────────────────────────────────────────
        resolved_id = openalex_id

        if not resolved_id and doi:
            print(f"[stub_upgrade] No openalex_id, looking up by DOI: {doi}")
            openalex_info = openalex_by_id(doi)
            if openalex_info and openalex_info.get("openalex_id"):
                resolved_id = openalex_info["openalex_id"]
                print(f"[stub_upgrade] Resolved to: {resolved_id}")
            else:
                print(
                    f"[stub_upgrade] Could not resolve DOI to openalex_id, aborting")
                return

        if not resolved_id:
            print(f"[stub_upgrade] No openalex_id or doi provided, aborting")
            return

        # ── 2. Fetch the existing stub from Corelamo ──────────────────────────
        stub_data = retrieve_document(resolved_id)
        if not stub_data:
            print(f"[stub_upgrade] No stub found in Corelamo for {
                  resolved_id}, aborting")
            return

        print(f"[stub_upgrade] Found stub: {stub_data['title'][:60]}")

        # ── 3. Parse the PDF again (preview + full text) ──────────────────────
        image_path = generate_preview(save_path, PREVIEW_DIR)

        parser_info = extract_paper_data(save_path)

        if len((parser_info.get("full_text") or "").split()) < 100:
            ocr_text = extract_fallback_text(save_path)
            if ocr_text.strip():
                parser_info["full_text"] = ocr_text

        # Merge the stub's metadata with the freshly parsed full text.
        # NOTE: topics/concepts/keywords are intentionally left empty here
        # (we only persist the flattened `keywords_text`), matching the old
        # behaviour — carry them over here if you want them preserved.
        merged_info = {
            "openalex_id":         stub_data["openalex_id"],
            "doi":                 stub_data["doi"],
            "title":               stub_data["title"],
            "abstract":            stub_data["abstract"],
            "authors":             stub_data["authors"],
            "date":                stub_data["date"],
            "topics":              stub_data["topics"],
            "concepts":            stub_data["concepts"],
            "keywords":            stub_data["keywords"],
            "referenced_work_ids": stub_data["referenced_work_ids"],
            "related_work_ids":    stub_data["related_work_ids"],
            "file":                filename,
            "full_text":           parser_info.get("full_text", ""),
            "references":          parser_info.get("references", []),
            "methods":             parser_info.get("methods", []),
        }

        print(f"[stub_upgrade] Deleting stub {resolved_id} from Corelamo")
        delete_document(resolved_id)

        # NOTE: category_id is not carried over from the stub (build_document
        # defaults it to 1). Pass category_id=stub_data["category_id"] if you
        # want to keep the stub's category.
        doc_json = build_document(
            metadata_info={"cited_by_count": stub_data["cited_by_count"]},
            grobid_info=merged_info,
            image_path=image_path,
            stub=False,
        )

        final_json_name = f"{
            DOCS_OUT_PATH}/{os.path.splitext(filename)[0]}.json"
        save_document(doc_json, final_json_name)

        upload_result = upload_document(doc_json)

        if upload_result["success"]:
            print(f"[stub_upgrade] SUCCESS: {
                  resolved_id} upgraded to full document")
            all_ids = list(set(
                merged_info.get("referenced_work_ids", []) +
                merged_info.get("related_work_ids", [])
            ))
            if all_ids:
                add_dois_to_queue(all_ids)
        else:
            print(f"[stub_upgrade] UPLOAD ERROR: {upload_result['error']}")

    except Exception as e:
        print(f"[stub_upgrade] FATAL: {e}")


@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file part in request"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    filename = file.filename
    if not filename.lower().endswith(".pdf"):
        return jsonify({"error": f"'{filename}' is not a PDF (wrong extension)"}), 400

    if file.mimetype not in ("application/pdf", "application/octet-stream"):
        header = file.stream.read(4)
        file.stream.seek(0)
        if header != b"%PDF":
            return jsonify({"error": f"'{filename}' is not a valid PDF file"}), 400

    openalex_id = (request.form.get("openalex_id") or "").strip()
    doi = (request.form.get("doi") or "").strip()
    is_upgrade = bool(openalex_id or doi)

    file_hash = _file_hash(file.stream)
    if _is_duplicate_file(file_hash):
        return jsonify({"message": "File already uploaded"}), 200

    unique_filename = make_unique_filename(filename)
    save_path = os.path.join(PDF_DIR, unique_filename)
    file.save(save_path)
    _register_hash(file_hash)

    if is_upgrade:
        background_executor.submit(
            process_stub_upgrade, unique_filename, save_path, openalex_id=openalex_id, doi=doi)
        return jsonify({
            "message":  "Stub upgraded. Processing in background.",
            "filename": unique_filename,
        }), 200
    else:
        background_executor.submit(
            process_file_background, unique_filename, save_path)
        return jsonify({
            "message":  "Upload successful. Processing in background.",
            "filename": unique_filename,
        }), 200


def get_preview_filename(file_path):
    basename = os.path.basename(file_path)
    return os.path.splitext(basename)[0] + ".jpeg"


def clean_filename(file_path):
    if not file_path:
        return None
    return os.path.basename(file_path)


def extract_snippet(item: dict) -> str | None:
    highlights = item.get("highlights") or []
    if highlights:
        return " … ".join(
            h.replace("<em>", "<b>").replace("</em>", "</b>") for h in highlights
        )
    doc = item.get("data") or {}
    fallback = (doc.get("abstract") or "").strip()
    if not fallback:
        return None
    words = fallback.split()
    trail = "…" if len(words) > 30 else ""
    return " ".join(words[:30]) + trail


def do_search(query, docs, date_start=None, date_end=None,
              f_abstract="", f_methods="", f_conclusions="",
              f_figures="", category_id=None, f_topics="", f_keywords=""):

    filters = {"stub_document": {"exact": "no"}}

    if date_start is not None or date_end is not None:
        ds = int(date_start) if date_start is not None else YEAR_MIN
        de = int(date_end) if date_end is not None else YEAR_MAX
        filters["date"] = {"range": f"{ds}..{de}"}

    if f_abstract:
        filters["abstract"] = f_abstract
    if f_topics or f_keywords:
        filters["keywords_text"] = " ".join(
            x for x in (f_topics, f_keywords) if x)
    if f_methods:
        filters["methods_text"] = f_methods
    if f_conclusions:
        filters["conclusions_text"] = f_conclusions
    if f_figures:
        filters["figures_text"] = f_figures
    if category_id:
        filters["category_id"] = {"range": str(category_id)}

    # exclude the heavy/structured fields from the payload; snippet comes from highlights
    return_fields = {
        "full_text": False, "methods": False, "conclusions": False,
        "figures": False, "tables": False,
    }

    # tell Corelamo to return highlighted fragments -> these become `snippet`
    hl = {"fragment_size": 150, "number_of_fragments": 2,
          "pre_tags": ["<b>"], "post_tags": ["</b>"]}
    highlight = {
        "fields": {
            "abstract":         hl,
            "keywords_text":    hl,
            "methods_text":     hl,
            "conclusions_text": hl,
            "figures_text":     hl,
            "tables_text":      hl,
        }
    }

    resp = corelamo.search(
        query, docs=docs, filters=filters, return_fields=return_fields, highlight=highlight)
    resp.raise_for_status()
    data = resp.json()

    hits = (data.get("total_hits") or {}).get("value", 0)
    items = data.get("data") or []
    if isinstance(items, dict):
        items = [items]

    results = []
    for item in items:
        doc = item.get("data") or {}
        doc_id = item.get("id") or doc.get("id")

        file_path = doc.get("file")
        filename = clean_filename(file_path)
        preview_name = get_preview_filename(file_path) if file_path else None
        preview_exists = preview_name and os.path.exists(
            os.path.join(PREVIEW_DIR, preview_name))

        try:
            cat_id_raw = doc.get("category_id")
            category = get_category_by_id(
                int(cat_id_raw)) if cat_id_raw is not None else None
            if not category:
                category = NONE_CATEGORY
        except (TypeError, ValueError):
            category = NONE_CATEGORY

        results.append({
            "title":               doc.get("title"),
            "id":                  doc_id,
            "openalex_id":         doc.get("openalex_id", ""),
            "file":                filename,
            "date":                str(doc.get("date")) if doc.get("date") is not None else None,
            "full_text":           None,
            "authors":             doc.get("authors") or [],
            "abstract":            doc.get("abstract"),
            "preview":             f"/previews/{preview_name}" if preview_exists else None,
            "doi_number":          doc.get("doi_number", ""),
            "cited_by_count":      doc.get("cited_by_count"),
            "keywords_text":       doc.get("keywords_text", ""),
            "methods_text":        doc.get("methods_text", ""),
            "conclusions_text":    doc.get("conclusions_text", ""),
            "figures_text":        doc.get("figures_text", ""),
            "tables_text":         doc.get("tables_text", ""),
            "referenced_work_ids": doc.get("referenced_work_ids") or [],
            "related_work_ids":    doc.get("related_work_ids") or [],
            "category":            category,
            "stub_document":       doc.get("stub_document", "no"),
            "snippet":             extract_snippet(item),
        })

    return results, hits


def _enrich_and_sort(work_ids: list, limit: int) -> list[tuple[str, dict | None]]:
    enriched_map = {}
    for wid in work_ids:
        enriched_map[wid] = lookup_gray_node(wid)

    def cited_count(item):
        _, enriched = item
        return enriched["cited"] if enriched else 0

    sorted_items = sorted(enriched_map.items(), key=cited_count, reverse=True)
    return sorted_items[:limit]


def lookup_gray_node(openalex_id: str) -> dict | None:
    if not openalex_id:
        return None
    resp = corelamo.lookup([openalex_id])
    if resp.status_code != 200:
        return None
    docs = resp.json().get("data", {}).get("documents", [])
    if not docs:
        return None
    d = docs[0].get("data", {})
    return {
        "title":         (d.get("title") or "").strip(),
        "cited":         int(d.get("cited_by_count") or 0),
        "abstract":      (d.get("abstract") or "").strip(),
        "authors":       d.get("authors") or [],
        "stub_document": (d.get("stub_document") or "no").strip() == "yes",
    }


@app.route("/search")
def search():
    query = request.args.get("query", "").strip()
    try:
        docs = int(request.args.get("docs", 10))
        if docs < 1:
            docs = 10
    except (ValueError, TypeError):
        docs = 10

    f_abstract = request.args.get("abstract",    "").strip()
    f_methods = request.args.get("methods",     "").strip()
    f_conclusions = request.args.get("conclusions", "").strip()
    f_figures = request.args.get("figures",     "").strip()
    f_topics = request.args.get("topics", "").strip()

    has_any = query or f_abstract or f_methods or f_conclusions or f_figures or f_topics
    if not has_any:
        return jsonify({"error": "query is required"}), 400

    try:
        date_start = request.args.get("date_start", type=int)
        date_end = request.args.get("date_end",   type=int)
        category_id = request.args.get("category_id", "").strip() or None

        results, hits = do_search(
            query,
            docs=docs,
            date_start=date_start,
            date_end=date_end,
            f_abstract=f_abstract,
            f_methods=f_methods,
            f_conclusions=f_conclusions,
            f_figures=f_figures,
            category_id=category_id,
            f_topics=f_topics,
        )

        all_nodes = []
        links = []
        initial_nodes = ["query"]
        seen_ids = set()
        seen_links = set()

        def add_link(from_id, to_id, style):
            key = (from_id, to_id)
            if key in seen_links or from_id == to_id:
                return
            seen_links.add(key)
            links.append({"from": from_id, "to": to_id, "style": style})

        def node_radius(cited, fallback=45):
            return min(200, round(70 + math.sqrt(cited) * 2, 1)) if cited else fallback

        REF_STYLE = {
            "fillColor":    "rgba(99,102,241,0.35)",
            "radius":       2,
            "toDecoration": "arrow",
        }
        REL_STYLE = {
            "fillColor":    "rgba(251,146,60,0.45)",
            "radius":       1.5,
            "toDecoration": "arrow",
            "dashSize":     4,
        }

        # ── Query node ───────────────────────────────────────────────────────
        all_nodes.append({
            "id":     "query",
            "loaded": True,
            "style":  {"label": (query[:50] + "…") if len(query) > 50 else query},
            "data": {
                "title":        query,
                "authors":      [],
                "doi":          "",
                "cited":        0,
                "radius":       20,
                "fillColor":    "#ffffff",
                "preview":      None,
                "category":     None,
                "is_stub_node": False,
            },
        })
        seen_ids.add("query")

        # ── Result nodes ─────────────────────────────────────────────────────
        # Collect ref/rel ID sets per node for cross-link pass below.
        # These are NOT embedded in node.data — only used server-side here.
        result_node_ids = []   # ordered list of node IDs from search results
        ref_ids_by_node = {}   # node_id -> [referenced_work_ids]
        rel_ids_by_node = {}   # node_id -> [related_work_ids]

        for doc in results:
            cited = int(doc["cited_by_count"] or 0)
            title = doc["title"] or doc["doi_number"]
            node_id = doc["openalex_id"] or doc["id"] or doc["doi_number"]
            if not node_id or node_id in seen_ids:
                continue

            category = doc["category"]

            all_nodes.append({
                "id":     node_id,
                "loaded": True,
                "style":  {"label": title},
                "data": {
                    "title":        title,
                    "authors":      doc["authors"] or [],
                    "doi":          doc["doi_number"],
                    "openalex_id":  doc["openalex_id"],
                    "cited":        cited,
                    "id":           doc["id"],
                    "file":         doc["file"],
                    "radius":       node_radius(cited),
                    "abstract":     doc["abstract"] or "",
                    "snippet":  doc["snippet"] or "",
                    "fillColor":    category["color"],
                    "preview":      doc["preview"],
                    "category":     category,
                    "stub_document": doc["stub_document"] == "yes" if isinstance(doc["stub_document"], str) else bool(doc["stub_document"]),
                    "is_stub_node": False,
                },
            })
            seen_ids.add(node_id)
            initial_nodes.append(node_id)
            result_node_ids.append(node_id)
            ref_ids_by_node[node_id] = doc["referenced_work_ids"] or []
            rel_ids_by_node[node_id] = doc["related_work_ids"] or []

            add_link("query", node_id, REF_STYLE)

        # ── Cross-links between result nodes ─────────────────────────────────
        # Check every result node's full ref/rel lists against the result ID set.
        # No limit — we want all connections between the 10 results visible.
        result_id_set = set(result_node_ids)

        for node_id in result_node_ids:
            for ref_id in ref_ids_by_node[node_id]:
                if ref_id in result_id_set:
                    add_link(node_id, ref_id, REF_STYLE)
            for rel_id in rel_ids_by_node[node_id]:
                if rel_id in result_id_set:
                    add_link(node_id, rel_id, REL_STYLE)

        return jsonify({
            "query":         query,
            "results":       results,
            "chart_data":    {"nodes": all_nodes, "links": links},
            "hits":           hits,
            "initial_nodes": initial_nodes,
        })

    except Exception as e:
        print(str(e))
        return jsonify({"error": str(e)}), 500


def batch_lookup(ids: list) -> dict:
    if not ids:
        return {}
    resp = corelamo.lookup(ids)
    if resp.status_code != 200:
        return {}
    docs = resp.json().get("data", {}).get("documents", [])
    result = {}
    for entry in docs:
        d = entry.get("data") or {}
        wid = entry.get("id") or d.get("id") or d.get("openalex_id")
        if not wid:
            continue
        result[wid] = {
            "title":               (d.get("title") or "").strip(),
            "cited":               int(d.get("cited_by_count") or 0),
            "abstract":            (d.get("abstract") or "").strip(),
            "authors":             d.get("authors") or [],
            "stub_document":       (d.get("stub_document") or "no") == "yes",
            "doi_number":          d.get("doi_number", ""),
            "referenced_work_ids": d.get("referenced_work_ids") or [],
            "related_work_ids":    d.get("related_work_ids") or [],
            "file":                d.get("file", ""),
            "category_id":         d.get("category_id"),
        }
    return result


@app.route("/expand", methods=["POST"])
def expand():
    body = request.get_json(force=True)

    openalex_id = (body.get("openalex_id") or "").strip()
    shown_node_ids = set(body.get("shown_node_ids") or [])
    shown_ref_ids = set(body.get("shown_ref_ids") or [])
    shown_rel_ids = set(body.get("shown_rel_ids") or [])

    if not openalex_id:
        return jsonify({"error": "openalex_id is required"}), 400

    # ── 1. Fetch this node's reference/related lists from Corelamo ────────────
    try:
        resp = corelamo.lookup([openalex_id])
    except Exception as e:
        return jsonify({"error": f"Corelamo lookup failed: {e}"}), 500

    if resp.status_code != 200:
        return jsonify({"error": f"Corelamo lookup failed: {resp.status_code}"}), 500

    docs = resp.json().get("data", {}).get("documents", [])
    if not docs:
        return jsonify({"error": "Node document not found"}), 404

    data = docs[0].get("data", {})
    all_ref_ids = data.get("referenced_work_ids") or []
    all_rel_ids = data.get("related_work_ids") or []

    # ── 2. Filter already-shown, batch-lookup candidates ─────────────────────
    candidate_ref_ids = [i for i in all_ref_ids if i not in shown_ref_ids]
    candidate_rel_ids = [i for i in all_rel_ids if i not in shown_rel_ids]
    all_candidates = list(set(candidate_ref_ids + candidate_rel_ids))

    # batch_lookup returns full Corelamo data including stub_document and file fields
    enriched_map = batch_lookup(all_candidates)

    # ── 3. Sort by cited_by_count desc, take next 5 refs / 3 rels ────────────
    def sorted_candidates(id_list, limit):
        scored = [(wid, enriched_map.get(wid, {}).get("cited", 0))
                  for wid in id_list]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [wid for wid, _ in scored[:limit]]

    new_ref_ids = sorted_candidates(candidate_ref_ids, 5)
    new_rel_ids = sorted_candidates(candidate_rel_ids, 3)

    # ── 4. Build nodes ───────────────────────────────────────────────────────
    new_nodes = []
    new_links = []
    seen_new = set()
    seen_links_set = set()

    def node_radius(cited, fallback=45):
        return min(200, round(70 + math.sqrt(cited) * 2, 1)) if cited else fallback

    REF_STYLE = {
        "fillColor": "rgba(99,102,241,0.35)",  "radius": 2,   "toDecoration": "arrow"}
    REL_STYLE = {"fillColor": "rgba(251,146,60,0.45)",
                 "radius": 1.5, "toDecoration": "arrow", "dashSize": 4}

    def add_link(from_id, to_id, style):
        key = (from_id, to_id)
        if key in seen_links_set or from_id == to_id:
            return
        seen_links_set.add(key)
        new_links.append({"from": from_id, "to": to_id, "style": style})

    def make_node(wid, enriched, link_style):
        if not enriched:
            return {
                "id":     wid,
                "loaded": False,
                "style":  {"label": wid},
                "data": {
                    "title":                wid,
                    "authors":              [],
                    "abstract":             "",
                    "cited":                0,
                    "doi":                  "",
                    "openalex_id":          wid,
                    "radius":               15,
                    "fillColor":            "rgba(120,120,120,0.7)",
                    "preview":              None,
                    "category":             None,
                    "is_stub_node":         True,
                    "stub_document":        False,
                    "referenced_work_ids":  [],
                    "related_work_ids":     [],
                },
            }

        cited = enriched.get("cited", 0)
        is_stub_doc = enriched.get("stub_document", True)

        if not is_stub_doc:
            # ── Full document in our DB ──────────────────────────────────────
            file_path = enriched.get("file", "")
            filename = clean_filename(file_path)
            preview_name = get_preview_filename(
                file_path) if file_path else None
            preview_exists = preview_name and os.path.exists(
                os.path.join(PREVIEW_DIR, preview_name)
            )

            try:
                cat_id_raw = enriched.get("category_id")
                category = get_category_by_id(
                    int(cat_id_raw)) if cat_id_raw is not None else None
                if not category:
                    category = NONE_CATEGORY
            except (TypeError, ValueError):
                category = NONE_CATEGORY

            return {
                "id":     wid,
                "loaded": True,
                "style":  {"label": enriched.get("title", wid)},
                "data": {
                    "title":                enriched.get("title",    wid),
                    "authors":              enriched.get("authors",  []),
                    "abstract":             enriched.get("abstract", ""),
                    "cited":                cited,
                    "doi":                  enriched.get("doi_number", ""),
                    "openalex_id":          wid,
                    "id":                   wid,
                    "file":                 filename,
                    "radius":               node_radius(cited),
                    "fillColor":            category["color"],
                    "preview":              f"/previews/{preview_name}" if preview_exists else None,
                    "category":             category,
                    "is_stub_node":         False,
                    "stub_document":        False,
                    "referenced_work_ids":  enriched.get("referenced_work_ids", []),
                    "related_work_ids":     enriched.get("related_work_ids",    []),
                },
            }
        else:
            # ── Stub node (metadata only) ────────────────────────────────────
            fill_color = (
                "rgba(120,120,120,0.7)"
                if link_style is REF_STYLE
                else "rgba(180,120,60,0.6)"
            )
            return {
                "id":     wid,
                "loaded": False,
                "style":  {"label": enriched.get("title", wid)},
                "data": {
                    "title":                enriched.get("title",    wid),
                    "authors":              enriched.get("authors",  []),
                    "abstract":             enriched.get("abstract", ""),
                    "cited":                cited,
                    "doi":                  enriched.get("doi_number", ""),
                    "openalex_id":          wid,
                    "radius":               node_radius(cited),
                    "fillColor":            fill_color,
                    "preview":              None,
                    "category":             None,
                    "is_stub_node":         True,
                    "stub_document":        True,
                    "referenced_work_ids":  enriched.get("referenced_work_ids", []),
                    "related_work_ids":     enriched.get("related_work_ids",    []),
                },
            }

    for wid in new_ref_ids:
        if wid not in shown_node_ids and wid not in seen_new:
            new_nodes.append(make_node(wid, enriched_map.get(wid), REF_STYLE))
            seen_new.add(wid)
        add_link(openalex_id, wid, REF_STYLE)

    for wid in new_rel_ids:
        if wid not in shown_node_ids and wid not in seen_new:
            new_nodes.append(make_node(wid, enriched_map.get(wid), REL_STYLE))
            seen_new.add(wid)
        add_link(openalex_id, wid, REL_STYLE)

    # ── 5. Cross-links between the newly added nodes ─────────────────────────
    all_now_visible = shown_node_ids | seen_new | {openalex_id}

    for node in new_nodes:
        wid = node["id"]
        enriched = enriched_map.get(wid)
        if not enriched:
            continue
        for ref_id in enriched.get("referenced_work_ids", []):
            if ref_id in all_now_visible and ref_id != wid:
                add_link(wid, ref_id, REF_STYLE)
        for rel_id in enriched.get("related_work_ids", []):
            if rel_id in all_now_visible and rel_id != wid:
                add_link(wid, rel_id, REL_STYLE)

    return jsonify({
        "nodes":       new_nodes,
        "links":       new_links,
        "new_ref_ids": new_ref_ids,
        "new_rel_ids": new_rel_ids,
    })


@app.route("/pdf-file/<path:filename>")
def serve_pdf(filename):
    file_path = os.path.join(PDF_DIR, filename)
    if not os.path.exists(file_path):
        return "File not found", 404
    response = make_response(send_from_directory(PDF_DIR, filename))
    response.headers["Content-Type"] = "application/pdf"
    response.headers["Content-Disposition"] = f'inline; filename="{filename}"'
    return response


@app.route("/previews/<path:filename>")
def preview(filename):
    return send_from_directory(PREVIEW_DIR, filename)


@app.route("/get-all-categories", methods=["GET"])
def route_get_all_categories():
    return jsonify(get_all_categories()), 200


@app.route("/create-category", methods=["POST"])
def route_create_category():
    body = request.get_json(silent=True) or {}
    name = body.get("name", "").strip()
    color = body.get("color", "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    if not color:
        return jsonify({"error": "color is required"}), 400
    cat = create_category(name, color)
    return jsonify(cat), 201


@app.route("/edit-category/<int:cat_id>", methods=["PATCH"])
def route_edit_category(cat_id):
    body = request.get_json(silent=True) or {}
    name = body.get("name")
    color = body.get("color")
    if name is not None:
        name = name.strip()
    if color is not None:
        color = color.strip()
    updated = edit_category(cat_id, name or None, color or None)
    if updated is None:
        return jsonify({"error": f"Category id={cat_id} not found"}), 404
    return jsonify(updated), 200


@app.route("/delete-category/<int:cat_id>", methods=["DELETE"])
def route_delete_category(cat_id):
    if cat_id == 0:
        return jsonify({"error": "Cannot delete the 'none' category"}), 400
    deleted = delete_category(cat_id)
    if not deleted:
        return jsonify({"error": f"Category id={cat_id} not found"}), 404
    return jsonify({"success": True, "deleted_id": cat_id}), 200


@app.route("/assign-category", methods=["POST"])
def route_assign_category():
    body = request.get_json(silent=True) or {}
    doc_id = body.get("document_id", "").strip()
    cat_id = body.get("category_id")

    if not doc_id:
        return jsonify({"error": "document_id is required"}), 400
    if cat_id is None:
        return jsonify({"error": "category_id is required"}), 400
    try:
        cat_id = int(cat_id)
    except (TypeError, ValueError):
        return jsonify({"error": "category_id must be an integer"}), 400

    result = assign_category_to_document(doc_id, cat_id)
    if not result["success"]:
        return jsonify({"error": result.get("error"), "detail": result.get("response")}), 500
    return jsonify(result), 200


register_chat(app)

if __name__ == "__main__":
    start_stub_worker()
    # ssl_context=("./proxy/cert.pem", "./proxy/key.pem"))
    app.run(host="127.0.0.1", port=3002, threaded=True)
