import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

const API = process.env.REACT_APP_SERVER_URL;

function StatusStep({ label, done }) {
  return (
    <div
      className={`flex items-center gap-2 text-xs transition-all duration-300 ${
        done ? "text-ink-muted line-through opacity-40" : "text-accent font-medium"
      }`}
    >
      <span>{label}</span>
      {!done && (
        <span className="flex gap-0.5 ml-1">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-1 h-1 rounded-full bg-accent"
              style={{
                animation: "pulse 1.2s ease-in-out infinite",
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </span>
      )}
    </div>
  );
}

function SourceCard({ file, title }) {
  const displayName = title || file.split("/").pop() || file;

  return (
    <div
      title={file}
      className="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg
                 bg-surface border border-border flex-shrink-0
                 w-28 select-none"
    >
      {/* Document icon */}
      <svg
        className="w-5 h-5 text-accent/60 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
             a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19
             a2 2 0 01-2 2z"
        />
      </svg>
      {/* Title below icon */}
      <span
        className="text-xs text-ink-muted text-center leading-tight w-full"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {displayName}
      </span>
    </div>
  );
}

function SourceGrid({ sources }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="flex flex-row gap-2 overflow-x-auto pb-1"
         style={{ scrollbarWidth: "thin" }}>
      {sources.map((src, i) => (
        <SourceCard key={i} file={src.file} title={src.title} />
      ))}
    </div>
  );
}

const MD_PLUGINS = {
  remarkPlugins: [remarkMath],
  rehypePlugins: [rehypeKatex],
};

export default function ChatPage() {
  const [inputVal,  setInputVal]  = useState("");
  const [messages,  setMessages]  = useState([]);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const abortRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function patchLast(updater) {
    setMessages(prev => {
      const updated = [...prev];
      updated[updated.length - 1] = updater(updated[updated.length - 1]);
      return updated;
    });
  }

  async function sendQuestion(question) {
    if (!question.trim() || streaming) return;

    setMessages(prev => [
      ...prev,
      { role: "user", text: question },
      { role: "assistant", text: "", sources: null, statusSteps: [], currentStatus: null },
    ]);
    setInputVal("");
    setStreaming(true);

    try {
      abortRef.current = new AbortController();
      const res = await fetch(
        `${API}/chat?question=${encodeURIComponent(question)}`,
        { signal: abortRef.current.signal }
      );

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // ── status event ────────────────────────────────────────────────
          if (trimmed.startsWith("status: ")) {
            const statusMsg = trimmed.slice(8);
            patchLast(msg => ({
              ...msg,
              statusSteps: [
                ...(msg.statusSteps || []).map(s =>
                  s.label === msg.currentStatus ? { ...s, done: true } : s
                ),
                ...(msg.statusSteps || []).some(s => s.label === statusMsg)
                  ? []
                  : [{ label: statusMsg, done: false }],
              ],
              currentStatus: statusMsg,
            }));
            continue;
          }

          // ── sources event ───────────────────────────────────────────────
          if (trimmed.startsWith("sources: ")) {
            try {
              const sources = JSON.parse(trimmed.slice(9));
              patchLast(msg => ({ ...msg, sources }));
            } catch (_) {}
            continue;
          }

          // ── data event ──────────────────────────────────────────────────
          if (trimmed.startsWith("data: ")) {
            const token = trimmed.slice(6);
            if (token === "[DONE]") {
              patchLast(msg => ({
                ...msg,
                statusSteps:   (msg.statusSteps || []).map(s => ({ ...s, done: true })),
                currentStatus: null,
              }));
              break;
            }
            const actual = token === "\\n" ? "\n" : token;
            patchLast(msg => ({ ...msg, text: msg.text + actual }));
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        patchLast(msg => ({
          ...msg,
          text:  "Something went wrong. Please try again.",
          error: true,
          statusSteps:   (msg.statusSteps || []).map(s => ({ ...s, done: true })),
          currentStatus: null,
        }));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendQuestion(inputVal.trim());
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(inputVal.trim());
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <main className="h-screen overflow-hidden bg-main flex flex-col">

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-5">

          {isEmpty && (
            <div className="flex flex-col items-center justify-center h-full pt-24 gap-3 text-ink-muted select-none">
              <svg className="w-10 h-10 opacity-25" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <p className="text-sm text-center">Ask a question about your research papers.</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>

              {/* Assistant avatar */}
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2.5">
                  <svg className="w-3 h-3 text-accent" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 18a8 8 0 110-16 8 8 0 010 16zm-1-11h2v6h-2zm0-4h2v2h-2z" />
                  </svg>
                </div>
              )}

              <div style={{ maxWidth: "85%" }} className="flex flex-col gap-2 min-w-0">

                {/* ── Status steps ── */}
                {msg.role === "assistant" && (msg.statusSteps || []).length > 0 && (
                  <div className="flex flex-col gap-1 px-1 pb-1">
                    {msg.statusSteps.map((step, si) => (
                      <StatusStep key={si} label={step.label} done={step.done} />
                    ))}
                  </div>
                )}

                {/* ── Source cards — horizontal scrollable row ── */}
                {msg.role === "assistant" && msg.sources && (
                  <SourceGrid sources={msg.sources} />
                )}

                {/* ── Bubble ── */}
                {(msg.text || msg.role === "user") && (
                  <div
                    className={`
                      rounded-2xl px-4 py-2.5 text-sm leading-relaxed
                      ${msg.role === "user"
                        ? "bg-accent text-main rounded-br-sm font-medium"
                        : msg.error
                          ? "bg-surface border border-red-500/30 text-red-400 rounded-bl-sm"
                          : "bg-surface border border-border text-ink rounded-bl-sm"
                      }
                    `}
                  >
                    {msg.role === "assistant"
                      ? msg.text
                        ? (
                          <ReactMarkdown
                            remarkPlugins={MD_PLUGINS.remarkPlugins}
                            rehypePlugins={MD_PLUGINS.rehypePlugins}
                          >
                            {msg.text}
                          </ReactMarkdown>
                        )
                        : (
                          !msg.currentStatus && (
                            <span className="flex gap-1 items-center h-4">
                              {[0, 1, 2].map(j => (
                                <span
                                  key={j}
                                  className="w-1.5 h-1.5 rounded-full bg-ink-muted"
                                  style={{
                                    animation: "pulse 1.2s ease-in-out infinite",
                                    animationDelay: `${j * 0.2}s`,
                                  }}
                                />
                              ))}
                            </span>
                          )
                        )
                      : msg.text
                    }
                  </div>
                )}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar ── */}
      <div className="flex-shrink-0 border-t border-border bg-main px-5 py-3">
        <form
          onSubmit={handleSubmit}
          className="max-w-2xl mx-auto flex items-end gap-2"
        >
          <div className="flex-1 flex items-end gap-2 bg-surface border border-border rounded-xl px-4 py-2.5
                          focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30
                          transition-all duration-200">
            <textarea
              ref={inputRef}
              rows={1}
              value={inputVal}
              onChange={e => {
                setInputVal(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your papers…"
              disabled={streaming}
              style={{ resize: "none", minHeight: "1.25rem", maxHeight: "7.5rem" }}
              className="flex-1 bg-transparent text-ink placeholder-ink-muted text-sm outline-none leading-relaxed"
            />
          </div>

          <button
            type="submit"
            disabled={!inputVal.trim() || streaming}
            className="px-4 py-2.5 rounded-xl bg-accent text-main text-sm font-semibold
                       hover:bg-accent/90 active:scale-95 transition-all duration-150
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {streaming ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
