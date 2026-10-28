import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import SearchCard from "../components/SearchCard";
import PdfModal from "../components/PdfModal";
import UploadModal from "../components/UploadModal";
import CreateChart from "../components/Chart";
import YearRangeSlider, { YEAR_MIN, YEAR_MAX } from "../components/DualSlider";

const API = process.env.REACT_APP_SERVER_URL;

const displayFilename = (file) => file?.replace(/_\d+\.pdf$/i, ".pdf") ?? "";

const FIELD_FILTERS = [
    { key: "abstract", label: "Abstract", placeholder: "" },
    { key: "methods", label: "Methods", placeholder: "" },
    { key: "conclusions", label: "Conclusions", placeholder: "" },
    { key: "figures", label: "Figures", placeholder: "" },
    { key: "topics", label: "Topics / Keywords / Concepts", placeholder: "" },
];

export default function SearchPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const urlQuery = searchParams.get("q") || "";
    const urlDocs = parseInt(searchParams.get("docs") || "10", 10);
    const urlDateStart = parseInt(searchParams.get("date_start") || "", 10);
    const urlDateEnd = parseInt(searchParams.get("date_end") || "", 10);
    const urlCategoryId = searchParams.get("category_id") ?? "";

    const [inputVal, setInputVal] = useState(urlQuery);
    const [docsInput, setDocsInput] = useState(isNaN(urlDocs) ? 10 : urlDocs);
    const [results, setResults] = useState([]);
    const [hits, setHits] = useState(0);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState("");
    const [hasSearched, setHasSearched] = useState(!!urlQuery);
    const [modal, setModal] = useState(null);
    const [modalStage, setModalStage] = useState("closed");

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

    const [filtersOpen, setFiltersOpen] = useState(false);
    const [fieldFilters, setFieldFilters] = useState(
        Object.fromEntries(FIELD_FILTERS.map(({ key }) => [key, searchParams.get(key) || ""]))
    );
    const [categoryId, setCategoryId] = useState(urlCategoryId);
    const [categories, setCategories] = useState([]);

    useEffect(() => {
        fetch(`${API}/get-all-categories`)
            .then(r => r.json())
            .then(setCategories)
            .catch(() => { });
    }, []);

    const selectedCat = categories.find(c => String(c.id) === String(categoryId)) ?? null;

    const hasActiveFilters =
        Object.values(fieldFilters).some(v => v.trim()) ||
        (categoryId !== "" && categoryId != null);

    const hasAnyInput = (q, ff) =>
        q.trim() || Object.values(ff).some(v => v.trim());

    const updateField = (key, val) =>
        setFieldFilters(prev => ({ ...prev, [key]: val }));

    const clearAllFilters = () => {
        setFieldFilters(Object.fromEntries(FIELD_FILTERS.map(({ key }) => [key, ""])));
        setCategoryId("");
        setYearStart(YEAR_MIN);
        setYearEnd(YEAR_MAX);
    };

    const [uploadNode, setUploadNode] = useState(null);
    const [uploadModalStage, setUploadModalStage] = useState("closed");
    const chartRef = useRef(null);

    const openPdf = useCallback((e, r) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setModal({
            pdfUrl: `${API}/pdf-file/${encodeURIComponent(r.file)}`,
            previewUrl: `${API}${r.preview}`,
            documentId: r.id,
            searchQuery: searched,
            category: r.category ?? null,
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        });
        setModalStage("expanding");
        setTimeout(() => setModalStage("open"), 30);
    }, [searched]);

    const openPdfFromChart = useCallback((d) => {
        if (!d.file || !d.preview) return;
        setModal({
            pdfUrl: `${API}/pdf-file/${encodeURIComponent(d.file)}`,
            previewUrl: `${API}${d.preview}`,
            documentId: d.id,
            searchQuery: searched,
            category: d.category ?? null,
            rect: {
                top: window.innerHeight / 2 - 1,
                left: window.innerWidth / 2 - 1,
                width: 1,
                height: 1,
            },
        });
        setModalStage("expanding");
        setTimeout(() => setModalStage("open"), 30);
    }, [searched]);

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

    const buildApiUrl = (q, docs, ys, ye, ff, catId) => {
        const p = new URLSearchParams();
        p.set("query", q);
        p.set("docs", docs);
        if (!isDefaultRange(ys, ye)) { p.set("date_start", ys); p.set("date_end", ye); }
        if (catId) p.set("category_id", catId);
        FIELD_FILTERS.forEach(({ key }) => { if (ff[key]?.trim()) p.set(key, ff[key].trim()); });
        return `${API}/search?${p.toString()}`;
    };

    const buildNavUrl = (q, docs, ys, ye, ff, catId) => {
        const p = new URLSearchParams();
        p.set("q", q);
        p.set("docs", docs);
        if (!isDefaultRange(ys, ye)) { p.set("date_start", ys); p.set("date_end", ye); }
        if (catId) p.set("category_id", catId);
        FIELD_FILTERS.forEach(({ key }) => { if (ff[key]?.trim()) p.set(key, ff[key].trim()); });
        return `/search?${p.toString()}`;
    };

    const fetchResults = useCallback(async (q, docs, ys, ye, ff, catId) => {
        if (!hasAnyInput(q, ff)) return;
        setLoading(true);
        setSearched(q);
        try {
            const res = await fetch(buildApiUrl(q, docs, ys, ye, ff, catId));
            const data = await res.json();
            setResults(data.results ?? []);
            setHits(data.hits ?? 0);

            if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
            if (document.getElementById("megachart")) {
                chartRef.current = CreateChart(
                    data.chart_data ?? null,
                    data.initial_nodes,
                    openPdfFromChart,
                    openUploadFromChart,
                );
            } else {
                chartRef._pendingData = data.chart_data ?? null;
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
                fetchResults(searched, docsInput, yearStart, yearEnd, fieldFilters, categoryId);
            }
        }, 300);
    }, [categoryChanged, searched, docsInput, yearStart, yearEnd, fieldFilters, categoryId, fetchResults]);

    useEffect(() => {
        const q = searchParams.get("q") || "";
        const docs = parseInt(searchParams.get("docs") || "10", 10);
        const ys = parseInt(searchParams.get("date_start") || "", 10);
        const ye = parseInt(searchParams.get("date_end") || "", 10);
        const catId = searchParams.get("category_id") ?? "";
        const ff = Object.fromEntries(FIELD_FILTERS.map(({ key }) => [key, searchParams.get(key) || ""]));

        const docsVal = isNaN(docs) ? 10 : docs;
        const ysVal = !isNaN(ys) && ys >= YEAR_MIN ? ys : YEAR_MIN;
        const yeVal = !isNaN(ye) && ye <= YEAR_MAX ? ye : YEAR_MAX;

        setInputVal(q);
        setDocsInput(docsVal);
        setYearStart(ysVal);
        setYearEnd(yeVal);
        setFieldFilters(ff);
        setCategoryId(catId);

        if (hasAnyInput(q, ff)) {
            setHasSearched(true);
            fetchResults(q, docsVal, ysVal, yeVal, ff, catId);
        } else {
            setResults([]);
            setHits(0);
        }
    }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!hasSearched || chartRef.current) return;
        chartRef.current = CreateChart(undefined, undefined, openPdfFromChart, openUploadFromChart);
        chartRef._pendingData = null;
    }, [hasSearched, openPdfFromChart, openUploadFromChart]);

    const doSearch = () => {
        const q = inputVal.trim();
        const docs = Math.max(1, docsInput || 1);
        if (!hasAnyInput(q, fieldFilters)) return;
        setHasSearched(true);
        navigate(buildNavUrl(q, docs, yearStart, yearEnd, fieldFilters, categoryId));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        doSearch();
    };

    const handleFieldKeyDown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            doSearch();
        }
    };

    const handleLoadAll = () => {
        const q = inputVal.trim();
        if (!hasAnyInput(q, fieldFilters) || hits === 0) return;
        setDocsInput(hits);
        navigate(buildNavUrl(q, hits, yearStart, yearEnd, fieldFilters, categoryId));
    };

    const handleDocsChange = (e) => {
        const val = parseInt(e.target.value, 10);
        setDocsInput(isNaN(val) ? 1 : Math.max(1, val));
    };

    return (
        <main className="h-screen overflow-hidden bg-theme-bg flex flex-col">

            {/* ── Top bar ── */}
            <div
                style={{ transition: "all 450ms cubic-bezier(0.4, 0, 0.2, 1)" }}
                className={`
          z-30 bg-theme-bg flex-shrink-0
          ${hasSearched
                        ? "w-full px-5 pt-5 pb-0"
                        : "flex flex-col items-center px-5 pt-[10vh]"
                    }
        `}
            >
                {!hasSearched && (
                    <p
                        style={{ transition: "opacity 400ms", fontSize: 20 }}
                        className="text-theme-muted text-sm mb-4 tracking-wide"
                    >
                        Start Exploring…
                    </p>
                )}

                {/* ── Search row ── */}
                <form
                    onSubmit={handleSubmit}
                    className="flex items-end gap-2 w-full max-w-4xl"
                >
                    {/* Main search input */}
                    <div className="flex-1 flex items-center gap-2 bg-theme-bg-secondary border border-theme-border rounded-xl px-4 py-2.5
                          focus-within:border-chartizer-yellow focus-within:ring-1 focus-within:ring-chartizer-yellow/30
                          transition-all duration-200">
                        <svg className="w-4 h-4 text-theme-muted flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            value={inputVal}
                            onChange={(e) => setInputVal(e.target.value)}
                            placeholder="Search…"
                            className="flex-1 bg-transparent text-theme-text-primary placeholder-theme-muted text-sm outline-none"
                        />
                        {inputVal && (
                            <button type="button" onClick={() => setInputVal("")} className="text-theme-muted hover:text-theme-text-primary transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>

                    {/* Filters toggle */}
                    {hasSearched && (
                        <button
                            type="button"
                            onClick={() => setFiltersOpen(o => !o)}
                            className={`
                relative flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-medium
                transition-all duration-150 whitespace-nowrap
                ${filtersOpen
                                    ? "border-chartizer-yellow text-chartizer-yellow"
                                    : "border-theme-border text-theme-muted hover:border-chartizer-yellow hover:text-theme-text-primary"
                                }
              `}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <line x1="4" y1="6" x2="20" y2="6" strokeLinecap="round" />
                                <line x1="4" y1="12" x2="20" y2="12" strokeLinecap="round" />
                                <line x1="4" y1="18" x2="20" y2="18" strokeLinecap="round" />
                                <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
                                <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
                                <circle cx="9" cy="18" r="2" fill="currentColor" stroke="none" />
                            </svg>
                            Filters
                            {hasActiveFilters && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-chartizer-yellow" />
                            )}
                            <svg
                                className={`w-3 h-3 transition-transform duration-200 ${filtersOpen ? "rotate-180" : ""}`}
                                fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                    )}

                    {/* Document count */}
                    {hasSearched && (
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-theme-muted pl-1">Document Count</label>
                            <input
                                type="number"
                                min={1}
                                value={docsInput}
                                onChange={handleDocsChange}
                                onKeyDown={handleFieldKeyDown}
                                className="w-28 bg-theme-bg-secondary border border-theme-border rounded-xl px-3 py-2.5 text-sm text-theme-text-primary
                           text-center outline-none appearance-none
                           focus:border-chartizer-yellow focus:ring-1 focus:ring-chartizer-yellow/30 transition-all duration-200"
                            />
                        </div>
                    )}

                    {hasSearched && (
                        <button
                            type="button"
                            onClick={handleLoadAll}
                            disabled={hits === 0 || loading}
                            className="px-4 py-2.5 rounded-xl border border-theme-border text-theme-muted text-sm font-medium
                         hover:border-chartizer-yellow hover:text-theme-text-primary disabled:opacity-30 disabled:cursor-not-allowed
                         transition-all duration-150"
                        >
                            Load All
                        </button>
                    )}

                    <button
                        type="submit"
                        className="px-4 py-2.5 rounded-xl bg-chartizer-yellow text-theme-bg text-sm ml-2 font-semibold
                       hover:bg-chartizer-yellow/90 active:scale-95 transition-all duration-150"
                    >
                        Search
                    </button>
                </form>

                {/* ── Expandable filter panel ── */}
                {hasSearched && (
                    <div
                        style={{
                            display: "grid",
                            gridTemplateRows: filtersOpen ? "1fr" : "0fr",
                            transition: "grid-template-rows 260ms cubic-bezier(0.4, 0, 0.2, 1)",
                        }}
                        className="w-full max-w-4xl"
                    >
                        <div className="overflow-hidden">
                            <div className="pt-3 pb-4 flex flex-col gap-3">

                                {/* Field text inputs */}
                                <div className="grid grid-cols-2 gap-2">
                                    {FIELD_FILTERS.map(({ key, label, placeholder }) => (
                                        <div key={key} className="flex flex-col gap-1">
                                            <label className="text-xs text-theme-muted pl-1">{label}</label>
                                            <div className="flex items-center gap-2 bg-theme-bg-secondary border border-theme-border rounded-xl px-3 py-2
                                      focus-within:border-chartizer-yellow focus-within:ring-1 focus-within:ring-chartizer-yellow/30
                                      transition-all duration-200">
                                                <input
                                                    type="text"
                                                    value={fieldFilters[key]}
                                                    onChange={e => updateField(key, e.target.value)}
                                                    onKeyDown={handleFieldKeyDown}
                                                    placeholder={placeholder}
                                                    className="flex-1 bg-transparent text-theme-text-primary placeholder-theme-muted text-sm outline-none"
                                                />
                                                {fieldFilters[key] && (
                                                    <button
                                                        type="button"
                                                        onClick={() => updateField(key, "")}
                                                        className="text-theme-muted hover:text-theme-text-primary transition-colors flex-shrink-0"
                                                    >
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Category + year range + clear */}
                                <div className="flex items-end gap-3">

                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs text-theme-muted pl-1">Category</label>
                                        <div className="relative" style={{ minWidth: "11rem" }}>
                                            <span
                                                className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full pointer-events-none z-10"
                                                style={{
                                                    backgroundColor: selectedCat?.color ?? "rgba(170,170,170,0.92)",
                                                }}
                                            />
                                            <select
                                                value={categoryId}
                                                onChange={e => setCategoryId(e.target.value)}
                                                style={{ minWidth: "11rem" }}
                                                className="bg-theme-bg-secondary border border-theme-border rounded-xl py-2 pl-7 pr-8 text-sm text-theme-text-primary
                                   outline-none appearance-none cursor-pointer
                                   focus:border-chartizer-yellow focus:ring-1 focus:ring-chartizer-yellow/30 transition-all duration-200">
                                                <option value="">All categories</option>
                                                {categories
                                                    .filter(c => c.id !== 0)
                                                    .map(c => (
                                                        <option
                                                            key={c.id}
                                                            value={String(c.id)}
                                                            style={{ backgroundColor: c.color, color: "#000" }}
                                                        >
                                                            {c.name.charAt(0).toUpperCase() + c.name.slice(1)}
                                                        </option>
                                                    ))}
                                            </select>
                                            <svg
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-theme-muted pointer-events-none"
                                                fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </div>
                                    </div>

                                    {/* Year range */}
                                    <div className="flex flex-col gap-1">
                                        <YearRangeSlider
                                            start={yearStart}
                                            end={yearEnd}
                                            onChange={handleYearChange}
                                        />
                                    </div>

                                    <div className="flex-1" />

                                    {hasActiveFilters && (
                                        <button
                                            type="button"
                                            onClick={clearAllFilters}
                                            className="self-end px-3 py-2 rounded-xl border border-theme-border text-theme-muted text-xs
                                 hover:border-chartizer-yellow hover:text-theme-text-primary transition-all duration-150"
                                        >
                                            Clear filters
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {hasSearched && <div className="border-b border-theme-border mt-2" />}
            </div>

            {/* ── Results + chart ── */}
            {hasSearched && (
                <div className="flex flex-1 min-h-0">
                    <div className="w-[550px] min-w-[420px] shrink-0 flex flex-col bg-theme-bg min-h-0">
                        <div className="flex-1 overflow-y-auto px-5 pb-5 flex flex-col gap-3 pt-3">

                            {!loading && hasSearched && (
                                <p className="text-xs text-theme-muted mb-1">
                                    {results.length > 0
                                        ? `Showing ${results.length} out of ${hits} results`
                                        : `No results found`}
                                </p>
                            )}

                            {loading && [1, 2, 3].map((i) => (
                                <div key={i} className="h-40 rounded-2xl bg-theme-bg-secondary animate-pulse" />
                            ))}

                            {!loading && results.length > 0 && results.map((r, i) => (
                                <SearchCard
                                    key={`${r.file}-${i}`}
                                    result={{ ...r, displayFile: displayFilename(r.file) }}
                                    apiUrl={API}
                                    onOpenPdf={openPdf}
                                />
                            ))}

                            {!loading && hasSearched && results.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-20 gap-3 text-theme-muted">
                                    <svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <p className="text-sm">No results found</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 bg-theme-bg overflow-hidden relative">
                        <div id="megachart" className="w-full h-full" />
                        <div className="absolute bottom-4 right-4 bg-theme-bg-secondary/80 backdrop-blur-sm border border-theme-border rounded-xl px-3 py-2.5 flex flex-col gap-1.5 pointer-events-none">
                            <div className="flex items-center gap-2">
                                <span className="w-5 h-0.5 rounded-full" style={{ backgroundColor: "rgba(251,146,60,0.9)" }} />
                                <span className="text-xs text-theme-muted">Related</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-5 h-0.5 rounded-full" style={{ backgroundColor: "rgba(170,170,170,0.92)" }} />
                                <span className="text-xs text-theme-muted">Referenced</span>
                            </div>
                        </div>
                    </div>
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
