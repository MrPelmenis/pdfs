import json
import math
import os
import random
import threading
import requests
from xml.sax.saxutils import escape


CATEGORIES_FILE = os.path.join(os.path.dirname(__file__), "../files/categories.json")
_lock = threading.Lock()

NONE_CATEGORY = {"id": 0, "name": "none", "color": "rgba(170,170,170,0.92)"}


# ── Internal helpers ──────────────────────────────────────────────────────────

def _read() -> list:
    with open(CATEGORIES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _write(data: list) -> None:
    with open(CATEGORIES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _next_id(categories: list) -> int:
    return max((c["id"] for c in categories), default=-1) + 1


def _hsl_to_rgb(h, s, l):
    s /= 100
    l /= 100
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = l - c / 2
    if   0   <= h < 60:  r, g, b = c, x, 0
    elif 60  <= h < 120: r, g, b = x, c, 0
    elif 120 <= h < 180: r, g, b = 0, c, x
    elif 180 <= h < 240: r, g, b = 0, x, c
    elif 240 <= h < 300: r, g, b = x, 0, c
    else:                r, g, b = c, 0, x
    return (round((r + m) * 255), round((g + m) * 255), round((b + m) * 255))


def _is_ugly_hue(hue: float) -> bool:
    hue = hue % 360
    return (50 <= hue <= 80) or (165 <= hue <= 195)


def _random_rgba_color() -> str:
    """
    Generates a perceptually balanced color using golden ratio hue stepping.
    Returns an rgba() string matching the format used in categories.json.
    """
    GOLDEN_ANGLE = 137.508
    SATURATION   = 68

    hue = random.uniform(0, 360)
    for _ in range(20):          # max attempts to find a non-ugly hue
        hue = (hue + GOLDEN_ANGLE) % 360
        if not _is_ugly_hue(hue):
            break

    lightness = 60 + 8 * math.sin(math.radians(hue))
    r, g, b   = _hsl_to_rgb(hue, SATURATION, lightness)
    return f"rgba({r},{g},{b},0.92)"


# ── Public API ────────────────────────────────────────────────────────────────

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
        return NONE_CATEGORY
    return random.choice(choices)


def get_category_by_id(cat_id: int) -> dict | None:
    with _lock:
        categories = _read()
    return next((c for c in categories if c["id"] == cat_id), None)


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


def find_or_create_by_field(field_name: str) -> dict:
    """
    Given an OpenAlex field display name (e.g. "Mathematics", "Medicine"),
    find the matching category by name (case-insensitive) or create a new one
    with a randomly generated perceptually balanced color.

    Returns the full category dict: {id, name, color}.
    Falls back to NONE_CATEGORY if field_name is empty.
    """
    if not field_name or not field_name.strip():
        return NONE_CATEGORY

    normalised = field_name.strip().lower()

    with _lock:
        categories = _read()

        # Case-insensitive match against existing category names
        existing = next(
            (c for c in categories if c["name"] == normalised),
            None
        )
        if existing:
            return existing

        # Not found — create new category
        new_cat = {
            "id":    _next_id(categories),
            "name":  normalised,
            "color": _random_rgba_color(),
        }
        categories.append(new_cat)
        _write(categories)
        print(f"[categories] Created new category: '{normalised}' → {new_cat['color']}")
        return new_cat


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
