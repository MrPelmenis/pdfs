import { useRef, useState, useEffect } from "react";

const UPLOAD_URL = `${process.env.REACT_APP_SERVER_URL}/upload`;

const STATUS = {
  IDLE:      "idle",
  UPLOADING: "uploading",
  SUCCESS:   "success",
  ERROR:     "error",
};

export default function UploadModal({ node, modalStage, onClose }) {
  const inputRef                = useRef(null);
  const [status, setStatus]     = useState(STATUS.IDLE);
  const [filename, setFilename] = useState("");
  const [message, setMessage]   = useState("");

  useEffect(() => {
    if (node) {
      setStatus(STATUS.IDLE);
      setFilename("");
      setMessage("");
    }
  }, [node]);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!node) return null;

  const isOpen    = modalStage === "open";
  const isClosing = modalStage === "closing";
  const isUploading = status === STATUS.UPLOADING;
  const isDone      = status === STATUS.SUCCESS || status === STATUS.ERROR;

  // Final open dimensions — small card, centered
  const openWidth  = "min(448px, 90vw)";
  const openHeight = "auto";

  // Collapsed origin — 2×2 dot at screen center
  const closedTop    = `${window.innerHeight / 2 - 1}px`;
  const closedLeft   = `${window.innerWidth  / 2 - 1}px`;
  const closedWidth  = "2px";
  const closedHeight = "2px";

  async function uploadFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setStatus(STATUS.ERROR);
      setMessage("Not a PDF file");
      return;
    }

    setFilename(file.name);
    setStatus(STATUS.UPLOADING);
    setMessage("");

    const form = new FormData();
    form.append("file", file);

    const openalexId = node.openalex_id || "";
    const doi        = node.doi         || "";
    console.log("[UploadModal] uploading for node:", { openalexId, doi, filename: file.name });

    if (openalexId)  form.append("openalex_id", openalexId);
    else if (doi)    form.append("doi", doi);

    const res = await fetch(UPLOAD_URL, { method: "POST", body: form });

    if (res.ok) {
      setStatus(STATUS.SUCCESS);
      setMessage("Processing in the background — you can close this window.");
    } else {
      const body = await res.json().catch(() => ({}));
      setStatus(STATUS.ERROR);
      setMessage(body.error || `Server error ${res.status}`);
    }
  }

  const borderColor = {
    [STATUS.IDLE]:      "#3c3f43",
    [STATUS.UPLOADING]: "#4f8ef7",
    [STATUS.SUCCESS]:   "#34a853",
    [STATUS.ERROR]:     "#ea4335",
  }[status];

  return (
    <div
      onClick={onClose}
      style={{ transition: "opacity 300ms" }}
      className={`fixed inset-0 z-50 flex items-center justify-center
        ${isOpen    ? "bg-black/70" : "bg-black/0"}
        ${isClosing ? "bg-black/0"  : ""}
      `}
    >
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          transition: "all 350ms cubic-bezier(0.4, 0, 0.2, 1)",
          position:   "fixed",
          width:      isOpen ? openWidth  : closedWidth,
          height:     isOpen ? openHeight : closedHeight,
          top:        isOpen ? "50%"      : closedTop,
          left:       isOpen ? "50%"      : closedLeft,
          transform:  isOpen ? "translate(-50%, -50%)" : "none",
          borderRadius: isOpen ? "1rem" : "2px",
          overflow:   "hidden",
          boxShadow:  isOpen ? "0 25px 60px rgba(0,0,0,0.8)" : "none",
          background: "#202124",
          display:    "flex",
          flexDirection: "column",
          gap:        "0.75rem",
          padding:    isOpen ? "1.5rem" : "0",
          fontFamily: "sans-serif",
          color:      "white",
          opacity:    isOpen ? 1 : 0,
        }}
      >
        {isOpen && (
          <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 11, color: "#5f6368", margin: "0 0 3px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Upload PDF for
                </p>
                <p style={{
                  fontSize: 13, color: "#9aa0a6", margin: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {node.title || node.openalex_id || "Unknown document"}
                </p>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#5f6368", fontSize: 18, lineHeight: 1, padding: "2px 4px", flexShrink: 0,
                }}
                onMouseEnter={e => e.currentTarget.style.color = "#9aa0a6"}
                onMouseLeave={e => e.currentTarget.style.color = "#5f6368"}
              >✕</button>
            </div>

            {/* Drop zone */}
            <div
              onDrop={e => { e.preventDefault(); if (!isUploading && !isDone) uploadFile(e.dataTransfer.files[0]); }}
              onDragOver={e => e.preventDefault()}
              onClick={() => !isUploading && !isDone && inputRef.current?.click()}
              style={{
                border:        `2px dashed ${borderColor}`,
                background:    "#303134",
                borderRadius:  "0.875rem",
                padding:       "2rem 1.5rem",
                cursor:        isUploading || isDone ? "default" : "pointer",
                display:       "flex",
                flexDirection: "column",
                alignItems:    "center",
                gap:           "0.5rem",
                transition:    "border-color 0.2s",
              }}
              onMouseEnter={e => { if (!isUploading && !isDone) e.currentTarget.style.borderColor = "#5f6368"; }}
              onMouseLeave={e => { if (!isUploading && !isDone) e.currentTarget.style.borderColor = borderColor; }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                style={{ display: "none" }}
                onChange={e => { uploadFile(e.target.files[0]); e.target.value = ""; }}
              />

              {status === STATUS.IDLE && (
                <svg style={{ width: 36, height: 50, color: "#5f6368" }}
                  fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              )}
              {status === STATUS.UPLOADING && (
                <svg style={{ width: 36, height: 36, color: "#4f8ef7", animation: "spin 1s linear infinite" }}
                  fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
              {status === STATUS.SUCCESS && (
                <svg style={{ width: 36, height: 36, color: "#34a853" }}
                  fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {status === STATUS.ERROR && (
                <svg style={{ width: 36, height: 36, color: "#ea4335" }}
                  fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}

              <p style={{ fontSize: 13, color: "#9aa0a6", margin: 0, textAlign: "center" }}>
                {status === STATUS.IDLE      && "Drag & drop PDF, or click to browse"}
                {status === STATUS.UPLOADING && `Uploading ${filename}…`}
                {status === STATUS.SUCCESS   && message}
                {status === STATUS.ERROR     && (message || "Upload failed")}
              </p>

              {status === STATUS.ERROR && (
                <button
                  onClick={e => { e.stopPropagation(); setStatus(STATUS.IDLE); setMessage(""); setFilename(""); }}
                  style={{
                    marginTop: 4, fontSize: 12, color: "#9aa0a6",
                    background: "none", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6, padding: "4px 12px", cursor: "pointer",
                  }}
                >
                  Try again
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
