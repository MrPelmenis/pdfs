import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import SearchCard from "../components/SearchCard";
import PdfModal from "../components/PdfModal";

const API = process.env.REACT_APP_SERVER_URL;

const displayFilename = (file) => file?.replace(/_\d+\.pdf$/i, ".pdf") ?? "";

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const urlQuery       = searchParams.get("q") || "";

  const [inputVal,    setInputVal]    = useState(urlQuery);
  const [results,     setResults]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [searched,    setSearched]    = useState("");
  const [hasSearched, setHasSearched] = useState(!!urlQuery);
  const [modal,       setModal]       = useState(null);
  const [modalStage,  setModalStage]  = useState("closed");

  const fetchResults = useCallback(async (q) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(q);
    try {
      const res  = await fetch(`${API}/search?query=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setInputVal(urlQuery);
    if (urlQuery) {
      setHasSearched(true);
      fetchResults(urlQuery);
    } else {
      setResults([]);
    }
  }, [urlQuery, fetchResults]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const q = inputVal.trim();
    if (!q) return;
    setHasSearched(true);
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const clearInput = () => setInputVal("");

  const openPdf = useCallback((e, r) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setModal({
      pdfUrl:     `${API}/pdf-file/${encodeURIComponent(r.file)}`,
      previewUrl: `${API}${r.preview}`,
      rect:       { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    });
    setModalStage("expanding");
    setTimeout(() => setModalStage("open"), 30);
  }, []);

  const closeModal = useCallback(() => {
    setModalStage("closing");
    setTimeout(() => { setModal(null); setModalStage("closed"); }, 300);
  }, []);

  return (
    <main className="min-h-screen bg-main flex flex-col">

      {/* ── Search bar ── */}
      <div
        style={{
          transition: "all 450ms cubic-bezier(0.4, 0, 0.2, 1)",
          ...(hasSearched ? {} : { paddingTop: "10vh" }),
        }}
        className={`
          z-30 bg-main
          ${hasSearched
            ? "sticky top-0 w-full border-b border-border px-5 pt-5 pb-3"
            : "flex flex-col items-center px-5"
          }
        `}
      >
        {!hasSearched && (
          <p
            style={{ transition: "opacity 400ms", fontSize:20 }}
            className="text-ink-muted text-sm mb-4 tracking-wide"
          >
            Start Exploring…
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 w-full max-w-xl"
        >
          <div className="flex-1 flex items-center gap-2 bg-surface border border-border rounded-xl px-4 py-2.5
                          focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30
                          transition-all duration-200">
            <svg className="w-4 h-4 text-ink-muted flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Search…"
              className="flex-1 bg-transparent text-ink placeholder-ink-muted text-sm outline-none"
            />
            {inputVal && (
              <button type="button" onClick={clearInput} className="text-ink-muted hover:text-ink transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-accent text-main text-sm font-semibold
                       hover:bg-accent/90 active:scale-95 transition-all duration-150"
          >
            Search
          </button>
        </form>
      </div>

      {/* ── Results + right panel ── */}
      {hasSearched && (
        <div className="flex flex-1 overflow-hidden">

          {/* Left panel */}
          <div className="w-[650px] min-w-[420px] shrink-0 flex flex-col bg-main">
            <div className="flex-1 overflow-y-auto px-5 pb-5 flex flex-col gap-3 pt-3">

              {searched && !loading && (
                <p className="text-xs text-ink-muted mb-1">
                  {results.length > 0
                    ? `${results.length} result${results.length !== 1 ? "s" : ""} for "${searched}"`
                    : `No results for "${searched}"`}
                </p>
              )}

              {loading && [1, 2, 3].map((i) => (
                <div key={i} className="h-40 rounded-2xl bg-surface animate-pulse" />
              ))}

              {!loading && results.length > 0 && results.map((r, i) => (
                <SearchCard
                  key={`${r.file}-${i}`}
                  result={{ ...r, displayFile: displayFilename(r.file) }}
                  apiUrl={API}
                  onOpenPdf={openPdf}
                />
              ))}

              {!loading && searched && results.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-ink-muted">
                  <svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm">Nothing found for <span className="text-ink-dim font-medium">{searched}</span></p>
                </div>
              )}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1 bg-main" />
        </div>
      )}

      <PdfModal modal={modal} modalStage={modalStage} onClose={closeModal} />
    </main>
  );
}
