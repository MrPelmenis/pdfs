import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import SearchCard from "../components/SearchCard";
import PdfModal from "../components/PdfModal";
import UploadModal from "../components/UploadModal";
import CreateChart from "../components/Chart";
import ChartToolbar, {
    ToolbarButton, FiltersIcon, PanelIcon, ModeSwitch, useMediaQuery, useSidePanel,
} from "../components/ChartToolbar";
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
    // Phones show the results or the graph, picked in the toolbar's Results | Graph | Mafia
    // switch (?view=graph when coming back from the author map). Wider screens show both.
    const [mobileView, setMobileView] = useState(searchParams.get("view") === "graph" ? "graph" : "results");
    // lg+: the results slide over the graph (shared open/closed state with the author map)
    const [panelOpen, setPanelOpen] = useSidePanel();
    const wide = useMediaQuery("(min-width: 768px)");
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
    // the chart keeps the callbacks it was created with, so it reads the query from here
    const searchedRef = useRef("");
    useEffect(() => { searchedRef.current = searched; }, [searched]);

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
        if (!d.file) return;
        setModal({
            pdfUrl: `${API}/pdf-file/${encodeURIComponent(d.file)}`,
            previewUrl: d.preview ? `${API}${d.preview}` : null,
            documentId: d.id,
            searchQuery: searchedRef.current,
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

    // The author map for the same topic, fields and years.
    const mafiaUrl = (() => {
        const p = new URLSearchParams({ q: searched });
        if (categoryId) p.set("fields", categoryId);
        if (!isDefaultRange(yearStart, yearEnd)) { p.set("from", yearStart); p.set("to", yearEnd); }
        return `/mafia?${p}`;
    })();

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
        searchedRef.current = q;
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
                    data.results ?? [],
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
        setMobileView("results");
        // a new query starts clean: the old one's field / year / category filters go
        // (a search made only of field filters, with no query text, keeps them)
        if (q && q !== searched) {
            const ff = Object.fromEntries(FIELD_FILTERS.map(({ key }) => [key, ""]));
            clearAllFilters();
            navigate(buildNavUrl(q, docs, YEAR_MIN, YEAR_MAX, ff, ""));
            return;
        }
        navigate(buildNavUrl(q, docs, yearStart, yearEnd, fieldFilters, categoryId));
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
        <main className="h-full overflow-hidden bg-theme-bg flex flex-col">

            {/* ── Top bar ── */}
            <div
                style={{ transition: "all 450ms cubic-bezier(0.4, 0, 0.2, 1)" }}
                className={`
          z-30 bg-theme-bg flex-shrink-0
          ${hasSearched
                        ? "w-full px-3 sm:px-5 pt-2.5 pb-0"
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

                {/* ── Search row: the same bar as on the author map ── */}
                <ChartToolbar
                    value={inputVal}
                    onChange={setInputVal}
                    onSubmit={doSearch}
                    placeholder="Search…"
                    left={hasSearched && (
                        <>
                            <ToolbarButton active={panelOpen} onClick={() => setPanelOpen((o) => !o)} className="hidden md:flex w-28 justify-center">
                                <PanelIcon />
                                Results
                            </ToolbarButton>
                            <ModeSwitch mode="papers" papersHref={`/search?${searchParams}`} mafiaHref={mafiaUrl}
                                view={mobileView} onView={setMobileView} />
                        </>
                    )}
                    right={hasSearched && (
                        <>
                            <ToolbarButton active={filtersOpen} dot={hasActiveFilters} onClick={() => setFiltersOpen((o) => !o)}>
                                <FiltersIcon />
                                Filters
                                <svg className={`w-3 h-3 transition-transform duration-200 ${filtersOpen ? "rotate-180" : ""}`}
                                    fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                            </ToolbarButton>
                            <label className="hidden md:flex h-10 flex-none items-center gap-2 pl-3 pr-1 rounded-xl border border-theme-border bg-theme-bg-secondary
                                              focus-within:border-chartizer-yellow focus-within:ring-1 focus-within:ring-chartizer-yellow/30 transition-colors duration-200">
                                <span className="text-xs text-theme-muted whitespace-nowrap">Documents</span>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    aria-label="Document count"
                                    min={1}
                                    value={docsInput}
                                    onChange={handleDocsChange}
                                    onKeyDown={handleFieldKeyDown}
                                    className="w-14 h-8 bg-transparent text-base sm:text-sm text-theme-text-primary text-center outline-none appearance-none"
                                />
                            </label>
                            <ToolbarButton onClick={handleLoadAll} disabled={hits === 0 || loading} className="hidden md:flex">
                                Load All
                            </ToolbarButton>
                        </>
                    )}
                />

                {/* ── Expandable filter panel ── */}
                {hasSearched && (
                    <div
                        style={{
                            display: "grid",
                            gridTemplateRows: filtersOpen ? "1fr" : "0fr",
                            transition: "grid-template-rows 260ms cubic-bezier(0.4, 0, 0.2, 1)",
                        }}
                        className="w-full max-w-4xl mx-auto"
                    >
                        <div className="overflow-hidden">
                            <div className="pt-3 pb-4 flex flex-col gap-3 max-lg:max-h-[55dvh] max-lg:overflow-y-auto overscroll-contain">

                                {/* phones: the document count lives here instead of in the bar */}
                                <div className="md:hidden flex items-end gap-2">
                                    <label className="flex-1 flex flex-col gap-1">
                                        <span className="text-xs text-theme-muted pl-1">Documents</span>
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            min={1}
                                            value={docsInput}
                                            onChange={handleDocsChange}
                                            onKeyDown={handleFieldKeyDown}
                                            className="h-10 bg-theme-bg-secondary border border-theme-border rounded-xl px-3 text-base text-theme-text-primary outline-none focus:border-chartizer-yellow"
                                        />
                                    </label>
                                    <ToolbarButton onClick={handleLoadAll} disabled={hits === 0 || loading}>Load All</ToolbarButton>
                                </div>

                                {/* Field text inputs */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                                                    className="flex-1 min-w-0 bg-transparent text-theme-text-primary placeholder-theme-muted text-base sm:text-sm outline-none"
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
                                <div className="flex flex-wrap items-end gap-3">

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

                {hasSearched && <div className="border-b border-theme-border mt-2.5 -mx-3 sm:-mx-5" />}
            </div>

            {/* ── Results + chart ── */}
            {hasSearched && (
                <div className="relative flex flex-1 min-h-0">
                    {/* md+: the results slide over the graph, like the author map's filters, so
                        opening / closing them never resizes (or moves) the graph. Phones: the
                        results or the graph fill the screen; both keep their size, so the
                        graph lays out correctly while out of sight. */}
                    <section
                        aria-hidden={wide ? !panelOpen : mobileView !== "results"}
                        className={`
                            absolute z-20 flex flex-col min-h-0
                            ${wide
                                ? "inset-y-0 left-0 w-[clamp(340px,40vw,550px)] glass !rounded-none !border-y-0 !border-l-0 transition-transform duration-300 ease-out"
                                : "inset-0 bg-theme-bg glass-pane"}
                            ${wide && !panelOpen ? "-translate-x-full pointer-events-none" : ""}
                            ${!wide && mobileView !== "results" ? "invisible pointer-events-none" : ""}
                        `}
                    >
                        <div className="results-list flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5 pb-[calc(20px+env(safe-area-inset-bottom))] md:pb-5 flex flex-col gap-3 pt-3">

                            {!loading && hasSearched && (
                                <div className="flex items-center gap-3 mb-1">
                                    <p className="flex-1 text-xs text-theme-muted">
                                        {results.length > 0
                                            ? `Showing ${results.length} out of ${hits} results`
                                            : `No results found`}
                                    </p>
                                    {searched && (
                                        <Link to={mafiaUrl} className="flex-none text-xs font-semibold text-chartizer-yellow hover:underline">
                                            Who works on this →
                                        </Link>
                                    )}
                                </div>
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
                    </section>

                    <section
                        style={{ "--chart-left-inset": wide && panelOpen ? "clamp(340px, 40vw, 550px)" : "0px" }}
                        className={`
                            absolute inset-0 bg-theme-bg overflow-hidden
                        `}
                    >
                        <div id="megachart" className="graph-surface w-full h-full" />
                    </section>

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
