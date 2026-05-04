import base64
import json
import re
import requests

OLLAMA_URL = "http://localhost:11434/api/generate"
#gemma4:e4b bija ok, no 0001 lidz 0010 8/1  0
#MODEL      = "qwen2.5vl:7b"   
#MODEL =     "gemma4:e4b"
#MODEL = "minicpm-v:latest"
MODEL =     "qwen2.5vl:7b"
#MODEL = "gemma4:26b"
TIMEOUT    = 60           

PROMPT = (
    "You are given an image of a single scientific paper PDF page. "
    "Your task is to extract the EXACT title and author names. "
 
    "TITLE RULES: "
    "- Copy the title EXACTLY as printed — do not paraphrase, correct, or reword anything. "
    "- Old papers use typewriter fonts — transcribe every word carefully, even if it looks unusual. "
    "- The real title is usually the largest or most prominent text near the top of the page. "
    "- If there is a short general header or journal section name before the real title, skip it — "
    "  the real title is more specific and longer. "
    "- Skip journal names, volume numbers, issue numbers, and page numbers. "
    "- Standalone numbers near the title (e.g. '6118', '283', '864') are article or page identifiers — ignore them completely. "
    "- Include subtitle or part numbers if they are part of the title "
    "  (e.g. '3. Solubility Studies', 'Part II', 'I. Introduction'). "
 
    "AUTHOR RULES: "
    "- Include only personal names in the format 'First Last' or 'F. Last'. "
    "- Skip institutions, universities, laboratories, and introduced-by credits. "
 
    "OUTPUT RULES: "
    "- Return a single JSON object with exactly this structure: "
    '{"title": "...", "authors": ["First Last", "First Last"]}. '
    "- No markdown, no code fences, no explanation. JSON only."
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
    #print(raw)
    result = _parse_json_safe(raw)

    return {
        "title":   result.get("title") or None,
        "authors": result.get("authors") or [],
    }


def _parse_json_safe(text: str) -> dict:
    #panemam json ar drosibas siknsinu ja LLM tweako
    if not text:
        return {}

    text = text.strip()

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        print(f"[vision_extractor] No JSON object found in response: {text[:200]}")
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
