import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import SearchCard from "../components/SearchCard";
import PdfModal from "../components/PdfModal";
import UploadModal from "../components/UploadModal";
import CreateChart from "../components/Chart";
import YearRangeSlider, { YEAR_MIN, YEAR_MAX } from "../components/DualSlider";

const API = process.env.REACT_APP_SERVER_URL;

const displayFilename = (file) => file?.replace(/_\d+\.pdf$/i, ".pdf") ?? "";

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const urlQuery       = searchParams.get("q")          || "";
  const urlDocs        = parseInt(searchParams.get("docs") || "10", 10);
  const urlDateStart   = parseInt(searchParams.get("date_start") || "", 10);
  const urlDateEnd     = parseInt(searchParams.get("date_end")   || "", 10);

  const [inputVal,    setInputVal]    = useState(urlQuery);
  const [docsInput,   setDocsInput]   = useState(isNaN(urlDocs) ? 10 : urlDocs);
  const [results,     setResults]     = useState([]);
  const [hits,        setHits]        = useState(0);
  const [loading,     setLoading]     = useState(false);
  const [searched,    setSearched]    = useState("");
  const [hasSearched, setHasSearched] = useState(!!urlQuery);
  const [modal,       setModal]       = useState(null);
  const [modalStage,  setModalStage]  = useState("closed");

  const [yearStart, setYearStart] = useState(
    !isNaN(urlDateStart) && urlDateStart >= YEAR_MIN ? urlDateStart : YEAR_MIN
  );
  const [yearEnd, setYearEnd] = useState(
    !isNaN(urlDateEnd) && urlDateEnd <= YEAR_MAX ? urlDateEnd : YEAR_MAX
  );

  const handleYearChange = useCallback((s, e) => {
    setYearStart(s);
    setYearEnd(e);
  }, []);

  const [uploadNode,       setUploadNode]       = useState(null);
  const [uploadModalStage, setUploadModalStage] = useState("closed");

  const chartRef = useRef(null);

  const openPdf = useCallback((e, r) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setModal({
      pdfUrl:     `${API}/pdf-file/${encodeURIComponent(r.file)}`,
      previewUrl: `${API}${r.preview}`,
      documentId: r.id,
      category:   r.category ?? null,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    });
    setModalStage("expanding");
    setTimeout(() => setModalStage("open"), 30);
  }, []);

  const openPdfFromChart = useCallback((d) => {
    if (!d.file || !d.preview) return;
    setModal({
      pdfUrl:     `${API}/pdf-file/${encodeURIComponent(d.file)}`,
      previewUrl: `${API}${d.preview}`,
      documentId: d.id,
      category:   d.category ?? null,
      rect: {
        top:    window.innerHeight / 2 - 1,
        left:   window.innerWidth  / 2 - 1,
        width:  1,
        height: 1,
      },
    });
    setModalStage("expanding");
    setTimeout(() => setModalStage("open"), 30);
  }, []);

  const openUploadFromChart = useCallback((d) => {
    setUploadNode(d);
    setUploadModalStage("expanding");
    setTimeout(() => setUploadModalStage("open"), 30);
  }, []);

  const closeUploadModal = useCallback(() => {
    setUploadModalStage("closing");
    setTimeout(() => {
      setUploadNode(null);
      setUploadModalStage("closed");
    }, 300);
  }, []);

  const isDefaultRange = (ys, ye) => ys === YEAR_MIN && ye === YEAR_MAX;

  const buildApiUrl = (q, docs, ys, ye) => {
    let url = `${API}/search?query=${encodeURIComponent(q)}&docs=${docs}`;
    if (!isDefaultRange(ys, ye)) url += `&date_start=${ys}&date_end=${ye}`;
    return url;
  };

  const buildNavUrl = (q, docs, ys, ye) => {
    let url = `/search?q=${encodeURIComponent(q)}&docs=${docs}`;
    if (!isDefaultRange(ys, ye)) url += `&date_start=${ys}&date_end=${ye}`;
    return url;
  };

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchResults = useCallback(async (q, docs, ys, ye) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(q);
    try {
      const res  = await fetch(buildApiUrl(q, docs, ys, ye));
      const data = await res.json();
      setResults(data.results ?? []);
      setHits(data.hits ?? 0);

      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      if (document.getElementById("megachart")) {
        chartRef.current = CreateChart(
          data.chart_data ?? null,
          data.initial_nodes,
          openPdfFromChart,
          openUploadFromChart,
        );
      } else {
        chartRef._pendingData  = data.chart_data ?? null;
        chartRef._pendingQuery = q;
      }
    } catch {
      setResults([]);
      setHits(0);
    } finally {
      setLoading(false);
    }
  }, [openPdfFromChart, openUploadFromChart]); // eslint-disable-line react-hooks/exhaustive-deps

  const [categoryChanged, setCategoryChanged] = useState(false);
  const closeModal = useCallback(() => {
    setModalStage("closing");
    setTimeout(() => {
      setModal(null);
      setModalStage("closed");
      if (categoryChanged) {
        setCategoryChanged(false);
        fetchResults(searched, docsInput, yearStart, yearEnd);
      }
    }, 300);
  }, [categoryChanged, searched, docsInput, yearStart, yearEnd, fetchResults]);

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasSearched || chartRef.current) return;
    chartRef.current = CreateChart(undefined, undefined, openPdfFromChart, openUploadFromChart);
    chartRef._pendingData = null;
  }, [hasSearched, openPdfFromChart, openUploadFromChart]);

  useEffect(() => {
    const docs = isNaN(urlDocs) ? 10 : urlDocs;
    const ys   = !isNaN(urlDateStart) && urlDateStart >= YEAR_MIN ? urlDateStart : YEAR_MIN;
    const ye   = !isNaN(urlDateEnd)   && urlDateEnd   <= YEAR_MAX ? urlDateEnd   : YEAR_MAX;
    setInputVal(urlQuery);
    setDocsInput(docs);
    setYearStart(ys);
    setYearEnd(ye);
    if (urlQuery) {
      setHasSearched(true);
      fetchResults(urlQuery, docs, ys, ye);
    } else {
      setResults([]);
      setHits(0);
    }
  }, [urlQuery, urlDocs, urlDateStart, urlDateEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSubmit = (e) => {
    e.preventDefault();
    const q    = inputVal.trim();
    const docs = Math.max(1, docsInput || 1);
    if (!q) return;
    setHasSearched(true);
    navigate(buildNavUrl(q, docs, yearStart, yearEnd));
  };

  const handleLoadAll = () => {
    const q = inputVal.trim();
    if (!q || hits === 0) return;
    setDocsInput(hits);
    navigate(buildNavUrl(q, hits, yearStart, yearEnd));
  };

  const handleDocsChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setDocsInput(isNaN(val) ? 1 : Math.max(1, val));
  };

  const clearInput = () => setInputVal("");

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="h-screen overflow-hidden bg-main flex flex-col">

      {/* ── Search bar ── */}
      <div
        style={{
          transition: "all 450ms cubic-bezier(0.4, 0, 0.2, 1)",
          ...(hasSearched ? {} : { paddingTop: "10vh" }),
        }}
        className={`
          z-30 bg-main flex-shrink-0
          ${hasSearched
            ? "w-full border-b border-border px-5 pt-5 pb-3"
            : "flex flex-col items-center px-5"
          }
        `}
      >
        {!hasSearched && (
          <p
            style={{ transition: "opacity 400ms", fontSize: 20 }}
            className="text-ink-muted text-sm mb-4 tracking-wide"
          >
            Start Exploring…
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 w-full max-w-4xl"
        >
          {/* Search input */}
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

          {/* Document Count — only after first search */}
          {hasSearched && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-muted pl-1">Document Count</label>
              <input
                type="number"
                min={1}
                value={docsInput}
                onChange={handleDocsChange}
                className="w-28 bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-ink
                           text-center outline-none appearance-none
                           focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all duration-200"
              />
            </div>
          )}

          {/* Load All — only after first search */}
          {hasSearched && (
            <button
              type="button"
              onClick={handleLoadAll}
              disabled={hits === 0 || loading}
              className="px-4 py-2.5 rounded-xl border border-border text-ink-muted text-sm font-medium mr-2
                         hover:border-accent hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed
                         transition-all duration-150"
            >
              Load All
            </button>
          )}

          {/* Year Range Slider — only after first search */}
          {hasSearched && (
            <YearRangeSlider
              start={yearStart}
              end={yearEnd}
              onChange={handleYearChange}
            />
          )}

          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-accent text-main text-sm ml-2 font-semibold
                       hover:bg-accent/90 active:scale-95 transition-all duration-150"
          >
            Search
          </button>
        </form>
      </div>

      {/* ── Results + right panel ── */}
      {hasSearched && (
        <div className="flex flex-1 min-h-0">

          {/* Left panel */}
          <div className="w-[550px] min-w-[420px] shrink-0 flex flex-col bg-main min-h-0">
            <div className="flex-1 overflow-y-auto px-5 pb-5 flex flex-col gap-3 pt-3">

              {/* Result count */}
              {searched && !loading && (
                <p className="text-xs text-ink-muted mb-1">
                  {results.length > 0
                    ? `Showing ${results.length} out of ${hits} results for "${searched}"`
                    : `No results for "${searched}"`}
                </p>
              )}

              {/* Skeletons */}
              {loading && [1, 2, 3].map((i) => (
                <div key={i} className="h-40 rounded-2xl bg-surface animate-pulse" />
              ))}

              {/* Results */}
              {!loading && results.length > 0 && results.map((r, i) => (
                <SearchCard
                  key={`${r.file}-${i}`}
                  result={{ ...r, displayFile: displayFilename(r.file) }}
                  apiUrl={API}
                  onOpenPdf={openPdf}
                />
              ))}

              {/* Empty state */}
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

          {/* Right panel — ZoomCharts */}
          <div id="megachart" className="flex-1 bg-main overflow-hidden" />
        </div>
      )}

      <PdfModal
        modal={modal}
        modalStage={modalStage}
        onClose={closeModal}
        onCategoryChange={() => setCategoryChanged(true)}
      />

      <UploadModal
        node={uploadNode}
        modalStage={uploadModalStage}
        onClose={closeUploadModal}
      />
    </main>
  );
}
