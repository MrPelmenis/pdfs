import os
import requests
from flask import Flask, request, jsonify, send_from_directory, make_response
from flask_cors import CORS
from dotenv import load_dotenv
import sys
import json
import random
import re
import math



from concurrent.futures import ThreadPoolExecutor
background_executor = ThreadPoolExecutor(max_workers=1)

from src.pdfToImage import generate_preview
from src.parser import extract_paper_data
from src.xml_builder import build_xml, save_xml, upload_xml, extract_fallback_text, grobid_confidence

from src.vision_extractor   import extract_title_authors_from_image
from src.metadata_analyser  import openalex_by_id, openalex_by_title

from src.categories import (get_all_categories,create_category, edit_category, delete_category, get_random_category, assign_category_to_document, get_category_by_id, NONE_CATEGORY)

from src.queue_manager import add_dois_to_queue
from src.stub_worker import start_stub_worker, set_pdf_processing, cp_document_exists, fetch_cp_document, delete_cp_document
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape



load_dotenv()

CP_URL  = os.getenv("CP_URL")
CP_USER = os.getenv("CP_USER")
CP_PASS = os.getenv("CP_PASS")

app = Flask(__name__)
CORS(app)

PREVIEW_DIR  = "./files/pdf-preview-images"
PDF_DIR      = "./files/pdf-files"
XML_OUT_PATH = "./files/xml-files"   

os.makedirs(PDF_DIR,      exist_ok=True)
os.makedirs(PREVIEW_DIR,  exist_ok=True)
os.makedirs(XML_OUT_PATH,  exist_ok=True)

def process_file_background(filename, save_path):
    set_pdf_processing(True)
    try:
        confidence = "unknown"
        missing    = []

        image_path  = generate_preview(save_path, PREVIEW_DIR)
        grobid_info = extract_paper_data(save_path)

        vision = extract_title_authors_from_image(image_path)
        if vision.get("title"):
            grobid_info["title"]   = vision["title"]
        if vision.get("authors"):
            grobid_info["authors"] = vision["authors"]

        if len((grobid_info.get("full_text") or "").split()) < 100:
            ocr_text = extract_fallback_text(save_path)
            if ocr_text.strip():
                grobid_info["full_text"] = ocr_text

        openalex_info = {}
        grobid_doi    = grobid_info.get("doi")

        if grobid_doi:
            openalex_info = openalex_by_id(grobid_doi)

        if not openalex_info:
            openalex_info = openalex_by_title(
                title   = grobid_info.get("title", ""),
                authors = grobid_info.get("authors", []),
            )

        if openalex_info:
            if openalex_info.get("openalex_id"):
                grobid_info["openalex_id"] = openalex_info["openalex_id"]
            if openalex_info.get("doi"):
                grobid_info["doi"] = openalex_info["doi"]
            if openalex_info.get("abstract"):
                grobid_info["abstract"] = openalex_info["abstract"]
            if openalex_info.get("authors"):
                grobid_info["authors"] = openalex_info["authors"]
            if openalex_info.get("referenced_work_ids"):
                grobid_info["referenced_work_ids"] = openalex_info["referenced_work_ids"]
            if openalex_info.get("related_work_ids"):
                grobid_info["related_work_ids"] = openalex_info["related_work_ids"]
            if openalex_info.get("topics"):
                grobid_info["topics"] = openalex_info["topics"]


        final_id = grobid_info.get("openalex_id") or slugify(grobid_info.get("title", ""))
        if final_id:
            existing = fetch_cp_document(final_id, CP_URL, CP_USER, CP_PASS)
            #ja dokuments jau bija kip stub tad izdzesam un ieliekam pilno
            if existing and existing.get("stub_document") == "yes":
                print(f"[app] Replacing stub for ID: {final_id}")
                delete_cp_document(final_id, CP_URL, CP_USER, CP_PASS)

        xml_string     = build_xml(openalex_info or None, grobid_info, image_path, stub=False)
        final_xml_name = f"{XML_OUT_PATH}/{os.path.splitext(filename)[0]}.xml"
        save_xml(xml_string, final_xml_name)

        upload_result = upload_xml(xml_string, CP_URL, CP_USER, CP_PASS)

        if upload_result["success"]:
            print(f"SUCCESS: [{filename[:20]}]")
            print("\n\n\n")

            #pievienojm bacgkround procesam sito
            ref_ids = grobid_info.get("referenced_work_ids", [])
            rel_ids = grobid_info.get("related_work_ids", [])
            all_ids = list(set(ref_ids + rel_ids))
            if all_ids:
                added = add_dois_to_queue(all_ids)
                #print(f"[app] Added {added} OpenAlex IDs to stub queue")
        else:
            #print(upload_result)
            print(f"ERROR: [{filename}] {upload_result['error']}")

    except Exception as e:
        print(f"FATAL: [{filename}] {str(e)}")
    finally:
        set_pdf_processing(False)


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

    unique_filename = make_unique_filename(filename)
    save_path = os.path.join(PDF_DIR, unique_filename)
    file.save(save_path)

    background_executor.submit(process_file_background, unique_filename, save_path)

    return jsonify({
        "message": "Upload successful. Processing in background.",
        "filename": unique_filename
    }), 200


def get_preview_filename(file_path):
    basename = os.path.basename(file_path)
    return os.path.splitext(basename)[0] + ".jpeg"


def clean_filename(file_path):
    if not file_path:
        return None
    return os.path.basename(file_path)


def do_search(query):
    fullQ = (
        f"<query><stub_document>no</stub_document>{query}*</query>"
        f"<relevance>decending</relevance>"
        f"<docs>10</docs>"
        f"<list>"
        f"<id>yes</id>"
        f"<openalex_id>yes</openalex_id>"
        f"<title>yes</title>"
        f"<abstract>yes</abstract>"
        f"<authors>yes</authors>"
        f"<date>yes</date>"
        f"<doi_number>yes</doi_number>"
        f"<cited_by_count>yes</cited_by_count>"
        f"<file>yes</file>"
        f"<img_preview_path>yes</img_preview_path>"
        f"<full_text>yes</full_text>"
        f"<stub_document>yes</stub_document>"
        f"<category_id>yes</category_id>"
        f"<topics>yes</topics>"
        f"<concepts>yes</concepts>"
        f"<keywords>yes</keywords>"
        f"<referenced_work_ids>yes</referenced_work_ids>"
        f"<related_work_ids>yes</related_work_ids>"
        f"</list>"
    )
    resp = requests.post(
        CP_URL + "/api/databases/pdfs/search/json",
        data=fullQ,
        auth=(CP_USER, CP_PASS),
    )
    resp.raise_for_status()
    data = resp.json()
 
    documents = (
        data.get("cps:reply", {})
            .get("cps:content", {})
            .get("results", {})
            .get("document", [])
    )
    if isinstance(documents, dict):
        documents = [documents]
 
    results = []
    for doc in documents:
        raw_authors = doc.get("authors")
        if raw_authors is None:
            authors = []
        else:
            a = raw_authors.get("author", [])
            authors = [a] if isinstance(a, str) else a
 
        # Topics
        raw_topics = doc.get("topics")
        if raw_topics is None:
            topics = []
        else:
            t = raw_topics.get("topic", [])
            topics = [t] if isinstance(t, str) else t
 
        # Referenced work IDs
        raw_ref_ids = doc.get("referenced_work_ids")
        if raw_ref_ids is None:
            referenced_work_ids = []
        else:
            r = raw_ref_ids.get("referenced_work_id", [])
            referenced_work_ids = [r] if isinstance(r, str) else r
 
        # Related work IDs
        raw_rel_ids = doc.get("related_work_ids")
        if raw_rel_ids is None:
            related_work_ids = []
        else:
            r = raw_rel_ids.get("related_work_id", [])
            related_work_ids = [r] if isinstance(r, str) else r
 
        file_path    = doc.get("file")
        filename     = clean_filename(file_path)
        preview_name = get_preview_filename(file_path) if file_path else None
        preview_exists = preview_name and os.path.exists(
            os.path.join(PREVIEW_DIR, preview_name)
        )
 
        try:
            cat_id_raw = doc.get("category_id")
            category = get_category_by_id(int(cat_id_raw)) if cat_id_raw is not None else None
            if not category:
                category = NONE_CATEGORY
        except (TypeError, ValueError):
            category = NONE_CATEGORY
 
        results.append({
            "title":               doc.get("title"),
            "id":                  doc.get("id"),          # OpenAlex ID (primary key)
            "openalex_id":         doc.get("openalex_id", ""),
            "file":                filename,
            "date":                doc.get("date"),
            "full_text":           doc.get("full_text"),
            "authors":             authors,
            "abstract":            doc.get("abstract"),
            "preview":             f"/previews/{preview_name}" if preview_exists else None,
            "doi_number":          doc.get("doi_number", ""),
            "cited_by_count":      doc.get("cited_by_count"),
            "topics":              topics,
            "referenced_work_ids": referenced_work_ids,
            "related_work_ids":    related_work_ids,
            "category":            category,
            "stub_document":       doc.get("stub_document", "no"),
        })
 
    return results
 
 
def _enrich_and_sort(work_ids: list, limit: int) -> list[tuple[str, dict | None]]:
    """
    Look up all work_ids in CP, sort by cited_by_count desc, return top `limit`
    as list of (openalex_id, enriched_or_None) tuples.
    Unknown/missing nodes get cited=0 and sort to the bottom.
    """
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
    body = (
        f"<document><id>{escape(openalex_id)}</id></document>"
        f"<list>"
        f"<title>yes</title>"
        f"<cited_by_count>yes</cited_by_count>"
        f"<authors>yes</authors>"
        f"<abstract>yes</abstract>"
        f"<stub_document>yes</stub_document>"
        f"<doi_number>yes</doi_number>"
        f"<referenced_work_ids>yes</referenced_work_ids>"
        f"<related_work_ids>yes</related_work_ids>"
        f"</list>"
    )
    try:
        resp = requests.post(
            CP_URL.rstrip("/") + "/api/databases/pdfs/lookup",
            data=body,
            auth=(CP_USER, CP_PASS),
            timeout=10,
        )
        resp.raise_for_status()
        if "<found>1</found>" not in resp.text:
            return None
        root = ET.fromstring(resp.text)
        doc  = root.find(".//document")
        if doc is None:
            return None
 
        title    = (doc.findtext("title") or "").strip()
        cited    = int(doc.findtext("cited_by_count") or 0)
        abstract = (doc.findtext("abstract") or "").strip()
        stub     = (doc.findtext("stub_document") or "no").strip() == "yes"
        authors  = [a.text.strip() for a in doc.findall(".//authors/author") if a.text]
 
        return {
            "title":         title,
            "cited":         cited,
            "abstract":      abstract,
            "authors":       authors,
            "stub_document": stub,
        }
    except Exception as e:
        print(f"[lookup_gray_node] failed for {openalex_id}: {e}")
        return None
 
 
@app.route("/search")
def search():
    query = request.args.get("query", "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400

    try:
        results = do_search(query)

        all_nodes     = []
        links         = []
        initial_nodes = ["query"]
        seen_ids      = set()
        seen_links    = set()

        def add_link(from_id, to_id, style):
            key = (from_id, to_id)
            if key in seen_links or from_id == to_id:
                return
            seen_links.add(key)
            links.append({"from": from_id, "to": to_id, "style": style})

        def node_radius(cited, fallback=15):
            return min(100, round(40 + math.sqrt(cited) * 2, 1)) if cited else fallback

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
            cited   = int(doc["cited_by_count"] or 0)
            title   = doc["title"] or doc["doi_number"]
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
            rel_ids_by_node[node_id] = doc["related_work_ids"]    or []

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
            "initial_nodes": initial_nodes,
        })

    except Exception as e:
        print(str(e))
        return jsonify({"error": str(e)}), 500


def batch_lookup(ids: list) -> dict:
    if not ids:
        return {}
    body = "".join(f"<document><id>{escape(wid)}</id></document>" for wid in ids)
    body += (
        "<list>"
        "<title>yes</title>"
        "<cited_by_count>yes</cited_by_count>"
        "<authors>yes</authors>"
        "<abstract>yes</abstract>"
        "<stub_document>yes</stub_document>"
        "<doi_number>yes</doi_number>"
        "<referenced_work_ids>yes</referenced_work_ids>"
        "<related_work_ids>yes</related_work_ids>"
        "</list>"
    )
    try:
        resp = requests.post(
            CP_URL.rstrip("/") + "/api/databases/pdfs/lookup/json",
            data=body,
            auth=(CP_USER, CP_PASS),
            timeout=15,
        )
        resp.raise_for_status()
        docs = resp.json().get("cps:reply", {}).get("cps:content", {}).get("document", [])
        if isinstance(docs, dict):
            docs = [docs]
        result = {}
        for doc in docs:
            wid = doc.get("id") or doc.get("openalex_id")
            if not wid:
                continue

            raw_authors = doc.get("authors") or {}
            a = raw_authors.get("author", [])
            authors = [a] if isinstance(a, str) else a

            raw_ref = doc.get("referenced_work_ids") or {}
            r = raw_ref.get("referenced_work_id", [])
            ref_ids = [r] if isinstance(r, str) else r

            raw_rel = doc.get("related_work_ids") or {}
            r = raw_rel.get("related_work_id", [])
            rel_ids = [r] if isinstance(r, str) else r

            result[wid] = {
                "title":               (doc.get("title") or "").strip(),
                "cited":               int(doc.get("cited_by_count") or 0),
                "abstract":            (doc.get("abstract") or "").strip(),
                "authors":             authors,
                "stub_document":       (doc.get("stub_document") or "no") == "yes",
                "doi_number":          doc.get("doi_number", ""),
                "referenced_work_ids": ref_ids,
                "related_work_ids":    rel_ids,
            }
        return result
    except Exception as e:
        print(f"[batch_lookup] failed: {e}")
        return {}


@app.route("/expand", methods=["POST"])
def expand():
    body = request.get_json(force=True)

    openalex_id   = (body.get("openalex_id") or "").strip()
    shown_node_ids = set(body.get("shown_node_ids") or [])
    shown_ref_ids  = set(body.get("shown_ref_ids")  or [])
    shown_rel_ids  = set(body.get("shown_rel_ids")  or [])

    if not openalex_id:
        return jsonify({"error": "openalex_id is required"}), 400

    # ── 1. Look up the target node to get its edge lists ────────────────────
    node_data = lookup_gray_node(openalex_id)
    if node_data is None:
        return jsonify({"error": f"Node {openalex_id} not found in ClusterPoint"}), 404

    # lookup_gray_node doesn't return edge lists — do a full lookup here
    body_xml = (
        f"<document><id>{escape(openalex_id)}</id></document>"
        f"<list>"
        f"<title>yes</title>"
        f"<cited_by_count>yes</cited_by_count>"
        f"<referenced_work_ids>yes</referenced_work_ids>"
        f"<related_work_ids>yes</related_work_ids>"
        f"</list>"
    )
    try:
        resp = requests.post(
            CP_URL.rstrip("/") + "/api/databases/pdfs/lookup",
            data=body_xml,
            auth=(CP_USER, CP_PASS),
            timeout=10,
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        doc  = root.find(".//document")
        if doc is None:
            return jsonify({"error": "Node document not found"}), 404

        raw_ref = doc.find("referenced_work_ids")
        all_ref_ids = []
        if raw_ref is not None:
            r = [el.text for el in raw_ref.findall("referenced_work_id") if el.text]
            all_ref_ids = r

        raw_rel = doc.find("related_work_ids")
        all_rel_ids = []
        if raw_rel is not None:
            r = [el.text for el in raw_rel.findall("related_work_id") if el.text]
            all_rel_ids = r

    except Exception as e:
        return jsonify({"error": f"CP lookup failed: {e}"}), 500

    # ── 2. Filter out already-shown, then batch-lookup remaining candidates ──
    candidate_ref_ids = [i for i in all_ref_ids if i not in shown_ref_ids]
    candidate_rel_ids = [i for i in all_rel_ids if i not in shown_rel_ids]

    all_candidates = list(set(candidate_ref_ids + candidate_rel_ids))

    # Reuse the same batch_lookup defined in /search
    enriched_map = batch_lookup(all_candidates)

    # ── 3. Sort by cited_by_count desc, take next 5 refs / 3 rels ───────────
    def sorted_candidates(id_list, limit):
        scored = [
            (wid, enriched_map.get(wid, {}).get("cited", 0))
            for wid in id_list
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [wid for wid, _ in scored[:limit]]

    new_ref_ids = sorted_candidates(candidate_ref_ids, 5)
    new_rel_ids = sorted_candidates(candidate_rel_ids, 3)

    # ── 4. Build new nodes and links ─────────────────────────────────────────
    new_nodes      = []
    new_links      = []
    seen_new       = set()
    seen_links_set = set()

    def node_radius(cited, fallback=15):
        return min(100, round(40 + math.sqrt(cited) * 2, 1)) if cited else fallback

    REF_STYLE = {
        "fillColor":    "rgba(120,120,120,0.7)",
        "radius":       2,
        "toDecoration": "arrow",
    }
    REL_STYLE = {
        "fillColor":    "rgba(180,120,60,0.6)",
        "radius":       1.5,
        "toDecoration": "arrow",
        "dashSize":     4,
    }

    def add_link(from_id, to_id, style):
        key = (from_id, to_id)
        if key in seen_links_set or from_id == to_id:
            return
        seen_links_set.add(key)
        new_links.append({"from": from_id, "to": to_id, "style": style})

    def make_stub_node(wid, enriched, fill_color):
        cited = enriched["cited"] if enriched else 0
        return {
            "id":     wid,
            "loaded": False,
            "style":  {"label": enriched["title"] if enriched else wid},
            "data": {
                "title":                enriched["title"]               if enriched else wid,
                "authors":              enriched["authors"]             if enriched else [],
                "abstract":             enriched["abstract"]            if enriched else "",
                "cited":                cited,
                "doi":                  enriched.get("doi_number", "")  if enriched else "",
                "openalex_id":          wid,
                "radius":               node_radius(cited),
                "fillColor":            fill_color,
                "preview":              None,
                "category":             None,
                "is_stub_node":         True,
                "stub_document":        enriched["stub_document"]       if enriched else False,
                "referenced_work_ids":  enriched["referenced_work_ids"] if enriched else [],
                "related_work_ids":     enriched["related_work_ids"]    if enriched else [],
            },
        }

    # New ref nodes
    for wid in new_ref_ids:
        if wid not in shown_node_ids and wid not in seen_new:
            enriched = enriched_map.get(wid)
            new_nodes.append(make_stub_node(wid, enriched, "rgba(120,120,120,0.7)"))
            seen_new.add(wid)
        add_link(openalex_id, wid, REF_STYLE)

    # New rel nodes
    for wid in new_rel_ids:
        if wid not in shown_node_ids and wid not in seen_new:
            enriched = enriched_map.get(wid)
            new_nodes.append(make_stub_node(wid, enriched, "rgba(180,120,60,0.6)"))
            seen_new.add(wid)
        add_link(openalex_id, wid, REL_STYLE)

    # ── 5. Cross-links: connect new nodes to any already on the graph ────────
    # Collect all edge info for newly added nodes
    all_now_visible = shown_node_ids | seen_new | {openalex_id}

    for node in new_nodes:
        wid      = node["id"]
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
        "nodes":        new_nodes,
        "links":        new_links,
        "new_ref_ids":  new_ref_ids,
        "new_rel_ids":  new_rel_ids,
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
    name  = body.get("name", "").strip()
    color = body.get("color", "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    if not color:
        return jsonify({"error": "color is required"}), 400
    cat = create_category(name, color)
    return jsonify(cat), 201


@app.route("/edit-category/<int:cat_id>", methods=["PATCH"])
def route_edit_category(cat_id):
    body  = request.get_json(silent=True) or {}
    name  = body.get("name")
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
    body   = request.get_json(silent=True) or {}
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

    result = assign_category_to_document(doc_id, cat_id, CP_URL, CP_USER, CP_PASS)
    if not result["success"]:
        return jsonify({"error": result.get("error"), "detail": result.get("response")}), 500
    return jsonify(result), 200


if __name__ == "__main__":
    start_stub_worker(CP_URL, CP_USER, CP_PASS)
    app.run(host="0.0.0.0", port=3002, debug=True, threaded=True)
