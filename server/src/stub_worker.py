import time
import random
import threading
import requests

from src.metadata_analyser import openalex_by_id
from src.xml_builder        import build_xml, upload_xml
from src.queue_manager      import peek_next_id, remove_first_id
from xml.sax.saxutils       import escape


_pdf_processing = False
_flag_lock       = threading.Lock()


def set_pdf_processing(value: bool):
    global _pdf_processing
    with _flag_lock:
        _pdf_processing = value


def is_pdf_processing() -> bool:
    with _flag_lock:
        return _pdf_processing


def cp_document_exists(openalex_id: str, cp_url: str, cp_user: str, cp_pass: str) -> bool:
    if not openalex_id:
        return False
    body = (
        f"<document><id>{escape(openalex_id).upper()}</id></document>"
        f"<list>"
        f"<file>no</file><title>no</title><date>no</date>"
        f"<doi_number>no</doi_number><img_preview_path>no</img_preview_path>"
        f"<stub_document>no</stub_document><authors>no</authors>"
        f"<abstract>no</abstract><cited_by_count>no</cited_by_count>"
        f"<referenced_work_ids>no</referenced_work_ids><related_work_ids>no</related_work_ids>"
        f"<category_id>no</category_id>"
        f"</list>"
    )
    try:
        resp = requests.post(
            cp_url.rstrip("/") + "/api/databases/pdfs/lookup",
            data=body,
            auth=(cp_user, cp_pass),
            timeout=10,
        )

        resp.raise_for_status()
        return "<found>1</found>" in resp.text
    except Exception as e:
        print(f"[stub_worker] CP existence check failed for {openalex_id}: {e}")
        return False
  

def fetch_cp_document(openalex_id: str, cp_url: str, cp_user: str, cp_pass: str) -> dict | None:
    if not openalex_id:
        return None
    body = f"<document><id>{escape(openalex_id).upper()}</id></document>"
    f"<list>"
    f"<id>yes</id>"
    f"</list>"

    try:
        resp = requests.post(
            cp_url.rstrip("/") + "/api/databases/pdfs/lookup",
            data=body,
            auth=(cp_user, cp_pass),
            timeout=10,
        )
        resp.raise_for_status()
        if "<found>0</found>" in resp.text:
            return None
        return _parse_lookup_response(resp.text)
    except Exception as e:
        print(f"[stub_worker] CP fetch failed for {openalex_id}: {e}")
        return None


def delete_cp_document(doc_id: str, cp_url: str, cp_user: str, cp_pass: str) -> bool:
    body = f"<document><id>{escape(doc_id).upper()}</id></document>"
    try:
        resp = requests.post(
            cp_url.rstrip("/") + "/api/databases/pdfs/delete",
            data=body,
            auth=(cp_user, cp_pass),
            headers={"Content-Type": "text/xml"},
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        print(f"[stub_worker] CP delete failed for {doc_id}: {e}")
        return False


def _parse_lookup_response(xml_text: str) -> dict | None:
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        print(f"[stub_worker] Failed to parse CP response: {e}")
        return None

    doc_el = root.find(".//document")
    if doc_el is None:
        return None

    def text(tag):
        el = doc_el.find(tag)
        return el.text.strip() if el is not None and el.text else None

    authors = []
    for a in doc_el.findall(".//authors/author"):
        if a.text:
            authors.append(a.text.strip())

    referenced_work_ids = []
    for r in doc_el.findall(".//referenced_work_ids/referenced_work_id"):
        if r.text:
            referenced_work_ids.append(r.text.strip())

    related_work_ids = []
    for r in doc_el.findall(".//related_work_ids/related_work_id"):
        if r.text:
            related_work_ids.append(r.text.strip())

    cited_raw = text("cited_by_count")
    try:
        cited = int(cited_raw) if cited_raw else 0
    except ValueError:
        cited = 0

    return {
        "id":                  text("id"),
        "openalex_id":         text("openalex_id"),
        "file":                text("file"),
        "title":               text("title"),
        "date":                text("date"),
        "doi_number":          text("doi_number"),
        "stub_document":       text("stub_document") or "no",
        "abstract":            text("abstract"),
        "cited_by_count":      cited,
        "authors":             authors,
        "referenced_work_ids": referenced_work_ids,
        "related_work_ids":    related_work_ids,
        "category_id":         text("category_id"),
    }


def build_stub_xml(openalex_data: dict) -> str:
    return build_xml(
        metadata_info = openalex_data,
        grobid_info   = {},
        image_path    = "",
        stub          = True,
    )


def run_stub_worker(cp_url: str, cp_user: str, cp_pass: str):
    print("[stub_worker] Started.")
    while True:
        try:
            if is_pdf_processing():
                time.sleep(5)
                continue

            openalex_id = peek_next_id()
            if not openalex_id:
                time.sleep(10)
                continue

            remove_first_id()
            if cp_document_exists(openalex_id, cp_url, cp_user, cp_pass):
                print(f"[stub_worker] Already in CP, skipping: {openalex_id}")
                _throttle()
                continue

            openalex_data = openalex_by_id(openalex_id)
            if not openalex_data:
                print(f"[stub_worker] OpenAlex returned nothing for: {openalex_id}")
                _throttle()
                continue

            xml_string    = build_stub_xml(openalex_data)
            upload_result = upload_xml(xml_string, cp_url, cp_user, cp_pass)
            
            status_code = upload_result.get("status_code")
            if status_code == 422:
                print(f"[stub_worker] ID {openalex_id} already exists. Skipping.")
            elif upload_result.get("success"):
                print(f"[stub_worker] Successfully uploaded {openalex_id}", flush=True)
            else:
                print(f"[stub_worker] Failed: {upload_result.get('error')}")


            _throttle()

        except Exception as e:
            print(f"[stub_worker] Unexpected error: {e}")
            time.sleep(5)


def _throttle():
    time.sleep(random.uniform(0.5, 1.0))


def start_stub_worker(cp_url: str, cp_user: str, cp_pass: str) -> threading.Thread:
    t = threading.Thread(
        target = run_stub_worker,
        args   = (cp_url, cp_user, cp_pass),
        daemon = True,
        name   = "stub-worker",
    )
    t.start()
    return t
