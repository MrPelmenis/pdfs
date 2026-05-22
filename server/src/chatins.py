import json
import os
import traceback
import requests as req

OLLAMA_URL     = "http://localhost:11434/api/chat"
DEEPSEEK_URL   = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_KEY   = os.getenv("DEEPSEEK_KEY", "")
OLLAMA_TIMEOUT = 120
DEEPSEEK_TIMEOUT = 60

# "ollama" or "deepseek"
PROVIDER = os.getenv("PROVIDER", "ollama")

CHAT_MODEL  = "gemma4:e4b"        # used when PROVIDER=ollama
QUERY_MODEL = "gemma4:e4b"        # used when PROVIDER=ollama

DEEPSEEK_CHAT_MODEL  = "deepseek-chat"   # used when PROVIDER=deepseek
DEEPSEEK_QUERY_MODEL = "deepseek-chat"   # used when PROVIDER=deepseek

CTX_MIN        = 2048
CTX_MAX        = 65536
CTX_HEADROOM   = 1.4
ANSWER_RESERVE = 1024

SEARCH_DOCS = 10

QUERY_PROMPT = """\
You are a search keyword extractor for a scientific document database.
Your job is to extract the most concrete, specific content words from the user's question.
These keywords will be matched literally against document text, so only include words that would physically appear in a scientific paper.

Rules:
- Output ONLY the keywords, space-separated, nothing else
- 2 to 4 words maximum
- Use only nouns and adjectives — no verbs, no question words
- No synonyms, no expansions, no related concepts
- No scientific jargon that wasn't in the original question
- Prefer shorter, more common words over long technical ones
- If the question is vague, pick the single most concrete noun

Examples:
  "what interesting things can you find about human bones?" → human bones
  "how does the heart pump blood?" → heart blood
  "neural network training convergence issues" → neural network convergence
  "what methods are used in protein folding?" → protein folding
  "tell me about climate change effects on fish" → fish climate

User question: {question}
Keywords:"""

ANSWER_PROMPT = """\
You are a research assistant helping scientists explore a paper database.
Answer the user's question using ONLY the provided paper excerpts below.

Formatting rules — follow exactly:
- Write one section per relevant paper
- Each section MUST start with: ## (use the exact title)
- Under each heading write 3-6 sentences covering what that paper says about the question
- Always extract and highlight specific numeric results: values, units, percentages, concentrations, rates, constants — format them as `inline code` (e.g. `37 °C`, `Km = 2.4 mM`, `yield: 91%`)
- When a paper includes table data, present key values from it as a markdown table if it adds clarity
- Use bullet points under a section when listing multiple measurements or findings
- Use $...$ for inline math and $$...$$ for display equations when the paper contains them
- If a paper has no relevant information, skip it entirely
- End with a short **Summary** section (2-3 sentences) synthesising the key numeric findings across papers
- Do not invent numbers — only report what is explicitly stated in the excerpts

--- PAPERS ---
{context}
--- END PAPERS ---

User question: {question}
Answer:"""


NO_CONTEXT_PROMPT = """\
You are a research assistant helping scientists explore a paper database.
No relevant papers were found in the database for this question.
Answer as best you can from your general knowledge.

Formatting rules:
- Use markdown headings and bullet points for structure
- Use $...$ for inline math and $$...$$ for block equations
- Begin your response with: > No relevant papers were found. Answering from general knowledge.
- Then a blank line, then your answer

User question: {question}
Answer:"""


# ---------------------------------------------------------------------------
# Provider functions
# ---------------------------------------------------------------------------

def ollama_generate(prompt: str, stream: bool = False, model: str = CHAT_MODEL):
    num_ctx = _estimate_num_ctx(prompt)
    payload = {
        "model":   model,
        "stream":  stream,
        "options": {
            "temperature": 0.3,
            "num_ctx":     num_ctx,
            "thinking":    False,
        },
        "messages": [{"role": "user", "content": prompt}],
    }
    resp = req.post(OLLAMA_URL, json=payload, timeout=OLLAMA_TIMEOUT, stream=stream)
    return resp


def deepseek_generate(prompt: str, stream: bool = False, model: str = DEEPSEEK_CHAT_MODEL):
    payload = {
        "model":       model,
        "stream":      stream,
        "temperature": 0.3,
        "messages":    [{"role": "user", "content": prompt}],
    }
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_KEY}",
        "Content-Type":  "application/json",
    }
    resp = req.post(DEEPSEEK_URL, json=payload, headers=headers, timeout=DEEPSEEK_TIMEOUT, stream=stream)
    return resp


def _generate(prompt: str, stream: bool = False, use_query_model: bool = False):
    """Route to the right provider based on PROVIDER setting."""
    if PROVIDER == "deepseek":
        model = DEEPSEEK_QUERY_MODEL if use_query_model else DEEPSEEK_CHAT_MODEL
        return deepseek_generate(prompt, stream=stream, model=model)
    else:
        model = QUERY_MODEL if use_query_model else CHAT_MODEL
        return ollama_generate(prompt, stream=stream, model=model)


# ---------------------------------------------------------------------------
# Token parsing — each provider has a different response shape
# ---------------------------------------------------------------------------

def _extract_token_ollama(data: dict) -> tuple[str, bool]:
    token = data.get("message", {}).get("content", "")
    done  = data.get("done", False)
    return token, done


def _extract_token_deepseek(data: dict) -> tuple[str, bool]:
    choices = data.get("choices", [])
    if not choices:
        return "", False
    choice = choices[0]
    token  = (choice.get("delta") or choice.get("message") or {}).get("content") or ""
    done   = choice.get("finish_reason") is not None
    return token, done


def _extract_token(data: dict) -> tuple[str, bool]:
    if PROVIDER == "deepseek":
        return _extract_token_deepseek(data)
    return _extract_token_ollama(data)


def _extract_query_response(data: dict) -> str:
    """Extract the full text from a non-streaming response."""
    if PROVIDER == "deepseek":
        choices = data.get("choices", [])
        return (choices[0].get("message", {}).get("content") or "").strip() if choices else ""
    return data.get("message", {}).get("content", "").strip()


# ---------------------------------------------------------------------------
# Search + context helpers (unchanged)
# ---------------------------------------------------------------------------

def search_cp(query: str, cp_url: str, cp_user: str, cp_pass: str) -> list:
    body = (
        f"<query><stub_document>no</stub_document>{query}*</query>"
        f"<relevance>decending</relevance>"
        f"<docs>{SEARCH_DOCS}</docs>"
        f"<list>"
        f"<title>yes</title>"
        f"<abstract>yes</abstract>"
        f"<authors>yes</authors>"
        f"<date>yes</date>"
        f"<full_text>yes</full_text>"
        f"<figures>yes</figures>"
        f"<conclusions>yes</conclusions>"
        f"<methods>yes</methods>"
        f"<topics>yes</topics>"
        f"<keywords>yes</keywords>"
        f"<concepts>yes</concepts>"
        f"</list>"
    )

    try:
        resp = req.post(
            cp_url.rstrip("/") + "/api/databases/pdfs/search/json",
            data=body,
            auth=(cp_user, cp_pass),
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

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

        def _list(parent_key, child_key):
            raw = doc.get(parent_key)
            if raw is None:
                return []
            val = raw.get(child_key, [])
            return [val] if isinstance(val, str) else val

        def _method_list():
            raw = doc.get("methods")
            if not raw:
                return []
            items = raw.get("method", [])
            if isinstance(items, dict):
                items = [items]
            return [
                {"heading": m.get("heading", ""), "text": m.get("text", "")}
                for m in items
            ]

        def _conclusion_list():
            raw = doc.get("conclusions")
            if not raw:
                return []
            items = raw.get("conclusion", [])
            if isinstance(items, dict):
                items = [items]
            return [
                {"heading": c.get("heading", ""), "text": c.get("text", "")}
                for c in items
            ]

        def _figure_list():
            raw = doc.get("figures")
            if not raw:
                return []
            items = raw.get("figure", [])
            if isinstance(items, dict):
                items = [items]
            return [
                {"label": f.get("figure_label", ""), "caption": f.get("caption", "")}
                for f in items
                if f.get("caption")
            ]

        def _table_list():
            raw = doc.get("tables")
            if not raw:
                return []
            items = raw.get("table", [])
            if isinstance(items, dict):
                items = [items]
            return [
                t.get("content", "").strip()
                for t in items
                if t.get("content", "").strip()
            ]

        results.append({
            "file":               (doc.get("file")      or "").strip(),
            "title":              (doc.get("title")     or "").strip(),
            "abstract":           (doc.get("abstract")  or "").strip(),
            "full_text":          (doc.get("full_text") or "").strip(),
            "authors":            _list("authors", "author"),
            "date":               (doc.get("date")      or "").strip(),
            "keywords":           _list("keywords", "keyword"),
            "keywords_extracted": _list("keywords_extracted", "keyword"),
            "topics":             _list("topics", "topic"),
            "methods":            _method_list(),
            "conclusions":        _conclusion_list(),
            "figures":            _figure_list(),
            "tables":             _table_list(),
        })

    return results


def _build_context(results: list) -> str:
    parts = []
    for i, doc in enumerate(results, 1):
        title     = doc.get("title")    or "Unknown"
        abstract  = doc.get("abstract") or ""
        full_text = doc.get("full_text") or ""
        authors   = ", ".join(doc.get("authors") or [])
        date      = doc.get("date")     or ""

        kw_all = list(dict.fromkeys(
            (doc.get("keywords") or []) + (doc.get("keywords_extracted") or [])
        ))
        kw_str = ", ".join(kw_all[:10]) if kw_all else ""
        topics = ", ".join((doc.get("topics") or [])[:5])

        lines = [f"[{i}] {title}"]
        if authors:   lines.append(f"Authors: {authors}" + (f" ({date})" if date else ""))
        if topics:    lines.append(f"Topics: {topics}")
        if kw_str:    lines.append(f"Keywords: {kw_str}")
        if abstract:  lines.append(f"Abstract: {abstract}")

        for m in (doc.get("methods") or []):
            heading = m.get("heading", "")
            text    = m.get("text") or ""
            if text:
                lines.append(f"Method ({heading}): {text}")

        for c in (doc.get("conclusions") or []):
            text = c.get("text") or ""
            if text:
                lines.append(f"Conclusion: {text}")

        for f in (doc.get("figures") or []):
            caption = f.get("caption", "")
            label   = f.get("label", "")
            if caption:
                lines.append(f"Figure {label}: {caption}")

        for idx, table_content in enumerate(doc.get("tables") or [], 1):
            print(table_content)
            lines.append(f"Table {idx}:\n{table_content}")

        if full_text:
            lines.append(f"Full text:\n{full_text}")

        parts.append("\n".join(lines))
        

    return "\n\n---\n\n".join(parts)


def _estimate_num_ctx(prompt: str) -> int:
    estimated_tokens = len(prompt) // 4
    needed = int(estimated_tokens * CTX_HEADROOM) + ANSWER_RESERVE
    ctx = CTX_MIN
    while ctx < needed:
        ctx *= 2
    ctx = min(ctx, CTX_MAX)
    return ctx


# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------

def _convert_to_query(question: str) -> str:
    prompt = QUERY_PROMPT.format(question=question)
    try:
        resp = _generate(prompt, stream=False, use_query_model=True)
        resp.raise_for_status()
        body  = resp.json()
        query = _extract_query_response(body)
        first_line = query.splitlines()[0] if query else ""
        words      = first_line.replace(",", " ").replace(";", " ").split()
        query      = " ".join(words[:4])
        print(f"[chat/_convert_to_query] provider={PROVIDER} result='{query}'")
        return query or question
    except Exception as e:
        print(f"[chat/_convert_to_query] FAILED: {e} — falling back to raw question")
        return question


def send_status_update(msg: str):
    return f"status: {msg}\n\n"

def send_sources(results: list):
    sources = [
        {"file": doc.get("file", ""), "title": doc.get("title", "") or doc.get("file", "")}
        for doc in results
        if doc.get("file") or doc.get("title")
    ]
    return f"sources: {json.dumps(sources)}\n\n"

def _sse_token(token: str):
    parts = token.split("\n")
    out = ""
    for j, part in enumerate(parts):
        out += f"data: {part}\n\n"
        if j < len(parts) - 1:
            out += "data: \\n\n\n"
    return out


def generate(question: str, cp_url: str, cp_user: str, cp_pass: str):
    try:
        yield send_status_update(f"Converting query… [{PROVIDER}]")
        cp_query = _convert_to_query(question)

        yield send_status_update("Finding documents…")
        results = search_cp(cp_query, cp_url, cp_user, cp_pass)

        if not results:
            print("[chat/generate] No results, falling back to general knowledge")
            yield send_sources([])
            yield send_status_update("No papers found — generating from general knowledge…")
            prompt = NO_CONTEXT_PROMPT.format(question=question)
        else:
            yield send_sources(results)
            yield send_status_update("Analysing papers…")
            context = _build_context(results)
            prompt  = ANSWER_PROMPT.format(context=context, question=question)

        yield send_status_update("Generating response…")
        resp = _generate(prompt, stream=True, use_query_model=False)
        resp.raise_for_status()

        for raw_line in resp.iter_lines():
            if not raw_line:
                continue
            try:
                line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                # DeepSeek SSE lines are prefixed with "data: "
                if line.startswith("data: "):
                    line = line[6:]
                if line == "[DONE]":
                    break
                data  = json.loads(line)
                token, done = _extract_token(data)

                if token:
                    yield _sse_token(token)

                if done:
                    break

            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                print(f"Parse error: {repr(raw_line[:80])} — {e}")
                continue

        yield "data: [DONE]\n\n"

    except req.exceptions.ConnectionError:
        yield f"data: Could not connect to {PROVIDER}. Is it running?\n\n"
        yield "data: [DONE]\n\n"
    except req.exceptions.Timeout:
        yield "data: The model timed out. Try a shorter question.\n\n"
        yield "data: [DONE]\n\n"
    except Exception:
        traceback.print_exc()
        yield "data: Something went wrong on the server.\n\n"
        yield "data: [DONE]\n\n"


def register_chat(app, cp_url: str, cp_user: str, cp_pass: str):
    from flask import request, jsonify

    @app.route("/chat")
    def chat():
        question = request.args.get("question", "").strip()
        print(f"Question: '{question}' | provider: {PROVIDER}")

        if not question:
            return jsonify({"error": "question is required"}), 400

        return app.response_class(
            generate(question, cp_url, cp_user, cp_pass),
            mimetype="text/event-stream",
            headers={
                "Cache-Control":     "no-cache",
                "X-Accel-Buffering": "no",
            },
        )
