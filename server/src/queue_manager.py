import os
import threading

QUEUE_FILE = "./files/queue.txt"
_lock = threading.Lock()


def _ensure_file():
    os.makedirs(os.path.dirname(QUEUE_FILE), exist_ok=True)
    if not os.path.exists(QUEUE_FILE):
        open(QUEUE_FILE, "w").close()


def add_dois_to_queue(dois: list[str]) -> int:
    if not dois:
        return 0
    with _lock:
        _ensure_file()
        with open(QUEUE_FILE, "r") as f:
            existing = set(line.strip() for line in f if line.strip())
        new_dois = [d.strip().lower() for d in dois if d and d.strip().lower() not in existing]
        if not new_dois:
            return 0
        with open(QUEUE_FILE, "a") as f:
            for doi in new_dois:
                f.write(doi + "\n")
        return len(new_dois)


def peek_next_id() -> str | None:
    with _lock:
        _ensure_file()
        with open(QUEUE_FILE, "r") as f:
            for line in f:
                doi = line.strip()
                if doi:
                    return doi
    return None


def remove_first_id() -> str | None:
    with _lock:
        _ensure_file()
        with open(QUEUE_FILE, "r") as f:
            lines = f.readlines()
        if not lines:
            return None
        removed = None
        remaining = []
        for line in lines:
            if removed is None and line.strip():
                removed = line.strip()
            else:
                remaining.append(line)
        with open(QUEUE_FILE, "w") as f:
            f.writelines(remaining)
        return removed


def doi_in_queue(doi: str) -> bool:
    if not doi:
        return False
    target = doi.strip().lower()
    with _lock:
        _ensure_file()
        with open(QUEUE_FILE, "r") as f:
            return any(line.strip() == target for line in f)
