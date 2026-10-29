import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import createMafiaChart, { dominantField, profileUrl } from "../components/MafiaChart";
import { solidColor } from "../components/Chart";
import YearRangeSlider, { YEAR_MIN, YEAR_MAX } from "../components/DualSlider";
import PdfModal from "../components/PdfModal";
import ChartToolbar, {
    ToolbarButton, FiltersIcon, ModeSwitch, useMediaQuery, useSidePanel,
} from "../components/ChartToolbar";

const API = process.env.REACT_APP_SERVER_URL;

const AUTHORS_MIN = 25;
const AUTHORS_MAX = 1000;
const AUTHORS_STEP = 25;
const EXPAND_COUNT = 12;   // connections an expansion brings in
const MIN_WEIGHTS = [1, 2, 3, 5, 10];
// Fields with fewer papers than this are left out of the blind spots: two tiny fields
// not citing each other says nothing.
const BLIND_SPOT_MIN_PAPERS = 40;
const NARROW = "(max-width: 699px)";

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const colorOf = (cat) => solidColor(cat?.color ?? "#5f6368");

// ── Filter state ⇄ URL (so a search can link straight to its author map) ──────

function readFilters(params) {
    const int = (k, d) => {
        const v = parseInt(params.get(k) ?? "", 10);
        return Number.isFinite(v) ? v : d;
    };
    return {
        q: params.get("q") ?? "",
        around: params.get("around") !== "0",
        fields: new Set((params.get("fields") ?? "").split(",").filter(Boolean).map(Number)),
        from: int("from", YEAR_MIN),
        to: int("to", YEAR_MAX),
        full: params.get("full") === "1",
        n: int("n", window.matchMedia(NARROW).matches ? 100 : 250),
        min: int("min", 3),
        cites: params.get("cites") !== "0",
        coauthors: params.get("coauthors") !== "0",
        cross: params.get("cross") === "1",
        lonely: params.get("lonely") === "1",
    };
}

function writeFilters(f) {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.q && !f.around) p.set("around", "0");
    if (f.fields.size) p.set("fields", [...f.fields].join(","));
    if (f.from > YEAR_MIN) p.set("from", f.from);
    if (f.to < YEAR_MAX) p.set("to", f.to);
    if (f.full) p.set("full", "1");
    p.set("n", f.n);
    p.set("min", f.min);
    if (!f.cites) p.set("cites", "0");
    if (!f.coauthors) p.set("coauthors", "0");
    if (f.cross) p.set("cross", "1");
    if (f.lonely) p.set("lonely", "1");
    return p;
}

// The server-side part of the filters, as /mafia query parameters.
function networkParams(f) {
    const p = new URLSearchParams({ limit: f.n, min_weight: f.min });
    if (f.fields.size) p.set("categories", [...f.fields].sort().join(","));
    if (f.from > YEAR_MIN) p.set("year_from", f.from);
    if (f.to < YEAR_MAX) p.set("year_to", f.to);
    if (f.q) { p.set("q", f.q); if (f.around) p.set("expand", "1"); }
    if (f.full) p.set("full_only", "1");
    // "hide unconnected": the server then picks authors who link to someone on the map
    if (f.lonely) p.set("linked_only", "0");
    return p;
}

// Adds an expansion's authors and links to the network on screen.
function mergeExpansion(net, add) {
    const known = new Set(net.authors.map((a) => a.id));
    const authors = [
        ...net.authors.map((a) => (add.more[a.id] != null ? { ...a, more: add.more[a.id] } : a)),
        ...add.authors.filter((a) => !known.has(a.id)),
    ];
    const key = (l) => `${l.type}|${l.from}|${l.to}`;
    const seen = new Set(net.links.map(key));
    const links = [...net.links, ...add.links.filter((l) => !seen.has(key(l)))];
    return {
        ...net,
        authors,
        links,
        stats: {
            ...net.stats,
            authors_shown: authors.length,
            cite_links: links.filter((l) => l.type === "cite").length,
            coauthor_links: links.filter((l) => l.type === "coauthor").length,
        },
    };
}

// ── Small controls ───────────────────────────────────────────────────────────

function Section({ title, action, children }) {
    return (
        <section className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] uppercase tracking-[0.1em] font-semibold text-theme-muted">{title}</h3>
                {action}
            </div>
            {children}
        </section>
    );
}

function Segmented({ options, value, onChange, format = String }) {
    return (
        <div className="flex p-0.5 rounded-lg bg-theme-bg border border-theme-border">
            {options.map((o) => (
                <button
                    key={String(o)}
                    type="button"
                    onClick={() => onChange(o)}
                    className={`flex-1 h-8 [@media(pointer:coarse)]:h-10 px-2 rounded-md text-xs font-semibold transition-colors
                        ${value === o ? "bg-chartizer-yellow text-theme-bg" : "text-theme-muted hover:text-theme-text-primary"}`}
                >
                    {format(o)}
                </button>
            ))}
        </div>
    );
}

// How many authors to show. It follows the thumb while dragging and only reloads the
// map when it is let go (or on each arrow key press).
function AuthorCountSlider({ value, onChange }) {
    const [local, setLocal] = useState(value);
    useEffect(() => setLocal(value), [value]);
    const commit = () => { if (local !== value) onChange(local); };
    // also commit shortly after the last change: Safari on iPad doesn't always send a
    // pointerup to a range input
    useEffect(() => {
        if (local === value) return undefined;
        const t = setTimeout(() => onChange(local), 450);
        return () => clearTimeout(t);
    }, [local, value, onChange]);
    const pct = ((local - AUTHORS_MIN) / (AUTHORS_MAX - AUTHORS_MIN)) * 100;
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold text-theme-text-primary tabular-nums leading-none">{local}</span>
                <span className="text-[11px] text-theme-muted">authors</span>
            </div>
            <input
                type="range"
                min={AUTHORS_MIN}
                max={AUTHORS_MAX}
                step={AUTHORS_STEP}
                value={local}
                aria-label="Authors shown"
                onChange={(e) => setLocal(Number(e.target.value))}
                onPointerUp={commit}
                onKeyUp={commit}
                onBlur={commit}
                className="touch-range w-full h-2 rounded-full cursor-pointer"
                style={{ background: `linear-gradient(90deg, rgb(222,161,28) ${pct}%, rgba(255,255,255,0.12) ${pct}%)` }}
            />
            <div className="flex justify-between text-[10px] text-theme-muted tabular-nums">
                {[AUTHORS_MIN, 250, 500, 750, AUTHORS_MAX].map((t) => <span key={t}>{t}</span>)}
            </div>
        </div>
    );
}

function Switch({ on, onChange, swatch, label, hint }) {
    return (
        <button type="button" onClick={() => onChange(!on)} aria-pressed={on}
            className="flex items-center gap-3 py-1 [@media(pointer:coarse)]:py-2.5 text-left group">
            <span className="w-6 flex justify-center flex-none">{swatch}</span>
            <span className="flex-1 min-w-0">
                <span className={`block text-sm ${on ? "text-theme-text-primary" : "text-theme-muted"}`}>{label}</span>
                {hint && <span className="block text-[11px] text-theme-muted leading-snug">{hint}</span>}
            </span>
            <span className={`w-8 h-[18px] rounded-full flex-none relative transition-colors ${on ? "bg-chartizer-yellow" : "bg-theme-border"}`}>
                <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${on ? "left-[16px]" : "left-[2px]"}`} />
            </span>
        </button>
    );
}

// Each field is a row: colour (also the map's legend), paper count, on/off; "only"
// keeps just that one.
function FieldList({ categories, counts, selected, onChange }) {
    const rows = [...counts.entries()]
        .filter(([id, n]) => id !== 0 && n > 0)
        .sort((a, b) => b[1] - a[1]);
    const all = selected.size === 0;
    const isOn = (id) => all || selected.has(id);
    const toggle = (id) => {
        const next = new Set(all ? rows.map(([r]) => r) : selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onChange(next.size === rows.length ? new Set() : next);
    };
    const max = Math.max(1, ...rows.map(([, n]) => n));

    return (
        <div className="flex flex-col -mx-2">
            {rows.map(([id, n]) => {
                const cat = categories.get(id);
                const on = isOn(id);
                return (
                    <div key={id} className={`group flex items-center gap-2.5 px-2 h-8 [@media(pointer:coarse)]:h-11 rounded-lg hover:bg-theme-hover ${on ? "" : "opacity-40"}`}>
                        <button type="button" onClick={() => toggle(id)} className="flex-1 min-w-0 flex items-center gap-2.5 h-full text-left">
                            <span className="w-3 h-3 rounded-full flex-none" style={{ background: colorOf(cat) }} />
                            <span className="flex-1 min-w-0 truncate text-[13px] text-theme-text-primary">{cap(cat?.name ?? "unknown")}</span>
                            <span className="w-10 h-1 rounded-full bg-theme-border overflow-hidden flex-none">
                                <span className="block h-full rounded-full" style={{ width: `${(100 * n) / max}%`, background: colorOf(cat) }} />
                            </span>
                            <span className="w-9 text-right text-[11px] tabular-nums text-theme-muted">{n}</span>
                        </button>
                        <button type="button" onClick={() => onChange(new Set([id]))}
                            className="text-[11px] font-semibold text-chartizer-yellow opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 px-1">
                            only
                        </button>
                    </div>
                );
            })}
            <div className="flex items-center gap-2.5 px-2 h-8">
                <span className="w-3 h-3 rounded-full flex-none bg-[#eef0f2] ring-2 ring-[#8ab4f8] ring-offset-1 ring-offset-theme-bg-secondary" />
                <span className="text-[13px] text-theme-muted">Several fields (ring: main one)</span>
            </div>
            <div className="flex items-center gap-2.5 px-2 h-8">
                <span className="w-3 flex-none text-center text-theme-muted font-bold leading-none"><span className="text-[9px]">A</span><span className="text-[13px]">A</span></span>
                <span className="text-[13px] text-theme-muted">Name size: citation rank on the map</span>
            </div>
        </div>
    );
}

// Pairs of sizeable fields with no citation either way between their papers.
function blindSpots(matrix) {
    if (!matrix) return [];
    const rows = matrix.category_ids
        .map((id, i) => ({ id, i, papers: matrix.papers[i] }))
        .filter((r) => r.id !== 0 && r.papers >= BLIND_SPOT_MIN_PAPERS)
        .sort((a, b) => b.papers - a.papers);
    const out = [];
    for (let a = 0; a < rows.length; a++) {
        for (let b = a + 1; b < rows.length; b++) {
            const x = rows[a];
            const y = rows[b];
            if (!matrix.counts[x.i][y.i] && !matrix.counts[y.i][x.i]) out.push([x, y]);
        }
    }
    return out;
}

// ── Author panel ─────────────────────────────────────────────────────────────

function AuthorPanel({ author, network, categories, onPick, onOpenPdf, onClose, onExpand, expanding }) {
    const [papers, setPapers] = useState(null);

    useEffect(() => {
        let live = true;
        setPapers(null);
        fetch(`${API}/mafia/author/${encodeURIComponent(author.id)}`)
            .then((r) => r.json())
            .then((d) => { if (live) setPapers(d.papers ?? []); })
            .catch(() => { if (live) setPapers([]); });
        return () => { live = false; };
    }, [author.id]);

    const byId = useMemo(() => new Map(network.authors.map((a) => [a.id, a])), [network]);
    const top = (pick, other) => network.links
        .filter(pick)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 6)
        .map((l) => ({ a: byId.get(other(l)), w: l.weight }))
        .filter((r) => r.a);
    const cites = top((l) => l.type === "cite" && l.from === author.id, (l) => l.to);
    const citedBy = top((l) => l.type === "cite" && l.to === author.id, (l) => l.from);
    const coauthors = top((l) => l.type === "coauthor" && (l.from === author.id || l.to === author.id),
        (l) => (l.from === author.id ? l.to : l.from));

    // their whole career, from OpenAlex (null while loading, false if there is none)
    const [profile, setProfile] = useState(null);
    useEffect(() => {
        let live = true;
        setProfile(null);
        fetch(`${API}/mafia/profile/${encodeURIComponent(author.id)}`)
            .then((r) => (r.ok ? r.json() : false))
            .then((d) => { if (live) setProfile(d); })
            .catch(() => { if (live) setProfile(false); });
        return () => { live = false; };
    }, [author.id]);

    const catOf = (id) => categories.get(Number(id));
    const dom = dominantField(author);
    const fmt = (v) => (v == null ? "—" : v.toLocaleString());
    const scholarUrl = `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(author.name)}`;

    const people = (title, rows, unit) => rows.length > 0 && (
        <Section title={title}>
            <div className="flex flex-col -my-1">
                {rows.map(({ a, w }) => (
                    <button key={a.id} type="button" onClick={() => onPick(a.id)}
                        className="flex items-center gap-2.5 py-1.5 [@media(pointer:coarse)]:py-3 text-left text-sm text-theme-text-primary hover:text-chartizer-yellow">
                        <span className="w-2.5 h-2.5 rounded-full flex-none"
                            style={{ background: a.multi ? "#eef0f2" : colorOf(catOf(dominantField(a))) }} />
                        <span className="truncate flex-1">{a.name}</span>
                        <span className="text-xs text-theme-muted tabular-nums">{w}× {unit}</span>
                    </button>
                ))}
            </div>
        </Section>
    );

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold text-theme-text-primary leading-tight">{author.name}</h2>
                    <p className="text-xs text-theme-muted mt-1">
                        {author.papers} paper{author.papers === 1 ? "" : "s"} in the library
                        {dom != null && ` · mostly ${catOf(dom)?.name ?? "unknown"}`}
                    </p>
                </div>
                <button type="button" onClick={onClose} aria-label="Close"
                    className="w-9 h-9 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11 -mr-2 -mt-1 flex items-center justify-center rounded-lg text-theme-muted hover:text-theme-text-primary hover:bg-theme-hover text-xl">×</button>
            </div>

            <div className="flex flex-wrap gap-1.5">
                {Object.entries(author.fields ?? {}).map(([id, n]) => (
                    <span key={id} className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-theme-bg text-xs text-theme-text-primary border border-theme-border">
                        <span className="w-2 h-2 rounded-full" style={{ background: colorOf(catOf(id)) }} />
                        {cap(Number(id) === 0 ? "uncategorised" : catOf(id)?.name ?? "unknown")} · {n}
                    </span>
                ))}
            </div>

            <Section title="Career · OpenAlex"
                action={<span className="flex gap-3 text-[11px] font-semibold">
                    <a href={profileUrl(author)} target="_blank" rel="noreferrer" className="text-chartizer-yellow hover:underline">Profile ↗</a>
                    {profile?.orcid && <a href={profile.orcid} target="_blank" rel="noreferrer" className="text-chartizer-yellow hover:underline">ORCID ↗</a>}
                    <a href={scholarUrl} target="_blank" rel="noreferrer" className="text-chartizer-yellow hover:underline">Scholar ↗</a>
                </span>}>
                {profile === null && <div className="h-[58px] rounded-xl bg-theme-bg animate-pulse" />}
                {profile === false && <p className="text-xs text-theme-muted">No OpenAlex profile for this name.</p>}
                {profile && (
                    <>
                        <div className="grid grid-cols-4 gap-2 text-center">
                            {[["Works", profile.works], ["Citations", profile.citations], ["h-index", profile.h_index], ["i10-index", profile.i10_index]].map(([k, v]) => (
                                <div key={k} className="rounded-xl bg-theme-bg border border-theme-border py-2.5">
                                    <div className="text-base font-semibold text-theme-text-primary tabular-nums">{fmt(v)}</div>
                                    <div className="text-[10.5px] text-theme-muted">{k}</div>
                                </div>
                            ))}
                        </div>
                        {profile.institutions.length > 0 && (
                            <p className="text-xs text-theme-muted leading-snug">
                                {profile.institutions.map((i) => `${i.name}${i.country ? ` (${i.country})` : ""}`).join(" · ")}
                            </p>
                        )}
                        {profile.topics.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {profile.topics.map((t) => (
                                    <span key={t} className="h-6 px-2.5 rounded-full bg-theme-bg border border-theme-border text-[11px] text-theme-text-primary inline-flex items-center">{t}</span>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </Section>

            <Section title="In our library">
                <div className="grid grid-cols-3 gap-2 text-center">
                    {[["Cites others", author.cites_out], ["Cited by others", author.cited_in], ["Co-authorships", author.coauthored]].map(([k, v]) => (
                        <div key={k} className="rounded-xl bg-theme-bg border border-theme-border py-2.5">
                            <div className="text-base font-semibold text-theme-text-primary tabular-nums">{v}</div>
                            <div className="text-[10.5px] text-theme-muted">{k}</div>
                        </div>
                    ))}
                </div>
            </Section>

            {author.more > 0 && (
                <button type="button" onClick={() => onExpand(author.id)} disabled={expanding}
                    className="h-10 rounded-xl bg-chartizer-yellow text-theme-bg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
                    {expanding
                        ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-theme-bg border-t-transparent animate-spin" /> Bringing them in…</>
                        : `Show ${Math.min(author.more, EXPAND_COUNT)} more connections · ${author.more} hidden`}
                </button>
            )}

            {people("Cites most", cites, "cites")}
            {people("Cited most by", citedBy, "cites")}
            {people("Co-authors", coauthors, "papers")}

            <Section title={`Papers${papers ? ` · ${papers.length}` : ""}`}>
                {papers == null && <div className="h-16 rounded-xl bg-theme-bg animate-pulse" />}
                <div className="flex flex-col divide-y divide-theme-border -my-2">
                    {(papers ?? []).map((p) => (
                        <div key={p.id} className="py-2.5 flex items-start gap-2.5">
                            <span className="mt-1.5 w-2 h-2 rounded-full flex-none" style={{ background: colorOf(catOf(p.category_id)) }} />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-theme-text-primary leading-snug">{p.title}</div>
                                <div className="text-xs text-theme-muted mt-0.5">{p.year ?? "—"} · cited by {p.cited_by_count}</div>
                            </div>
                            {!p.stub && p.file ? (
                                <button type="button" onClick={() => onOpenPdf(p)}
                                    className="flex-none h-8 px-3 rounded-lg bg-chartizer-yellow text-theme-bg text-xs font-semibold">PDF</button>
                            ) : (
                                <a href={`https://openalex.org/${p.id}`} target="_blank" rel="noreferrer"
                                    className="flex-none h-8 px-2.5 rounded-lg bg-theme-bg border border-theme-border text-theme-muted text-xs font-medium flex items-center">OpenAlex</a>
                            )}
                        </div>
                    ))}
                </div>
            </Section>
        </div>
    );
}

// ── Find an author on the map ────────────────────────────────────────────────

function AuthorFinder({ authors, categories, onPick }) {
    const [text, setText] = useState("");
    const [open, setOpen] = useState(false);
    const matches = useMemo(() => {
        const t = text.trim().toLowerCase();
        if (!t) return [];
        return authors.filter((a) => a.name.toLowerCase().includes(t)).slice(0, 8);
    }, [text, authors]);

    return (
        <div className="relative">
            <input
                value={text}
                onChange={(e) => { setText(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { onPick(matches[0].id); setText(""); setOpen(false); } }}
                placeholder="Find an author on the map…"
                className="w-full h-9 [@media(pointer:coarse)]:h-11 px-3 rounded-lg bg-theme-bg border border-theme-border text-base sm:text-sm text-theme-text-primary placeholder-theme-muted outline-none focus:border-chartizer-yellow"
            />
            {open && text.trim() && (
                <div className="absolute z-30 top-full mt-1 left-0 right-0 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-2xl p-1">
                    {matches.length === 0 && <div className="px-3 py-2 text-xs text-theme-muted">Not among the authors shown</div>}
                    {matches.map((a) => (
                        <button key={a.id} type="button" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { onPick(a.id); setText(""); setOpen(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 [@media(pointer:coarse)]:py-3 rounded-md text-left text-sm text-theme-text-primary hover:bg-theme-hover">
                            <span className="w-2.5 h-2.5 rounded-full flex-none"
                                style={{ background: a.multi ? "#eef0f2" : colorOf(categories.get(dominantField(a))) }} />
                            <span className="truncate flex-1">{a.name}</span>
                            <span className="text-xs text-theme-muted">{a.papers} papers</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MafiaPage() {
    const [params, setParams] = useSearchParams();
    const filters = useMemo(() => readFilters(params), [params]);
    const setFilter = useCallback((patch) => {
        setParams(writeFilters({ ...readFilters(params), ...patch }), { replace: true });
    }, [params, setParams]);

    const [network, setNetwork] = useState(null);
    const [loading, setLoading] = useState(true);
    const [slow, setSlow] = useState(false);
    const [error, setError] = useState(null);
    const [allCategories, setAllCategories] = useState([]);
    const [queryText, setQueryText] = useState(filters.q);
    useEffect(() => setQueryText(filters.q), [filters.q]);
    // paper counts per field for the current scope, kept while some fields are switched
    // off so the switched-off rows still show theirs
    const [fieldCounts, setFieldCounts] = useState(new Map());

    const [selectedId, setSelectedId] = useState(null);
    const [sheet, setSheet] = useState(null);   // phones: "filters" | "author" | null
    const wide = useMediaQuery("(min-width: 768px)");
    // shared with the Search page's results panel: switching modes keeps it as it was
    const [sidebarOpen, setSidebarOpen] = useSidePanel();
    // Under ~1100px (iPad portrait) the filters and an author's panel don't both fit
    // beside the graph: while an author is open, the filters step aside.
    const roomy = useMediaQuery("(min-width: 1100px)");

    const [modal, setModal] = useState(null);
    const [modalStage, setModalStage] = useState("closed");

    const chartBox = useRef(null);
    const chart = useRef(null);

    const categories = useMemo(
        () => new Map((network?.categories ?? allCategories).map((c) => [c.id, c])),
        [network, allCategories],
    );

    useEffect(() => {
        fetch(`${API}/get-all-categories`).then((r) => r.json()).then(setAllCategories).catch(() => {});
    }, []);

    // ── fetch the network whenever a server-side filter changes ──
    const { q, around, fields, from, to, full, n, min, lonely } = filters;
    const fieldsKey = [...fields].sort().join(",");
    // authors brought in by expanding stay on the map when the filters change
    const included = useRef(new Set());
    const filtersRef = useRef(filters);
    filtersRef.current = filters;
    useEffect(() => {
        let live = true;
        const p = networkParams(filtersRef.current);
        setLoading(true);
        setError(null);
        // the very first build fetches every author from OpenAlex (about a minute)
        const slowTimer = setTimeout(() => live && setSlow(true), 4000);
        const t = setTimeout(() => {
            fetch(`${API}/mafia?${p}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ include: [...included.current] }),
            })
                .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
                .then((d) => {
                    if (!live) return;
                    setNetwork(d);
                    if (!fieldsKey) {
                        const m = d.field_matrix;
                        setFieldCounts(new Map(m.category_ids.map((id, i) => [id, m.papers[i]])));
                    }
                })
                .catch((e) => { if (live) setError(e.message); })
                .finally(() => { clearTimeout(slowTimer); if (live) { setLoading(false); setSlow(false); } });
        }, 250);
        return () => { live = false; clearTimeout(t); clearTimeout(slowTimer); };
    }, [q, around, fieldsKey, from, to, full, n, min, lonely]);

    // ── expanding: an author's strongest hidden connections join the map ──
    const [expanding, setExpanding] = useState(new Set());
    const networkRef = useRef(null);
    networkRef.current = network;
    const anchorRef = useRef(null);
    const inFlight = useRef(new Set());
    const expandAuthor = useCallback(async (id) => {
        const net = networkRef.current;
        // a double-click is two clicks: expand once
        if (!net || inFlight.current.has(id)) return;
        inFlight.current.add(id);
        setExpanding((s) => new Set(s).add(id));
        try {
            const p = networkParams(filtersRef.current);
            p.set("count", EXPAND_COUNT);
            // open at the strength the map was drawn at (the server may have relaxed it)
            if (net.min_weight != null) p.set("min_weight", net.min_weight);
            const resp = await fetch(`${API}/mafia/expand/${encodeURIComponent(id)}?${p}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ shown: net.authors.map((a) => a.id) }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const add = await resp.json();
            for (const a of add.authors) included.current.add(a.id);
            included.current.add(id);
            anchorRef.current = id;
            setNetwork((cur) => (cur ? mergeExpansion(cur, add) : cur));
        } catch (e) {
            console.error("[mafia] expand failed", e);
        } finally {
            inFlight.current.delete(id);
            setExpanding((s) => { const next = new Set(s); next.delete(id); return next; });
        }
    }, []);
    const expandRef = useRef(expandAuthor);
    expandRef.current = expandAuthor;

    // ── chart lifecycle ──
    const onSelect = useCallback((id) => {
        setSelectedId(id);
        setSheet(id ? "author" : null);
    }, []);

    useEffect(() => {
        chart.current = createMafiaChart(chartBox.current, {
            onSelect,
            onExpand: (id) => expandRef.current(id),
            onOpenProfile: (a) => window.open(profileUrl(a), "_blank", "noopener"),
            legend: false,
        });
        return () => { chart.current?.remove(); chart.current = null; };
    }, [onSelect]);

    useEffect(() => {
        if (!network) return;
        const anchor = anchorRef.current;
        anchorRef.current = null;
        chart.current?.setData(network, {
            cites: filters.cites, coauthors: filters.coauthors, crossField: filters.cross, hideLonely: !filters.lonely, anchor,
        });
    }, [network, filters.cites, filters.coauthors, filters.cross, filters.lonely]);

    const selected = network?.authors.find((a) => a.id === selectedId) ?? null;
    useEffect(() => {
        if (selectedId && network && !selected) setSelectedId(null);
    }, [network, selected, selectedId]);

    const pickAuthor = (id) => {
        chart.current?.select(id);
        chart.current?.focus(id);
        setSelectedId(id);
        setSheet("author");
    };
    const closeAuthor = () => {
        chart.current?.select(null);
        setSelectedId(null);
        setSheet(null);
    };

    const filtersVisible = sidebarOpen && (roomy || !selected);
    const toggleFilters = () => {
        if (!wide) { setSheet(sheet === "filters" ? null : "filters"); return; }
        // narrow iPad with an author open: Filters brings the filters back
        if (!roomy && selected) { closeAuthor(); setSidebarOpen(true); return; }
        setSidebarOpen((o) => !o);
    };

    const openPdf = (p) => {
        setModal({
            pdfUrl: `${API}/pdf-file/${encodeURIComponent(p.file)}`,
            previewUrl: null,
            documentId: p.id,
            searchQuery: q,
            category: categories.get(p.category_id) ?? null,
            rect: { top: window.innerHeight / 2 - 1, left: window.innerWidth / 2 - 1, width: 1, height: 1 },
        });
        setModalStage("expanding");
        setTimeout(() => setModalStage("open"), 30);
    };
    const closeModal = () => {
        setModalStage("closing");
        setTimeout(() => { setModal(null); setModalStage("closed"); }, 300);
    };

    // the Papers mode for the same topic, years and (first) field
    const papersUrl = (() => {
        if (!q) return "/search";
        const p = new URLSearchParams({ q, docs: 20 });
        if (fields.size) p.set("category_id", [...fields][0]);
        if (from > YEAR_MIN) p.set("date_start", from);
        if (to < YEAR_MAX) p.set("date_end", to);
        return `/search?${p}`;
    })();

    const submitQuery = () => {
        // a new topic is a new map: forget what was expanded into the old one
        if (queryText.trim() !== q) included.current = new Set();
        setFilter({ q: queryText.trim() });
    };
    const changeQueryText = (v) => {
        setQueryText(v);
        // clearing the box (×) clears the topic too
        if (!v && q) { included.current = new Set(); setFilter({ q: "" }); }
    };

    const stats = network?.stats;
    const spots = useMemo(() => blindSpots(network?.field_matrix), [network]);
    const activeCount = [fields.size > 0, from > YEAR_MIN || to < YEAR_MAX, full, !filters.cites || !filters.coauthors || filters.cross || filters.lonely, min !== 3]
        .filter(Boolean).length;

    const filterPanel = (
        <div className="flex flex-col gap-6">
            <Section title="Find">
                <AuthorFinder authors={network?.authors ?? []} categories={categories} onPick={pickAuthor} />
            </Section>

            <Section title="Published">
                <YearRangeSlider start={from} end={to} onChange={(s, e) => setFilter({ from: s, to: e })} />
            </Section>

            <Section title="Links">
                <div className="flex flex-col gap-1">
                    <Switch on={filters.cites} onChange={(v) => setFilter({ cites: v })} label="Citations"
                        swatch={<svg width="22" height="10" viewBox="0 0 22 10"><line x1="1" y1="5" x2="16" y2="5" stroke="rgba(232,234,237,0.85)" strokeWidth="1.6" /><path d="M15 1.5 L21 5 L15 8.5 Z" fill="rgba(232,234,237,0.85)" /></svg>} />
                    <Switch on={filters.coauthors} onChange={(v) => setFilter({ coauthors: v })} label="Co-authors"
                        swatch={<span className="w-5 h-[3px] rounded-full bg-[rgb(45,212,191)]" />} />
                    <Switch on={filters.cross} onChange={(v) => setFilter({ cross: v })} label="Between fields only"
                        hint="Hide links inside a field: shows who bridges fields"
                        swatch={<span className="flex gap-0.5"><span className="w-2 h-2 rounded-full bg-[rgb(139,92,246)]" /><span className="w-2 h-2 rounded-full bg-[rgb(34,197,94)]" /></span>} />
                    <Switch on={!filters.lonely} onChange={(v) => setFilter({ lonely: !v })} label="Hide unconnected authors"
                        hint="Off: the top cited authors also when they link to no one here"
                        swatch={<span className="w-3 h-3 rounded-full border border-dashed border-theme-muted" />} />
                </div>
                <span className="text-[11px] text-theme-muted leading-snug -mt-1">Link width = how many times they cite each other / papers together.</span>
                <div className="flex flex-col gap-1.5 mt-1">
                    <span className="text-xs text-theme-muted">At least this many cites / joint papers</span>
                    <Segmented options={MIN_WEIGHTS} value={min} onChange={(v) => setFilter({ min: v })} format={(w) => `${w}×`} />
                </div>
            </Section>

            <Section title="Papers">
                <Segmented options={[false, true]} value={full} onChange={(v) => setFilter({ full: v })}
                    format={(v) => (v ? "Only with PDF" : "All papers")} />
            </Section>

            <Section title="Authors shown">
                <AuthorCountSlider value={n} onChange={(v) => setFilter({ n: v })} />
                <span className="text-[11px] text-theme-muted leading-snug">The most cited scientists (career citations) in this selection. With “Hide unconnected” on, only ones linked to someone else on the map.</span>
            </Section>

            <Section
                title="Fields"
                action={fields.size > 0 && (
                    <button type="button" onClick={() => setFilter({ fields: new Set() })}
                        className="text-[11px] font-semibold text-chartizer-yellow">Show all</button>
                )}
            >
                <FieldList categories={categories} counts={fieldCounts} selected={fields}
                    onChange={(s) => setFilter({ fields: s })} />
            </Section>

            {spots.length > 0 && (
                <Section title="Blind spots">
                    <span className="text-[11px] text-theme-muted leading-snug -mt-1">
                        Fields with {BLIND_SPOT_MIN_PAPERS}+ papers here that never cite each other.
                    </span>
                    <div className="flex flex-col gap-1.5">
                        {spots.slice(0, 8).map(([x, y]) => (
                            <button key={`${x.id}-${y.id}`} type="button" onClick={() => setFilter({ fields: new Set([x.id, y.id]) })}
                                className="flex items-center gap-2 text-[13px] text-left text-theme-text-primary hover:text-chartizer-yellow">
                                <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: colorOf(categories.get(x.id)) }} />
                                <span className="truncate">{cap(categories.get(x.id)?.name)}</span>
                                <span className="text-theme-muted">↮</span>
                                <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: colorOf(categories.get(y.id)) }} />
                                <span className="truncate">{cap(categories.get(y.id)?.name)}</span>
                            </button>
                        ))}
                    </div>
                </Section>
            )}
        </div>
    );

    const authorPanel = selected && (
        <AuthorPanel author={selected} network={network} categories={categories}
            onPick={pickAuthor} onOpenPdf={openPdf} onClose={closeAuthor}
            onExpand={expandAuthor} expanding={expanding.has(selected.id)} />
    );

    return (
        <main className="h-full flex flex-col bg-theme-bg">
            {/* ── top bar: topic search + what's on the map ── */}
            <div className="flex-shrink-0 border-b border-theme-border px-3 sm:px-5 py-2.5">
                <ChartToolbar
                    value={queryText}
                    onChange={changeQueryText}
                    onSubmit={submitQuery}
                    placeholder="Who works on… (a topic, e.g. vaccine adjuvant)"
                    left={
                        <>
                            <ToolbarButton
                                active={wide ? filtersVisible : sheet === "filters"}
                                dot={activeCount > 0}
                                onClick={toggleFilters}
                                className="md:w-28 justify-center"
                            >
                                <FiltersIcon />
                                Filters
                            </ToolbarButton>
                            <ModeSwitch mode="mafia" papersHref={papersUrl} mafiaHref={`/mafia?${params}`} />
                        </>
                    }
                    right={
                        <>
                            {q && wide && (
                                <div className="flex-none w-56 [&>div]:h-10 [&_button]:h-full [&_button]:whitespace-nowrap">
                                    <Segmented options={[false, true]} value={around} onChange={(v) => setFilter({ around: v })}
                                        format={(v) => (v ? "Around topic" : "Exact")} />
                                </div>
                            )}
                            {wide && stats && (
                                <div className="text-right text-xs text-theme-muted leading-tight whitespace-nowrap">
                                    <div><b className="text-theme-text-primary font-semibold">{stats.authors_shown}</b> of {stats.authors_total.toLocaleString()} authors</div>
                                    {/* the server lowered the link strength to fill the map */}
                                    {network.min_weight < network.requested_min_weight && (
                                        <div className="text-chartizer-yellow">links ≥ {network.min_weight} to fill the map</div>
                                    )}
                                    {/* fewer than asked for: that's everyone with a link here */}
                                    {!lonely && stats.authors_shown < n && (
                                        <div className="text-chartizer-yellow">all connected ones here</div>
                                    )}
                                    <div>{stats.papers.toLocaleString()} papers · {(stats.cite_links + stats.coauthor_links).toLocaleString()} links</div>
                                </div>
                            )}
                        </>
                    }
                />
            </div>

            <div className="relative flex flex-1 min-h-0">
                {/* ── filters: slide over the graph, so opening / closing them never resizes it ── */}
                {wide && (
                    <aside
                        aria-hidden={!filtersVisible}
                        className={`glass absolute top-0 left-0 bottom-0 z-20 w-[300px] !border-y-0 !border-l-0 overflow-y-auto overscroll-contain px-5 py-5
                            transition-transform duration-300 ease-out ${filtersVisible ? "translate-x-0" : "-translate-x-full pointer-events-none"}`}
                    >
                        {filterPanel}
                    </aside>
                )}

                {/* ── graph ── */}
                <section className="relative flex-1 min-w-0 overflow-hidden">
                    <div ref={chartBox} className="graph-surface w-full h-full" />

                    {q && (
                        <div className={`absolute top-3 z-10 flex items-center gap-2 h-8 px-3 rounded-full transition-[left] duration-300
                            glass text-xs text-theme-muted
                            ${wide && filtersVisible ? "left-[312px] max-w-[calc(100%-324px)]" : "left-3 max-w-[calc(100%-24px)]"}`}>
                            <span className="truncate">Authors {around ? "around" : "of papers on"} <b className="text-theme-text-primary">“{q}”</b></span>
                        </div>
                    )}

                    {(loading || error) && (
                        <div className="glass absolute top-14 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full text-xs text-theme-muted flex items-center gap-2">
                            {error ? (
                                <span className="text-red-300">Couldn't load the network ({error})</span>
                            ) : (
                                <>
                                    <span className="w-3 h-3 rounded-full border-2 border-chartizer-yellow border-t-transparent animate-spin" />
                                    {slow && !network ? "Building the author network for the first time, about a minute…" : "Loading…"}
                                </>
                            )}
                        </div>
                    )}
                    {!loading && network && network.authors.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center text-sm text-theme-muted">No authors match these filters.</div>
                    )}

                    {!wide && selected && sheet !== "author" && (
                        <div className="absolute inset-x-0 z-10 flex justify-center pointer-events-none" style={{ bottom: "calc(16px + env(safe-area-inset-bottom))" }}>
                            <button type="button" onClick={() => setSheet("author")}
                                className="pointer-events-auto h-10 px-5 rounded-full text-sm font-semibold bg-chartizer-yellow text-theme-bg shadow-lg max-w-[70vw] truncate">{selected.name}</button>
                        </div>
                    )}
                </section>

                {/* ── author: slides over the graph, so the graph never resizes (and never jumps) ── */}
                {wide && (
                    <aside
                        aria-hidden={!authorPanel}
                        className={`glass absolute top-0 right-0 bottom-0 z-20 w-[380px] xl:w-[420px] !border-y-0 !border-r-0 overflow-y-auto overscroll-contain p-5
                            transition-transform duration-300 ease-out ${authorPanel ? "translate-x-0" : "translate-x-full pointer-events-none"}`}
                    >
                        {authorPanel}
                    </aside>
                )}

                {/* phones: filters and author slide up as a sheet (iPads get the side panels) */}
                {!wide && (
                    <div className={`absolute inset-x-0 bottom-0 z-20 transition-transform duration-300 ease-out ${sheet ? "translate-y-0" : "translate-y-[110%]"}`}>
                        <div className="glass mx-2 rounded-2xl max-h-[75dvh] flex flex-col relative"
                            style={{ marginBottom: "calc(8px + env(safe-area-inset-bottom))" }}>
                            <div className="flex justify-center pt-2"><span className="w-10 h-1 rounded-full bg-theme-border" /></div>
                            {sheet === "filters" && (
                                <button type="button" onClick={() => setSheet(null)} aria-label="Close"
                                    className="absolute right-3 top-2 w-9 h-9 flex items-center justify-center text-theme-muted text-xl">×</button>
                            )}
                            <div className="overflow-y-auto overscroll-contain p-4 pt-3">
                                {sheet === "filters" && (
                                    <div className="flex flex-col gap-6">
                                        {q && (
                                            <Section title="Topic">
                                                <Segmented options={[false, true]} value={around} onChange={(v) => setFilter({ around: v })}
                                                    format={(v) => (v ? "Around topic" : "Exact matches")} />
                                            </Section>
                                        )}
                                        {filterPanel}
                                    </div>
                                )}
                                {sheet === "author" && authorPanel}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <PdfModal modal={modal} modalStage={modalStage} onClose={closeModal} onCategoryChange={() => {}} />
        </main>
    );
}
