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
    confidence = "unknown"
    missing    = []
 
    try:
        image_path  = generate_preview(save_path, PREVIEW_DIR)
        grobid_info = extract_paper_data(save_path)
 
        #print(f"[{filename[:20]}] Grobid done — "f"full_text={'OK' if grobid_info.get('full_text') else 'MISSING'}")
 
        # ── Vision LLM for title + authors ───────────────────────────────────
        vision = extract_title_authors_from_image(image_path)
        if vision.get("title"):
            grobid_info["title"]   = vision["title"]
            #print(f"[{filename[:20]}] Vision title: {vision['title']}")
        if vision.get("authors"):
            grobid_info["authors"] = vision["authors"]
 
        # ── OCR fallback for full text ────────────────────────────────────────
        if len((grobid_info.get("full_text") or "").split()) < 100:
            #print(f"[{filename[:20]}] No full text from Grobid, running OCR...")
            ocr_text = extract_fallback_text(save_path)
            if ocr_text.strip():
                grobid_info["full_text"] = ocr_text
 
        # ── Crossref ──────────────────────────────────────────────────────────
        crossref_info = {}
        grobid_doi    = grobid_info.get("doi")
 
        if grobid_doi:
            # Full fetch — includes reference_dois and cited_by_count
            crossref_info = crossref_by_doi(grobid_doi)
 
        if not crossref_info:
            # Title search first (lightweight), then full fetch if DOI found
            search_result = crossref_by_title(
                title   = grobid_info.get("title", ""),
                authors = grobid_info.get("authors", []),
            )
            found_doi = search_result.get("doi")
            if found_doi and not search_result.get("low_confidence"):
                crossref_info = crossref_by_doi(found_doi)
            else:
                crossref_info = search_result
 
        # ── Merge Crossref into grobid_info ──────────────────────────────────
        if crossref_info and not crossref_info.get("low_confidence"):
            if crossref_info.get("doi"):
                grobid_info["doi"] = crossref_info["doi"]
            if crossref_info.get("abstract"): 
                grobid_info["abstract"] = crossref_info["abstract"]
            if crossref_info.get("authors"): 
                grobid_info["authors"] = crossref_info["authors"]
            if crossref_info.get("reference_dois"):
                grobid_info["reference_dois"] = crossref_info["reference_dois"]
        
        print(f"DEBUG reference_dois: {grobid_info.get('reference_dois', [])[:5]}")
        #print(grobid_info["doi"], "\n",grobid_info["title"],"\n", grobid_info["abstract"],"\n", grobid_info["authors"], "\n\n\n\n", crossref_info)

        # ── Build XML and upload ──────────────────────────────────────────────
        xml_string     = build_xml(crossref_info or None, grobid_info, image_path)
        final_xml_name = f"{XML_OUT_PATH}/{os.path.splitext(filename)[0]}.xml"
        save_xml(xml_string, final_xml_name)
 
        upload_result = upload_xml(xml_string, CP_URL, CP_USER, CP_PASS)
 
        if upload_result["success"]:
            print(f"SUCCESS: [{filename[:20]}]") 
            print("\n\n\n")
        else:
            print(f"ERROR: [{filename}] {upload_result['error']}")
 
    except Exception as e:
        print(f"FATAL: [{filename}] {str(e)}")




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
    fullQ = f"<query>{query}*</query><relevance>decending</relevance><docs>10</docs>"
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

        category = doc.get("category", {}).get("name") if isinstance(doc.get("category"), dict) else doc.get("category"),


        results.append({
            "title":          doc.get("title"),
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
        })

    return results




CATEGORIES = [
    {"cat-name": "crystals",   "cat-color": "rgba(239,68,68,0.92)"},     # vivid red
    {"cat-name": "bones",      "cat-color": "rgba(59,130,246,0.92)"},    # vivid blue
    {"cat-name": "teeth",      "cat-color": "rgba(16,185,129,0.92)"},    # vivid green
    {"cat-name": "implants",   "cat-color": "rgba(245,158,11,0.92)"},    # vivid amber
    {"cat-name": "coatings",   "cat-color": "rgba(168,85,247,0.92)"},    # vivid purple
    {"cat-name": "composites", "cat-color": "rgba(236,72,153,0.92)"},    # vivid pink
]

@app.route("/search")
def search():
    query = request.args.get("query", "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400
    try:
        results = do_search(query)

        nodes = []
        links = []

        # ── query node ────────────────────────────────────────────────────────
        nodes.append({
            "id":     "query",
            "loaded": True,
            "style":  { "label": (query[:50] + "…") if len(query) > 50 else query },
            "data": {
                "title":     query,
                "authors":   [],
                "doi":       "",
                "cited":     0,
                "radius":    20,
                "fillColor": "rgba(255,220,0,0.95)",
                "preview":   None,
                "category":  None,
            },
        })

        doi_to_id = {r["doi_number"]: r["doi_number"] for r in results if r["doi_number"]}

        for r in results:
            if not r["doi_number"]:
                continue

            cited = r["cited_by_count"]
            try:
                cited = int(cited) if cited is not None else 0
            except (ValueError, TypeError):
                cited = 0

            radius      = round(20 + math.sqrt(cited)*2, 1)
            title       = r["title"] or r["doi_number"]
            short_label = (title[:50] + "…") if len(title) > 50 else title
            authors     = r["authors"] or []

            # TODO: replace with real category lookup once field is populated:
            # cat_raw  = r.get("category")
            # category = next((c for c in CATEGORIES if c["cat-name"] == cat_raw), random.choice(CATEGORIES))
            category = random.choice(CATEGORIES)

            nodes.append({
                "id":     r["doi_number"],
                "loaded": True,
                "style":  { "label": short_label },
                "data": {
                    "title":     title,
                    "authors":   authors,
                    "doi":       r["doi_number"],
                    "cited":     cited,
                    "radius":    radius,
                    "fillColor": category["cat-color"],
                    "preview":   r["preview"],
                    "category":  category,
                },
            })

            # q-link
            links.append({
                "id":   f"q->{r['doi_number']}",
                "from": "query",
                "to":   r["doi_number"],
                "style": {
                    "fillColor": "rgba(99,102,241,0.35)",
                    "radius":    1,
                },
            })

            # reference links (only within result set)
            for ref_doi in r["reference_dois"]:
                if ref_doi in doi_to_id:
                    links.append({
                        "id":   f"{r['doi_number']}->{ref_doi}",
                        "from": r["doi_number"],
                        "to":   ref_doi,
                        "style": {
                            "fillColor":    "rgba(255,200,50,0.6)",
                            "radius":       2,
                            "toDecoration": "arrow",
                        },
                    })

        return jsonify({
            "query":      query,
            "results":    results,
            "chart_data": {"nodes": nodes, "links": links},
        })
    except Exception as e:
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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3002, debug=True, threaded=True)

