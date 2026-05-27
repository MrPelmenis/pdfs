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

  const getProgressBarColor = () => {
    if (allDone) {
      return anyError ? "bg-danger" : "bg-success";
    }
    return "bg-chartizer-yellow";
  };

  const getBorderColorClass = () => {
    if (allDone) {
      return anyError ? "border-danger/40" : "border-success/40";
    }
    return "border-border hover:border-chartizer-yellow/40";
  };

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
    <main className="min-h-screen bg-main text-ink flex flex-col items-center justify-center p-8">
      {/* Restored exact original 30rem sizing footprint to avoid layout jumps */}
      <div className="w-full max-w-[30rem] flex flex-col gap-3">

        {/* Drop zone */}
        <div
          onDrop={(e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => !isUploading && inputRef.current?.click()}
          className={`border-2 border-dashed ${getBorderColorClass()} bg-surface rounded-xl 
                     py-10 px-8 flex flex-col items-center justify-center text-center gap-2.5 transition-colors duration-200 w-full`}
          style={{ cursor: isUploading ? "default" : "pointer" }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }}
          />
          <svg className="w-12 h-16 text-ink-muted opacity-30" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="text-sm text-ink-dim select-none m-0">
            {isUploading ? "Uploading, please wait…" : "Drag & drop PDFs, or click to browse"}
          </p>
        </div>

        {/* Progress section */}
        {fileQueue.length > 0 && (
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-2 w-full">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-dim font-medium">
                {allDone
                  ? `${doneCount}/${totalCount} files done${anyError ? " (some errors)" : ""}`
                  : `${doneCount}/${totalCount} uploaded · processing ${formatTime(estimatedSeconds)} total`}
              </span>
              <button
                onClick={() => setExpanded(e => !e)}
                className="bg-transparent border-none cursor-pointer text-ink-muted hover:text-ink text-xs 
                           flex items-center gap-1 p-0 transition-colors duration-150"
              >
                {expanded ? "hide" : "details"}
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d={expanded ? "M2 8l4-4 4 4" : "M2 4l4 4 4-4"} />
                </svg>
              </button>
            </div>

            <div className="h-1 bg-border rounded-full overflow-hidden">
              <div 
                className={`h-full ${getProgressBarColor()} rounded-full transition-all duration-300 ease-in-out`}
                style={{ width: `${progress}%` }} 
              />
            </div>

            {totalCount > 0 && (
              <p className="text-xs text-ink-muted leading-relaxed m-0">
                Files are processed in the background — {formatTime(estimatedSeconds)} for all {totalCount} file{totalCount !== 1 ? "s" : ""}. You can leave this page.
              </p>
            )}

            {expanded && (
              <div 
                className="flex flex-col gap-1 mt-1 max-h-56 overflow-y-auto pr-1"
                style={{ scrollbarWidth: "thin" }}
              >
                {fileQueue.map(f => (
                  <FileRow key={f.name} name={f.name} status={f.status} message={f.message} />
                ))}
              </div>
            )}

            {allDone && (
              <button
                onClick={() => { clearQueue(); setExpanded(false); }}
                className="self-center mt-1 text-xs text-ink-muted hover:text-danger underline 
                           underline-offset-4 bg-transparent border-none cursor-pointer transition-colors duration-150"
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
