import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

// The bar above both graphs (Search and the author map): the search box in the middle,
// the page's own controls to its left and right. One component so the two look alike.
// Below xl (iPads, phones) it stacks: the search box on its own row, the controls in a
// row under it. From xl it is one row, the search box centred and the sides as wide as
// their controls need (so nothing overlaps on a 1194px iPad in landscape).

export function ToolbarButton({ active = false, dot = false, onClick, children, label, className = "", ...rest }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={`relative h-10 px-3 flex-none flex items-center gap-1.5 rounded-xl border text-sm font-medium whitespace-nowrap
                transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed ${className}
                ${active
                    ? "border-chartizer-yellow text-chartizer-yellow"
                    : "border-theme-border text-theme-muted hover:border-chartizer-yellow hover:text-theme-text-primary"}`}
            {...rest}
        >
            {children}
            {dot && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-chartizer-yellow" />}
        </button>
    );
}

export function useMediaQuery(query) {
    const [match, setMatch] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const mq = window.matchMedia(query);
        const onChange = () => setMatch(mq.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [query]);
    return match;
}

// Whether the side panel (results on Search, filters on the author map) is open. Shared
// by both pages, so switching modes keeps it as it was.
const PANEL_KEY = "brims.sidePanelOpen";
export function useSidePanel() {
    const [open, setOpen] = useState(() => {
        try { return localStorage.getItem(PANEL_KEY) !== "0"; } catch { return true; }
    });
    useEffect(() => {
        try { localStorage.setItem(PANEL_KEY, open ? "1" : "0"); } catch { /* private mode */ }
    }, [open]);
    return [open, setOpen];
}

// Phones show one view at a time: the results list, the paper graph or the author map.
export const PHONE = "(max-width: 767px)";

// Adds the phone view ("results" | "graph") to a /search link.
export function withView(href, view) {
    const [path, query = ""] = href.split("?");
    const p = new URLSearchParams(query);
    p.set("view", view);
    return `${path}?${p}`;
}

// The view switch. Sits at the same spot in both toolbars. md+: Papers | Mafia (the
// results and the graph share the screen there). Phones: Results | Graph | Mafia, every
// view one tap away. On Search, `onView` switches results / graph in place; on the
// author map they link back to Search.
export function ModeSwitch({ mode, papersHref, mafiaHref, view = "results", onView = null }) {
    const phone = useMediaQuery(PHONE);
    const cls = (on) => `h-full px-3.5 max-md:px-0 max-md:flex-1 justify-center rounded-[10px] flex items-center text-sm font-semibold transition-colors
        ${on ? "bg-chartizer-yellow text-theme-bg" : "text-theme-muted hover:text-theme-text-primary"}`;
    const link = (on, href, label) => (
        <Link key={label} to={href} aria-current={on ? "page" : undefined} className={cls(on)}>{label}</Link>
    );
    const paperView = (key, label) => {
        const on = mode === "papers" && view === key;
        return onView
            ? <button key={key} type="button" aria-pressed={on} onClick={() => onView(key)} className={cls(on)}>{label}</button>
            : link(on, withView(papersHref, key), label);
    };
    return (
        <div className="h-10 flex-none max-md:flex-1 flex p-0.5 rounded-xl border border-theme-border bg-theme-bg-secondary">
            {phone
                ? [paperView("results", "Results"), paperView("graph", "Graph"), link(mode === "mafia", mafiaHref, "Mafia")]
                : [link(mode === "papers", papersHref, "Papers"), link(mode === "mafia", mafiaHref, "Mafia")]}
        </div>
    );
}

// Phones: the grab bar on top of a bottom sheet (the results on Search, the author card
// on the author map). Tap toggles the sheet, a swipe up opens it, a swipe down closes
// it. With a label it is also the sheet's peek when closed ("12 results ⌃").
export const SHEET_PEEK_PX = 52;
export function SheetHandle({ open, onToggle, label = null }) {
    const startY = useRef(null);
    const onPointerDown = (e) => {
        startY.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onPointerUp = (e) => {
        if (startY.current == null) return;
        const dy = e.clientY - startY.current;
        startY.current = null;
        if (Math.abs(dy) < 12) onToggle(!open);
        else if (dy < 0 && !open) onToggle(true);
        else if (dy > 0 && open) onToggle(false);
    };
    return (
        <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Close" : "Open"}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { startY.current = null; }}
            // keyboard (pointer clicks are handled above)
            onClick={(e) => { if (e.detail === 0) onToggle(!open); }}
            style={{ height: SHEET_PEEK_PX }}
            className="w-full flex-none flex flex-col items-center justify-center gap-1.5 touch-none select-none"
        >
            <span className="w-10 h-1 rounded-full bg-white/30" />
            {label && (
                <span className="flex items-center gap-1.5 max-w-[85vw] text-sm font-semibold text-theme-text-primary">
                    <span className="truncate">{label}</span>
                    <svg className={`w-3.5 h-3.5 flex-none text-theme-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                        fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                </span>
            )}
        </button>
    );
}

export function PanelIcon() {
    return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
            <line x1="9.5" y1="4.5" x2="9.5" y2="19.5" />
        </svg>
    );
}

export function FiltersIcon() {
    return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <line x1="4" y1="6" x2="20" y2="6" strokeLinecap="round" />
            <line x1="4" y1="12" x2="20" y2="12" strokeLinecap="round" />
            <line x1="4" y1="18" x2="20" y2="18" strokeLinecap="round" />
            <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
            <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
            <circle cx="9" cy="18" r="2" fill="currentColor" stroke="none" />
        </svg>
    );
}

export default function ChartToolbar({ value, onChange, onSubmit, placeholder = "Search…", left = null, right = null }) {
    return (
        <div className="w-full flex flex-wrap items-center gap-2 xl:grid xl:grid-cols-[minmax(max-content,1fr)_minmax(0,40rem)_minmax(max-content,1fr)] xl:gap-4">
            <div className="order-2 xl:order-none max-md:flex-1 flex items-center gap-2 min-w-0">{left}</div>

            <form
                onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
                className="order-1 xl:order-none w-full flex items-center gap-2"
            >
                <div className="flex-1 min-w-0 h-10 flex items-center gap-2 px-3.5 rounded-xl bg-theme-bg-secondary border border-theme-border
                                focus-within:border-chartizer-yellow focus-within:ring-1 focus-within:ring-chartizer-yellow/30 transition-colors duration-200">
                    <svg className="w-4 h-4 text-theme-muted flex-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder}
                        enterKeyHint="search"
                        className="flex-1 min-w-0 bg-transparent text-base sm:text-sm text-theme-text-primary placeholder-theme-muted outline-none"
                    />
                    {value && (
                        <button type="button" onClick={() => onChange("")} aria-label="Clear"
                            className="-mr-2 w-9 h-9 flex-none flex items-center justify-center text-theme-muted hover:text-theme-text-primary transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>
                <button type="submit"
                    className="h-10 px-4 flex-none rounded-xl bg-chartizer-yellow text-theme-bg text-sm font-semibold hover:bg-chartizer-yellow/90 active:scale-95 transition-all duration-150">
                    Search
                </button>
            </form>

            <div className="order-3 xl:order-none ml-auto xl:ml-0 flex items-center justify-end gap-2 min-w-0">{right}</div>
        </div>
    );
}
