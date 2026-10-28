
import base64
import json
import re
import requests

OLLAMA_URL = "http://localhost:11434/api/generate"
# gemma4:e4b bija ok, no 0001 lidz 0010 8/10
# MODEL      = "qwen2.5vl:7b"
# MODEL =     "gemma4:e4b"
# MODEL = "minicpm-v:latest"
MODEL = "qwen2.5vl:7b"
# MODEL = "gemma4:26b"
TIMEOUT = 60

PROMPT = (
    "I am giving you an image of a single scientific paper PDF"
    "I need to find the title and authors for querying crossref later"
    "Keep in mind that these documents can be old and sometimes theres some text or fake title before the actual title"
    "You can notice that this fake title might be more general or shorter than the real one"
    "If you find more than \"main title\" pick the first one, keep in mind to SKIP JOURNAL NAMES I need the given documetns title, not the journal it was relead in"
    "Skip references citations... I need the title and author names only"
    "For authors leave only their name as Name Surname or N. Surname, skip institution, university labaratory... names"
    "Include any part numbers or series numbers in the title if present "
    "(e.g. '...Part 1', '...I.', '...3. Solubility Studies'). "
    "Do NOT include page numbers, article numbers, volume numbers, or journal identifiers in the title. "
    "These appear as standalone numbers printed near the title (e.g. '6118', '283', '2659') — ignore them completely. "
    "STRICT RULES: "
    "Return a single JSON object: "
    '{"title": "...", "authors": ["First Last", "First Last"]}. '
    'Not some {"papers":{"paprer":....}} NO i need the exact structure i just gave you, the rest of the code depends on it '
    "No markdown, no code fences, no explanation. JSON only."
)


def extract_title_authors_from_image(image_path: str) -> dict:
    try:
        with open(image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()
    except FileNotFoundError:
        print(f"[vision_extractor] Image not found: {image_path}")
        return {}

    payload = {
        "model":  MODEL,
        "prompt": PROMPT,
        "images": [img_b64],
        "format": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "authors": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            },
            "required": ["title", "authors"]
        },
        "options": {
            "temperature": 0,
            "num_ctx": 4096
        },
        "stream": False,
    }

    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=TIMEOUT)
        resp.raise_for_status()
    except requests.exceptions.ConnectionError:
        print("[vision_extractor] Ollama not reachable — is it running?")
        return {}
    except requests.exceptions.Timeout:
        print("[vision_extractor] Ollama timed out.")
        return {}
    except requests.exceptions.RequestException as e:
        print(f"[vision_extractor] Request failed: {e}")
        return {}

    raw = resp.json().get("response", "")
    # print(raw)
    result = _parse_json_safe(raw)

    return {
        "title":   result.get("title") or None,
        "authors": result.get("authors") or [],
    }


def _parse_json_safe(text: str) -> dict:
    # panemam json ar drosibas siknsinu ja LLM tweako
    if not text:
        return {}

    text = text.strip()

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        print(f"[vision_extractor] No JSON object found in response: {
              text[:200]}")
        return {}

    candidate = match.group(0)

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    try:
        fixed = candidate.replace("'", '"')
        return json.loads(fixed)
    except json.JSONDecodeError:
        print(f"[vision_extractor] Could not parse JSON: {candidate[:200]}")
        return {}
