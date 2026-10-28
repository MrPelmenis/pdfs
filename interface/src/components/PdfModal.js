"use client";
import { useEffect, useState, useRef } from "react";
import PdfViewer from "./PdfViewer";

const API = process.env.REACT_APP_SERVER_URL;

// ── Small helpers ──────────────────────────────────────────────────────────
function ColorDot({ color, size = 10 }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        boxShadow: "0 0 0 1.5px rgba(255,255,255,0.15)",
      }}
    />
  );
}

function iconBtn(color = "rgba(255,255,255,0.25)") {
  return {
    background: "none",
    border: "none",
    cursor: "pointer",
    color,
    padding: "2px 5px",
    borderRadius: 4,
    fontSize: 13,
    lineHeight: 1,
    flexShrink: 0,
    transition: "color 150ms",
  };
}

function btnStyle(bg, disabled = false) {
  return {
    flex: 1,
    padding: "7px 10px",
    borderRadius: 7,
    border: "none",
    background: disabled ? "rgba(255,255,255,0.05)" : bg,
    color: disabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.9)",
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 150ms",
  };
}

// ── Single editable category row ───────────────────────────────────────────
function CategoryRow({ cat, isAssigned, saving, onAssign, onUpdated, onDeleted }) {
  const [editing, setEditing]   = useState(false);
  const [editName, setEditName] = useState(cat.name);
  const [editColor, setEditColor] = useState(cat.color);
  const [busy, setBusy]         = useState(false);
  const colorRef                = useRef(null);

  // keep local state in sync if parent updates the cat object
  useEffect(() => {
    if (!editing) {
      setEditName(cat.name);
      setEditColor(cat.color);
    }
  }, [cat, editing]);

  async function handleSave() {
    if (!editName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/edit-category/${cat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || "Failed");
      onUpdated(updated);
      setEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/delete-category/${cat.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      onDeleted(cat.id);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div
        style={{
          padding: "8px 10px",
          borderRadius: 7,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.04)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {/* Name input */}
        <input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 5,
            padding: "5px 8px",
            fontSize: 12,
            color: "rgba(255,255,255,0.85)",
            outline: "none",
            width: "100%",
            boxSizing: "border-box",
          }}
        />
        {/* Color row */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div
            onClick={() => colorRef.current?.click()}
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: editColor,
              cursor: "pointer",
              flexShrink: 0,
              border: "2px solid rgba(255,255,255,0.2)",
            }}
          />
          <input
            ref={colorRef}
            type="color"
            value={editColor.startsWith("rgba") ? "#6366f1" : editColor}
            onChange={(e) => setEditColor(e.target.value)}
            style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
          />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {editColor}
          </span>
        </div>
        {/* Save / Cancel */}
        <div style={{ display: "flex", gap: 5 }}>
          <button onClick={handleSave} disabled={busy || !editName.trim()} style={btnStyle("rgba(99,102,241,0.85)", busy || !editName.trim())}>
            {busy ? "…" : "Save"}
          </button>
          <button onClick={() => setEditing(false)} style={btnStyle("rgba(255,255,255,0.1)")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 10px",
        minHeight: 38,
        borderRadius: 7,
        border: isAssigned ? `1px solid ${cat.color}` : "1px solid transparent",
        background:   "transparent",
        transition: "all 150ms",
        opacity: saving || busy ? 0.5 : 1,
      }}
    >
      {/* Left: assign on click */}
      <button
        onClick={() => !saving && !busy && onAssign(cat)}
        disabled={saving || busy}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          flex: 1, minWidth: 0,
          background: "none", border: "none", cursor: saving || busy ? "not-allowed" : "pointer",
          textAlign: "left", padding: 0,
        }}
        onMouseEnter={(e) => { if (!isAssigned) e.currentTarget.parentElement.style.background = "rgba(255,255,255,0.05)"; }}
        onMouseLeave={(e) => { if (!isAssigned) e.currentTarget.parentElement.style.background = "transparent"; }}
      >
        <ColorDot color={cat.color} size={10} />
        <span style={{ fontSize: 12, color: isAssigned ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cat.name}
        </span>
        {isAssigned && <span style={{ fontSize: 10, color: cat.color, flexShrink: 0 }}>✓</span>}
      </button>

      {/* Right: edit + delete (hidden on "none" row) */}
      {cat.id !== 0 && (
        <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            style={iconBtn("rgba(255,255,255,0.2)")}
            title="Edit"
            onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
          >✎</button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            disabled={busy}
            style={iconBtn("rgba(255,255,255,0.2)")}
            title="Delete"
            onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(239,68,68,0.8)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
          >✕</button>
        </div>
      )}
    </div>
  );
}

function CategoryPanel({ documentId, initialCategory, visible, onCategoryChange, style }) {
  const [categories, setCategories] = useState([]);
  const [assigned, setAssigned]     = useState(null);
  const [newName, setNewName]       = useState("");
  const [newColor, setNewColor]     = useState("#6366f1");
  const [creating, setCreating]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState(null);
  const colorInputRef               = useRef(null);

  useEffect(() => {
    fetch(`${API}/get-all-categories`)
      .then((r) => r.json())
      .then(setCategories)
      .catch(() => setError("Could not load categories"));
  }, []);

  useEffect(() => {
    setAssigned(initialCategory ?? null);
    setNewName("");
    setCreating(false);
    setError(null);
  }, [documentId]); //eslint-disable-line react-hooks/exhaustive-deps


  async function doAssign(cat) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/assign-category`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId, category_id: cat.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign");
      setAssigned(cat);
      onCategoryChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleRemove() {
    const none = categories.find((c) => c.id === 0);
    if (none) doAssign(none);
    else setAssigned(null);
    onCategoryChange?.();
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/create-category`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      const cat = await res.json();
      if (!res.ok) throw new Error(cat.error || "Failed to create");
      setCategories((prev) => [...prev, cat]);
      setNewName("");
      setNewColor("#6366f1");
      setCreating(false);
      doAssign(cat);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleUpdated(updated) {
    setCategories((prev) => prev.map((c) => c.id === updated.id ? updated : c));
    if (assigned?.id === updated.id) setAssigned(updated);
  }

  function handleDeleted(id) {
    setCategories((prev) => prev.filter((c) => c.id !== id));
    if (assigned?.id === id) setAssigned(null);
  }

  const isNone = !assigned || assigned.id === 0;

  return (
    <div
      style={{
        minWidth: 240,
        width: "20%",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(18,18,22,0.97)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(-12px)",
        transition: "opacity 280ms 80ms, transform 280ms 80ms",
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ padding: "18px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
        <p style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 6 }}>
          Document
        </p>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", wordBreak: "break-all" }}>
          {documentId ?? "—"}
        </p>
      </div>

      <div style={{ padding: "14px 16px 12px", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <p style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 8 }}>
          Category
        </p>
        {!isNone ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ColorDot color={assigned.color} size={12} />
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", flex: 1 }}>{assigned.name}</span>
            <button
              onClick={handleRemove}
              disabled={saving}
              title="Remove"
              style={iconBtn()}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(239,68,68,0.8)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}
            >×</button>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", fontStyle: "italic" }}>None assigned</span>
        )}
        {error && <p style={{ marginTop: 8, fontSize: 11, color: "rgba(239,68,68,0.85)" }}>{error}</p>}
      </div>

      {/* Category list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px" }}>
        <p style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 8 }}>
          All Categories
        </p>
        {categories.length === 0 && (
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", fontStyle: "italic" }}>Loading…</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {categories.map((cat) => (
            <CategoryRow
              key={cat.id}
              cat={cat}
              isAssigned={assigned?.id === cat.id}
              saving={saving}
              onAssign={doAssign}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      </div>

      {/* Create new category */}
      <div style={{ padding: "10px 16px 16px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            style={{
              width: "100%", padding: "8px", borderRadius: 7,
              border: "1px dashed rgba(255,255,255,0.15)",
              background: "transparent", color: "rgba(255,255,255,0.35)",
              fontSize: 12, cursor: "pointer", transition: "all 150ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "rgba(255,255,255,0.35)"; }}
          >
            + New category
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>
              New Category
            </p>
            <input
              autoFocus
              type="text"
              placeholder="category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 7, padding: "7px 10px", fontSize: 12,
                color: "rgba(255,255,255,0.85)", outline: "none", width: "100%", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                onClick={() => colorInputRef.current?.click()}
                style={{ width: 28, height: 28, borderRadius: 6, background: newColor, cursor: "pointer", flexShrink: 0, border: "2px solid rgba(255,255,255,0.2)" }}
                title="Pick color"
              />
              <input
                ref={colorInputRef}
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
              />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{newColor}</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={handleCreate} disabled={!newName.trim() || saving} style={btnStyle("rgba(99,102,241,0.85)", !newName.trim() || saving)}>
                {saving ? "Saving…" : "Create"}
              </button>
              <button onClick={() => setCreating(false)} style={btnStyle("rgba(255,255,255,0.1)")}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Below this width (phones, iPad portrait) the viewer fills the screen and the category
// panel slides over it instead of sitting beside it.
const COMPACT_QUERY = "(max-width: 1023px)";

function useCompact() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return compact;
}

export default function PdfModal({ modal, modalStage, onClose, onCategoryChange }) {
  const isOpen    = modalStage === "open";
  const isClosing = modalStage === "closing";
  const compact   = useCompact();
  const [sideOpen, setSideOpen] = useState(false);

  useEffect(() => { setSideOpen(false); }, [modal?.documentId]);

  useEffect(() => {
    if (modal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [modal, onClose]);

  if (!modal) return null;

  const query = (modal.searchQuery ?? "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  const inset = compact ? 0 : "3vh 3vw";

  return (
    <div
      onClick={onClose}
      style={{ transition: "opacity 300ms" }}
      className={`fixed inset-0 z-50 flex items-center justify-center
        ${isOpen    ? "bg-black/70" : "bg-black/0"}
        ${isClosing ? "bg-black/0"  : ""}
      `}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transition: "all 350ms cubic-bezier(0.4, 0, 0.2, 1)",
          position: "fixed",
          ...(isOpen
            ? { inset, width: "auto", height: "auto" }
            : { top: modal.rect.top, left: modal.rect.left, width: modal.rect.width, height: modal.rect.height }),
          borderRadius: isOpen && !compact ? "12px" : "4px",
          overflow: "hidden",
          boxShadow: isOpen ? "0 25px 60px rgba(0,0,0,0.8)" : "none",
          display: "flex",
          flexDirection: "row",
          background: "#1e1f22",
          paddingTop: compact ? "env(safe-area-inset-top)" : 0,
          paddingBottom: compact ? "env(safe-area-inset-bottom)" : 0,
        }}
      >
        {!compact && (
          <CategoryPanel
            documentId={modal.documentId}
            initialCategory={modal.category}
            visible={isOpen}
            onCategoryChange={onCategoryChange}
          />
        )}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {!isOpen && modal.previewUrl && (
            <img src={modal.previewUrl} alt="" className="w-full h-full object-cover" />
          )}
          {isOpen && (
            <PdfViewer
              url={modal.pdfUrl}
              query={query}
              onClose={onClose}
              onToggleSide={compact ? () => setSideOpen((o) => !o) : undefined}
              sideOpen={sideOpen}
            />
          )}

          {/* compact: the category panel slides over the document */}
          {compact && isOpen && (
            <>
              <div
                onClick={() => setSideOpen(false)}
                className={`absolute inset-0 top-[49px] bg-black/50 transition-opacity duration-200 ${sideOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
              />
              <div
                className="absolute left-0 bottom-0 top-[49px] transition-transform duration-300 ease-out"
                style={{ width: "min(320px, 85vw)", transform: sideOpen ? "translateX(0)" : "translateX(-105%)" }}
              >
                <CategoryPanel
                  documentId={modal.documentId}
                  initialCategory={modal.category}
                  visible
                  onCategoryChange={onCategoryChange}
                  style={{ width: "100%", minWidth: 0, height: "100%", background: "#16171a", boxShadow: "12px 0 32px rgba(0,0,0,0.5)" }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
