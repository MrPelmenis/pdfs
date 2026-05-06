const SEARCH_ICON = "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Search_Icon.svg/500px-Search_Icon.svg.png?_=20181016161702";

const API = process.env.REACT_APP_SERVER_URL;

function stripHtml(str) {
    if (!str) return str;
    const doc = new DOMParser().parseFromString(str, "text/html");
    return doc.body.textContent ?? "";
}

let _tooltip = null;

function getTooltip() {
    if (_tooltip) return _tooltip;
    _tooltip = document.createElement("div");
    Object.assign(_tooltip.style, {
        position:      "fixed",
        pointerEvents: "none",
        zIndex:        "99999",
        background:    "rgba(15,15,20,0.95)",
        color:         "#e8e8e8",
        border:        "1px solid rgba(255,255,255,0.1)",
        borderRadius:  "8px",
        padding:       "8px 12px",
        fontSize:      "11px",
        lineHeight:    "1.5",
        width:         "360px",
        boxShadow:     "0 4px 20px rgba(0,0,0,0.55)",
        display:       "none",
        fontFamily:    "sans-serif",
        wordBreak:     "break-word",
    });
    document.body.appendChild(_tooltip);
    return _tooltip;
}

function showTooltip(d, x, y) {
    const tip        = getTooltip();
    const title      = d.title      || "—";
    const oaId       = d.openalex_id || "—";
    const doi        = d.doi        || "—";
    const cited      = d.cited      ?? "—";
    const authors    = Array.isArray(d.authors) && d.authors.length
        ? d.authors.join(", ")
        : "—";

    const abstractFull  = d.abstract || "";
    const abstractWords = abstractFull.trim().split(/\s+/);
    const abstractSnip  = abstractWords.slice(0, 20).join(" ")
        + (abstractWords.length > 20 ? "…" : "");

    const isStub    = !!d.is_stub_node;
    const clickHint = isStub
        ? "Click to open on OpenAlex"
        : "Click to expand references";
    const dblHint   = isStub
        ? ""
        : (d.stub_document ? "Double-click for DOI info" : "Double-click to view PDF");

    tip.innerHTML = `
        <div style="font-weight:600;font-size:12px;color:#fff;margin-bottom:5px">${title}</div>
        <div style="color:#94a3b8;margin-bottom:2px"><span style="color:#64748b">Authors </span>${authors}</div>
        <div style="color:#94a3b8;margin-bottom:2px"><span style="color:#64748b">OpenAlex </span><span style="color:#7dd3fc">${oaId}</span></div>
        ${doi !== "—" ? `<div style="color:#94a3b8;margin-bottom:2px"><span style="color:#64748b">DOI </span><span style="color:#7dd3fc">${doi}</span></div>` : ""}
        <div style="color:#94a3b8;margin-bottom:5px"><span style="color:#64748b">Cited by </span>${cited}</div>
        ${abstractSnip ? `<div style="color:#94a3b8;margin-bottom:5px;font-style:italic;font-size:12px">${abstractSnip}</div>` : ""}
        <div style="color:#475569;font-size:10px;border-top:1px solid rgba(255,255,255,0.07);padding-top:5px">
            <span style="margin-right:12px">${clickHint}</span>
            ${dblHint ? `<span>${dblHint}</span>` : ""}
        </div>
    `.trim();

    positionTooltip(x, y);
    tip.style.display = "block";
}

function positionTooltip(x, y) {
    if (!_tooltip) return;
    const margin = 14;
    const tw = 360;
    const th = _tooltip.offsetHeight || 90;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x + margin;
    let top  = y + margin;

    if (left + tw > vw - margin) left = x - tw - margin;
    if (top  + th > vh - margin) top  = y - th - margin;

    _tooltip.style.left = `${Math.max(margin, left)}px`;
    _tooltip.style.top  = `${Math.max(margin, top)}px`;
}

function hideTooltip() {
    if (_tooltip) _tooltip.style.display = "none";
}


const CreateChart = (data = null, initialNodes = [], onOpenPdf = null) => {
    const container = document.getElementById("megachart");
    if (!container) return null;

    const chartData = data ?? { nodes: [], links: [] };

    // ── Expansion state ──────────────────────────────────────────────────────
    //
    // shownNodeIds     : every node ID currently in the graph
    // shownRefsByNode  : nodeId -> Set of ref IDs already shown for that node
    // shownRelsByNode  : nodeId -> Set of rel IDs already shown for that node
    // nodeEdgeMap      : nodeId -> { ref_ids: [], rel_ids: [] }
    //                    kept for cross-link pass when new nodes arrive
    // expandingNodes   : Set of nodeIds currently waiting for a fetch (debounce)
    //
    const shownNodeIds    = new Set(chartData.nodes.map(n => n.id));
    const shownRefsByNode = new Map();
    const shownRelsByNode = new Map();
    const nodeEdgeMap     = new Map();
    const expandingNodes  = new Set();

    // Seed edge maps from preloaded data so cross-links work on first expansion
    for (const node of chartData.nodes) {
        const d = node.data?.data;
        if (!d) continue;
        nodeEdgeMap.set(node.id, {
            ref_ids: d.referenced_work_ids || [],
            rel_ids: d.related_work_ids    || [],
        });
        // Seed shown refs/rels from what /search already placed on screen.
        // We don't know which were trimmed vs shown, but that's fine —
        // /expand will filter by shown_ref_ids we send it.
        shownRefsByNode.set(node.id, new Set());
        shownRelsByNode.set(node.id, new Set());
    }

    // ── Expand a node ────────────────────────────────────────────────────────
    async function expandNode(nodeId) {
        if (expandingNodes.has(nodeId)) return;
        expandingNodes.add(nodeId);

        const shownRefs = shownRefsByNode.get(nodeId) ?? new Set();
        const shownRels = shownRelsByNode.get(nodeId) ?? new Set();

        try {
            const resp = await fetch(`${API}/expand`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    openalex_id:   nodeId,
                    shown_node_ids: [...shownNodeIds],
                    shown_ref_ids:  [...shownRefs],
                    shown_rel_ids:  [...shownRels],
                }),
            });

            if (!resp.ok) {
                console.warn(`[expand] ${nodeId} → HTTP ${resp.status}`);
                return;
            }

            const payload = await resp.json();
            const newNodes = payload.nodes ?? [];
            const newLinks = payload.links ?? [];

            // Register new nodes in state before addData so cross-link pass
            // below sees them as "on screen"
            for (const node of newNodes) {
                shownNodeIds.add(node.id);
                const d = node.data?.data ?? {};
                nodeEdgeMap.set(node.id, {
                    ref_ids: d.referenced_work_ids || [],
                    rel_ids: d.related_work_ids    || [],
                });
                shownRefsByNode.set(node.id, new Set());
                shownRelsByNode.set(node.id, new Set());
            }

            // Update pagination cursors for the expanded node
            if (!shownRefsByNode.has(nodeId)) shownRefsByNode.set(nodeId, new Set());
            if (!shownRelsByNode.has(nodeId))  shownRelsByNode.set(nodeId, new Set());
            for (const id of payload.new_ref_ids ?? []) shownRefsByNode.get(nodeId).add(id);
            for (const id of payload.new_rel_ids ?? []) shownRelsByNode.get(nodeId).add(id);

            // ── Client-side cross-link pass ──────────────────────────────────
            // The server can cross-link new→existing and new→new.
            // We also need existing→new: walk every node already on screen
            // and emit a link if it references one of our new arrivals.
            const newNodeIdSet = new Set(newNodes.map(n => n.id));
            const extraLinks   = [];
            const seenLinkKeys = new Set(newLinks.map(l => `${l.from}|${l.to}`));

            const REF_STYLE = { fillColor: "rgba(99,102,241,0.35)",  radius: 2,   toDecoration: "arrow" };
            const REL_STYLE = { fillColor: "rgba(251,146,60,0.45)",  radius: 1.5, toDecoration: "arrow", dashSize: 4 };

            for (const [existingId, edges] of nodeEdgeMap.entries()) {
                if (existingId === nodeId) continue;  // already handled by server
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
            });

        } catch (err) {
            console.error(`[expand] ${nodeId} failed:`, err);
        } finally {
            expandingNodes.delete(nodeId);
        }
    }

    // ── Pointer tracking ─────────────────────────────────────────────────────
    let pointerX = 0;
    let pointerY = 0;

    container.addEventListener("mousemove", (e) => {
        pointerX = e.clientX;
        pointerY = e.clientY;
        if (_tooltip && _tooltip.style.display !== "none") {
            positionTooltip(pointerX, pointerY);
        }
    });

    // ── Chart init ───────────────────────────────────────────────────────────
    const chart = new window.NetChart({
        container,
        area: { style: { fillColor: "#202124" } },
        toolbar:     { enabled: false },
        interaction: { resizing: { enabled: false } },
        data:        { preloaded: chartData },
        navigation: {
            initialNodes:             initialNodes,
            focusNodeExpansionRadius: 1,
        },
        layout:{
            mode:"focusnode",
            nodeSpacing: 10
        },
        style: {
            node: {
                display:   "text",
                fillColor: "rgba(28,124,213,0.92)",
                radius:    28,
                lineColor: "rgba(0,0,0,0.15)",
                lineWidth: 1,
            },

            nodeStyleFunction: function (node) {
                const d = node.data?.data;
                if (!d) return;

                if (d.radius    !== undefined) node.radius    = d.radius;
                if (d.fillColor !== undefined) node.fillColor = d.fillColor;

                if (node.id === "query") {
                    node.display   = "text";
                    node.image     = SEARCH_ICON;
                    node.fillColor = "#ffffff";
                    return;
                }

                const raw  = d.title || node.id;
                node.label = stripHtml(raw);
            },

            nodeLabel: {
                textStyle: {
                    font:      "bold 12px Poppins, sans-serif",
                    fillColor: "#000000",
                },
                padding:      10,
                borderRadius: 6,
            },

            link: {
                fillColor: "rgba(255,255,255,0.15)",
                radius:    5,
            },

            linkStyleFunction: function (link) {
                const s = link.data?.style;
                if (!s) return;
                if (s.fillColor    !== undefined) link.fillColor    = s.fillColor;
                if (s.radius       !== undefined) link.radius       = s.radius;
                if (s.toDecoration !== undefined) link.toDecoration = s.toDecoration;
                if (s.dashSize     !== undefined) link.dashSize     = s.dashSize;
            },
        },

        events: {
            onHoverChange: function (event) {
                if (event.hoverNode && event.hoverNode.id !== "query") {
                    const d = event.hoverNode.data?.data;
                    if (d) {
                        showTooltip(d, pointerX, pointerY);
                    } else {
                        hideTooltip();
                    }
                } else {
                    hideTooltip();
                }
            },

            onClick: function (event) {
                if (!event.clickNode || event.clickNode.id === "query") return;
                const d = event.clickNode.data?.data;
                if (!d) return;

                if (d.is_stub_node) {
                    // Gray (referenced) and orange (related) nodes → open OpenAlex
                    const oaId = d.openalex_id || event.clickNode.id;
                    window.open(`https://openalex.org/${oaId}`, "_blank");
                    return;
                }

                if (d.stub_document) {
                    // Full-text stub (indexed only for linking) → open OpenAlex
                    const oaId = d.openalex_id || event.clickNode.id;
                    window.open(`https://openalex.org/${oaId}`, "_blank");
                    return;
                }

                // Real expandable node (original search result)
                expandNode(event.clickNode.id);
            },

            onDoubleClick: function (event) {
                if (!event.clickNode || event.clickNode.id === "query") return;
                const d = event.clickNode.data?.data;
                if (!d) return;

                // Stub and gray nodes: already opened by single click, nothing extra
                if (d.is_stub_node || d.stub_document) return;

                if (onOpenPdf) {
                    hideTooltip();
                    onOpenPdf(d);
                }
            },
        },
    });

    return chart;
};

export default CreateChart;
