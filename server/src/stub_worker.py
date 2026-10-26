import time
import random
import threading
import src.corelamo

from src.metadata_analyser import openalex_by_id
from src.json_builder import build_document, upload_document
from src.queue_manager import peek_next_id, remove_first_id


_pdf_processing = False
_flag_lock = threading.Lock()


def set_pdf_processing(value: bool):
    global _pdf_processing
    with _flag_lock:
        _pdf_processing = value


def is_pdf_processing() -> bool:
    with _flag_lock:
        return _pdf_processing


def document_exists(openalex_id: str) -> bool:
    if not openalex_id:
        return False
    resp = src.corelamo.retrieve([openalex_id])
    if resp.status_code != 200:
        return False
    return len(resp.json().get("data", {}).get("documents", [])) > 0


def fetch_document(openalex_id: str) -> dict | None:
    if not openalex_id:
        return None
    resp = src.corelamo.retrieve([openalex_id])
    if resp.status_code != 200:
        return None
    docs = resp.json().get("data", {}).get("documents", [])
    return docs[0].get("data", {}) if docs else None


def delete_document(doc_id: str) -> bool:
    resp = src.corelamo.delete([doc_id])
    return resp.status_code in (200, 207)


def build_stub_document(openalex_data: dict) -> dict:
    return build_document(
        metadata_info=openalex_data,
        grobid_info={},
        image_path="",
        stub=True,
    )


def run_stub_worker():
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
            if document_exists(openalex_id):
                print(f"[stub_worker] Already in DB, skipping: {openalex_id}")
                _throttle()
                continue

            openalex_data = openalex_by_id(openalex_id)
            if not openalex_data:
                print(f"[stub_worker] OpenAlex returned nothing for: {
                      openalex_id}")
                _throttle()
                continue

            doc = build_stub_document(openalex_data)
            upload_result = upload_document(doc)

            status_code = upload_result.get("status_code")
            if status_code == 409:
                print(f"[stub_worker] ID {
                      openalex_id} already exists. Skipping.")
            elif not upload_result.get("success"):
                print(f"[stub_worker] Failed: {upload_result.get('error')}")

            _throttle()

        except Exception as e:
            print(f"[stub_worker] Unexpected error: {e}")
            time.sleep(5)


def _throttle():
    time.sleep(random.uniform(0.5, 1.0))


def start_stub_worker() -> threading.Thread:
    t = threading.Thread(target=run_stub_worker,
                         daemon=True, name="stub-worker")
    t.start()
    return t
