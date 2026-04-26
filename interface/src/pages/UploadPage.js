import { useRef, useState } from "react";
import { useUploadStore, STATUS } from "../store/uploadStore";
import FileRow from "../components/FileRow";

const UPLOAD_URL = `${process.env.REACT_APP_SERVER_URL}/upload`;
const SECONDS_PER_FILE = 25;

function formatTime(seconds) {
  if (seconds < 60) return `~${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
}

export default function UploadPage() {
  const { fileQueue, setFileQueue, updateFile, clearQueue } = useUploadStore();
  const inputRef = useRef(null);
  const [expanded, setExpanded] = useState(false);

  const isUploading = fileQueue.some(f => f.status === STATUS.UPLOADING || f.status === STATUS.WAITING);
  const allDone     = fileQueue.length > 0 && !isUploading;
  const anyError    = fileQueue.some(f => f.status === STATUS.ERROR);
  const doneCount   = fileQueue.filter(f => f.status === STATUS.SUCCESS || f.status === STATUS.ERROR).length;
  const totalCount  = fileQueue.length;
  const progress    = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;
  const estimatedSeconds = Math.ceil(totalCount * SECONDS_PER_FILE);

  const barColor = allDone
    ? (anyError ? "#f6ae2d" : "#34a853")
    : "#4f8ef7";

  async function uploadFiles(fileList) {
    const all     = Array.from(fileList);
    const pdfs    = all.filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    const skipped = all.filter(f => !pdfs.includes(f));

    if (!pdfs.length && !skipped.length) return;

    setFileQueue([
      ...skipped.map(f => ({ name: f.name, status: STATUS.ERROR,   message: "Not a PDF, skipped" })),
      ...pdfs.map(f =>    ({ name: f.name, status: STATUS.WAITING, message: "" })),
    ]);

    await Promise.all(
      pdfs.map(async (file) => {
        updateFile(file.name, { status: STATUS.UPLOADING, message: "" });
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch(UPLOAD_URL, { method: "POST", body: form });
          if (res.ok) {
            updateFile(file.name, { status: STATUS.SUCCESS, message: "Uploaded successfully" });
          } else {
            const body = await res.json().catch(() => ({}));
            updateFile(file.name, { status: STATUS.ERROR, message: body.error || `Server error ${res.status}` });
          }
        } catch {
          updateFile(file.name, { status: STATUS.ERROR, message: "Network error" });
        }
      })
    );
  }

  return (
    <main style={{
      minHeight: "100vh", background: "#202124", color: "white",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "2rem", fontFamily: "sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: "30rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>

        {/* Drop zone */}
        <div
          onDrop={(e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => !isUploading && inputRef.current?.click()}
          style={{
            border: `2px dashed ${
              allDone && !anyError ? "#34a853" :
              allDone && anyError  ? "#f6ae2d" : "#3c3f43"
            }`,
            background: "#303134",
            borderRadius: "0.875rem", padding: "2.5rem 2rem",
            cursor: isUploading ? "default" : "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: "0.625rem",
            transition: "border-color 0.2s",
          }}
        >
          <input
            ref={inputRef} type="file" accept=".pdf,application/pdf" multiple
            style={{ display: "none" }}
            onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }}
          />
          <svg style={{ width: 50, height: 70, color: "#5f6368" }}
            fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p style={{ fontSize: 15, color: "#9aa0a6", margin: 0 }}>
            {isUploading ? "Uploading, please wait…" : "Drag & drop PDFs, or click to browse"}
          </p>
        </div>

        {/* Progress section */}
        {fileQueue.length > 0 && (
          <div style={{
            background: "#303134", borderRadius: "0.75rem",
            padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.5rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "#9aa0a6" }}>
                {allDone
                  ? `${doneCount}/${totalCount} files done${anyError ? " (some errors)" : ""}`
                  : `${doneCount}/${totalCount} uploaded · processing ${formatTime(estimatedSeconds)} total`}
              </span>
              <button
                onClick={() => setExpanded(e => !e)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#5f6368", fontSize: 12, display: "flex", alignItems: "center", gap: "0.25rem",
                  padding: 0,
                }}
              >
                {expanded ? "hide" : "details"}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d={expanded ? "M2 8l4-4 4 4" : "M2 4l4 4 4-4"} />
                </svg>
              </button>
            </div>

            <div style={{ height: 4, background: "#3c3f43", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${progress}%`,
                background: barColor,
                borderRadius: 2,
                transition: "width 0.3s ease, background 0.3s ease",
              }} />
            </div>

            {totalCount > 0 && (
              <p style={{ fontSize: 14, color: "#5f6368", margin: 0 }}>
                Files are processed in the background — {formatTime(estimatedSeconds)} for all {totalCount} file{totalCount !== 1 ? "s" : ""}. You can leave this page.
              </p>
            )}

            {expanded && (
              <div style={{
                display: "flex", flexDirection: "column", gap: "0.25rem",
                marginTop: "0.25rem", maxHeight: "14rem", overflowY: "auto",
              }}>
                {fileQueue.map(f => (
                  <FileRow key={f.name} name={f.name} status={f.status} message={f.message} />
                ))}
              </div>
            )}

            {allDone && (
              <button
                onClick={() => { clearQueue(); setExpanded(false); }}
                style={{
                  alignSelf: "center",
                  fontSize: 12, color: "#5f6368",
                  background: "none", border: "none", cursor: "pointer",
                  textDecoration: "underline", textUnderlineOffset: 3,
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
