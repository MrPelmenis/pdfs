import hashlib
import os
import threading

HASHES_FILE = "./files/uploaded_hashes.txt"
_hashes_lock = threading.Lock()

def _file_hash(stream) -> str:
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(8192), b""):
        h.update(chunk)
    stream.seek(0)
    return h.hexdigest()

def _is_duplicate_file(file_hash: str) -> bool:
    with _hashes_lock:
        if not os.path.exists(HASHES_FILE):
            return False
        with open(HASHES_FILE, "r") as f:
            return any(line.strip() == file_hash for line in f)

def _register_hash(file_hash: str):
    with _hashes_lock:
        with open(HASHES_FILE, "a") as f:
            f.write(file_hash + "\n")
