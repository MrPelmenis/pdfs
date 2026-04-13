"use client";
import { useEffect, useRef, useState, useCallback } from "react";

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL;

const LEGEND = [
  { label: "pre-2000", color: "rgba(149,117,205,0.85)" },
  { label: "2000–2005", color: "rgba(66,165,245,0.85)"  },
  { label: "2006–2010", color: "rgba(38,198,218,0.85)"  },
  { label: "2011–2015", color: "rgba(102,187,106,0.85)" },
  { label: "2016+",     color: "rgba(255,167,38,0.85)"  },
  { label: "Author",     color: "rgba(236,46,46,0.75)"   },  
];

const AUTHOR_LEGEND = [
  { label: "Co-authors",        color: "rgba(102,187,106,0.7)" },
  { label: "Cross-reference →", color: "rgba(255,167,38,0.7)"  },
];

export default function ChartPage() {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);

  const [mode,        setMode]        = useState("documents"); // "documents" | "authors"
  const [showLinked,  setShowLinked]  = useState(false);
  const [yearFrom,    setYearFrom]    = useState(1990);
  const [yearTo,      setYearTo]      = useState(new Date().getFullYear());
  const [loading,     setLoading]     = useState(false);
  const [nodeCount,   setNodeCount]   = useState(0);
  const [linkCount,   setLinkCount]   = useState(0);

  const destroyChart = () => {
    if (chartRef.current) {
      chartRef.current.remove?.();
      chartRef.current = null;
    }
  };

  const initChart = useCallback((data) => {
    destroyChart();
    if (!window.NetChart || !containerRef.current) return;

    setNodeCount(data.nodes.length);
    setLinkCount(data.links.length);

    chartRef.current = new window.NetChart({
      container: containerRef.current,
      data:      { preloaded: data },
      area:      { style: { fillColor: "#121212" } },
      style: {
        node: {
          display:   "roundrect",
          fillColor: "rgba(100,100,100,0.8)",
          label:     "",
        },
        link: {
          fillColor: "rgba(255,255,255,0.25)",
        },
      },
    });
  }, []);

  const fetchAndRender = useCallback(async () => {
    setLoading(true);
    try {
      let url;
      if (mode === "documents") {
        const params = new URLSearchParams({
          year_from:   yearFrom,
          year_to:     yearTo,
          linked_only: showLinked,
        });
        url = `${SERVER}/api/graph/documents?${params}`;
      } else {
        url = `${SERVER}/api/graph/authors`;
      }

      const res  = await fetch(url);
      const data = await res.json();
      initChart(data);
    } catch (e) {
      console.error("Graph fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [mode, yearFrom, yearTo, showLinked, initChart]);

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchAndRender();
    return destroyChart;
  }, [fetchAndRender]);

  const legend = mode === "documents" ? LEGEND : AUTHOR_LEGEND;

  return (
    <main style={{
      height: "100vh", background: "#121212", color: "white",
      display: "flex", flexDirection: "column", fontFamily: "sans-serif",
      overflow: "hidden",
    }}>
      {/* ── toolbar ── */}
      <div style={{
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: "1.25rem",
        padding: "0.75rem 1.25rem", background: "#1e1e1e", borderBottom: "1px solid #2e2e2e",
        zIndex: 10,
      }}>

        {/* mode toggle */}
        <div style={{ display: "flex", background: "#2a2a2a", borderRadius: 8, overflow: "hidden" }}>
          {["documents", "authors"].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: "0.4rem 1rem", border: "none", cursor: "pointer",
              background: mode === m ? "#3c4043" : "transparent",
              color: mode === m ? "white" : "#9aa0a6",
              fontWeight: mode === m ? 600 : 400, fontSize: 13,
              textTransform: "capitalize",
            }}>
              {m}
            </button>
          ))}
        </div>

        {/* linked-only toggle — documents only */}
        {mode === "documents" && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: 13, color: "#9aa0a6", cursor: "pointer" }}>
            <input
              type="checkbox" checked={showLinked}
              onChange={e => setShowLinked(e.target.checked)}
              style={{ accentColor: "#4fc3f7" }}
            />
            Linked only
          </label>
        )}

        {/* year sliders — documents only */}
        {mode === "documents" && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: 13, color: "#9aa0a6" }}>
            <span>From</span>
            <input type="range" min={1970} max={new Date().getFullYear()} value={yearFrom}
              onChange={e => setYearFrom(Math.min(Number(e.target.value), yearTo - 1))}             
              style={{ accentColor: "#4fc3f7", width: 100 }}
            />
            <span style={{ minWidth: 34 }}>{yearFrom}</span>
            <span>To</span>
            <input type="range" min={1970} max={new Date().getFullYear()} value={yearTo}
              onChange={e => setYearTo(Math.max(Number(e.target.value), yearFrom + 1))}
              style={{ accentColor: "#4fc3f7", width: 100 }}
            />
            <span style={{ minWidth: 34 }}>{yearTo}</span>
          </div>
        )}

        {/* stats */}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#5f6368" }}>
          {loading ? "Loading…" : `${nodeCount} nodes · ${linkCount} links`}
        </span>
      </div>

      {/* ── chart ── */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

        {loading && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(18,18,18,0.7)", fontSize: 14, color: "#9aa0a6",
          }}>
            Loading graph…
          </div>
        )}
      </div>

      {/* ── legend ── */}
      <div style={{
        position: "absolute", bottom: 16, left: 16,
        display: "flex", flexDirection: "column", gap: "0.3rem",
        background: "rgba(30,30,30,0.85)", borderRadius: 8,
        padding: "0.6rem 0.9rem", fontSize: 12,
      }}>
        {legend.map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: l.color, flexShrink: 0 }} />
            <span style={{ color: "#ccc" }}>{l.label}</span>
          </div>
        ))}
      </div>

    </main>
  );
}
