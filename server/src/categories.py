import json
import os
import random
import threading
import requests
from xml.sax.saxutils import escape


#LLM rakstija so, man bija galax, vienkarsi uztur kategorijaam konstantu sarakstu 
CATEGORIES_FILE = os.path.join(os.path.dirname(__file__), "../files/categories.json")
_lock = threading.Lock()


def _read() -> list:
    with open(CATEGORIES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _write(data: list) -> None:
    with open(CATEGORIES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _next_id(categories: list) -> int:
    return max((c["id"] for c in categories), default=-1) + 1


def get_all_categories() -> list:
    with _lock:
        return _read()


def create_category(name: str, color: str) -> dict:
    with _lock:
        categories = _read()
        new_cat = {
            "id":    _next_id(categories),
            "name":  name.strip().lower(),
            "color": color,
        }
        categories.append(new_cat)
        _write(categories)
        return new_cat


def edit_category(cat_id: int, name: str | None, color: str | None) -> dict | None:
    with _lock:
        categories = _read()
        for cat in categories:
            if cat["id"] == cat_id:
                if name is not None:
                    cat["name"] = name.strip().lower()
                if color is not None:
                    cat["color"] = color
                _write(categories)
                return cat
        return None


def delete_category(cat_id: int) -> bool:
    with _lock:
        categories = _read()
        new_list = [c for c in categories if c["id"] != cat_id]
        if len(new_list) == len(categories):
            return False
        _write(new_list)
        return True


def get_random_category() -> dict:
    with _lock:
        categories = _read()
    choices = [c for c in categories if c["id"] != 0]  
    if not choices:
        return {"id": 0, "name": "none", "color": "rgba(170,170,170,0.92)"}
    return random.choice(choices)


def get_category_by_id(cat_id: int) -> dict | None:
    with _lock:
        categories = _read()
    return next((c for c in categories if c["id"] == cat_id), None)


NONE_CATEGORY = {"id": 0, "name": "none", "color": "rgba(170,170,170,0.92)"}

def get_category_by_name(name) -> dict:
    if not name:
        return NONE_CATEGORY
    if isinstance(name, dict):
        name = name.get("name") or ""
    if not name:
        return NONE_CATEGORY
    with _lock:
        categories = _read()
    found = next((c for c in categories if c["name"] == name.strip().lower()), None)
    return found if found else NONE_CATEGORY



def assign_category_to_document(
    doc_id: str,
    cat_id: int,
    cp_url: str,
    cp_user: str,
    cp_pass: str,
) -> dict:
    cat = get_category_by_id(cat_id)
    if cat is None:
        return {"success": False, "error": f"Category id={cat_id} not found"}

    xml_body = f"""<document>
  <id>{escape(doc_id)}</id>
  <category_id>{cat['id']}</category_id>
</document>"""

    url = f"{cp_url.rstrip('/')}/api/databases/pdfs/partial-replace"
    try:
        resp = requests.post(
            url,
            data=xml_body,
            auth=(cp_user, cp_pass),
            headers={"Content-Type": "application/xml"},
            timeout=15,
        )
        resp.raise_for_status()
        return {"success": True, "category": cat}
    except requests.exceptions.HTTPError as e:
        return {"success": False, "error": str(e), "response": resp.text}
    except requests.exceptions.RequestException as e:
        return {"success": False, "error": str(e)}
