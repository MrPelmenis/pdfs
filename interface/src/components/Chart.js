const API = process.env.REACT_APP_SERVER_URL;

const SEARCH_ICON = "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Search_Icon.svg/500px-Search_Icon.svg.png?_=20181016161702";

// ─── strip HTML tags (handles tags + encoded entities like &amp; &nbsp;) ──────
function stripHtml(str) {
    if (!str) return str;
    const doc = new DOMParser().parseFromString(str, "text/html");
    return doc.body.textContent ?? "";
}

// ─── tooltip singleton ────────────────────────────────────────────────────────
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
    const tip     = getTooltip();
    // tooltip title: render HTML tags as actual HTML (sub/sup will render natively)
    const title   = d.title   || "—";
    const doi     = d.doi     || "—";
    const cited   = d.cited   ?? "—";
    const authors = Array.isArray(d.authors) && d.authors.length
        ? d.authors.join(", ")
        : "—";

    tip.innerHTML = `
        <div style="font-weight:600;font-size:12px;color:#fff;margin-bottom:5px">${title}</div>
        <div style="color:#94a3b8;margin-bottom:2px"><span style="color:#64748b">Authors </span>${authors}</div>
        <div style="color:#94a3b8;margin-bottom:2px"><span style="color:#64748b">DOI </span><span style="color:#7dd3fc">${doi}</span></div>
        <div style="color:#94a3b8;margin-bottom:5px"><span style="color:#64748b">Cited by </span>${cited}</div>
        <div style="color:#475569;font-size:10px;border-top:1px solid rgba(255,255,255,0.07);padding-top:5px">
            <span style="margin-right:12px">🖱 Click to see more</span>
            <span>⎆ Double-click to view PDF</span>
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

// ─── chart factory ────────────────────────────────────────────────────────────
const CreateChart = (data = null) => {
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
            initialNodes:             ["query"],
            mode:                     "focusnodes",
            focusNodeExpansionRadius: 4,
        },
        style: {
            node: {
                display:   "text",
                fillColor: "rgba(28,124,213,0.92)",
                radius:    28,
                lineColor: "rgba(0,0,0,0.15)",
                lineWidth: 1,
                padding:   10,
            },

            nodeStyleFunction: function (node) {
                const d = node.data?.data;
                if (!d) return;

                if (d.radius    !== undefined) node.radius    = d.radius;
                if (d.fillColor !== undefined) node.fillColor = d.fillColor;

                const raw = node.id === "query"
                    ? (d.title || "Search")
                    : (d.title || node.id);

                const converted = stripHtml(raw);
                node.label = converted.length > 50
                    ? converted.slice(0, 50) + "…"
                    : converted;
            },

            nodeLabel: {
                enabled: true,
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
            },
        },

        events: {
            onHoverChange: function (event) {
                if (event.hoverNode && event.hoverNode.id !== "query") {
                    const d = event.hoverNode.data?.data;
                    if (d) showTooltip(d, pointerX, pointerY);
                } else {
                    hideTooltip();
                }
            },

            onClick: function (event) {
                if (event.clickNode && event.clickNode.id !== "query") {
                    const doi = event.clickNode.data?.data?.doi || event.clickNode.id;
                    alert(`See more: ${doi}`);
                }
            },

            onDoubleClick: function (event) {
                if (event.clickNode && event.clickNode.id !== "query") {
                    const doi = event.clickNode.data?.data?.doi || event.clickNode.id;
                    alert(`View PDF for: ${doi}`);
                }
            },
        },
    });

    return chart;
};

export default CreateChart;
