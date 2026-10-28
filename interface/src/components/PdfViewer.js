import { useEffect, useRef, useState, useCallback } from "react";
import "pdfjs-dist/legacy/web/pdf_viewer.css";

// pdf.js renders the document itself: browsers on iPad/iPhone show an <embed>ed PDF as a
// single static page, without scrolling, zoom or search. The legacy build supports
// older Safari versions. Loaded on first use so it isn't part of the main bundle.
let pdfjsReady = null;
function loadPdfjs() {
  pdfjsReady ||= (async () => {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    // the viewer module reads the library from this global
    window.pdfjsLib = pdfjsLib;
    const viewer = await import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
    return { pdfjsLib, viewer };
  })();
  return pdfjsReady;
}

const PINCH_REDRAW_DELAY_MS = 400;   // pages are scaled with CSS while pinching, redrawn after
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_ZOOM = 2.2;

function Icon({ d, className = "w-4 h-4" }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const ICONS = {
  close: "M6 18L18 6M6 6l12 12",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  fit: "M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4",
  up: "M5 15l7-7 7 7",
  down: "M19 9l-7 7-7-7",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5",
  tag: "M7 7h.01M3 11V4a1 1 0 011-1h7l9 9-8 8-9-9z",
};

function ToolButton({ onClick, label, icon, disabled, active, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`h-9 min-w-9 px-2 inline-flex items-center justify-center gap-1.5 rounded-lg text-sm
        transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed
        ${active ? "bg-chartizer-yellow/15 text-chartizer-yellow" : "text-ink-dim hover:text-ink hover:bg-white/5 active:bg-white/10"}`}
    >
      {icon && <Icon d={ICONS[icon]} />}
      {children}
    </button>
  );
}

/**
 * Scrollable, zoomable PDF with search highlighting.
 * `query` is searched for and highlighted once the pages are laid out.
 * `onClose` / `onToggleSide` add a close button / a side panel toggle to the toolbar.
 */
export default function PdfViewer({ url, query = "", onClose, onToggleSide, sideOpen, sideLabel = "Category" }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const eventBusRef = useRef(null);

  const [status, setStatus] = useState("loading");   // loading | ready | error
  const [progress, setProgress] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [findText, setFindText] = useState(query);
  const [searchOpen, setSearchOpen] = useState(!!query);
  const [matches, setMatches] = useState({ current: 0, total: 0 });

  const find = useCallback((text, again = false, previous = false) => {
    eventBusRef.current?.dispatch("find", {
      source: null,
      type: again ? "again" : "",
      query: text,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  }, []);

  // ── Load the document ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;
    let viewer = null;
    setStatus("loading");
    setProgress(0);

    loadPdfjs().then(({ pdfjsLib, viewer: lib }) => {
      if (cancelled) return;
      const container = containerRef.current;
      const eventBus = new lib.EventBus();
      const linkService = new lib.PDFLinkService({ eventBus });
      const findController = new lib.PDFFindController({ eventBus, linkService });
      viewer = new lib.PDFViewer({ container, eventBus, linkService, findController });
      linkService.setViewer(viewer);
      viewerRef.current = viewer;
      eventBusRef.current = eventBus;

      eventBus.on("pagesinit", () => {
        viewer.currentScaleValue = "page-width";
        if (query) find(query);
      });
      eventBus.on("pagechanging", (e) => setPage(e.pageNumber));
      eventBus.on("scalechanging", (e) => setScale(e.scale));
      const onCount = (e) => e.matchesCount && setMatches(e.matchesCount);
      eventBus.on("updatefindmatchescount", onCount);
      eventBus.on("updatefindcontrolstate", onCount);

      loadingTask = pdfjsLib.getDocument({ url });
      loadingTask.onProgress = ({ loaded, total }) => total && setProgress(loaded / total);
      return loadingTask.promise.then((doc) => {
        if (cancelled) return;
        viewer.setDocument(doc);
        linkService.setDocument(doc);
        setPageCount(doc.numPages);
        setStatus("ready");
      });
    }).catch((err) => {
      if (cancelled) return;
      console.error("[pdf]", err);
      setStatus("error");
    });

    return () => {
      cancelled = true;
      loadingTask?.destroy();
      viewer?.setDocument(null);
      viewerRef.current = null;
      eventBusRef.current = null;
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep "page width" when the viewer is resized (rotation, side panel, window).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    let width = container.clientWidth;
    const ro = new ResizeObserver(() => {
      const viewer = viewerRef.current;
      if (!viewer?.pdfDocument || container.clientWidth === width) return;
      width = container.clientWidth;
      if (viewer.currentScaleValue === "page-width") viewer.currentScaleValue = "page-width";
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Touch: pinch to zoom around the fingers, double tap to zoom in/out ────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let pinch = null;      // { startDist, startScale }
    let lastTap = null;    // { time, x, y }

    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];

    const onTouchStart = (e) => {
      const viewer = viewerRef.current;
      if (!viewer?.pdfDocument) return;
      if (e.touches.length === 2) {
        pinch = { startDist: dist(e.touches), startScale: viewer.currentScale };
        lastTap = null;
        e.preventDefault();
      }
    };
    const onTouchMove = (e) => {
      const viewer = viewerRef.current;
      if (!pinch || e.touches.length !== 2 || !viewer) return;
      e.preventDefault();
      const target = pinch.startScale * (dist(e.touches) / pinch.startDist);
      const factor = target / viewer.currentScale;
      if (Math.abs(factor - 1) < 0.01) return;
      viewer.updateScale({ scaleFactor: factor, origin: mid(e.touches), drawingDelay: PINCH_REDRAW_DELAY_MS });
    };
    const onTouchEnd = (e) => {
      if (pinch) {
        if (e.touches.length < 2) pinch = null;
        return;
      }
      if (e.changedTouches.length !== 1 || e.touches.length) return;
      const t = e.changedTouches[0];
      const now = performance.now();
      if (lastTap && now - lastTap.time < DOUBLE_TAP_MS && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 30) {
        lastTap = null;
        const viewer = viewerRef.current;
        if (!viewer?.pdfDocument) return;
        e.preventDefault();
        // zoomed in → back to page width; otherwise zoom in on the tapped spot
        const before = viewer.currentScale;
        viewer.currentScaleValue = "page-width";
        if (viewer.currentScale >= before * 0.95) {
          viewer.updateScale({ scaleFactor: DOUBLE_TAP_ZOOM, origin: [t.clientX, t.clientY] });
        }
      } else {
        lastTap = { time: now, x: t.clientX, y: t.clientY };
      }
    };
    // trackpad pinch (and ctrl + wheel) zooms the document, not the page
    const onWheel = (e) => {
      const viewer = viewerRef.current;
      if (!e.ctrlKey || !viewer?.pdfDocument) return;
      e.preventDefault();
      viewer.updateScale({
        scaleFactor: Math.exp(-e.deltaY / 100),
        origin: [e.clientX, e.clientY],
        drawingDelay: PINCH_REDRAW_DELAY_MS,
      });
    };
    // Safari's own pinch gesture would zoom the whole page
    const stopGesture = (e) => e.preventDefault();

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("gesturestart", stopGesture);
    container.addEventListener("gesturechange", stopGesture);
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("gesturestart", stopGesture);
      container.removeEventListener("gesturechange", stopGesture);
    };
  }, []);

  const zoom = (steps) => viewerRef.current?.updateScale({ steps });
  const fitWidth = () => { if (viewerRef.current) viewerRef.current.currentScaleValue = "page-width"; };
  const goTo = (n) => {
    const viewer = viewerRef.current;
    if (viewer && n >= 1 && n <= pageCount) viewer.currentPageNumber = n;
  };

  const submitFind = (e) => {
    e.preventDefault();
    if (findText.trim()) find(findText.trim(), true);
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[#2a2b2e]">
      {/* ── Toolbar ── */}
      <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.07] bg-[#1e1f22]/95 backdrop-blur">
        {onToggleSide && (
          <ToolButton onClick={onToggleSide} label={sideLabel} icon="tag" active={sideOpen} />
        )}

        <div className="flex items-center gap-1 text-xs text-ink-dim tabular-nums px-1 whitespace-nowrap">
          <ToolButton onClick={() => goTo(page - 1)} label="Previous page" icon="up" disabled={page <= 1} />
          <span className="min-w-[3.5rem] text-center">{pageCount ? `${page} / ${pageCount}` : "–"}</span>
          <ToolButton onClick={() => goTo(page + 1)} label="Next page" icon="down" disabled={page >= pageCount} />
        </div>

        <div className="flex-1" />

        <div className="hidden sm:flex items-center gap-0.5">
          <ToolButton onClick={() => zoom(-1)} label="Zoom out" icon="minus" />
          <button
            type="button"
            onClick={fitWidth}
            title="Fit to width"
            className="h-9 px-1.5 text-xs text-ink-dim hover:text-ink tabular-nums min-w-[3.25rem]"
          >
            {Math.round(scale * 100)}%
          </button>
          <ToolButton onClick={() => zoom(1)} label="Zoom in" icon="plus" />
        </div>
        <span className="sm:hidden">
          <ToolButton onClick={fitWidth} label="Fit to width" icon="fit" />
        </span>

        <ToolButton onClick={() => setSearchOpen((o) => !o)} label="Search in document" icon="search" active={searchOpen} />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open in new tab"
          aria-label="Open in new tab"
          className="h-9 min-w-9 px-2 inline-flex items-center justify-center rounded-lg text-ink-dim hover:text-ink hover:bg-white/5"
        >
          <Icon d={ICONS.external} />
        </a>
        {onClose && <ToolButton onClick={onClose} label="Close" icon="close" />}
      </div>

      {/* ── Find bar ── */}
      {searchOpen && (
        <form onSubmit={submitFind} className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-white/[0.07] bg-[#1e1f22]/95">
          <div className="flex-1 min-w-0 flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2.5 h-9 focus-within:border-chartizer-yellow/60">
            <Icon d={ICONS.search} className="w-3.5 h-3.5 text-ink-muted flex-shrink-0" />
            <input
              value={findText}
              onChange={(e) => { setFindText(e.target.value); find(e.target.value); }}
              placeholder="Find in document…"
              enterKeyHint="search"
              className="flex-1 min-w-0 bg-transparent text-base sm:text-sm text-ink outline-none placeholder-ink-muted"
            />
            <span className="text-xs text-ink-muted tabular-nums whitespace-nowrap">
              {findText.trim() ? (matches.total ? `${matches.current} / ${matches.total}` : "0") : ""}
            </span>
          </div>
          <ToolButton onClick={() => find(findText, true, true)} label="Previous match" icon="up" disabled={!matches.total} />
          <ToolButton onClick={() => find(findText, true)} label="Next match" icon="down" disabled={!matches.total} />
        </form>
      )}

      {/* ── Pages ── */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          className="pdf-scroll absolute inset-0 overflow-auto"
          style={{ touchAction: "pan-x pan-y", WebkitOverflowScrolling: "touch" }}
        >
          <div className="pdfViewer" />
        </div>

        {status !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-dim text-sm pointer-events-none">
            {status === "loading" ? (
              <>
                <div className="w-40 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-chartizer-yellow transition-[width] duration-200"
                    style={{ width: `${Math.max(8, progress * 100)}%` }}
                  />
                </div>
                <span>Loading document…</span>
              </>
            ) : (
              <span className="pointer-events-auto">
                Couldn’t load this PDF.{" "}
                <a href={url} target="_blank" rel="noreferrer" className="text-chartizer-yellow underline">Open it directly</a>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
