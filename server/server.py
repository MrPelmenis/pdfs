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

from src.vision_extractor import extract_title_authors_from_image
from src.crossref         import crossref_by_doi, crossref_by_title

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
 
        crossref_info = {}
        grobid_doi    = grobid_info.get("doi")
 
        if grobid_doi:
            crossref_info = crossref_by_doi(grobid_doi)
 
        if not crossref_info:
            search_result = crossref_by_title(
                title   = grobid_info.get("title", ""),
                authors = grobid_info.get("authors", []),
            )
            found_doi = search_result.get("doi")
            if found_doi and not search_result.get("low_confidence"):
                crossref_info = crossref_by_doi(found_doi)
            else:
                crossref_info = search_result
 
        if crossref_info and not crossref_info.get("low_confidence"):
            if crossref_info.get("doi"):
                grobid_info["doi"] = crossref_info["doi"]
            if crossref_info.get("abstract"):
                grobid_info["abstract"] = crossref_info["abstract"]
            if crossref_info.get("authors"):
                grobid_info["authors"] = crossref_info["authors"]
            if crossref_info.get("reference_dois"):
                grobid_info["reference_dois"] = crossref_info["reference_dois"]
 
        final_doi = grobid_info.get("doi") or (crossref_info or {}).get("doi")
        if final_doi:
            existing = fetch_cp_document(final_doi, CP_URL, CP_USER, CP_PASS)
            if existing and existing.get("stub_document") == "yes":
                print(f"[app] Replacing stub for DOI: {final_doi}")
                delete_cp_document(final_doi, CP_URL, CP_USER, CP_PASS)
 
        xml_string     = build_xml(crossref_info or None, grobid_info, image_path, stub=False)
        final_xml_name = f"{XML_OUT_PATH}/{os.path.splitext(filename)[0]}.xml"
        save_xml(xml_string, final_xml_name)
 
        upload_result = upload_xml(xml_string, CP_URL, CP_USER, CP_PASS)
 
        if upload_result["success"]:
            print(f"SUCCESS: [{filename[:20]}]")
            print("\n\n\n")
 
            ref_dois = grobid_info.get("reference_dois", [])
            if ref_dois:
                added = add_dois_to_queue(ref_dois)
                print(f"[app] Added {added} DOIs to stub queue")
        else:
            print(f"ERROR: [{filename}] {upload_result['error']}")
 
    except Exception as e:
        print(f"FATAL: [{filename}] {str(e)}")
    finally:
        set_pdf_processing(False) 


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
    fullQ = f"<query><stub_document>no</stub_document>{query}*</query><relevance>decending</relevance><docs>10</docs>"
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

        raw_ref_dois = doc.get("references_doi")
        if raw_ref_dois is None:
            reference_dois = []
        else:
            r = raw_ref_dois.get("reference_doi", [])
            reference_dois = [r] if isinstance(r, str) else r

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
            "title":          doc.get("title"),
            "id":             doc.get("id"),
            "file":           filename,
            "date":           doc.get("date"),
            "full_text":      doc.get("full_text"),
            "authors":        authors,
            "abstract":       doc.get("abstract"),
            "preview":        f"/previews/{preview_name}" if preview_exists else None,
            "doi_number":     doc.get("doi_number", ""),
            "cited_by_count": doc.get("cited_by_count"),
            "reference_dois": reference_dois,
            "category": category,
            "stub_document":  doc.get("stub_document", "no"),

        })

    return results


def filterGrayNodes(reference_dois):
    return reference_dois[:5]


def lookup_gray_node(doi: str) -> dict | None:
    if not doi:
        return None
    body = (
        f"<document><id>{escape(doi)}</id></document>"
        f"<list>"
        f"<title>yes</title>"
        f"<cited_by_count>yes</cited_by_count>"
        f"<authors>yes</authors>"
        f"<abstract>yes</abstract>"
        f"<stub_document>yes</stub_document>"
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

        title   = (doc.findtext("title") or "").strip()
        cited   = int(doc.findtext("cited_by_count") or 0)
        abstract = (doc.findtext("abstract") or "").strip()
        stub    = (doc.findtext("stub_document") or "no").strip() == "yes"
        authors = [a.text.strip() for a in doc.findall(".//authors/author") if a.text]

        return {
            "title":     title,
            "cited":     cited,
            "abstract":  abstract,
            "authors":   authors,
            "stub_document": stub,
        }
    except Exception as e:
        print(f"[lookup_gray_node] failed for {doi}: {e}")
        return None

@app.route("/search")
def search():
    query = request.args.get("query", "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400
    try:
        results = do_search(query)
        all_nodes = []
        initial_nodes = [] 
        links = []

        query_node = {
            "id":     "query",
            "loaded": True,
            "style":  { "label": (query[:50] + "…") if len(query) > 50 else query },
            "data": {
                "title":     query,
                "authors":   [],
                "doi":       "",
                "cited":     0,
                "radius":    20,
                "fillColor": "#ffffff",
                "preview":   None,
                "category":  None,
            },
        }
        initial_nodes.append("query")
        all_nodes.append(query_node)

        for doc in results:
            cited = int(doc["cited_by_count"] or 0)
            title = doc["title"]
            radius   = round(40 + math.sqrt(cited) * 2, 1)
            title    = doc["title"] or doc["doi_number"]
            authors  = doc["authors"] or []
            abstract = doc["abstract"] or ""
            category = doc["category"]
 

            result_node =({
                "id":     doc["doi_number"],
                "loaded": True,
                "style":  { "label": title },
                "data": {
                    "title":     title,
                    "authors":   authors,
                    "doi":       doc["doi_number"],
                    "cited":     cited,
                    "id":        doc["id"], 
                    "file":      doc["file"],
                    "radius":    radius,
                    "abstract":  abstract,
                    "fillColor": category["color"],
                    "preview":   doc["preview"],
                    "category":  category,
                    "isGray":    False,
                }})
            initial_nodes.append(result_node["id"])
            all_nodes.append(result_node)

        for node in all_nodes:
            if node["id"] != "query":
                links.append({
                    "from":"query",
                    "to":node["id"],
                    "style": {
                        "fillColor": "rgba(99,102,241,0.35)",
                        "radius":    2,
                        "toDecoration": "arrow",
                    }
                })


        result_doi_set = set(doc["doi_number"] for doc in results if doc["doi_number"])
        for doc in results:
            for ref_doi in doc["reference_dois"]:
                if ref_doi in result_doi_set and ref_doi != doc["doi_number"]:
                    links.append({
                        "from": doc["doi_number"],
                        "to":   ref_doi,
                        "style": {
                            "fillColor": "rgba(99,102,241,0.35)",
                            "radius":    2,
                            "toDecoration": "arrow",
                        }
                    })


        #pievienojam sitos graynodes  filtreti (pagaidam pirmie 5 ) katru vienreiz 
        seen_ids = set(node["id"] for node in all_nodes)  
        for node in results:
            reference_dois = filterGrayNodes(node["reference_dois"])
            for reference_doi in reference_dois: 
                if reference_doi not in seen_ids:
                    enriched = lookup_gray_node(reference_doi)
                    
                    if not enriched:
                        print("not in CP: ", reference_doi)
                        add_dois_to_queue([reference_doi])

                    cited    = enriched["cited"] if enriched else 0
                    gray_node = {
                        "id":     reference_doi,
                        "loaded": False,
                        "style":  { "label": enriched["title"] if enriched else reference_doi },
                        "data": {
                            "title":         enriched["title"]    if enriched else reference_doi,
                            "authors":       enriched["authors"]  if enriched else [],
                            "abstract":      enriched["abstract"] if enriched else "",
                            "cited":         cited,
                            "doi":           reference_doi,
                            "radius":        round(40 + math.sqrt(cited) * 2, 1) if enriched else 15,
                            "fillColor":     "rgba(120,120,120,0.7)",
                            "preview":       None,
                            "category":      None,
                            "isGray":        True,
                            "stub_document": enriched["stub_document"] if enriched else False,
                        }
                    }
                    all_nodes.append(gray_node)
                    seen_ids.add(reference_doi)
                links.append({
                    "from":node["id"],
                    "to":reference_doi,
                    "style": {
                        "fillColor": "rgba(99,102,241,0.35)",
                        "radius":    2,
                        "toDecoration": "arrow",
                    }
                })


        return jsonify({
            "query":         query,
            "results":       results,
            "chart_data":    {"nodes": all_nodes, "links": links},
            "initial_nodes": initial_nodes,
        })
    except Exception as e:
        print(str(e))
        return jsonify({"error": str(e)}), 500




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

