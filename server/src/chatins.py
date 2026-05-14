import json
import traceback
import requests as req

OLLAMA_URL     = "http://localhost:11434/api/chat"
OLLAMA_TIMEOUT = 120
CHAT_MODEL     = "gemma4:26b"
QUERY_MODEL    = "gemma4:e2b"

SEARCH_DOCS = 5

QUERY_PROMPT = """\
You are a search query generator for a scientific paper database.
Your query will be used to query a search engine and find relevant documents on this question.
Return ONLY the query string. No explanation, no punctuation, no quotes.

User question: {question}
Search query:"""

ANSWER_PROMPT = """\
You are a research assistant helping scientists explore a paper database.
Answer the user's question based ONLY on the provided paper excerpts.
Be concise and specific. Reference paper titles when relevant.
If the papers don't contain enough information to answer, say so clearly.
Answer in markdown.

--- PAPERS ---
{context}
--- END PAPERS ---

User question: {question}
Answer:"""

NO_CONTEXT_PROMPT = """\
You are a research assistant helping scientists explore a paper database.
No relevant papers were found in the database for this question.
Answer as best you can from your general knowledge.
Be concise and answer in markdown.

User question: {question}
Answer:"""


def search_cp(query: str, cp_url: str, cp_user: str, cp_pass: str) -> list:
    print(f"Querying CP: '{query}'")

    body = (
        f"<query><stub_document>no</stub_document>{query}*</query>"
        f"<relevance>decending</relevance>"
        f"<docs>{SEARCH_DOCS}</docs>"
        f"<list>"
        f"<file>yes</file>"
        f"<title>yes</title>"
        f"<abstract>yes</abstract>"
        f"<authors>yes</authors>"
        f"<date>yes</date>"
        f"<keywords>yes</keywords>"
        f"<keywords_extracted>yes</keywords_extracted>"
        f"<topics>yes</topics>"
        f"<methods>yes</methods>"
        f"<conclusions>yes</conclusions>"
        f"<figures>yes</figures>"
        f"<full_text>yes</full_text>"
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
    except Exception as e:
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

        if full_text:
            lines.append(f"Full text:\n{full_text}")

        parts.append("\n".join(lines))

    context = "\n\n---\n\n".join(parts)
    return context



def ollama_generate(prompt: str, stream: bool = False, model: str = CHAT_MODEL):
    payload = {
        "model":   model,
        "stream":  stream,
        "options": {
            "temperature": 0.3,
            "num_ctx":     131072,
        },
        "messages": [{"role": "user", "content": prompt}],
    }
    resp = req.post(OLLAMA_URL, json=payload, timeout=OLLAMA_TIMEOUT, stream=stream)
    return resp



def _convert_to_query(question: str) -> str:
    prompt = QUERY_PROMPT.format(question=question)
    try:
        resp = ollama_generate(prompt, stream=False, model=QUERY_MODEL)
        resp.raise_for_status()
        body  = resp.json()
        query = body.get("message", {}).get("content", "").strip()
        print(f"[chat/_convert_to_query] Body keys: {list(body.keys())}")
        print(f"[chat/_convert_to_query] Result: '{query}'")
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
        yield send_status_update("Converting query…")
        cp_query = _convert_to_query(question)
        print(f"CP query: '{cp_query}'")

        # Step 2 — search ClusterPoint
        yield send_status_update("Finding documents…")
        results = search_cp(cp_query, cp_url, cp_user, cp_pass)

        if not results:
            # No documents found — answer from general knowledge
            print("[chat/generate] No results, falling back to general knowledge")
            yield send_sources([])   # empty sources list so frontend knows
            yield send_status_update("No papers found — generating from general knowledge…")

            prompt = NO_CONTEXT_PROMPT.format(question=question)
            # Prepend the clarification as the first data token
            clarification = (
                "> ⚠️ I couldn't find any relevant papers in the database for your question. "
                "Here's what I know from general knowledge:\n\n"
            )
            for line in clarification.split("\n"):
                yield f"data: {line}\n\n"
            yield "data: \\n\n\n"

        else:
            # Documents found — emit sources then build context
            yield send_sources(results)
            yield send_status_update("Analysing papers…")
            context = _build_context(results)
            prompt  = ANSWER_PROMPT.format(context=context, question=question)

        # Step 3 — stream the answer
        yield send_status_update("Generating response…")
        resp = ollama_generate(prompt, stream=True, model=CHAT_MODEL)
        resp.raise_for_status()

        token_count = 0
        for raw_line in resp.iter_lines():
            if not raw_line:
                continue
            try:
                line  = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                data  = json.loads(line)
                token = data.get("message", {}).get("content", "")

                if token:
                    token_count += 1
                    if token_count <= 5 or token_count % 50 == 0:
                        print(f"[chat/generate] Token #{token_count}: {repr(token)}")
                    yield _sse_token(token)

                if data.get("done"):
                    print(f"Ollama done. Total tokens: {token_count}")
                    break

            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                print(f"Parse error: {repr(raw_line[:80])} — {e}")
                continue

        yield "data: [DONE]\n\n"

    except req.exceptions.ConnectionError as e:
        print(f"[chat/generate] CONNECTION ERROR: {e}")
        yield "data: Ollama is not reachable. Is it running?\n\n"
        yield "data: [DONE]\n\n"
    except req.exceptions.Timeout as e:
        print(f"[chat/generate] TIMEOUT: {e}")
        yield "data: The model timed out. Try a shorter question.\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        print(f"UNEXPECTED ERROR: {type(e).__name__}: {e}")
        traceback.print_exc()
        yield "data: Something went wrong on the server.\n\n"
        yield "data: [DONE]\n\n"


def register_chat(app, cp_url: str, cp_user: str, cp_pass: str):
    from flask import request, jsonify

    @app.route("/chat")
    def chat():
        question = request.args.get("question", "").strip()
        print(f"Question: '{question}'")

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
