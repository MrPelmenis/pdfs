import { GraphRenderer } from "@chartizer/graph-renderer";

const SEARCH_ICON = "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Search_Icon.svg/500px-Search_Icon.svg.png?_=20181016161702";
const API = process.env.REACT_APP_SERVER_URL;

// ── Visual constants ─────────────────────────────────────────────────────────

const CHART_BG = "#1e1f22";
const NODE_FILL = "rgba(28,164,222,0.92)";
const QUERY_FILL = "#dea11c";
const QUERY_NODE_RADIUS = 20;

// Article pills. The renderer draws the pill; the title is drawn on the overlay canvas,
// wrapped by us, because the renderer clips text it wraps itself.
const PILL_FONT_FAMILY = "Poppins, sans-serif";
const PILL_FONT_SIZE = 13;
const PILL_LINE_HEIGHT = 17;
const PILL_TEXT_WIDTH = 220;     // world units; titles wrap to this
const PILL_PAD_X = 16;
const PILL_PAD_Y = 9;
const STUB_FONT_SIZE = 12;
const STUB_LINE_HEIGHT = 16;
const STUB_FILL = "#26272b";
// Articles not in our library are outlined pills; the outline says how they were found.
const STUB_REF_STROKE = "rgba(154,160,166,0.8)";
const STUB_REL_STROKE = "rgba(222,161,28,0.75)";
const STUB_TEXT = "rgba(232,234,237,0.85)";
const EXPANDED_STROKE = "rgba(255,255,255,0.95)";
const MIN_TEXT_PX = 3;           // below this on screen, titles are skipped

const LINK_LABEL_STYLE = {
    visible: true,
    fontFamily: PILL_FONT_FAMILY,
    fontSize: 9,
    backgroundColor: CHART_BG,
    paddingX: 4,
    paddingY: 1,
    cornerRadius: 3,
    mode: "badge",
};
const LINK_STYLES = {
    query: {
        color: "rgba(232,234,237,0.16)", width: 1, arrow: false, dashed: false, label: "search hit",
        labelStyle: { ...LINK_LABEL_STYLE, textColor: "rgba(232,234,237,0.45)" },
    },
    ref: {
        color: "rgba(138,180,248,0.45)", width: 1.2, arrow: true, dashed: false, label: "cites",
        labelStyle: { ...LINK_LABEL_STYLE, textColor: "rgba(138,180,248,0.95)" },
    },
    rel: {
        color: "rgba(246,174,45,0.4)", width: 1, arrow: false, dashed: true, label: "related work",
        labelStyle: { ...LINK_LABEL_STYLE, textColor: "rgba(246,174,45,0.95)" },
    },
};

// Nodes pop in (grow with an overshoot) and pop out (shrink away).
const POP_IN_MS = 420;
const POP_OUT_MS = 240;
const POP_STAGGER_MS = 35;       // first results pop in one after another
const POP_MIN_SCALE = 0.05;
const POP_START_MS = 30;          // the shrink to a dot lands before growing starts
// Expansion marker (the renderer's small patch of hairs). The patch has a fixed width and
// packs one hair per count into it, so the count is capped to keep the hairs spaced out.
const MARKER_MAX_HAIRS = 5;
const HAIR_COLOR = "rgba(189,193,198,0.9)";
const HAIR_LENGTH = 9;           // world units, like the pills
const HAIR_GAP = 3;              // between the pill edge and the hair
const HAIR_SPACING = 7;          // along the edge, between hairs
const LONG_PRESS_MS = 600;

const MAX_FIT_ZOOM = 1.1;
// On a phone the whole graph only fits at a zoom where titles can't be read, so the view
// starts on the search node at a readable zoom instead; the rest is a swipe away.
const NARROW_WIDTH = 700;
const NARROW_ZOOM = 0.7;
const FIT_DELAY_MS = 2600;
const FIT_GLIDE_MS = 900;
const GOLDEN_ANGLE = 2.399963229728653;
// NetChart navigation: show nodes within this many hops of the initial nodes.
const FOCUS_RADIUS = 8;

const REF_STYLE = { fillColor: "rgba(99,102,241,0.35)", radius: 2, toDecoration: "arrow" };
const REL_STYLE = { fillColor: "rgba(251,146,60,0.45)", radius: 1.5, toDecoration: "arrow", dashSize: 4 };

// Force layout that keeps settling (the default stops ~2 s after a change and for good
// after ~30 s, which leaves expanded nodes half-placed). Upserting nodes restarts it.
const LAYOUT = {
    enabled: true,
    maxActiveTicks: 1_000_000,
    minActiveTicks: 600,
    stableTickThreshold: 300,
    temperatureDecay: 0.998,
    chargeStrength: 60000,
    chargeMinDistance: 80,
};

function stripHtml(str) {
    if (!str) return str;
    const doc = new DOMParser().parseFromString(str, "text/html");
    return doc.body.textContent ?? "";
}

// The server wraps node fields as item.data.data; accept item.data as well so a
// slightly different payload shape doesn't silently lose titles/ids/edges.
function fieldsOf(item) {
    return item?.data?.data ?? item?.data ?? null;
}

function linkStyleOf(link) {
    return link?.style ?? link?.data?.style ?? {};
}

function isStub(d) {
    return !!(d?.is_stub_node || d?.stub_document);
}

// ── Colour helpers ───────────────────────────────────────────────────────────

function parseColor(str) {
    const s = String(str ?? "").trim();
    let m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) {
        const n = parseInt(m[1], 16);
        return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
    return null;
}

// Pills must be opaque or the links show through them: flatten the colour onto the background.
function solidColor(str) {
    const c = parseColor(str);
    const bg = parseColor(CHART_BG);
    if (!c) return str;
    const mix = (fg, back) => Math.round(fg * c.a + back * (1 - c.a));
    return `rgb(${mix(c.r, bg.r)},${mix(c.g, bg.g)},${mix(c.b, bg.b)})`;
}

function textColorOn(fill) {
    const c = parseColor(fill);
    if (!c) return "#111";
    const lin = (v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const lum = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    return lum > 0.22 ? "#111317" : "#f5f6f7";
}

// ── Pill layout ──────────────────────────────────────────────────────────────

let _measureCtx = null;
const _pillCache = new Map();

// Wraps the full title into lines and sizes the pill around them (world units).
function pillLayout(title, stub) {
    const key = `${stub ? 1 : 0}|${title}`;
    const cached = _pillCache.get(key);
    if (cached) return cached;

    _measureCtx ||= document.createElement("canvas").getContext("2d");
    const fontSize = stub ? STUB_FONT_SIZE : PILL_FONT_SIZE;
    const lineHeight = stub ? STUB_LINE_HEIGHT : PILL_LINE_HEIGHT;
    const weight = stub ? 400 : 500;
    _measureCtx.font = `${weight} ${fontSize}px ${PILL_FONT_FAMILY}`;
    const width = (t) => _measureCtx.measureText(t).width;

    const lines = [];
    let line = "";
    for (const word of title.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (line && width(next) > PILL_TEXT_WIDTH) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);

    const textWidth = Math.min(PILL_TEXT_WIDTH, Math.max(...lines.map(width)));
    const h = lines.length * lineHeight + 2 * PILL_PAD_Y;
    // A true pill: the ends are half circles. On a multi-line pill the top and bottom
    // lines would run into them, so the sides get as much room as the curve takes away
    // at the height of the text's top edge.
    const r = h / 2;
    const textTop = r - PILL_PAD_Y;
    const curveInset = r - Math.sqrt(Math.max(0, r * r - textTop * textTop));
    const padX = Math.max(PILL_PAD_X, curveInset + 8);
    const layout = {
        lines, fontSize, lineHeight, weight,
        w: Math.ceil(textWidth + 2 * padX),
        h,
        corner: r,
    };
    _pillCache.set(key, layout);
    return layout;
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ── Engine failure ───────────────────────────────────────────────────────────

// Errors that mean the WASM engine itself has faulted, as opposed to a bad call.
function isEngineFault(err) {
    return (typeof WebAssembly !== "undefined" && err instanceof WebAssembly.RuntimeError)
        || /memory access|unreachable|null pointer passed to rust|recursive use of an object/i.test(err?.message ?? "");
}

function adapterOf(r) {
    try { return r?.getCompatAdapter?.() ?? null; } catch { return null; }
}

function titleOf(d, id) {
    return (stripHtml(d?.title || id) || "").replace(/\s+/g, " ").trim();
}

// Same curves as the renderer's "ease-out-back" / "ease-in-back", so titles drawn on the
// overlay scale in step with their pill.
const BACK = 1.70158;
const easeOutBack = (t) => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2;
const easeInBack = (t) => (BACK + 1) * t ** 3 - BACK * t ** 2;

// ── Expansion hairs ──────────────────────────────────────────────────────────
//
// The renderer's own expansion marker sits where the engine puts it (no option to move
// it), so the hairs are drawn on the overlay instead: a small fan on the pill's edge,
// in the middle of the widest gap between the links leaving the pill — as far as
// possible from where links come in.

// The point on a pill's edge (a w×h stadium, centred on 0,0) in direction `angle`, and
// the outward normal there.
function pillEdgePoint(w, h, angle) {
    const r = h / 2;
    const a = Math.max(0, w / 2 - r);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let lo = 0;
    let hi = w / 2 + h;
    for (let i = 0; i < 22; i++) {
        const t = (lo + hi) / 2;
        const px = t * dx;
        const py = t * dy;
        const qx = Math.max(-a, Math.min(a, px));
        if (Math.hypot(px - qx, py) < r) lo = t;
        else hi = t;
    }
    const x = lo * dx;
    const y = lo * dy;
    const qx = Math.max(-a, Math.min(a, x));
    const n = Math.hypot(x - qx, y) || 1;
    return { x, y, nx: (x - qx) / n, ny: y / n, dist: lo };
}

// A pill's outline (a w×h stadium centred on 0,0) walked by distance: from the left end
// of the top edge, clockwise. Spacing hairs by distance along it keeps them evenly apart
// on the flat edges as well as round the ends.
function pillOutline(w, h) {
    const r = h / 2;
    const a = Math.max(0, w / 2 - r);
    const arc = Math.PI * r;
    const length = 4 * a + 2 * arc;

    // the point and outward normal at distance s along the outline
    const at = (s) => {
        let d = ((s % length) + length) % length;
        if (d < 2 * a) return { x: -a + d, y: -r, nx: 0, ny: -1 };
        d -= 2 * a;
        if (d < arc) {
            const t = -Math.PI / 2 + d / r;
            return { x: a + r * Math.cos(t), y: r * Math.sin(t), nx: Math.cos(t), ny: Math.sin(t) };
        }
        d -= arc;
        if (d < 2 * a) return { x: a - d, y: r, nx: 0, ny: 1 };
        d -= 2 * a;
        const t = Math.PI / 2 + d / r;
        return { x: -a + r * Math.cos(t), y: r * Math.sin(t), nx: Math.cos(t), ny: Math.sin(t) };
    };

    // distance along the outline of a point on it
    const distanceOf = ({ x, y }) => {
        if (Math.abs(x) <= a) return y < 0 ? x + a : 2 * a + arc + (a - x);
        if (x > a) return 2 * a + (Math.atan2(y, x - a) + Math.PI / 2) * r;
        let t = Math.atan2(y, x + a);
        if (t < Math.PI / 2) t += 2 * Math.PI;
        return 4 * a + arc + (t - Math.PI / 2) * r;
    };

    return { at, distanceOf };
}

// Middle of the widest angular gap between the directions to `points` (straight up
// when there are none).
function hairAngle(cx, cy, points) {
    if (!points.length) return -Math.PI / 2;
    const angles = points.map((p) => Math.atan2(p.y - cy, p.x - cx)).sort((x, y) => x - y);
    let widest = -1;
    let at = -Math.PI / 2;
    angles.forEach((a, i) => {
        const b = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
        if (b - a > widest) { widest = b - a; at = a + (b - a) / 2; }
    });
    return at;
}

// Draws `count` hairs on a pill centred at (cx, cy) on screen, w×h in world units, at
// `zoom`; `neighbours` are the screen points its links go to. Returns a hit area for
// clicks ({ x, y, r } on screen), or null when too small to draw.
function drawHairs(ctx, cx, cy, w, h, zoom, count, neighbours) {
    if (!count || h * zoom < 8) return null;
    const angle = hairAngle(cx, cy, neighbours);
    const sw = w * zoom;
    const sh = h * zoom;
    const outline = pillOutline(sw, sh);
    const middle = outline.distanceOf(pillEdgePoint(sw, sh, angle));
    const centre = outline.at(middle);
    ctx.save();
    ctx.strokeStyle = HAIR_COLOR;
    ctx.lineWidth = Math.max(1, 1.5 * zoom);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
        const e = outline.at(middle + (i - (count - 1) / 2) * HAIR_SPACING * zoom);
        const x0 = cx + e.x + e.nx * HAIR_GAP * zoom;
        const y0 = cy + e.y + e.ny * HAIR_GAP * zoom;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + e.nx * HAIR_LENGTH * zoom, y0 + e.ny * HAIR_LENGTH * zoom);
    }
    ctx.stroke();
    ctx.restore();
    const reach = (HAIR_GAP + HAIR_LENGTH / 2) * zoom;
    return {
        x: cx + centre.x + centre.nx * reach,
        y: cy + centre.y + centre.ny * reach,
        r: Math.max(14, (HAIR_LENGTH + count * HAIR_SPACING) * zoom * 0.7),
    };
}

function hairHit(hits, x, y) {
    let best = null;
    for (const h of hits) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= h.r && (!best || d < best.d)) best = { id: h.id, d };
    }
    return best?.id ?? null;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

let _tooltip = null;

function getTooltip() {
    if (_tooltip) return _tooltip;
    _tooltip = document.createElement("div");
    _tooltip.className = "glass";
    Object.assign(_tooltip.style, {
        position: "fixed",
        pointerEvents: "none",
        zIndex: "99999",
        color: "#e8eaed",
        borderRadius: "12px",
        padding: "10px 14px",
        fontSize: "11px",
        lineHeight: "1.55",
        width: "360px",
        display: "none",
        fontFamily: "Poppins, sans-serif",
        wordBreak: "break-word",
    });
    document.body.appendChild(_tooltip);
    return _tooltip;
}

function positionTooltip(x, y) {
    if (!_tooltip) return;
    const margin = 14;
    const tw = 360;
    const th = _tooltip.offsetHeight || 90;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + margin;
    let top = y + margin;
    if (left + tw > vw - margin) left = x - tw - margin;
    if (top + th > vh - margin) top = y - th - margin;
    _tooltip.style.left = `${Math.max(margin, left)}px`;
    _tooltip.style.top = `${Math.max(margin, top)}px`;
}

function hideTooltip() {
    if (_tooltip) _tooltip.style.display = "none";
}

function buildSnippetHtml(d) {
    // Prefer snippet, fall back to abstract. Truncate to 25 words of plain text
    // but preserve the <b> tag so we can highlight it.
    const raw = d.snippet || d.abstract || "";
    if (!raw) return "";

    // Replace <b>…</b> with a placeholder, strip all other tags, restore placeholder
    const marked = raw.replace(/<b>(.*?)<\/b>/gi, "%%BOLD%%$1%%ENDBOLD%%");
    const plain = marked.replace(/<[^>]+>/g, "");
    const words = plain.trim().split(/\s+/);
    const snippet = words.slice(0, 25).join(" ") + (words.length > 25 ? "…" : "");

    // Re-apply highlight styling in place of the placeholder
    return snippet
        .replace(
            /%%BOLD%%(.*?)%%ENDBOLD%%/g,
            '<span style="color:#fbbf24;font-weight:600;background:rgba(251,191,36,0.15);border-radius:2px;padding:0 2px">$1</span>'
        );
}

function showTooltip(d, x, y, remaining) {
    const tip = getTooltip();
    const title = d.title || "—";
    const oaId = d.openalex_id || "—";
    const doi = d.doi || "—";
    const cited = d.cited ?? "—";
    const authors = Array.isArray(d.authors) && d.authors.length
        ? d.authors.join(", ")
        : "—";

    const snippetHtml = buildSnippetHtml(d);

    const isStubNode = !!d.is_stub_node;
    let clickHint = "Click to expand references";
    if (isStubNode || d.stub_document) clickHint = "Click to open on OpenAlex";
    else if (remaining === 0) clickHint = "Nothing more to explore";
    const dblHint = isStubNode ? "Double-click to upload" : (d.stub_document ? "" : "Double-click to view PDF");

    // Category badge — only shown if category exists and isn't "none" (id 0)
    const cat = d.category;
    const categoryHtml = (cat && cat.id !== 0)
        ? `<div style="margin-bottom:6px">
               <span style="
                   background:${cat.color};
                   color:#000000;
                   font-size:10px;
                   font-weight:600;
                   padding:2px 8px;
                   border-radius:999px;
                   letter-spacing:0.04em;
                   text-transform:uppercase;
               ">${cat.name}</span>
           </div>`
        : "";

    tip.innerHTML = `
        <div style="font-weight:600;font-size:12.5px;color:#fff;margin-bottom:6px;line-height:1.4">${title}</div>
        ${categoryHtml}
        <div style="color:#9aa0a6;margin-bottom:2px"><span style="color:#5f6368">Authors </span>${authors}</div>
        <div style="color:#9aa0a6;margin-bottom:2px"><span style="color:#5f6368">OpenAlex </span><span style="color:#8ab4f8">${oaId}</span></div>
        ${doi !== "—" ? `<div style="color:#9aa0a6;margin-bottom:2px"><span style="color:#5f6368">DOI </span><span style="color:#8ab4f8">${doi}</span></div>` : ""}
        <div style="color:#9aa0a6;margin-bottom:6px"><span style="color:#5f6368">Cited by </span>${cited}</div>
        ${snippetHtml ? `<div style="color:#bdc1c6;margin-bottom:6px;font-style:italic;font-size:11.5px">${snippetHtml}</div>` : ""}
        <div style="color:#5f6368;font-size:10px;border-top:1px solid rgba(255,255,255,0.07);padding-top:6px;display:flex;flex-wrap:wrap;gap:4px 12px">
            <span>${clickHint}</span>
            ${dblHint ? `<span>${dblHint}</span>` : ""}
            <span>Hold to remove</span>
        </div>
    `.trim();

    positionTooltip(x, y);
    tip.style.display = "block";
}

// ── Legend ───────────────────────────────────────────────────────────────────

function legendRow(swatch, text, filterKey = null, hidden = false) {
    const label = `<span style="flex:none;display:inline-flex;width:22px;justify-content:center">${swatch}</span>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${hidden ? "text-decoration:line-through" : ""}">${text.charAt(0).toUpperCase()}${text.slice(1)}</span>`;
    if (!filterKey) return `<div style="display:flex;align-items:center;gap:8px;min-width:0">${label}</div>`;
    // a filter: click to hide / show what it stands for
    return `<button type="button" class="legend-filter" data-filter="${filterKey}" aria-pressed="${!hidden}" title="${hidden ? "Show" : "Hide"}"
        style="all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;min-width:0;margin:-3px -6px;padding:3px 6px;border-radius:6px;opacity:${hidden ? 0.38 : 1}">${label}</button>`;
}

function legendSection(title, rows) {
    if (!rows.length) return "";
    return `<div style="display:flex;flex-direction:column;gap:5px">
        <div style="font-size:9.5px;letter-spacing:0.08em;text-transform:uppercase;color:#5f6368;font-weight:600">${title}</div>
        ${rows.join("")}
    </div>`;
}

const pillSwatch = (fill, stroke = "transparent") =>
    `<span style="width:20px;height:11px;border-radius:6px;background:${fill};border:1.5px solid ${stroke};box-sizing:border-box"></span>`;
const lineSwatch = (color, dashed, arrow) =>
    `<svg width="22" height="10" viewBox="0 0 22 10"><line x1="1" y1="5" x2="${arrow ? 16 : 21}" y2="5" stroke="${color}" stroke-width="1.6" ${dashed ? 'stroke-dasharray="3 2.5"' : ""}/>${arrow ? `<path d="M15 1.5 L21 5 L15 8.5 Z" fill="${color}"/>` : ""}</svg>`;

// ── Data mapping: server node/link → @chartizer/graph-renderer snapshots ─────

// Articles outside the library found through "related works" come back coloured brown.
function isRelatedStub(d) {
    return parseColor(d?.fillColor)?.r === 180;
}

// Fill, outline and text colours of an article pill.
function pillColors(d, expanded) {
    if (isStub(d)) {
        return {
            fill: STUB_FILL,
            stroke: expanded ? EXPANDED_STROKE : (isRelatedStub(d) ? STUB_REL_STROKE : STUB_REF_STROKE),
            strokeWidth: expanded ? 2.5 : 1.5,
            text: STUB_TEXT,
        };
    }
    const fill = solidColor(d.fillColor ?? NODE_FILL);
    return {
        fill,
        stroke: expanded ? EXPANDED_STROKE : CHART_BG,
        strokeWidth: expanded ? 2.5 : 1.5,
        text: textColorOn(fill),
    };
}

// The engine always gets the plain outline: the "expanded" ring is drawn on the overlay,
// because changing a node's style in the engine means re-sending (re-creating) it.
function toRendererNode(item, x, y, pinned = false) {
    const id = String(item.id);
    const d = fieldsOf(item) ?? {};

    // The search "query" node: accent circle with the search icon and the query as label.
    if (id === "query") {
        return {
            id, x, y,
            label: titleOf(d, "") || undefined,
            shape: { kind: "circle", radius: QUERY_NODE_RADIUS },
            flags: { pinned },
            style: {
                fillColor: QUERY_FILL,
                strokeColor: CHART_BG,
                strokeWidth: 3,
                imageUrl: SEARCH_ICON,
                label: {
                    textColor: QUERY_FILL,
                    fontFamily: PILL_FONT_FAMILY,
                    fontSize: 13,
                    backgroundColor: "rgba(30,31,34,0.8)",
                    paddingX: 6,
                    paddingY: 2,
                    cornerRadius: 4,
                },
            },
        };
    }

    // No label: the title is drawn on the overlay, inside the pill.
    const pill = pillLayout(titleOf(d, id), isStub(d));
    const colors = pillColors(d, false);
    return {
        id, x, y,
        shape: { kind: "rect", width: pill.w, height: pill.h, cornerRadius: pill.corner },
        flags: { pinned },
        style: {
            fillColor: colors.fill,
            strokeColor: colors.stroke,
            strokeWidth: colors.strokeWidth,
        },
    };
}

function linkKind(link) {
    if (String(link.from) === "query" || String(link.to) === "query") return "query";
    return linkStyleOf(link).dashSize !== undefined ? "rel" : "ref";
}

function toRendererLink(link) {
    const s = linkStyleOf(link);
    const from = String(link.from);
    const to = String(link.to);
    const kind = linkKind(link);
    return {
        // NetChart links had no ids; the renderer needs one. Include the colour so a
        // "referenced" and a "related" link between the same pair can coexist.
        id: link.id != null ? String(link.id) : `${from}|${to}|${s.fillColor ?? ""}`,
        from,
        to,
        points: [],
        weight: kind === "query" ? 1 : 2,
        style: { ...LINK_STYLES[kind], curveStyle: "straight" },
    };
}

// Every node needs a starting x/y (the force layout then settles it). New nodes fan out
// around the node they connect to; with nothing to connect to, a spiral at the origin.
function seedPosition(index, anchor) {
    const angle = index * GOLDEN_ANGLE;
    if (!anchor) {
        const r = 220 * Math.sqrt(index + 1);
        return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    }
    const r = 260 + 30 * Math.sqrt(index);
    return { x: anchor.x + r * Math.cos(angle), y: anchor.y + r * Math.sin(angle) };
}

function pushTo(map, key, value) {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
}

// ── Chart ────────────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for the NetChart-based CreateChart.
 * Returns a handle { addData({nodes, links}, anchorId?), remove(), renderer } immediately;
 * the WASM renderer mounts asynchronously and calls made before that are queued.
 * Call remove() when the React component unmounts (React 18 strict mode mounts twice).
 * `results` (the /search result rows) supply reference lists the chart nodes lack, so
 * search hits know whether they have anything to expand into.
 */
const CreateChart = (data = null, initialNodes = [], onOpenPdf = null, onUploadStub = null, results = []) => {
    const container = document.getElementById("megachart");
    if (!container) return null;

    const chartData = data ?? { nodes: [], links: [] };

    // Tracks every node ID currently visible in the graph (sent to /expand)
    const shownNodeIds = new Set();
    // Tracks which ref/rel IDs have already been shown per node (for pagination)
    const shownRefsByNode = new Map();
    const shownRelsByNode = new Map();
    // Stores each node's full ref/rel ID lists (for client-side cross-link pass)
    const nodeEdgeMap = new Map();
    // Debounce: skip if already fetching for this node
    const expandingNodes = new Set();
    // Node fields by id, for tooltips / click handlers
    const fieldsById = new Map();
    // Ids actually handed to the renderer
    const knownNodeIds = new Set();
    const knownLinkIds = new Set();
    // Legend filters. Keys: "cat:<id>", "stub:ref", "stub:rel" (articles), "link:ref",
    // "link:rel", "link:query" (links). Articles hidden by a filter stay loaded, with the
    // spot they were at, and come back there.
    const hiddenKeys = new Set();
    const filteredOut = new Map();   // id -> { x, y }
    // Nodes the user clicked (expanded), the node each revealed node came from, and
    // nodes the server has nothing more for
    const expandedIds = new Set();
    const parentOf = new Map();
    const exhaustedIds = new Set();

    // NetChart's navigation showed only nodes within FOCUS_RADIUS hops of the initial
    // nodes. Every node and link the chart was given is kept here; `focusOn` decides
    // which of them are drawn.
    const allNodes = new Map();      // id -> server node
    let allLinks = [];               // server links
    const adjacency = new Map();     // id -> neighbour ids

    function remember(payload) {
        for (const n of payload?.nodes ?? []) {
            if (n?.id == null) continue;
            const id = String(n.id);
            allNodes.set(id, n);
            fieldsById.set(id, fieldsOf(n));
        }
        for (const l of payload?.links ?? []) {
            if (l?.from == null || l?.to == null) continue;
            allLinks.push(l);
            pushTo(adjacency, String(l.from), String(l.to));
            pushTo(adjacency, String(l.to), String(l.from));
        }
    }

    // Ids within FOCUS_RADIUS hops of the given ones (breadth-first over all known links).
    function around(ids) {
        const seen = new Set(ids.map(String).filter((id) => allNodes.has(id)));
        let frontier = [...seen];
        for (let hop = 0; hop < FOCUS_RADIUS && frontier.length; hop++) {
            const next = [];
            for (const id of frontier) {
                for (const nb of adjacency.get(id) ?? []) {
                    if (!seen.has(nb) && allNodes.has(nb)) {
                        seen.add(nb);
                        next.push(nb);
                    }
                }
            }
            frontier = next;
        }
        return seen;
    }

    function registerEdges(node) {
        const d = fieldsOf(node);
        if (!d) return;
        nodeEdgeMap.set(String(node.id), {
            ref_ids: d.referenced_work_ids || [],
            rel_ids: d.related_work_ids || [],
        });
        shownRefsByNode.set(String(node.id), new Set());
        shownRelsByNode.set(String(node.id), new Set());
    }

    for (const node of chartData.nodes) {
        // search hits carry no ref/rel lists of their own; take them from the result rows
        if (!fieldsOf(node)?.referenced_work_ids) continue;
        registerEdges(node);
    }
    for (const row of results ?? []) {
        const id = row.openalex_id || row.id || row.doi_number;
        if (!id) continue;
        registerEdges({ id, data: { referenced_work_ids: row.referenced_work_ids, related_work_ids: row.related_work_ids } });
    }

    // How many articles this node could still reveal: null when unknown, 0 when none.
    function remainingFor(id) {
        const d = fieldsById.get(id);
        if (id === "query" || !d || isStub(d) || exhaustedIds.has(id)) return 0;
        const edges = nodeEdgeMap.get(id);
        if (!edges) return null;
        const shownRefs = shownRefsByNode.get(id) ?? new Set();
        const shownRels = shownRelsByNode.get(id) ?? new Set();
        const left = new Set();
        const onMap = (x) => knownNodeIds.has(x) || filteredOut.has(x);
        for (const ref of edges.ref_ids) if (!shownRefs.has(ref) && !onMap(ref)) left.add(ref);
        for (const rel of edges.rel_ids) if (!shownRels.has(rel) && !onMap(rel)) left.add(rel);
        return left.size;
    }

    // ── Renderer lifecycle ───────────────────────────────────────────────────

    if (!container.style.position) container.style.position = "relative";
    // a long press removes an article; keep iOS from also selecting text or showing a callout
    Object.assign(container.style, { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" });

    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        display: "block",
        background: CHART_BG,
    });
    container.appendChild(canvas);

    // Pill titles are drawn on a 2D canvas above the graph.
    const overlay = document.createElement("canvas");
    Object.assign(overlay.style, {
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
    });
    container.appendChild(overlay);
    const octx = overlay.getContext("2d");

    const legend = document.createElement("div");
    legend.className = "glass";
    Object.assign(legend.style, {
        // top right: the results panel slides over the left of the graph
        position: "absolute",
        right: "16px",
        top: "16px",
        maxWidth: "250px",
        maxHeight: "calc(100% - 32px)",
        overflowY: "auto",
        display: "none",
        flexDirection: "column",
        gap: "12px",
        padding: "12px 14px",
        borderRadius: "12px",
        color: "#bdc1c6",
        fontFamily: PILL_FONT_FAMILY,
        fontSize: "11px",
        lineHeight: "1.3",
        zIndex: "2",
    });
    const legendHeader = document.createElement("button");
    legendHeader.type = "button";
    Object.assign(legendHeader.style, {
        all: "unset",
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        fontSize: "11px",
        fontWeight: "600",
        color: "#e8eaed",
    });
    const legendBody = document.createElement("div");
    Object.assign(legendBody.style, { display: "flex", flexDirection: "column", gap: "12px" });
    // folded at first unless there is room beside the results panel (not on iPad portrait)
    let legendOpen = container.clientWidth >= 1100;
    const renderLegendHeader = () => {
        legendHeader.innerHTML = `<span>Legend</span><span style="color:#9aa0a6;font-size:10px">${legendOpen ? "Hide" : "Show"}</span>`;
        legendBody.style.display = legendOpen ? "flex" : "none";
    };
    legendHeader.addEventListener("click", () => { legendOpen = !legendOpen; renderLegendHeader(); });
    renderLegendHeader();
    legend.append(legendHeader, legendBody);
    container.appendChild(legend);

    let renderer = null;
    let removed = false;
    let latestSize = null;
    let fitTimer = null;
    let userMoved = false;
    let offEvents = null;
    let frame = 0;
    const queue = [];

    const safe = (fn, r) => {
        try {
            fn(r);
        } catch (err) {
            if (isEngineFault(err) || adapterOf(r)?.destroyed) engineFailed(err);
            else console.error("[chart]", err);
        }
    };

    // When the WASM engine faults inside its frame loop, the renderer (0.1.11) marks itself
    // destroyed but its destroy() then returns early: the faulted engine stays attached,
    // with its pointer listeners. Every later touch or position read calls into it and
    // throws again ("Out of bounds memory access"). So: finish the teardown, stop calling
    // it, and offer a reload in place of the graph.
    let failed = false;
    function engineFailed(err) {
        if (failed || removed) return;
        failed = true;
        console.error("[chart] graph engine failed", err);
        const adapter = adapterOf(renderer);
        if (adapter?.engine) {
            adapter.destroyed = false;
            try { adapter.destroy(); } catch { /* already broken */ }
        }
        renderer = null;
        queue.length = 0;
        if (fitTimer) clearTimeout(fitTimer);
        cancelAnimationFrame(frame);
        hideTooltip();
        canvas.style.visibility = "hidden";
        overlay.style.visibility = "hidden";
        legend.style.display = "none";
        sheet.style.display = "none";

        const notice = document.createElement("div");
        Object.assign(notice.style, {
            position: "absolute",
            inset: "0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "14px",
            padding: "24px",
            textAlign: "center",
            color: "#bdc1c6",
            fontFamily: PILL_FONT_FAMILY,
            fontSize: "13px",
            zIndex: "4",
        });
        notice.innerHTML = `
            <div>The graph stopped working.</div>
            <button type="button" style="all:unset;cursor:pointer;height:40px;padding:0 18px;border-radius:10px;
                background:${QUERY_FILL};color:#1e1f22;font-weight:600">Reload graph</button>`;
        notice.querySelector("button").addEventListener("click", () => window.location.reload());
        container.appendChild(notice);
    }
    // Run now if the renderer is up, otherwise once it has mounted.
    const run = (fn) => {
        if (removed) return;
        invalidate();
        if (renderer) safe(fn, renderer);
        else queue.push(fn);
    };

    // The overlay (titles, rings, hairs) is only redrawn while something can change it:
    // the camera moved, the layout is running, a pop is playing, or something just
    // happened (a touch, new data). An idle graph costs nothing per frame (iPad battery).
    let dirtyUntil = 0;
    let lastView = "";
    function invalidate(ms = 500) {
        dirtyUntil = Math.max(dirtyUntil, performance.now() + ms);
    }
    let lastRedraws = -1;
    function overlayIdle(now, w, h) {
        const vp = renderer.getViewport();
        const view = `${w}|${h}|${vp.centerX}|${vp.centerY}|${vp.zoom}`;
        const changed = view !== lastView;
        lastView = view;
        // the engine drew a new frame (layout moving, an animation): follow it
        const redraws = renderer.getPerfStats?.()?.redraws;
        const engineDrew = redraws === undefined || redraws !== lastRedraws;
        lastRedraws = redraws;
        // finished pops (some, like the search node's, are never drawn here) are dropped
        let popping = false;
        for (const [id, pop] of pops) {
            if (now < pop.start + pop.ms + 32) popping = true;
            else if (!leaving.has(id)) pops.delete(id);
        }
        return !changed && !engineDrew && !popping && !leaving.size && now >= dirtyUntil;
    }

    // Lists what is actually on screen: categories of the articles shown, the two kinds
    // of articles outside the library, and each link type.
    function updateLegend() {
        const categories = new Map();
        let refStubs = false;
        let relStubs = false;
        const linkKinds = new Set();
        for (const id of [...knownNodeIds, ...filteredOut.keys()]) {
            const d = fieldsById.get(id);
            if (!d || id === "query") continue;
            if (isStub(d)) {
                if (isRelatedStub(d)) relStubs = true;
                else refStubs = true;
            } else {
                const cat = d.category ?? { id: 0, name: "uncategorised", color: d.fillColor ?? NODE_FILL };
                if (!categories.has(cat.id)) categories.set(cat.id, cat);
            }
        }
        const onMap = (x) => knownNodeIds.has(x) || filteredOut.has(x);
        for (const l of allLinks) {
            if (onMap(String(l.from)) && onMap(String(l.to))) linkKinds.add(linkKind(l));
        }
        const row = (swatch, text, key) => legendRow(swatch, text, key, hiddenKeys.has(key));

        const categoryRows = [...categories.values()]
            .sort((a, b) => (a.id === 0) - (b.id === 0) || a.name.localeCompare(b.name))
            .map((cat) => row(pillSwatch(solidColor(cat.color)), cat.id === 0 ? "uncategorised" : cat.name, `cat:${cat.id}`));
        const outsideRows = [
            refStubs && row(pillSwatch(STUB_FILL, STUB_REF_STROKE), "cited, not in library", "stub:ref"),
            relStubs && row(pillSwatch(STUB_FILL, STUB_REL_STROKE), "related, not in library", "stub:rel"),
        ].filter(Boolean);
        const linkRows = [
            linkKinds.has("ref") && row(lineSwatch("rgba(138,180,248,0.95)", false, true), "cites", "link:ref"),
            linkKinds.has("rel") && row(lineSwatch("rgba(246,174,45,0.95)", true, false), "related work", "link:rel"),
            linkKinds.has("query") && row(lineSwatch("rgba(232,234,237,0.5)", false, false), "search hit", "link:query"),
        ].filter(Boolean);
        const markerRows = [
            legendRow(pillSwatch("transparent", EXPANDED_STROKE), "expanded"),
            legendRow(`<svg width="22" height="12" viewBox="0 0 22 12"><g stroke="#9aa0a6" stroke-width="1.2" stroke-linecap="round"><line x1="4" y1="1" x2="4" y2="4"/><line x1="11" y1="0.5" x2="11" y2="3.5"/><line x1="18" y1="1" x2="18" y2="4"/></g><rect x="1" y="5.5" width="20" height="6" rx="3" fill="#9aa0a6"/></svg>`, "more to explore"),
        ];

        const body = [
            hiddenKeys.size
                ? `<div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:#9aa0a6">
                       <span>Click to hide or show</span>
                       <button type="button" data-filter="*" style="all:unset;cursor:pointer;color:${QUERY_FILL};font-weight:600">Show all</button>
                   </div>`
                : `<div style="font-size:10.5px;color:#9aa0a6">Click to hide or show</div>`,
            legendSection("In library", categoryRows),
            legendSection("Outside library", outsideRows),
            legendSection("Links", linkRows),
            legendSection("Markers", markerRows),
        ].join("");
        if (legendBody.innerHTML !== body) legendBody.innerHTML = body;
        legend.style.display = knownNodeIds.size + filteredOut.size > 1 ? "flex" : "none";
    }

    // ── Expansion markers ────────────────────────────────────────────────────

    // id -> number of hairs (drawn on the overlay) for an article that still has
    // articles to reveal; hairHits are where they were drawn last frame, for clicks
    const markers = new Map();
    let hairHits = [];

    // ── Details sheet: what hover shows on desktop, for touch screens ────────

    const sheet = document.createElement("div");
    sheet.className = "glass";
    Object.assign(sheet.style, {
        // centred in the part of the graph not under the results panel
        // (--chart-left-inset: that panel's width while it is open)
        position: "absolute",
        left: "calc(50% + var(--chart-left-inset, 0px) / 2)",
        bottom: "calc(var(--chart-sheet-offset, 16px) + env(safe-area-inset-bottom))",
        width: "min(520px, calc(100% - var(--chart-left-inset, 0px) - 24px))",
        transform: "translate(-50%, 16px)",
        opacity: "0",
        pointerEvents: "none",
        transition: "opacity 180ms ease, transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        zIndex: "3",
        padding: "14px 16px 12px",
        borderRadius: "16px",
        color: "#e8eaed",
        fontFamily: PILL_FONT_FAMILY,
    });
    container.appendChild(sheet);
    let sheetId = null;

    const sheetButton = (action, label, primary = false, danger = false) => `
        <button type="button" data-action="${action}" style="
            all:unset;cursor:pointer;box-sizing:border-box;height:40px;padding:0 14px;border-radius:10px;
            display:inline-flex;align-items:center;font-size:13px;font-weight:600;white-space:nowrap;
            background:${primary ? QUERY_FILL : "rgba(255,255,255,0.07)"};
            color:${primary ? "#1e1f22" : danger ? "#f28b82" : "#e8eaed"}">${label}</button>`;

    function renderSheet() {
        const d = sheetId && fieldsById.get(sheetId);
        if (!d) { hideSheet(); return; }
        const remaining = remainingFor(sheetId);
        const authors = Array.isArray(d.authors) && d.authors.length
            ? d.authors.slice(0, 3).join(", ") + (d.authors.length > 3 ? ` +${d.authors.length - 3}` : "")
            : "";
        const meta = escapeHtml([authors, d.cited ? `Cited by ${d.cited}` : ""].filter(Boolean).join(" · "));
        const cat = d.category && d.category.id !== 0
            ? `<span style="background:${d.category.color};color:#000;font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:0.04em">${escapeHtml(d.category.name)}</span>`
            : isStub(d) ? `<span style="font-size:11px;color:#9aa0a6">Not in library</span>` : "";
        const actions = [];
        if (!isStub(d) && d.file && onOpenPdf) actions.push(sheetButton("open", "Open PDF", true));
        if (!isStub(d) && remaining !== 0) {
            actions.push(sheetButton("expand", expandingNodes.has(sheetId) ? "Loading…" : remaining ? `Show more · ${remaining}` : "Show more"));
        }
        if (isStub(d)) actions.push(sheetButton("openalex", "OpenAlex", !d.is_stub_node || !onUploadStub));
        if (d.is_stub_node && onUploadStub) actions.push(sheetButton("upload", "Upload", true));
        actions.push(sheetButton("remove", "Remove", false, true));

        sheet.innerHTML = `
            <div style="display:flex;gap:10px;align-items:flex-start">
                <div style="flex:1;min-width:0">
                    <div style="font-size:14px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(titleOf(d, sheetId))}</div>
                    ${meta ? `<div style="font-size:11.5px;color:#9aa0a6;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${meta}</div>` : ""}
                    ${cat ? `<div style="margin-top:8px">${cat}</div>` : ""}
                </div>
                <button type="button" data-action="close" aria-label="Close" style="all:unset;cursor:pointer;width:32px;height:32px;margin:-6px -8px 0 0;display:flex;align-items:center;justify-content:center;color:#9aa0a6;font-size:20px;line-height:1">×</button>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;overflow-x:auto">${actions.join("")}</div>`;
        Object.assign(sheet.style, { opacity: "1", transform: "translate(-50%, 0)", pointerEvents: "auto" });
    }

    function showSheet(id) {
        sheetId = id;
        renderSheet();
    }

    function hideSheet() {
        sheetId = null;
        Object.assign(sheet.style, { opacity: "0", transform: "translate(-50%, 16px)", pointerEvents: "none" });
    }

    sheet.addEventListener("click", (e) => {
        const action = e.target.closest("[data-action]")?.dataset.action;
        const id = sheetId;
        const d = id && fieldsById.get(id);
        if (!action || !d) return;
        if (action === "close") hideSheet();
        else if (action === "open") onOpenPdf(d);
        else if (action === "expand") expandNode(id);
        else if (action === "openalex") window.open(`https://openalex.org/${d.openalex_id || id}`, "_blank");
        else if (action === "upload") onUploadStub(d);
        else if (action === "remove") removeArticle(id);
    });

    function refreshExpansion() {
        if (sheetId) renderSheet();
        run((r) => {
            for (const id of knownNodeIds) {
                const remaining = remainingFor(id);
                const count = remaining == null ? MARKER_MAX_HAIRS : Math.min(remaining, MARKER_MAX_HAIRS);
                if (count) markers.set(id, count);
                else markers.delete(id);
            }
        });
        updateLegend();
    }

    // ── Pop in / pop out ─────────────────────────────────────────────────────

    // id -> { start, ms, from, to, ease }: the scale the overlay draws a node's title at
    const pops = new Map();
    // id -> node fields, for nodes shrinking away (already dropped from every other map)
    const leaving = new Map();

    function scaleOf(id, now) {
        const pop = pops.get(id);
        if (!pop) return 1;
        const t = Math.min(1, Math.max(0, (now - pop.start) / pop.ms));
        if (t >= 1 && !leaving.has(id)) pops.delete(id);
        return pop.from + (pop.to - pop.from) * pop.ease(t);
    }

    // Nodes arrive at full size, so the layout spaces them for it (it keeps a node's
    // size from when it was added). Before the next frame they are shrunk to a dot, then
    // each grows back with an overshoot; growing back to the real size also restores
    // the corner radius, so nothing is re-sent afterwards.
    function popIn(r, ids, stagger) {
        const now = performance.now();
        const sizeOf = (id) => {
            if (id === "query") return null;
            const d = fieldsById.get(id);
            return pillLayout(titleOf(d, id), isStub(d));
        };
        const resize = (rr, id, scale, opts) => {
            const pill = sizeOf(id);
            return pill
                ? rr.animateNodeSize(id, pill.w * scale, pill.h * scale, opts)
                : rr.animateNodeRadius(id, QUERY_NODE_RADIUS * scale, opts);
        };

        ids.forEach((id, i) => {
            if (!resize(r, id, POP_MIN_SCALE, { durationMs: 1, easing: "linear", commit: true })) return;
            const delay = POP_START_MS + (stagger ? i * POP_STAGGER_MS : 0);
            pops.set(id, { start: now + delay, ms: POP_IN_MS, from: POP_MIN_SCALE, to: 1, ease: easeOutBack });
            setTimeout(() => {
                if (removed || !renderer || !knownNodeIds.has(id)) return;
                safe((rr) => resize(rr, id, 1, { durationMs: POP_IN_MS, easing: "ease-out-back", commit: true }), renderer);
            }, delay);
            // Not pinned while it grows: it was inserted at full size, so the layout
            // already gives it room, and it drifts into place as it grows. (Holding it and
            // letting go afterwards made it jump: a second "pop".)
        });
    }

    // The white ring of an article that has been opened (expanded), around its pill.
    function drawExpandedRing(pill, c, zoom) {
        const w = pill.w * zoom;
        const h = pill.h * zoom;
        if (h < 4) return;
        const width = Math.max(1, 2.5 * zoom);
        octx.save();
        octx.strokeStyle = EXPANDED_STROKE;
        octx.lineWidth = width;
        octx.beginPath();
        octx.roundRect(c.x - w / 2 - width / 2, c.y - h / 2 - width / 2, w + width, h + width, h / 2 + width / 2);
        octx.stroke();
        octx.restore();
    }

    function drawTitle(d, id, c, zoom) {
        const pill = pillLayout(titleOf(d, id), isStub(d));
        if (expandedIds.has(id)) drawExpandedRing(pill, c, zoom);
        const px = pill.fontSize * zoom;
        if (px < MIN_TEXT_PX) return;
        octx.font = `${pill.weight} ${px}px ${PILL_FONT_FAMILY}`;
        octx.fillStyle = pillColors(d, false).text;
        const top = c.y - ((pill.lines.length - 1) * pill.lineHeight * zoom) / 2;
        pill.lines.forEach((line, i) => octx.fillText(line, c.x, top + i * pill.lineHeight * zoom));
    }

    function drawOverlay(now) {
        frame = requestAnimationFrame(drawOverlay);

        const dpr = window.devicePixelRatio || 1;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
            overlay.width = Math.round(w * dpr);
            overlay.height = Math.round(h * dpr);
        }
        if (!renderer) { octx.clearRect(0, 0, overlay.width, overlay.height); return; }
        if (adapterOf(renderer)?.destroyed) { engineFailed(new Error("renderer stopped")); return; }
        try {
            if (overlayIdle(now, w, h)) return;
            octx.setTransform(dpr, 0, 0, dpr, 0, 0);
            octx.clearRect(0, 0, w, h);
            drawTitles(now, w, h);
        } catch (err) {
            if (isEngineFault(err)) engineFailed(err);
            else throw err;
        }
    }

    function drawTitles(now, w, h) {
        const zoom = renderer.getViewport().zoom;
        octx.textAlign = "center";
        octx.textBaseline = "middle";
        const drawn = (id) => (leaving.has(id) ? leaving.get(id) : fieldsById.get(id));
        for (const id of [...knownNodeIds, ...leaving.keys()]) {
            if (id === "query") continue;
            const d = drawn(id);
            const pos = d && renderer.getNodePosition(id);
            if (!pos) continue;
            const c = renderer.worldToScreen(pos.x, pos.y);
            const pill = pillLayout(titleOf(d, id), isStub(d));
            if (c.x + pill.w * zoom < 0 || c.x - pill.w * zoom > w || c.y + pill.h * zoom < 0 || c.y - pill.h * zoom > h) continue;
            drawTitle(d, id, c, zoom * scaleOf(id, now));
        }

        // hairs, away from where this article's links come in
        const hits = [];
        for (const [id, count] of markers) {
            if (!knownNodeIds.has(id) || leaving.has(id) || pops.has(id)) continue;
            const pos = renderer.getNodePosition(id);
            if (!pos) continue;
            const c = renderer.worldToScreen(pos.x, pos.y);
            if (c.x < -200 || c.x > w + 200 || c.y < -200 || c.y > h + 200) continue;
            const d = fieldsById.get(id);
            const pill = pillLayout(titleOf(d, id), isStub(d));
            const neighbours = [];
            for (const nb of adjacency.get(id) ?? []) {
                if (!knownNodeIds.has(nb)) continue;
                const p = renderer.getNodePosition(nb);
                if (p) neighbours.push(renderer.worldToScreen(p.x, p.y));
            }
            const hit = drawHairs(octx, c.x, c.y, pill.w, pill.h, zoom, count, neighbours);
            if (hit) hits.push({ id, ...hit });
        }
        hairHits = hits;
    }
    frame = requestAnimationFrame(drawOverlay);

    // Draw the given server nodes (those not drawn yet) and every known link whose two
    // ends are now drawn. Upserting restarts the force layout by itself; no autoLayout(),
    // which would re-place the whole graph on every expansion.
    function draw(r, ids, anchorId, isInitial) {
        const fresh = [...ids].map(String).filter((id) => allNodes.has(id) && !knownNodeIds.has(id) && !filteredOut.has(id));

        const anchorFor = (id) => {
            for (const nb of adjacency.get(id) ?? []) {
                if (!knownNodeIds.has(nb)) continue;
                const p = r.getNodePosition(nb);
                if (p) return p;
            }
            if (anchorId != null && knownNodeIds.has(String(anchorId))) {
                return r.getNodePosition(String(anchorId));
            }
            return null;
        };

        const perAnchor = new Map();
        const rendererNodes = fresh.map((id) => {
            const n = allNodes.get(id);
            if (Number.isFinite(n.x) && Number.isFinite(n.y)) return toRendererNode(n, n.x, n.y);
            const anchor = anchorFor(id);
            const key = anchor ? `${anchor.x}|${anchor.y}` : "origin";
            const index = perAnchor.get(key) ?? 0;
            perAnchor.set(key, index + 1);
            const { x, y } = seedPosition(index, anchor);
            return toRendererNode(n, x, y);
        });

        // articles of a category hidden in the legend wait, placed, until it is shown
        const visibleNodes = [];
        for (const n of rendererNodes) {
            shownNodeIds.add(allNodes.get(n.id).id);
            if (isNodeHidden(n.id)) filteredOut.set(n.id, { x: n.x, y: n.y });
            else visibleNodes.push(n);
        }
        if (visibleNodes.length) {
            r.upsertNodes(visibleNodes);
            for (const n of visibleNodes) knownNodeIds.add(n.id);
            popIn(r, visibleNodes.map((n) => n.id), isInitial);
        }

        // links go in after their nodes: a link to a node the renderer lacks is not drawn
        const rendererLinks = [];
        for (const l of allLinks) {
            const rl = toRendererLink(l);
            if (!knownNodeIds.has(rl.from) || !knownNodeIds.has(rl.to)) continue;
            if (knownLinkIds.has(rl.id) || !isLinkShown(l)) continue;
            knownLinkIds.add(rl.id);
            rendererLinks.push(rl);
        }
        if (rendererLinks.length) r.upsertLinks(rendererLinks);

        refreshExpansion();

        if (isInitial && visibleNodes.length) {
            fitView(r);
            // Re-fit once the nodes have popped in and the layout has spread out, unless the
            // user has panned or zoomed. The camera glides there instead of jumping.
            fitTimer = setTimeout(() => {
                if (!removed && renderer && !userMoved) safe(glideToFit, renderer);
            }, FIT_DELAY_MS);
        }
    }

    // Fit everything, but never zoom in past about 1:1 so a small graph isn't blown up.
    function fitView(r) {
        if (container.clientWidth < NARROW_WIDTH) {
            const pos = r.getNodePosition("query");
            if (pos) {
                r.setViewport({ centerX: pos.x, centerY: pos.y, zoom: NARROW_ZOOM });
                return;
            }
        }
        r.fitToScreen(60);
        const vp = r.getViewport();
        if (vp.zoom > MAX_FIT_ZOOM) r.setViewport({ centerX: vp.centerX, centerY: vp.centerY, zoom: MAX_FIT_ZOOM });
    }

    function glideToFit(r) {
        if (container.clientWidth < NARROW_WIDTH && knownNodeIds.has("query")) {
            r.focusNode("query", { maxZoom: NARROW_ZOOM, durationMs: FIT_GLIDE_MS });
            return;
        }
        r.focusNodes(r.getVisibleNodeIds(), { paddingPx: 60, maxZoom: MAX_FIT_ZOOM, durationMs: FIT_GLIDE_MS });
    }

    // Show the nodes within FOCUS_RADIUS hops of these (NetChart focus navigation).
    function focusOn(ids, anchorId = null, isInitial = false) {
        run((r) => draw(r, around(ids), anchorId, isInitial));
    }

    // ── Legend filters ───────────────────────────────────────────────────────

    function nodeFilterKey(id) {
        const d = fieldsById.get(id);
        if (id === "query" || !d) return null;
        if (isStub(d)) return isRelatedStub(d) ? "stub:rel" : "stub:ref";
        return `cat:${d.category?.id ?? 0}`;
    }
    function isNodeHidden(id) {
        const key = nodeFilterKey(id);
        return key != null && hiddenKeys.has(key);
    }
    function isLinkShown(l) {
        return !hiddenKeys.has(`link:${linkKind(l)}`);
    }

    // Brings the graph in line with the legend filters: newly hidden articles shrink away
    // (keeping their spot), newly shown ones pop back in where they were, and links follow.
    function applyFilters(r) {
        const hide = [...knownNodeIds].filter(isNodeHidden);
        const show = [...filteredOut.keys()].filter((id) => !isNodeHidden(id));
        const hideSet = new Set(hide);

        const linkIds = [];
        for (const l of allLinks) {
            const rl = toRendererLink(l);
            if (!knownLinkIds.has(rl.id)) continue;
            if (hideSet.has(rl.from) || hideSet.has(rl.to) || !isLinkShown(l)) {
                knownLinkIds.delete(rl.id);
                linkIds.push(rl.id);
            }
        }
        if (linkIds.length) r.removeLinks(linkIds);

        if (hide.length) {
            if (hideSet.has(sheetId)) hideSheet();
            hideTooltip();
            const now = performance.now();
            for (const id of hide) {
                filteredOut.set(id, r.getNodePosition(id) ?? { x: 0, y: 0 });
                knownNodeIds.delete(id);
                leaving.set(id, fieldsById.get(id));
                pops.set(id, { start: now, ms: POP_OUT_MS, from: 1, to: POP_MIN_SCALE, ease: easeInBack });
                markers.delete(id);
                const d = fieldsById.get(id);
                const pill = pillLayout(titleOf(d, id), isStub(d));
                r.animateNodeSize(id, pill.w * POP_MIN_SCALE, pill.h * POP_MIN_SCALE, { durationMs: POP_OUT_MS, easing: "ease-in-back", commit: true });
            }
            setTimeout(() => {
                // shown again in the meantime: leave it
                const gone = hide.filter((id) => filteredOut.has(id) && leaving.has(id));
                for (const id of gone) { leaving.delete(id); pops.delete(id); }
                if (!removed && renderer && gone.length) safe((rr) => rr.removeNodes(gone), renderer);
            }, POP_OUT_MS);
        }

        if (show.length) {
            const nodes = show.map((id) => {
                const pos = filteredOut.get(id);
                filteredOut.delete(id);
                leaving.delete(id);
                pops.delete(id);
                return toRendererNode(allNodes.get(id), pos.x, pos.y);
            });
            r.upsertNodes(nodes);
            for (const n of nodes) knownNodeIds.add(n.id);
            popIn(r, nodes.map((n) => n.id), false);
        }

        const rendererLinks = [];
        for (const l of allLinks) {
            const rl = toRendererLink(l);
            if (!knownNodeIds.has(rl.from) || !knownNodeIds.has(rl.to)) continue;
            if (knownLinkIds.has(rl.id) || !isLinkShown(l)) continue;
            knownLinkIds.add(rl.id);
            rendererLinks.push(rl);
        }
        if (rendererLinks.length) r.upsertLinks(rendererLinks);
        refreshExpansion();
    }

    legendBody.addEventListener("click", (e) => {
        const key = e.target.closest("[data-filter]")?.dataset.filter;
        if (!key) return;
        if (key === "*") hiddenKeys.clear();
        else if (hiddenKeys.has(key)) hiddenKeys.delete(key);
        else hiddenKeys.add(key);
        run(applyFilters);
        updateLegend();
    });

    // ── Long press: remove an article ────────────────────────────────────────

    // Removes the node; for an expanded node, also the articles it revealed that were
    // never clicked themselves (unless another expanded node links to them as well).
    function removeArticle(id) {
        if (id === "query" || !knownNodeIds.has(id)) return;

        const doomed = new Set([id]);
        if (expandedIds.has(id)) {
            for (const [child, parent] of parentOf) {
                if (parent !== id || expandedIds.has(child) || !knownNodeIds.has(child)) continue;
                const heldElsewhere = (adjacency.get(child) ?? []).some(
                    (nb) => nb !== id && expandedIds.has(nb) && knownNodeIds.has(nb),
                );
                if (!heldElsewhere) doomed.add(child);
            }
        }

        hideTooltip();
        if (doomed.has(sheetId)) hideSheet();

        const linkIds = [];
        allLinks = allLinks.filter((l) => {
            if (!doomed.has(String(l.from)) && !doomed.has(String(l.to))) return true;
            const rl = toRendererLink(l);
            if (knownLinkIds.delete(rl.id)) linkIds.push(rl.id);
            return false;
        });
        for (const gone of doomed) {
            leaving.set(gone, fieldsById.get(gone));
            for (const nb of adjacency.get(gone) ?? []) {
                const list = adjacency.get(nb);
                if (list) adjacency.set(nb, list.filter((x) => x !== gone));
            }
            adjacency.delete(gone);
            allNodes.delete(gone);
            fieldsById.delete(gone);
            nodeEdgeMap.delete(gone);
            knownNodeIds.delete(gone);
            filteredOut.delete(gone);
            shownNodeIds.delete(gone);
            expandedIds.delete(gone);
            parentOf.delete(gone);
        }
        refreshExpansion();

        // shrink away, then drop the nodes and their links from the renderer
        const now = performance.now();
        run((r) => {
            for (const gone of doomed) {
                pops.set(gone, { start: now, ms: POP_OUT_MS, from: 1, to: POP_MIN_SCALE, ease: easeInBack });
                markers.delete(gone);
                const d = leaving.get(gone);
                const pill = pillLayout(titleOf(d, gone), isStub(d));
                r.animateNodeSize(gone, pill.w * POP_MIN_SCALE, pill.h * POP_MIN_SCALE, { durationMs: POP_OUT_MS, easing: "ease-in-back", commit: true });
            }
            setTimeout(() => {
                for (const gone of doomed) {
                    leaving.delete(gone);
                    pops.delete(gone);
                }
                if (removed || !renderer) return;
                safe((rr) => {
                    rr.removeLinks(linkIds);
                    rr.removeNodes([...doomed]);
                }, renderer);
            }, POP_OUT_MS);
        });
    }

    // ── Expand a node on click ───────────────────────────────────────────────

    async function expandNode(nodeId) {
        if (expandingNodes.has(nodeId)) return;
        expandingNodes.add(nodeId);
        if (sheetId === nodeId) renderSheet();
        // the ring is drawn on the overlay: nothing is re-sent to the engine
        expandedIds.add(nodeId);

        const shownRefs = shownRefsByNode.get(nodeId) ?? new Set();
        const shownRels = shownRelsByNode.get(nodeId) ?? new Set();

        try {
            const resp = await fetch(`${API}/expand`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    openalex_id: nodeId,
                    shown_node_ids: [...shownNodeIds],
                    shown_ref_ids: [...shownRefs],
                    shown_rel_ids: [...shownRels],
                }),
            });

            if (!resp.ok) {
                console.warn(`[expand] ${nodeId} → HTTP ${resp.status}`);
                if (resp.status === 404) exhaustedIds.add(nodeId);
                return;
            }
            if (removed || !knownNodeIds.has(nodeId)) return;   // removed while loading

            const payload = await resp.json();
            const newNodes = payload.nodes ?? [];
            const newLinks = payload.links ?? [];

            // Register new nodes before addData so the cross-link pass sees them
            for (const node of newNodes) {
                registerEdges({ id: node.id, data: fieldsOf(node) ?? {} });
                if (!parentOf.has(String(node.id))) parentOf.set(String(node.id), nodeId);
            }

            // Update pagination cursors for the expanded node
            if (!shownRefsByNode.has(nodeId)) shownRefsByNode.set(nodeId, new Set());
            if (!shownRelsByNode.has(nodeId)) shownRelsByNode.set(nodeId, new Set());
            for (const id of payload.new_ref_ids ?? []) shownRefsByNode.get(nodeId).add(id);
            for (const id of payload.new_rel_ids ?? []) shownRelsByNode.get(nodeId).add(id);
            if (!(payload.new_ref_ids ?? []).length && !(payload.new_rel_ids ?? []).length) {
                exhaustedIds.add(nodeId);
            }

            // Client-side cross-link pass: existing nodes → new nodes
            // (server handles new→existing and new→new)
            const newNodeIdSet = new Set(newNodes.map(n => n.id));
            const extraLinks = [];
            const seenLinkKeys = new Set(newLinks.map(l => `${l.from}|${l.to}`));

            for (const [existingId, edges] of nodeEdgeMap.entries()) {
                if (existingId === nodeId) continue;
                for (const refId of edges.ref_ids) {
                    if (!newNodeIdSet.has(refId)) continue;
                    const key = `${existingId}|${refId}`;
                    if (seenLinkKeys.has(key)) continue;
                    seenLinkKeys.add(key);
                    extraLinks.push({ from: existingId, to: refId, style: REF_STYLE });
                }
                for (const relId of edges.rel_ids) {
                    if (!newNodeIdSet.has(relId)) continue;
                    const key = `${existingId}|${relId}`;
                    if (seenLinkKeys.has(key)) continue;
                    seenLinkKeys.add(key);
                    extraLinks.push({ from: existingId, to: relId, style: REL_STYLE });
                }
            }

            chart.addData({
                nodes: newNodes,
                links: [...newLinks, ...extraLinks],
            }, nodeId);

        } catch (err) {
            console.error(`[expand] ${nodeId} failed:`, err);
        } finally {
            expandingNodes.delete(nodeId);
            refreshExpansion();
        }
    }

    // ── Pointer tracking (tooltip position; "the user moved the view") ──────────

    let pointerX = 0;
    let pointerY = 0;
    let pressed = null;

    const onPointerMove = (e) => {
        if (pressed) invalidate();
        pointerX = e.clientX;
        pointerY = e.clientY;
        if (_tooltip && _tooltip.style.display !== "none") {
            positionTooltip(pointerX, pointerY);
        }
        // a press that travels is a pan or a drag: stop re-fitting the view after that
        if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 6) userMoved = true;
    };
    let pointerType = "mouse";
    const onPointerDown = (e) => {
        invalidate();
        pressed = { x: e.clientX, y: e.clientY };
        pointerType = e.pointerType || "mouse";
        if (pointerType !== "mouse") hideTooltip();
    };
    const onPointerUp = () => { pressed = null; invalidate(); };
    const onWheel = () => { userMoved = true; invalidate(); };

    // iPad Safari: a pinch on the graph zooms the graph, never the page
    const onGesture = (e) => e.preventDefault();
    container.addEventListener("gesturestart", onGesture);
    container.addEventListener("gesturechange", onGesture);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: true });

    // ── Renderer events ──────────────────────────────────────────────────────
    //   hoverchange → { hoverNodeId, hoverLinkId }
    //   click / doubleclick / longpress → { nodeId, linkId, screenX, screenY, chartX, chartY, ... }

    const handleEvent = (event) => {
        switch (event.type) {
            case "hoverchange": {
                const id = event.hoverNodeId;
                if (id && id !== "query" && pointerType === "mouse") {
                    const d = fieldsById.get(id);
                    if (d) showTooltip(d, pointerX, pointerY, remainingFor(id));
                    else hideTooltip();
                } else {
                    hideTooltip();
                }
                break;
            }

            case "nodeexpand": {
                // a click on the expansion marker; the articles come from the server
                const id = event.nodeId;
                if (id && fieldsById.has(id) && remainingFor(id) !== 0) expandNode(id);
                break;
            }

            case "longpress": {
                // the adapter suppresses the click that would follow the release
                if (event.nodeId) removeArticle(event.nodeId);
                break;
            }

            case "click": {
                const id = event.nodeId;
                const touch = pointerType !== "mouse";
                // a click on an article's hairs: reveal more of it
                const rect = container.getBoundingClientRect();
                const sx = Number.isFinite(event.screenX) ? event.screenX : pointerX - rect.left;
                const sy = Number.isFinite(event.screenY) ? event.screenY : pointerY - rect.top;
                const hairId = !id && hairHit(hairHits, sx, sy);
                if (hairId && fieldsById.has(hairId) && remainingFor(hairId) !== 0) {
                    expandNode(hairId);
                    return;
                }
                if (!id || id === "query") {
                    if (touch) hideSheet();
                    return;
                }
                const d = fieldsById.get(id);
                if (!d) return;

                if (isStub(d)) {
                    // on touch the sheet offers OpenAlex instead of leaving the page at once
                    if (touch) showSheet(id);
                    else window.open(`https://openalex.org/${d.openalex_id || id}`, "_blank");
                    return;
                }

                if (remainingFor(id) !== 0) expandNode(id);
                if (touch) showSheet(id);
                break;
            }

            case "doubleclick": {
                const id = event.nodeId;
                if (!id || id === "query") return;
                const d = fieldsById.get(id);
                if (!d) return;

                if (d.is_stub_node) {
                    if (onUploadStub) {
                        hideTooltip();
                        onUploadStub(d);
                    }
                    return;
                }

                if (d.stub_document) return;

                if (onOpenPdf) {
                    hideTooltip();
                    onOpenPdf(d);
                }
                break;
            }

            default:
                break;
        }
    };

    // ── Resize: the canvas must follow its box ───────────────────────────────

    const resizeObserver = typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            if (width < 1 || height < 1) return;
            latestSize = { w: Math.floor(width), h: Math.floor(height) };
            invalidate();
            if (renderer) safe((r) => r.resize(latestSize.w, latestSize.h), renderer);
        })
        : null;
    if (resizeObserver) resizeObserver.observe(container);

    // ── Public handle ────────────────────────────────────────────────────────

    const chart = {
        // Add nodes/links (same payload shape as NetChart's addData); all of them are shown.
        // anchorId (optional) is the node the new ones fan out from.
        addData(payload, anchorId = null) {
            remember(payload);
            const ids = (payload?.nodes ?? []).filter((n) => n?.id != null).map((n) => String(n.id));
            run((r) => draw(r, ids, anchorId, false));
        },

        remove() {
            if (removed) return;
            removed = true;
            queue.length = 0;
            if (fitTimer) clearTimeout(fitTimer);
            cancelAnimationFrame(frame);
            if (resizeObserver) resizeObserver.disconnect();
            container.removeEventListener("gesturestart", onGesture);
            container.removeEventListener("gesturechange", onGesture);
            container.removeEventListener("pointermove", onPointerMove);
            container.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("pointerup", onPointerUp);
            container.removeEventListener("wheel", onWheel);
            hideTooltip();
            if (offEvents) offEvents();
            if (renderer) renderer.destroy();   // if still mounting, destroyed once it resolves
            renderer = null;
            canvas.remove();
            overlay.remove();
            legend.remove();
            sheet.remove();
        },

        get renderer() { return renderer; },
    };

    // ── Mount ────────────────────────────────────────────────────────────────

    remember(chartData);
    // With initialNodes, only their neighbourhood shows at first (as NetChart navigation
    // did); without, everything.
    const seeds = (initialNodes ?? []).map(String).filter((id) => allNodes.has(id));
    focusOn(seeds.length ? seeds : [...allNodes.keys()], null, true);

    // Pills are sized from measured text, so wait for Poppins before the first draw.
    const fontsReady = document.fonts
        ? Promise.all([
            document.fonts.load(`500 ${PILL_FONT_SIZE}px Poppins`),
            document.fonts.load(`400 ${STUB_FONT_SIZE}px Poppins`),
        ]).catch(() => null)
        : Promise.resolve();

    // "viewer": pan, zoom, select and drag nodes, no editing.
    Promise.all([
        GraphRenderer.mount(canvas, {
            darkModeEnabled: true,
            controlMode: "viewer",
            wheelEnabled: true,
        }),
        fontsReady,
    ]).then(([r]) => {
        if (removed) { r.destroy(); return; }
        renderer = r;

        r.patchSettings({ backgroundColor: CHART_BG });
        // snap to grid is on by default and makes the layout stiff and blocky
        r.setSnapToGrid({ enabled: false, gridSize: 32 });
        r.setLayoutConfig(LAYOUT);
        r.setLongPressOptions({ enabled: true, durationMs: LONG_PRESS_MS, movementTolerancePx: 10 });

        // onEvent returns an unsubscribe function
        offEvents = r.onEvent((event) => safe(() => handleEvent(event), r));

        if (latestSize) r.resize(latestSize.w, latestSize.h);

        for (const fn of queue.splice(0)) safe(fn, r);
    }).catch((err) => {
        console.error("[chart] failed to mount graph renderer:", err);
    });

    return chart;
};

// Shared with the author network (MafiaChart).
export {
    drawHairs, hairHit, MARKER_MAX_HAIRS,
    CHART_BG, PILL_FONT_FAMILY, LINK_LABEL_STYLE, LONG_PRESS_MS, MIN_TEXT_PX,
    POP_IN_MS, POP_OUT_MS, POP_MIN_SCALE, POP_START_MS, POP_STAGGER_MS, MAX_FIT_ZOOM, FIT_GLIDE_MS,
    parseColor, solidColor, textColorOn, escapeHtml, isEngineFault, adapterOf, easeOutBack, easeInBack,
    getTooltip, positionTooltip, hideTooltip, legendRow, legendSection, pillSwatch, lineSwatch,
};
export default CreateChart;
