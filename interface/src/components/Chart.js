const SEARCH_ICON = "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Search_Icon.svg/500px-Search_Icon.svg.png?_=20181016161702";

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

    const isGray    = !!d.isGray;
    const isStub    = !!d.stub_document;
    const clickHint = isGray
        ? "Click to open on OpenAlex"
        : "Click to see more";
    const dblHint   = isGray
        ? ""
        : (isStub ? "Double-click for DOI info" : "Double-click to view PDF");

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

    let pointerX = 0;
    let pointerY = 0;

    container.addEventListener("mousemove", (e) => {
        pointerX = e.clientX;
        pointerY = e.clientY;
        if (_tooltip && _tooltip.style.display !== "none") {
            positionTooltip(pointerX, pointerY);
        }
    });

    const chart = new window.NetChart({
        container,
        area: { style: { fillColor: "#202124" } },
        toolbar:     { enabled: false },
        interaction: { resizing: { enabled: false } },
        data:        { preloaded: chartData },
        navigation: {
            initialNodes:             initialNodes,
            mode:                     "manual",
            focusNodeExpansionRadius: 8,
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

                if (d.isGray) {
                    // Gray nodes (referenced/related) → open OpenAlex
                    const oaId = d.openalex_id || event.clickNode.id;
                    window.open(`https://openalex.org/${oaId}`, "_blank");
                } else if (d.stub_document) {
                    // Stub full docs — open OpenAlex too
                    const oaId = d.openalex_id || event.clickNode.id;
                    window.open(`https://openalex.org/${oaId}`, "_blank");
                } else {
                    const doi = d.doi || event.clickNode.id;
                    console.log(`clicked on: ${doi}`);
                }
            },

            onDoubleClick: function (event) {
                if (!event.clickNode || event.clickNode.id === "query") return;
                const d = event.clickNode.data?.data;
                if (!d) return;
                if (d.isGray || d.stub_document) {
                    // Already handled by single click — nothing extra
                    return;
                } else if (!d.isGray && onOpenPdf) {
                    hideTooltip();
                    onOpenPdf(d);
                }
            },
        },
    });

    return chart;
};

export default CreateChart;
