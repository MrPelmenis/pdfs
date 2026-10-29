import { GraphRenderer } from "@chartizer/graph-renderer";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from "d3-force";
import {
    CHART_BG, PILL_FONT_FAMILY, LINK_LABEL_STYLE, LONG_PRESS_MS, MIN_TEXT_PX,
    POP_IN_MS, POP_OUT_MS, POP_MIN_SCALE, POP_START_MS, POP_STAGGER_MS, MAX_FIT_ZOOM, FIT_GLIDE_MS,
    solidColor, textColorOn, escapeHtml, isEngineFault, adapterOf, easeOutBack, easeInBack,
    drawHairs, hairHit, MARKER_MAX_HAIRS, guardHover,
    getTooltip, positionTooltip, hideTooltip, legendRow, legendSection, pillSwatch, lineSwatch,
} from "./Chart";

// ── Author network ("science mafia" map) ─────────────────────────────────────
//
// Authors are pills sized by how embedded they are in the network and coloured by the
// field of their papers. Authors with papers in several fields are white, ringed in the
// colour of the field they publish in most.

const MULTI_FILL = "#eef0f2";
const NO_FIELD_FILL = "#5f6368";
const SELECTED_STROKE = "#ffffff";
// Name size = how the scientist ranks by career citations (OpenAlex) among the authors
// on the map: the most cited is biggest, the least cited smallest, the rest spread in
// between (a little more room at the top). Sizing by the citation numbers themselves
// left half of the authors within a few pixels of each other: counts run from tens to
// hundreds of thousands, so most land in the same middle band.
const NAME_MIN_FONT = 10;
const NAME_FONT_RANGE = 34;
const NAME_RANK_CURVE = 2.2;
const CITE_COLOR = (a) => `rgba(232,234,237,${a})`;
const COAUTHOR_COLOR = (a) => `rgba(45,212,191,${a})`;

// The renderer's own force layout pulls every link equally (its link weight barely
// matters), so a few thousand citations tie everyone into one ball. The layout is done
// here instead, with d3-force, and the renderer only draws:
//  - a link pulls in proportion to how often the two authors cite / co-author, so a
//    one-off citation hardly pulls and close collaborators sit together;
//  - each field has a home on a ring, so authors gather into field islands and the
//    citations between fields show as bridges.
const SIM_CHARGE = -2400;
const SIM_CHARGE_MAX_DISTANCE = 3000;
const SIM_FIELD_PULL = 0.11;          // towards the author's field island
const SIM_MULTI_FIELD_PULL = 0.025;   // authors in several fields sit between islands
const SIM_LINK_GAP = 90;              // world units between two linked pills
const SIM_TICKS_PER_FRAME = 4;
const SIM_WARMUP_TICKS = 60;          // run before the first frame, so it starts roughly in shape
const ISLAND_RING_PER_NODE = 160;
// After a drag the layout cools down more slowly (d3's default is ~0.023), so the
// neighbourhood visibly settles for a couple of seconds instead of freezing at once.
const SIM_DRAG_ALPHA_DECAY = 0.01;
// While dragging, the layout is kept just warm enough for neighbours to follow, with
// extra friction and one tick per frame. (d3's usual 0.3 heat at 4 ticks a frame made
// the crowd around the dragged author shake and never come to rest.)
const SIM_DRAG_HEAT = 0.06;
const SIM_DRAG_VELOCITY_DECAY = 0.6;     // ring radius = this × √authors

const NO_LABEL = { ...LINK_LABEL_STYLE, visible: false };
// Link width is a multiple of how often: per citation / per co-authored paper, capped
// so the few pairs with dozens don't bury the map (a straight multiple below the cap).
const CITE_WIDTH_PER = 0.5;
const COAUTHOR_WIDTH_PER = 1;
const LINK_MAX_WIDTH = 14;

// Field the author publishes in most (ignoring "none"), or null.
export function dominantField(author) {
    let best = null;
    for (const [id, n] of Object.entries(author.fields ?? {})) {
        if (id === "0") continue;
        if (!best || n > best.n) best = { id: Number(id), n };
    }
    return best?.id ?? null;
}

export function authorColors(author, categories) {
    const dom = dominantField(author);
    const domColor = dom != null ? solidColor(categories.get(dom)?.color ?? NO_FIELD_FILL) : NO_FIELD_FILL;
    if (author.multi) return { fill: MULTI_FILL, stroke: domColor, strokeWidth: 3.5, text: "#111317" };
    if (dom == null) return { fill: NO_FIELD_FILL, stroke: CHART_BG, strokeWidth: 1.5, text: "#f5f6f7" };
    return { fill: domColor, stroke: CHART_BG, strokeWidth: 1.5, text: textColorOn(domColor) };
}

// The scientist's public profile: OpenAlex by id (exact); authors only known by name
// (no OpenAlex id) get a Google Scholar author search.
export function profileUrl(author) {
    return /^A\d+$/.test(author.id)
        ? `https://openalex.org/authors/${author.id}`
        : `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(author.name)}`;
}

// author id -> 0..1, their place by citations among `authors` (ties share a place)
function citationRanks(authors) {
    const sorted = [...authors].sort((a, b) => (a.citations ?? 0) - (b.citations ?? 0));
    const ranks = new Map();
    const last = Math.max(1, sorted.length - 1);
    let place = 0;
    sorted.forEach((a, i) => {
        if (i > 0 && (a.citations ?? 0) !== (sorted[i - 1].citations ?? 0)) place = i;
        ranks.set(a.id, place / last);
    });
    return ranks;
}

function nameSize(rank) {
    return Math.round(NAME_MIN_FONT + NAME_FONT_RANGE * rank ** NAME_RANK_CURVE);
}

let _measureCtx = null;
const _nameCache = new Map();

function nameLayout(name, fontSize) {
    const key = `${fontSize}|${name}`;
    const cached = _nameCache.get(key);
    if (cached) return cached;
    _measureCtx ||= document.createElement("canvas").getContext("2d");
    _measureCtx.font = `600 ${fontSize}px ${PILL_FONT_FAMILY}`;
    const h = Math.round(fontSize * 2.2);
    const layout = { fontSize, w: Math.ceil(_measureCtx.measureText(name).width + h * 0.9), h, corner: h / 2 };
    _nameCache.set(key, layout);
    return layout;
}

// A home for each field on a ring, biggest fields first; authors without a field
// gather in the middle.
function fieldAnchors(authors) {
    const counts = new Map();
    for (const a of authors) {
        const f = dominantField(a);
        if (f != null) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const order = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([f]) => f);
    const radius = order.length > 1 ? ISLAND_RING_PER_NODE * Math.sqrt(authors.length) : 0;
    const anchors = new Map();
    order.forEach((f, i) => {
        const angle = (i / order.length) * 2 * Math.PI - Math.PI / 2;
        anchors.set(f, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    });
    return anchors;
}

function fieldChips(author, categories) {
    return Object.entries(author.fields ?? {})
        .map(([id, n]) => {
            const cat = categories.get(Number(id));
            const name = Number(id) === 0 || !cat ? "uncategorised" : cat.name;
            const color = cat ? solidColor(cat.color) : NO_FIELD_FILL;
            return `<span style="display:inline-flex;align-items:center;gap:5px;margin:2px 8px 2px 0;white-space:nowrap">
                <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>${escapeHtml(name)} · ${n}</span>`;
        })
        .join("");
}

function showAuthorTooltip(author, categories, x, y) {
    const tip = getTooltip();
    tip.innerHTML = `
        <div style="font-weight:600;font-size:13px;color:#fff;margin-bottom:4px">${escapeHtml(author.name)}</div>
        <div style="color:#9aa0a6;margin-bottom:2px">${(author.citations ?? 0).toLocaleString()} citations · h-index ${author.h_index ?? "—"} <span style="color:#5f6368">(career)</span></div>
        <div style="color:#9aa0a6;margin-bottom:6px">${author.papers} paper${author.papers === 1 ? "" : "s"} in the library
            ${author.multi ? " · <span style='color:#e8eaed'>several fields</span>" : ""}</div>
        <div style="color:#bdc1c6;font-size:10.5px;margin-bottom:6px;display:flex;flex-wrap:wrap">${fieldChips(author, categories)}</div>
        <div style="color:#5f6368;font-size:10px;margin-bottom:2px">Within the library</div>
        <div style="color:#9aa0a6"><span style="color:#5f6368">Cites others </span>${author.cites_out}
            <span style="color:#5f6368;margin-left:10px">Cited by others </span>${author.cited_in}
            <span style="color:#5f6368;margin-left:10px">Co-authorships </span>${author.coauthored}</div>
        <div style="color:#5f6368;font-size:10px;border-top:1px solid rgba(255,255,255,0.07);padding-top:6px;margin-top:6px;display:flex;flex-wrap:wrap;gap:4px 12px">
            <span>${author.more ? `Click: ${Math.min(author.more, 12)} more of ${author.more} hidden connection${author.more === 1 ? "" : "s"}, papers` : "Click for papers and connections"}</span>
            <span>Double-click for their profile</span>
        </div>`;
    positionTooltip(x, y);
    tip.style.display = "block";
}

function showLinkTooltip(link, authors, x, y) {
    const tip = getTooltip();
    const from = escapeHtml(authors.get(link.from)?.name ?? "");
    const to = escapeHtml(authors.get(link.to)?.name ?? "");
    tip.innerHTML = link.type === "cite"
        ? `<div style="color:#9aa0a6;margin-bottom:4px">Cites ×${link.weight}</div>
           <div style="color:#fff;font-weight:600">${from}</div>
           <div style="color:#5f6368;font-size:10px;margin:2px 0">cites work by</div>
           <div style="color:#fff;font-weight:600">${to}</div>`
        : `<div style="color:rgb(45,212,191);margin-bottom:4px">Co-authored ${link.weight} paper${link.weight === 1 ? "" : "s"}</div>
           <div style="color:#fff;font-weight:600">${from} &amp; ${to}</div>`;
    positionTooltip(x, y);
    tip.style.display = "block";
}

/**
 * Mounts the author network into `container`.
 * Returns { setData(network, { cites, coauthors, crossField, hideLonely, anchor }), select(id), focus(id), remove() }.
 * `anchor` is the author just expanded: the authors it brought in start beside it.
 * `onExpand(id)` fires when an author (or their hairs) is clicked and they have hidden connections,
 * `onOpenProfile(author)` on a double-click.
 * `onSelect(id | null)` fires when an author is clicked or the selection is cleared.
 */
export default function createMafiaChart(container, { onSelect, onExpand, onOpenProfile, legend: withLegend = true } = {}) {
    if (!container) return null;
    if (!container.style.position) container.style.position = "relative";
    Object.assign(container.style, { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" });

    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block", background: CHART_BG });
    const overlay = document.createElement("canvas");
    Object.assign(overlay.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block", pointerEvents: "none" });
    container.append(canvas, overlay);
    const octx = overlay.getContext("2d");

    const legend = document.createElement("div");
    legend.className = "glass";
    Object.assign(legend.style, {
        position: "absolute", left: "16px", top: "16px", maxWidth: "240px", maxHeight: "calc(100% - 32px)",
        overflowY: "auto", display: "none", flexDirection: "column", gap: "12px", padding: "12px 14px",
        borderRadius: "12px", color: "#bdc1c6",
        fontFamily: PILL_FONT_FAMILY, fontSize: "11px", lineHeight: "1.3", zIndex: "2",
    });
    const legendHeader = document.createElement("button");
    legendHeader.type = "button";
    Object.assign(legendHeader.style, {
        all: "unset", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "12px", fontSize: "11px", fontWeight: "600", color: "#e8eaed",
    });
    const legendBody = document.createElement("div");
    Object.assign(legendBody.style, { display: "flex", flexDirection: "column", gap: "12px" });
    let legendOpen = container.clientWidth >= 640;
    const renderLegendHeader = () => {
        legendHeader.innerHTML = `<span>Legend</span><span style="color:#9aa0a6;font-size:10px">${legendOpen ? "Hide" : "Show"}</span>`;
        legendBody.style.display = legendOpen ? "flex" : "none";
    };
    legendHeader.addEventListener("click", () => { legendOpen = !legendOpen; renderLegendHeader(); });
    renderLegendHeader();
    legend.append(legendHeader, legendBody);
    container.appendChild(legend);

    // ── State ────────────────────────────────────────────────────────────────

    let categories = new Map();
    const authors = new Map();         // id -> author row from /mafia
    const layouts = new Map();         // id -> name pill layout
    const knownLinkIds = new Set();
    const linksById = new Map();       // renderer link id -> link row, for the link tooltip
    let sim = null;
    let simFrame = 0;
    let simNodes = [];                 // the simulation's nodes (kept after it cools down)
    const dragged = new Set();         // ids being dragged: the renderer moves those
    const pinned = new Map();          // id -> {x, y}: dropped by the user, stays put
    let glideOnSettle = false;         // first load: fit the camera once it settles
    const pops = new Map();            // id -> { start, ms, from, to, ease }: the overlay's title scale
    const leaving = new Map();         // id -> { author, pill } while shrinking away
    const markers = new Map();         // id -> hair count (drawn on the overlay)
    let hairHits = [];                 // where hairs were drawn last frame, for clicks
    const neighbours = new Map();      // id -> ids it has a drawn link to
    let selectedId = null;

    let renderer = null;
    let removed = false;
    let failed = false;
    let latestSize = null;
    let userMoved = false;
    let offEvents = null;
    let frame = 0;
    const queue = [];

    const safe = (fn, r) => {
        try {
            fn(r);
        } catch (err) {
            if (isEngineFault(err) || adapterOf(r)?.destroyed) engineFailed(err);
            else console.error("[mafia]", err);
        }
    };
    const run = (fn) => {
        if (removed || failed) return;
        invalidate();
        if (renderer) safe(fn, renderer);
        else queue.push(fn);
    };

    // The overlay (names, hairs) is only redrawn while something can change it: the
    // camera moved, the layout is running, a pop is playing, or something just happened.
    // An idle map costs nothing per frame (iPad battery).
    let dirtyUntil = 0;
    let lastView = "";
    let simRunning = false;
    function invalidate(ms = 500) {
        dirtyUntil = Math.max(dirtyUntil, performance.now() + ms);
    }
    let lastRedraws = -1;
    function overlayIdle(now, w, h) {
        const vp = renderer.getViewport();
        const view = `${w}|${h}|${vp.centerX}|${vp.centerY}|${vp.zoom}`;
        const changed = view !== lastView;
        lastView = view;
        // the engine drew a new frame (a size animation, a selection): follow it
        const redraws = renderer.getPerfStats?.()?.redraws;
        const engineDrew = redraws === undefined || redraws !== lastRedraws;
        lastRedraws = redraws;
        let popping = false;
        for (const [id, pop] of pops) {
            if (now < pop.start + pop.ms + 32) popping = true;
            else if (!leaving.has(id)) pops.delete(id);
        }
        return !changed && !engineDrew && now >= dirtyUntil && !simRunning && !dragged.size && !popping && !leaving.size;
    }

    // Same recovery as the citation graph: finish the half-done teardown and offer a reload.
    function engineFailed(err) {
        if (failed || removed) return;
        failed = true;
        console.error("[mafia] graph engine failed", err);
        const adapter = adapterOf(renderer);
        if (adapter?.engine) {
            adapter.destroyed = false;
            try { adapter.destroy(); } catch { /* already broken */ }
        }
        renderer = null;
        queue.length = 0;
        cancelAnimationFrame(frame);
        cancelAnimationFrame(simFrame);
        if (sim) sim.stop();
        hideTooltip();
        canvas.style.visibility = "hidden";
        overlay.style.visibility = "hidden";
        legend.style.display = "none";
        const notice = document.createElement("div");
        Object.assign(notice.style, {
            position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "14px", padding: "24px", textAlign: "center", color: "#bdc1c6",
            fontFamily: PILL_FONT_FAMILY, fontSize: "13px", zIndex: "4",
        });
        notice.innerHTML = `<div>The graph stopped working.</div>
            <button type="button" style="all:unset;cursor:pointer;height:40px;padding:0 18px;border-radius:10px;background:#dea11c;color:#1e1f22;font-weight:600">Reload graph</button>`;
        notice.querySelector("button").addEventListener("click", () => window.location.reload());
        container.appendChild(notice);
    }

    // ── Mapping ──────────────────────────────────────────────────────────────

    function toRendererNode(author, x, y, pinned) {
        const pill = layouts.get(author.id);
        const colors = authorColors(author, categories);
        const selected = author.id === selectedId;
        return {
            id: author.id, x, y,
            shape: { kind: "rect", width: pill.w, height: pill.h, cornerRadius: pill.corner },
            flags: { pinned },
            style: {
                fillColor: colors.fill,
                strokeColor: selected ? SELECTED_STROKE : colors.stroke,
                strokeWidth: selected ? Math.max(colors.strokeWidth, 3.5) : colors.strokeWidth,
            },
        };
    }

    function toRendererLink(link, maxWeight) {
        const share = Math.log1p(link.weight) / Math.log1p(Math.max(maxWeight, 2));
        const cite = link.type === "cite";
        return {
            id: `${cite ? "c" : "k"}|${link.from}|${link.to}`,
            from: link.from,
            to: link.to,
            points: [],
            weight: 1,
            style: {
                color: cite ? CITE_COLOR(0.1 + 0.5 * share) : COAUTHOR_COLOR(0.35 + 0.5 * share),
                width: Math.min(LINK_MAX_WIDTH, link.weight * (cite ? CITE_WIDTH_PER : COAUTHOR_WIDTH_PER)),
                arrow: cite,
                dashed: false,
                label: "",
                labelStyle: NO_LABEL,
                curveStyle: "straight",
            },
        };
    }

    function updateLegend(shown, linkTypes) {
        const fields = new Map();
        let multi = false;
        let none = false;
        for (const a of shown) {
            if (a.multi) { multi = true; continue; }
            const dom = dominantField(a);
            if (dom == null) none = true;
            else fields.set(dom, (fields.get(dom) ?? 0) + 1);
        }
        const fieldRows = [...fields.entries()]
            .sort((x, y) => y[1] - x[1])
            .map(([id]) => legendRow(pillSwatch(solidColor(categories.get(id)?.color ?? NO_FIELD_FILL)), categories.get(id)?.name ?? "unknown"));
        const otherRows = [
            multi && legendRow(pillSwatch(MULTI_FILL, "#8ab4f8"), "several fields (ring: main one)"),
            none && legendRow(pillSwatch(NO_FIELD_FILL), "uncategorised"),
        ].filter(Boolean);
        const linkRows = [
            linkTypes.has("cite") && legendRow(lineSwatch(CITE_COLOR(0.8), false, true), "cites their work"),
            linkTypes.has("coauthor") && legendRow(lineSwatch(COAUTHOR_COLOR(0.9), false, false), "co-authors"),
        ].filter(Boolean);
        legendBody.innerHTML = [
            legendSection("Authors by field", [...fieldRows, ...otherRows]),
            legendSection("Links", [...linkRows, legendRow("", "width = times cited / papers together")]),
        ].join("");
        legend.style.display = withLegend && shown.length ? "flex" : "none";
    }

    // ── Drawing ──────────────────────────────────────────────────────────────

    function popIn(r, ids) {
        const now = performance.now();
        ids.forEach((id, i) => {
            const pill = layouts.get(id);
            if (!r.animateNodeSize(id, pill.w * POP_MIN_SCALE, pill.h * POP_MIN_SCALE, { durationMs: 1, easing: "linear", commit: true })) return;
            const delay = POP_START_MS + Math.min(i, 40) * POP_STAGGER_MS * 0.4;
            pops.set(id, { start: now + delay, ms: POP_IN_MS, from: POP_MIN_SCALE, to: 1, ease: easeOutBack });
            setTimeout(() => {
                if (removed || !renderer || !authors.has(id)) return;
                safe((rr) => rr.animateNodeSize(id, pill.w, pill.h, { durationMs: POP_IN_MS, easing: "ease-out-back", commit: true }), renderer);
            }, delay);
        });
    }

    // Shrinks the authors away, then drops them (their links are already gone).
    function popOut(r, ids) {
        const now = performance.now();
        for (const id of ids) {
            const pill = layouts.get(id);
            leaving.set(id, { author: authors.get(id), pill });
            pops.set(id, { start: now, ms: POP_OUT_MS, from: 1, to: POP_MIN_SCALE, ease: easeInBack });
            r.animateNodeSize(id, pill.w * POP_MIN_SCALE, pill.h * POP_MIN_SCALE, { durationMs: POP_OUT_MS, easing: "ease-in-back", commit: true });
        }
        setTimeout(() => {
            const still = ids.filter((id) => leaving.has(id) && !authors.has(id));
            for (const id of ids) { leaving.delete(id); if (!authors.has(id)) pops.delete(id); }
            if (!removed && renderer && still.length) safe((rr) => rr.removeNodes(still), renderer);
        }, POP_OUT_MS);
    }

    function scaleOf(id, now) {
        const pop = pops.get(id);
        if (!pop) return 1;
        const t = Math.min(1, Math.max(0, (now - pop.start) / pop.ms));
        if (t >= 1 && !leaving.has(id)) pops.delete(id);
        return pop.from + (pop.to - pop.from) * pop.ease(t);
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
            const zoom = renderer.getViewport().zoom;
            octx.textAlign = "center";
            octx.textBaseline = "middle";
            const drawn = [...authors].map(([id, a]) => [id, a, layouts.get(id)])
                .concat([...leaving].map(([id, l]) => [id, l.author, l.pill]));
            for (const [id, a, pill] of drawn) {
                const pos = renderer.getNodePosition(id);
                if (!pos || !a || !pill) continue;
                const c = renderer.worldToScreen(pos.x, pos.y);
                if (c.x + pill.w * zoom < 0 || c.x - pill.w * zoom > w || c.y + pill.h * zoom < 0 || c.y - pill.h * zoom > h) continue;
                const px = pill.fontSize * zoom * scaleOf(id, now);
                if (px < MIN_TEXT_PX) continue;
                octx.font = `600 ${px}px ${PILL_FONT_FAMILY}`;
                octx.fillStyle = authorColors(a, categories).text;
                octx.fillText(a.name, c.x, c.y);
            }

            // hairs, away from where this author's links come in
            const hits = [];
            for (const [id, count] of markers) {
                if (!authors.has(id) || leaving.has(id) || pops.has(id)) continue;
                const pos = renderer.getNodePosition(id);
                if (!pos) continue;
                const c = renderer.worldToScreen(pos.x, pos.y);
                if (c.x < -200 || c.x > w + 200 || c.y < -200 || c.y > h + 200) continue;
                const pill = layouts.get(id);
                const towards = [];
                for (const nb of neighbours.get(id) ?? []) {
                    const p = renderer.getNodePosition(nb);
                    if (p) towards.push(renderer.worldToScreen(p.x, p.y));
                }
                const hit = drawHairs(octx, c.x, c.y, pill.w, pill.h, zoom, count, towards);
                if (hit) hits.push({ id, ...hit });
            }
            hairHits = hits;
        } catch (err) {
            if (isEngineFault(err)) engineFailed(err);
            else throw err;
        }
    }
    frame = requestAnimationFrame(drawOverlay);

    function fitView(r) {
        r.fitToScreen(60);
        const vp = r.getViewport();
        if (vp.zoom > MAX_FIT_ZOOM) r.setViewport({ centerX: vp.centerX, centerY: vp.centerY, zoom: MAX_FIT_ZOOM });
    }

    // Runs the force layout over a few seconds, moving the pills every frame.
    // On the first load everything settles together. After that, authors already on the
    // map are held where they are and only the new ones find their place: changing a
    // filter adds and removes authors, it never rearranges the map.
    function layout(r, network, links, fresh, anchorId = null) {
        if (sim) sim.stop();
        cancelAnimationFrame(simFrame);
        const initial = fresh.size === network.authors.length;

        // new authors join their field's island where it already is on screen
        const anchors = fieldAnchors(network.authors);
        if (!initial) {
            const sums = new Map();
            for (const a of network.authors) {
                const pos = !fresh.has(a.id) && r.getNodePosition(a.id);
                const f = dominantField(a);
                if (!pos || f == null) continue;
                const acc = sums.get(f) ?? { x: 0, y: 0, n: 0 };
                acc.x += pos.x; acc.y += pos.y; acc.n += 1;
                sums.set(f, acc);
            }
            for (const [f, acc] of sums) anchors.set(f, { x: acc.x / acc.n, y: acc.y / acc.n });
        }
        const anchorOf = (a) => anchors.get(dominantField(a)) ?? { x: 0, y: 0 };

        const nodes = network.authors.map((a) => {
            const pos = r.getNodePosition(a.id);
            const home = anchorOf(a);
            const pill = layouts.get(a.id);
            const pin = pinned.get(a.id);
            const held = pin || (!initial && !fresh.has(a.id) && pos);
            // new authors were inserted at the origin: start them at their island instead
            // (all at one point, the repulsion would blow them apart)
            const start = fresh.has(a.id) || !pos
                ? { x: home.x + (Math.random() - 0.5) * 300, y: home.y + (Math.random() - 0.5) * 300 }
                : pos;
            return {
                id: a.id,
                x: start.x,
                y: start.y,
                fx: pin ? pin.x : held ? pos.x : undefined,
                fy: pin ? pin.y : held ? pos.y : undefined,
                home,
                pull: a.multi ? SIM_MULTI_FIELD_PULL : SIM_FIELD_PULL,
                // pills are wide and short: a circle of 40% of the width keeps neighbours
                // clear without spacing rows as far apart as the pills are wide
                radius: pill.w * 0.4 + 14,
            };
        });
        const degree = new Map();
        for (const l of links) {
            degree.set(l.from, (degree.get(l.from) ?? 0) + 1);
            degree.set(l.to, (degree.get(l.to) ?? 0) + 1);
        }
        const maxWeight = { cite: 1, coauthor: 1 };
        for (const l of links) maxWeight[l.type] = Math.max(maxWeight[l.type], l.weight);
        const simLinks = links.map((l) => ({ source: l.from, target: l.to, weight: l.weight, type: l.type }));

        sim = forceSimulation(nodes)
            .force("charge", forceManyBody().strength(SIM_CHARGE).distanceMax(SIM_CHARGE_MAX_DISTANCE).theta(0.9))
            .force("collide", forceCollide((n) => n.radius).strength(0.9).iterations(2))
            .force("link", forceLink(simLinks).id((n) => n.id)
                .distance((l) => l.source.radius + l.target.radius + SIM_LINK_GAP)
                // pull ∝ how often they cite / co-author (relative to the strongest pair),
                // damped for hubs so one prolific author doesn't drag everyone in
                .strength((l) => {
                    const share = (l.weight / maxWeight[l.type]) ** 0.6;
                    const base = l.type === "coauthor" ? 0.08 + 0.9 * share : 0.01 + 0.5 * share;
                    return base / Math.sqrt(Math.min(degree.get(l.source.id), degree.get(l.target.id)));
                }))
            .force("x", forceX((n) => n.home.x).strength((n) => n.pull))
            .force("y", forceY((n) => n.home.y).strength((n) => n.pull))
            .velocityDecay(0.35)
            .stop();

        simNodes = nodes;
        const moving = initial ? nodes : nodes.filter((n) => n.fx === undefined);
        const push = (rr) => rr.updateNodePositions(moving.map((n) => ({ id: n.id, x: n.x, y: n.y })));
        glideOnSettle = initial;
        if (initial) {
            sim.tick(SIM_WARMUP_TICKS);
            push(r);
            fitView(r);
        } else {
            if (!moving.length) return;
            // new authors start beside the author they link to most, else at their island
            const byId = new Map(nodes.map((n) => [n.id, n]));
            for (const n of moving) {
                const toAnchor = anchorId && simLinks.some((l) => (l.source === n.id && l.target === anchorId) || (l.target === n.id && l.source === anchorId));
                const nb = !toAnchor && simLinks.find((l) => (l.source === n.id && !fresh.has(l.target)) || (l.target === n.id && !fresh.has(l.source)));
                const other = toAnchor ? byId.get(anchorId) : nb && byId.get(nb.source === n.id ? nb.target : nb.source);
                const base = other ?? n.home;
                n.x = base.x + (Math.random() - 0.5) * 160;
                n.y = base.y + (Math.random() - 0.5) * 160;
            }
            sim.alpha(0.5);
            sim.tick(SIM_WARMUP_TICKS);
            push(r);
        }

        runSimulation();
    }

    // Ticks the simulation every frame and moves the pills, until it cools down (and
    // nobody is dragging). Dragged pills are left to the renderer.
    function runSimulation() {
        cancelAnimationFrame(simFrame);
        simRunning = true;
        const step = () => {
            if (removed || !renderer || !sim) { simRunning = false; return; }
            sim.tick(dragged.size ? 1 : SIM_TICKS_PER_FRAME);
            safe((rr) => rr.updateNodePositions(
                simNodes.filter((n) => !dragged.has(n.id)).map((n) => ({ id: n.id, x: n.x, y: n.y })),
            ), renderer);
            if (sim.alpha() > sim.alphaMin() || dragged.size) {
                simFrame = requestAnimationFrame(step);
                return;
            }
            simRunning = false;
            invalidate();
            if (glideOnSettle && !userMoved) {
                safe((rr) => rr.focusNodes(rr.getVisibleNodeIds(), { paddingPx: 60, maxZoom: MAX_FIT_ZOOM, durationMs: FIT_GLIDE_MS }), renderer);
            }
            glideOnSettle = false;
        };
        simFrame = requestAnimationFrame(step);
    }

    // Dragging an author wakes the layout up: the dragged pill follows the pointer, every
    // other author (also those held still since the last filter change, but not ones the
    // user dropped earlier) is free to move around it. Where it is let go, it stays
    // pinned, and the rest cools down around it.
    function dragMove(positions) {
        if (!sim) return;
        const byId = new Map(simNodes.map((n) => [n.id, n]));
        const wasIdle = !dragged.size;
        for (const { id, x, y } of positions) {
            const n = byId.get(id);
            if (!n) continue;
            dragged.add(id);
            n.fx = x;
            n.fy = y;
        }
        if (!dragged.size) return;
        if (wasIdle) {
            for (const n of simNodes) {
                if (dragged.has(n.id) || pinned.has(n.id)) continue;
                n.fx = undefined;
                n.fy = undefined;
            }
            glideOnSettle = false;
        }
        sim.alphaTarget(SIM_DRAG_HEAT).alphaDecay(SIM_DRAG_ALPHA_DECAY).velocityDecay(SIM_DRAG_VELOCITY_DECAY);
        if (sim.alpha() < SIM_DRAG_HEAT) sim.alpha(SIM_DRAG_HEAT);
        if (wasIdle) runSimulation();
    }

    function dragEnd() {
        if (!sim || !dragged.size) return;
        const byId = new Map(simNodes.map((n) => [n.id, n]));
        for (const id of dragged) {
            const n = byId.get(id);
            if (n) pinned.set(id, { x: n.fx, y: n.fy });   // stays where it was dropped
        }
        dragged.clear();
        sim.alphaTarget(0);   // cool down from here
    }

    // Hairs on authors with connections not on the map yet (drawn on the overlay, away
    // from where their links come in).
    function refreshMarkers() {
        markers.clear();
        for (const [id, a] of authors) {
            const count = Math.min(a.more ?? 0, MARKER_MAX_HAIRS);
            if (count) markers.set(id, count);
        }
    }

    const styleKey = (n) => `${n.style.fillColor}|${n.style.strokeColor}|${n.style.strokeWidth}`;
    const nodeStyles = new Map();   // id -> style key last sent
    const linkStyles = new Map();   // link id -> style key last sent

    // Brings the map to a new network: authors that stay are left alone (a changed size
    // or colour is animated / re-sent for them alone), new ones pop in, gone ones pop out.
    function apply(r, fullNetwork, show) {
        categories = new Map((fullNetwork.categories ?? []).map((c) => [c.id, c]));
        // cross-field: only links between authors whose main fields differ
        const byId = new Map(fullNetwork.authors.map((a) => [a.id, a]));
        const fieldOf = (id) => dominantField(byId.get(id));
        const links = fullNetwork.links.filter((l) => (l.type === "cite" ? show.cites : show.coauthors)
            && (!show.crossField || fieldOf(l.from) !== fieldOf(l.to)));
        let network = fullNetwork;
        if (show.hideLonely) {
            const linked = new Set(links.flatMap((l) => [l.from, l.to]));
            network = { ...fullNetwork, authors: fullNetwork.authors.filter((a) => linked.has(a.id)) };
        }
        const next = new Map(network.authors.map((a) => [a.id, a]));
        const ranks = citationRanks(network.authors);

        // links first: a link must not outlive one of its ends
        const maxWeight = Math.max(1, ...links.map((l) => l.weight));
        const rendererLinks = links.map((l) => toRendererLink(l, maxWeight));
        const nextLinkIds = new Set(rendererLinks.map((l) => l.id));
        const staleLinks = [...knownLinkIds].filter((id) => !nextLinkIds.has(id));
        if (staleLinks.length) r.removeLinks(staleLinks);
        for (const id of staleLinks) { knownLinkIds.delete(id); linkStyles.delete(id); }

        const goneIds = [...authors.keys()].filter((id) => !next.has(id));
        if (goneIds.length) popOut(r, goneIds);
        for (const id of goneIds) { authors.delete(id); layouts.delete(id); nodeStyles.delete(id); markers.delete(id); pinned.delete(id); }
        if (selectedId && !next.has(selectedId)) selectedId = null;

        const fresh = new Set();
        const freshNodes = [];
        const restyled = [];
        for (const a of network.authors) {
            const pill = nameLayout(a.name, nameSize(ranks.get(a.id) ?? 0));
            const prevPill = layouts.get(a.id);
            const known = authors.has(a.id) || leaving.has(a.id);
            authors.set(a.id, a);
            layouts.set(a.id, pill);
            if (!known) {
                fresh.add(a.id);
                freshNodes.push(toRendererNode(a, 0, 0, false));
                continue;
            }
            if (leaving.has(a.id)) {
                // came back while shrinking away: grow it again where it is
                leaving.delete(a.id);
                fresh.add(a.id);
            }
            const pos = r.getNodePosition(a.id);
            const node = pos && toRendererNode(a, pos.x, pos.y, false);
            if (node && styleKey(node) !== nodeStyles.get(a.id)) {
                restyled.push(node);
            } else if (prevPill && prevPill !== pill && !fresh.has(a.id)) {
                r.animateNodeSize(a.id, pill.w, pill.h, { durationMs: POP_IN_MS, easing: "ease-out-cubic", commit: true });
            }
            if (node) nodeStyles.set(a.id, styleKey(node));
        }
        if (restyled.length) r.upsertNodes(restyled);
        if (freshNodes.length) {
            r.upsertNodes(freshNodes);
            for (const n of freshNodes) nodeStyles.set(n.id, styleKey(n));
        }

        // place new authors before they appear, then pop them in
        layout(r, network, links, fresh, show.anchor ?? null);
        if (fresh.size) popIn(r, [...fresh]);

        const changedLinks = rendererLinks.filter((rl) => {
            const key = `${rl.style.color}|${rl.style.width}`;
            if (linkStyles.get(rl.id) === key) return false;
            linkStyles.set(rl.id, key);
            return true;
        });
        if (changedLinks.length) r.upsertLinks(changedLinks);
        linksById.clear();
        rendererLinks.forEach((rl, i) => { knownLinkIds.add(rl.id); linksById.set(rl.id, links[i]); });

        neighbours.clear();
        for (const l of links) {
            if (!next.has(l.from) || !next.has(l.to)) continue;
            (neighbours.get(l.from) ?? neighbours.set(l.from, []).get(l.from)).push(l.to);
            (neighbours.get(l.to) ?? neighbours.set(l.to, []).get(l.to)).push(l.from);
        }
        refreshMarkers();
        updateLegend(network.authors, new Set(links.map((l) => l.type)));
        if (fresh.size === network.authors.length) userMoved = false;
    }

    function restyle(r, id) {
        const a = authors.get(id);
        const pos = a && r.getNodePosition(id);
        if (!pos) return;
        r.upsertNode(toRendererNode(a, pos.x, pos.y, false));
    }

    function select(id, notify = false) {
        const prev = selectedId;
        selectedId = id && authors.has(id) ? id : null;
        run((r) => {
            if (prev && prev !== selectedId) restyle(r, prev);
            if (selectedId) restyle(r, selectedId);
        });
        if (notify && onSelect) onSelect(selectedId);
    }

    // ── Pointer + renderer events ────────────────────────────────────────────

    let pointerX = 0;
    let pointerY = 0;
    let pressed = null;
    let pointerType = "mouse";
    const onPointerMove = (e) => {
        if (pressed) invalidate();
        pointerX = e.clientX;
        pointerY = e.clientY;
        if (getTooltip().style.display !== "none") positionTooltip(pointerX, pointerY);
        if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 6) userMoved = true;
    };
    const onPointerDown = (e) => {
        invalidate();
        pressed = { x: e.clientX, y: e.clientY };
        pointerType = e.pointerType || "mouse";
        if (pointerType !== "mouse") hideTooltip();
    };
    // also here: a drag released outside the graph never reaches the renderer
    const onPointerUp = () => { pressed = null; dragEnd(); invalidate(); };
    const onWheel = () => { userMoved = true; invalidate(); };
    // iPad Safari: a pinch on the graph zooms the graph, never the page
    const onGesture = (e) => e.preventDefault();
    container.addEventListener("gesturestart", onGesture);
    container.addEventListener("gesturechange", onGesture);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: true });
    const unguardHover = guardHover(container);

    const handleEvent = (event) => {
        if (event.type === "hoverchange") {
            const a = event.hoverNodeId && authors.get(event.hoverNodeId);
            const l = !a && event.hoverLinkId && linksById.get(event.hoverLinkId);
            if (pointerType !== "mouse") hideTooltip();
            else if (a) showAuthorTooltip(a, categories, pointerX, pointerY);
            else if (l) showLinkTooltip(l, authors, pointerX, pointerY);
            else hideTooltip();
        } else if (event.type === "pointerdrag") {
            if (event.nodeIds?.length) {
                hideTooltip();
                dragMove(event.positions ?? []);
            }
        } else if (event.type === "pointerup") {
            dragEnd();
        } else if (event.type === "nodeexpand") {
            // a click on the hairs: bring in this author's hidden connections
            const a = event.nodeId && authors.get(event.nodeId);
            if (a?.more && onExpand) onExpand(a.id);
        } else if (event.type === "doubleclick") {
            const a = event.nodeId && authors.get(event.nodeId);
            if (a && onOpenProfile) { hideTooltip(); onOpenProfile(a); }
        } else if (event.type === "click") {
            hideTooltip();
            if (!event.nodeId) {
                // a click on an author's hairs: bring in their hidden connections
                const rect = container.getBoundingClientRect();
                const sx = Number.isFinite(event.screenX) ? event.screenX : pointerX - rect.left;
                const sy = Number.isFinite(event.screenY) ? event.screenY : pointerY - rect.top;
                const hairId = hairHit(hairHits, sx, sy);
                if (hairId && onExpand) { onExpand(hairId); return; }
            }
            const a = event.nodeId && authors.get(event.nodeId);
            select(a ? a.id : null, true);
            // like the citation graph: a click also brings in their hidden connections
            if (a?.more && onExpand) onExpand(a.id);
        }
    };

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

    // ── Mount ────────────────────────────────────────────────────────────────

    // The engine faults when it idles with no nodes at all, so it is only mounted once
    // the first network is ready to go in.
    let mounting = false;
    function mount() {
        if (mounting) return;
        mounting = true;
        const fontsReady = document.fonts
            ? document.fonts.load(`600 ${NAME_MIN_FONT}px Poppins`).catch(() => null)
            : Promise.resolve();
        Promise.all([
            GraphRenderer.mount(canvas, { darkModeEnabled: true, controlMode: "viewer", wheelEnabled: true }),
            fontsReady,
        ]).then(([r]) => {
            if (removed) { r.destroy(); return; }
            renderer = r;
            r.patchSettings({ backgroundColor: CHART_BG });
            r.setSnapToGrid({ enabled: false, gridSize: 32 });
            r.setLayoutConfig({ enabled: false });
            r.setLongPressOptions({ enabled: false, durationMs: LONG_PRESS_MS, movementTolerancePx: 10 });
            offEvents = r.onEvent((event) => safe(() => handleEvent(event), r));
            if (latestSize) r.resize(latestSize.w, latestSize.h);
            for (const fn of queue.splice(0)) safe(fn, r);
        }).catch((err) => console.error("[mafia] failed to mount graph renderer:", err));
    }

    return {
        setData(network, show = { cites: true, coauthors: true }) {
            if (!network.authors.length && !renderer) return;
            run((r) => apply(r, network, show));
            mount();
        },
        select: (id) => select(id),
        // Glide to an author, e.g. one picked from the side panel.
        focus(id) {
            run((r) => {
                if (authors.has(id)) r.focusNode(id, { maxZoom: 1.2, durationMs: FIT_GLIDE_MS });
            });
        },
        remove() {
            if (removed) return;
            removed = true;
            queue.length = 0;
            cancelAnimationFrame(frame);
            cancelAnimationFrame(simFrame);
            if (sim) sim.stop();
            if (resizeObserver) resizeObserver.disconnect();
            container.removeEventListener("gesturestart", onGesture);
            container.removeEventListener("gesturechange", onGesture);
            container.removeEventListener("pointermove", onPointerMove);
            container.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("pointerup", onPointerUp);
            unguardHover();
            container.removeEventListener("wheel", onWheel);
            hideTooltip();
            if (offEvents) offEvents();
            if (renderer) renderer.destroy();
            renderer = null;
            canvas.remove();
            overlay.remove();
            legend.remove();
        },
    };
}
