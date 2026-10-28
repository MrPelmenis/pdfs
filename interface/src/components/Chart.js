import { GraphRenderer } from "@chartizer/graph-renderer";

const SEARCH_ICON = "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Search_Icon.svg/500px-Search_Icon.svg.png?_=20181016161702";
const API = process.env.REACT_APP_SERVER_URL;

// ── Visual constants (ported from the NetChart style block) ──────────────────

const CHART_BG = "#202124";
const NODE_FILL = "rgba(28,124,213,0.92)";
const NODE_STROKE = "rgba(0,0,0,0.15)";
const QUERY_NODE_RADIUS = 28;
const LABEL_MAX_WIDTH = 240;
const LINK_FILL = "rgba(255,255,255,0.15)";
const DEFAULT_LINK_RADIUS = 5;
// NetChart styled links by "radius" (half the thickness); the renderer takes a line width.
const LINK_WIDTH_PER_RADIUS = 2;
const GOLDEN_ANGLE = 2.399963229728653;
// NetChart navigation: show nodes within this many hops of the initial / clicked nodes.
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

// ── Tooltip ──────────────────────────────────────────────────────────────────

let _tooltip = null;

function getTooltip() {
    if (_tooltip) return _tooltip;
    _tooltip = document.createElement("div");
    Object.assign(_tooltip.style, {
        position: "fixed",
        pointerEvents: "none",
        zIndex: "99999",
        background: "rgba(15,15,20,0.95)",
        color: "#e8e8e8",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "8px",
        padding: "8px 12px",
        fontSize: "11px",
        lineHeight: "1.5",
        width: "360px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.55)",
        display: "none",
        fontFamily: "sans-serif",
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

function showTooltip(d, x, y) {
    const tip = getTooltip();
    const title = d.title || "—";
    const oaId = d.openalex_id || "—";
    const doi = d.doi || "—";
    const cited = d.cited ?? "—";
    const authors = Array.isArray(d.authors) && d.authors.length
        ? d.authors.join(", ")
        : "—";

    const snippetHtml = buildSnippetHtml(d);

    const isStub = !!d.is_stub_node;
    const clickHint = isStub ? "Click to open on OpenAlex" : "Click to expand references";
    const dblHint = isStub ? "Double-click to upload this document" : (d.stub_document ? "Double-click for DOI info" : "Double-click to view PDF");

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
        <div style="font-weight:600;font-size:12px;color:#fff;margin-bottom:5px">${title}</div>
        ${categoryHtml}
        <div style="color:#94a3b8;margin-bottom:2px"><span style="color:#64748b">Authors </span>${authors}</div>
        <div style="color:#94a3b8;margin-bottom:2px"><span style="color:#64748b">OpenAlex </span><span style="color:#7dd3fc">${oaId}</span></div>
        ${doi !== "—" ? `<div style="color:#94a3b8;margin-bottom:2px"><span style="color:#64748b">DOI </span><span style="color:#7dd3fc">${doi}</span></div>` : ""}
        <div style="color:#94a3b8;margin-bottom:5px"><span style="color:#64748b">Cited by </span>${cited}</div>
        ${snippetHtml ? `<div style="color:#94a3b8;margin-bottom:5px;font-style:italic;font-size:12px">${snippetHtml}</div>` : ""}
        <div style="color:#475569;font-size:10px;border-top:1px solid rgba(255,255,255,0.07);padding-top:5px">
            <span style="margin-right:12px">${clickHint}</span>
            ${dblHint ? `<span>${dblHint}</span>` : ""}
        </div>
    `.trim();

    positionTooltip(x, y);
    tip.style.display = "block";
}

// ── Data mapping: server node/link → @chartizer/graph-renderer snapshots ─────

function toRendererNode(item, x, y) {
    const id = String(item.id);
    const d = fieldsOf(item) ?? {};

    // The search "query" node: white circle with the search icon, no label.
    if (id === "query") {
        return {
            id, x, y,
            shape: { kind: "circle", radius: d.radius ?? QUERY_NODE_RADIUS },
            style: {
                fillColor: "#ffffff",
                strokeColor: NODE_STROKE,
                strokeWidth: 1,
                imageUrl: SEARCH_ICON,
            },
        };
    }

    // Document nodes: rounded label box (NetChart's display "text"), coloured by d.fillColor.
    // autoText nodes size to their label, so d.radius does not change the size.
    return {
        id, x, y,
        label: stripHtml(d.title || id),
        shape: { kind: "autoText", maxWidth: LABEL_MAX_WIDTH, padding: 10, cornerRadius: 6 },
        style: {
            fillColor: d.fillColor ?? NODE_FILL,
            strokeColor: NODE_STROKE,
            strokeWidth: 1,
            label: {
                textColor: "#000000",
                fontFamily: "Poppins, sans-serif",
                fontSize: 12,
            },
        },
    };
}

function toRendererLink(link) {
    const s = linkStyleOf(link);
    const from = String(link.from);
    const to = String(link.to);
    return {
        // NetChart links had no ids; the renderer needs one. Include the colour so a
        // "referenced" and a "related" link between the same pair can coexist.
        id: link.id != null ? String(link.id) : `${from}|${to}|${s.fillColor ?? ""}`,
        from,
        to,
        points: [],
        style: {
            color: s.fillColor ?? LINK_FILL,
            width: (s.radius ?? DEFAULT_LINK_RADIUS) * LINK_WIDTH_PER_RADIUS,
            arrow: s.toDecoration === "arrow",
            dashed: s.dashSize !== undefined,
            curveStyle: "straight",
        },
    };
}

// Every node needs a starting x/y (the force layout then settles it). New nodes fan out
// around the node they connect to; with nothing to connect to, a spiral at the origin.
function seedPosition(index, anchor) {
    const angle = index * GOLDEN_ANGLE;
    if (!anchor) {
        const r = 90 * Math.sqrt(index + 1);
        return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    }
    const r = 170 + 20 * Math.sqrt(index);
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
 */
const CreateChart = (data = null, initialNodes = [], onOpenPdf = null, onUploadStub = null) => {
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

    // NetChart's navigation showed only nodes within FOCUS_RADIUS hops of the initial
    // nodes, and brought in more around each clicked node. Every node and link the
    // chart was given is kept here; `focusOn` decides which of them are drawn.
    const allNodes = new Map();      // id -> server node
    const allLinks = [];             // server links
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

    for (const node of chartData.nodes) {
        const d = fieldsOf(node);
        if (!d) continue;
        nodeEdgeMap.set(node.id, {
            ref_ids: d.referenced_work_ids || [],
            rel_ids: d.related_work_ids || [],
        });
        shownRefsByNode.set(node.id, new Set());
        shownRelsByNode.set(node.id, new Set());
    }

    // ── Renderer lifecycle ───────────────────────────────────────────────────

    if (!container.style.position) container.style.position = "relative";

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

    let renderer = null;
    let removed = false;
    let latestSize = null;
    let fitTimer = null;
    let userMoved = false;
    let offEvents = null;
    const queue = [];

    const safe = (fn, r) => {
        try { fn(r); } catch (err) { console.error("[chart]", err); }
    };
    // Run now if the renderer is up, otherwise once it has mounted.
    const run = (fn) => {
        if (removed) return;
        if (renderer) safe(fn, renderer);
        else queue.push(fn);
    };

    // Draw the given server nodes (those not drawn yet) and every known link whose two
    // ends are now drawn. Upserting restarts the force layout by itself; no autoLayout(),
    // which would re-place the whole graph on every expansion.
    function draw(r, ids, anchorId, isInitial) {
        const fresh = [...ids].map(String).filter((id) => allNodes.has(id) && !knownNodeIds.has(id));

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

        if (rendererNodes.length) {
            r.upsertNodes(rendererNodes);
            for (const n of rendererNodes) {
                knownNodeIds.add(n.id);
                shownNodeIds.add(allNodes.get(n.id).id);
            }
        }

        // links go in after their nodes: a link to a node the renderer lacks is not drawn
        const rendererLinks = [];
        for (const l of allLinks) {
            const rl = toRendererLink(l);
            if (!knownNodeIds.has(rl.from) || !knownNodeIds.has(rl.to)) continue;
            if (knownLinkIds.has(rl.id)) continue;
            knownLinkIds.add(rl.id);
            rendererLinks.push(rl);
        }
        if (rendererLinks.length) r.upsertLinks(rendererLinks);

        if (isInitial && rendererNodes.length) {
            r.fitToScreen(60);
            // Re-fit once the layout has spread out, unless the user has panned or zoomed.
            fitTimer = setTimeout(() => {
                if (!removed && renderer && !userMoved) renderer.fitToScreen(60);
            }, 1500);
        }
    }

    // Show the nodes within FOCUS_RADIUS hops of these (NetChart focus navigation).
    function focusOn(ids, anchorId = null, isInitial = false) {
        run((r) => draw(r, around(ids), anchorId, isInitial));
    }

    // ── Expand a node on click ───────────────────────────────────────────────

    async function expandNode(nodeId) {
        if (expandingNodes.has(nodeId)) return;
        expandingNodes.add(nodeId);

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
                return;
            }

            const payload = await resp.json();
            const newNodes = payload.nodes ?? [];
            const newLinks = payload.links ?? [];

            // Register new nodes before addData so the cross-link pass sees them
            for (const node of newNodes) {
                const d = fieldsOf(node) ?? {};
                nodeEdgeMap.set(node.id, {
                    ref_ids: d.referenced_work_ids || [],
                    rel_ids: d.related_work_ids || [],
                });
                shownRefsByNode.set(node.id, new Set());
                shownRelsByNode.set(node.id, new Set());
            }

            // Update pagination cursors for the expanded node
            if (!shownRefsByNode.has(nodeId)) shownRefsByNode.set(nodeId, new Set());
            if (!shownRelsByNode.has(nodeId)) shownRelsByNode.set(nodeId, new Set());
            for (const id of payload.new_ref_ids ?? []) shownRefsByNode.get(nodeId).add(id);
            for (const id of payload.new_rel_ids ?? []) shownRelsByNode.get(nodeId).add(id);

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
        }
    }

    // ── Pointer tracking (tooltip position; "the user moved the view") ────────

    let pointerX = 0;
    let pointerY = 0;
    let pressed = null;

    const onPointerMove = (e) => {
        pointerX = e.clientX;
        pointerY = e.clientY;
        if (_tooltip && _tooltip.style.display !== "none") {
            positionTooltip(pointerX, pointerY);
        }
        // a press that travels is a pan or a drag: stop re-fitting the view after that
        if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 6) userMoved = true;
    };
    const onPointerDown = (e) => { pressed = { x: e.clientX, y: e.clientY }; };
    const onPointerUp = () => { pressed = null; };
    const onWheel = () => { userMoved = true; };

    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: true });

    // ── Renderer events ──────────────────────────────────────────────────────
    //   hoverchange → { hoverNodeId, hoverLinkId }
    //   click / doubleclick → { nodeId, linkId, screenX, screenY, chartX, chartY, ... }

    const handleEvent = (event) => {
        switch (event.type) {
            case "hoverchange": {
                const id = event.hoverNodeId;
                if (id && id !== "query") {
                    const d = fieldsById.get(id);
                    if (d) showTooltip(d, pointerX, pointerY);
                    else hideTooltip();
                } else {
                    hideTooltip();
                }
                break;
            }

            case "click": {
                const id = event.nodeId;
                if (!id || id === "query") return;
                const d = fieldsById.get(id);
                if (!d) return;

                if (d.is_stub_node || d.stub_document) {
                    const oaId = d.openalex_id || id;
                    window.open(`https://openalex.org/${oaId}`, "_blank");
                    return;
                }

                // NetChart focused the clicked node: bring in what is near it, then fetch more
                focusOn([id], id);
                expandNode(id);
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
            if (resizeObserver) resizeObserver.disconnect();
            container.removeEventListener("pointermove", onPointerMove);
            container.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointerup", onPointerUp);
            container.removeEventListener("wheel", onWheel);
            hideTooltip();
            if (offEvents) offEvents();
            if (renderer) renderer.destroy();   // if still mounting, destroyed once it resolves
            renderer = null;
            canvas.remove();
        },

        get renderer() { return renderer; },
    };

    // ── Mount ────────────────────────────────────────────────────────────────

    remember(chartData);
    // With initialNodes, only their neighbourhood shows at first (as NetChart navigation
    // did); without, everything.
    const seeds = (initialNodes ?? []).map(String).filter((id) => allNodes.has(id));
    focusOn(seeds.length ? seeds : [...allNodes.keys()], null, true);

    // "viewer": pan, zoom, select and drag nodes, no editing.
    GraphRenderer.mount(canvas, {
        darkModeEnabled: true,
        controlMode: "viewer",
        wheelEnabled: true,
    }).then((r) => {
        if (removed) { r.destroy(); return; }
        renderer = r;

        r.patchSettings({ backgroundColor: CHART_BG });
        // snap to grid is on by default and makes the layout stiff and blocky
        r.setSnapToGrid({ enabled: false, gridSize: 32 });
        r.setLayoutConfig(LAYOUT);

        // onEvent returns an unsubscribe function
        offEvents = r.onEvent(handleEvent);

        if (latestSize) r.resize(latestSize.w, latestSize.h);

        for (const fn of queue.splice(0)) safe(fn, r);
    }).catch((err) => {
        console.error("[chart] failed to mount graph renderer:", err);
    });

    return chart;
};

export default CreateChart;
