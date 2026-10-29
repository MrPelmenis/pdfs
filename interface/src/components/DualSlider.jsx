import { useRef } from "react";

const YEAR_MIN = 1800;
const YEAR_MAX = new Date().getFullYear();

export { YEAR_MIN, YEAR_MAX };

// Two-thumb year range. Pointer events cover mouse, touch and pen alike: each thumb has
// a finger-sized (44px) grab area around the visible dot, a tap on the track moves the
// nearer thumb there, and the arrow keys step a focused thumb by a year.
export default function YearRangeSlider({ start, end, onChange }) {
  const trackRef = useRef(null);
  const dragging = useRef(null); // "start" | "end" | null

  const toPercent = (v) => ((v - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;
  const clampYear = (v) => Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(v)));

  const yearAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    return clampYear(YEAR_MIN + ((clientX - rect.left) / rect.width) * (YEAR_MAX - YEAR_MIN));
  };

  const move = (which, y) => {
    if (which === "start") onChange(Math.min(y, end - 1), end);
    else onChange(start, Math.max(y, start + 1));
  };

  const onPointerDown = (e) => {
    const y = yearAt(e.clientX);
    const thumb = e.target.closest("[data-thumb]")?.dataset.thumb;
    const which = thumb ?? (Math.abs(y - start) <= Math.abs(y - end) ? "start" : "end");
    dragging.current = which;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!thumb) move(which, y);
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    if (dragging.current) move(dragging.current, yearAt(e.clientX));
  };
  const onPointerUp = () => { dragging.current = null; };

  const onKeyDown = (which) => (e) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    move(which, clampYear((which === "start" ? start : end) + step));
  };

  const leftPct = toPercent(start);
  const rightPct = toPercent(end);

  const thumb = (which, pct, value) => (
    <div
      data-thumb={which}
      role="slider"
      tabIndex={0}
      aria-label={which === "start" ? "From year" : "To year"}
      aria-valuemin={YEAR_MIN}
      aria-valuemax={YEAR_MAX}
      aria-valuenow={value}
      onKeyDown={onKeyDown(which)}
      className="absolute top-1/2 w-11 h-11 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center
                 cursor-grab active:cursor-grabbing outline-none group"
      style={{ left: `${pct}%` }}
    >
      <span className="block w-[18px] h-[18px] [@media(pointer:coarse)]:w-6 [@media(pointer:coarse)]:h-6 rounded-full
                       bg-chartizer-yellow border-[3px] border-[#26272b] shadow-[0_1px_4px_rgba(0,0,0,0.5)]
                       group-focus-visible:ring-2 group-focus-visible:ring-white/70 transition-transform group-active:scale-110" />
    </div>
  );

  return (
    <div className="flex flex-col gap-1 select-none min-w-[180px]">
      <label className="text-xs text-theme-muted pl-1">Year Range</label>

      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative h-11 mx-2 flex items-center cursor-pointer touch-none"
      >
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/15" />
        <div
          className="absolute h-[3px] rounded-full bg-chartizer-yellow"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />
        {thumb("start", leftPct, start)}
        {thumb("end", rightPct, end)}
      </div>

      <div className="flex justify-between text-[11px] text-theme-muted font-mono px-0.5">
        <span>{start}</span>
        <span>{end}</span>
      </div>
    </div>
  );
}
