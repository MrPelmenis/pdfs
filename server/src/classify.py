import json

import requests

from src.categories import (get_all_categories, get_category_by_name,
                            find_or_create_by_field, NONE_CATEGORY)

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "gemma4:e4b"
TIMEOUT = 120

PROMPT = (
    "Classify this scientific paper into exactly one research field from the "
    "allowed list. Pick the field the paper's own research belongs to, not the "
    "field of the journal.\n"
    "Title: {title}\n"
    "Keywords: {keywords}\n"
    "Abstract: {abstract}"
)


def resolve_category(field=None, title="", abstract="", keywords="") -> dict:
    """Category for a paper, used by both the upload path and the stub worker.

    The OpenAlex primary_topic field is used when it is known (it matches the
    category names one to one). Otherwise Gemma picks one of the existing
    categories from the paper's text. Falls back to NONE_CATEGORY.
    """
    if field and field.strip():
        return find_or_create_by_field(field)
    if not (title or abstract or keywords):
        return NONE_CATEGORY
    name = classify_with_llm(title, abstract, keywords)
    return get_category_by_name(name) if name else NONE_CATEGORY


def classify_with_llm(title="", abstract="", keywords="") -> str | None:
    names = [c["name"] for c in get_all_categories() if c["id"] != 0]
    if not names:
        return None
    payload = {
        "model": MODEL,
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_ctx": 4096},
        "format": {
            "type": "object",
            "properties": {"category": {"type": "string", "enum": names}},
            "required": ["category"],
        },
        "messages": [{
            "role": "user",
            "content": PROMPT.format(
                title=(title or "")[:400],
                keywords=(keywords or "")[:600],
                abstract=(abstract or "")[:2000],
            ),
        }],
    }
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=TIMEOUT)
        resp.raise_for_status()
        name = json.loads(resp.json()["message"]["content"]).get("category")
    except Exception as e:
        print(f"[classify] LLM classification failed: {e}")
        return None
    return name if name in names else None
