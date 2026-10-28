import { useCallback, useEffect, useRef } from "react";

const YEAR_MIN = 1800;
const YEAR_MAX = new Date().getFullYear();

export { YEAR_MIN, YEAR_MAX };

export default function YearRangeSlider({ start, end, onChange }) {
  const trackRef = useRef(null);
  const dragging  = useRef(null); // "start" | "end" | null

  const toPercent = (v) => ((v - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;

  const clampYear = (v) => Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(v)));

  const yearFromClientX = (clientX) => {
    if (!trackRef.current) return YEAR_MIN;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return clampYear(YEAR_MIN + ratio * (YEAR_MAX - YEAR_MIN));
  };

  const onMouseMove = useCallback((e) => {
    if (!dragging.current) return;
    const y = yearFromClientX(e.clientX);
    if (dragging.current === "start") {
      onChange(Math.min(y, end - 1), end);
    } else {
      onChange(start, Math.max(y, start + 1));
    }
  }, [start, end, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMouseUp = useCallback(() => { dragging.current = null; }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const onTouchMove = useCallback((e) => {
    if (!dragging.current) return;
    const y = yearFromClientX(e.touches[0].clientX);
    if (dragging.current === "start") {
      onChange(Math.min(y, end - 1), end);
    } else {
      onChange(start, Math.max(y, start + 1));
    }
  }, [start, end, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend",  onMouseUp);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend",  onMouseUp);
    };
  }, [onTouchMove, onMouseUp]);

  const leftPct  = toPercent(start);
  const rightPct = toPercent(end);

  return (
    <div className="flex flex-col gap-1 select-none min-w-[180px]">
      <label className="text-xs text-ink-muted pl-1">Year Range</label>

      {/* track */}
      <div
        ref={trackRef}
        className="relative h-[34px] flex items-center cursor-pointer pb-0.5"
      >
        {/* grey rail */}
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-border" />

        {/* active range - styled with chartizer-yellow */}
        <div
          className="absolute h-[3px] rounded-full bg-chartizer-yellow"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />

        {/* start thumb */}
        <div
          className="absolute w-4 h-4 rounded-full bg-chartizer-yellow border-2 border-main shadow
                     cursor-grab active:cursor-grabbing hover:scale-110 transition-transform"
          style={{ left: `calc(${leftPct}% - 8px)`, top: "50%", transform: "translateY(-50%)" }}
          onMouseDown={(e) => { e.preventDefault(); dragging.current = "start"; }}
          onTouchStart={(e) => { e.preventDefault(); dragging.current = "start"; }}
        />

        {/* end thumb */}
        <div
          className="absolute w-4 h-4 rounded-full bg-chartizer-yellow border-2 border-main shadow
                     cursor-grab active:cursor-grabbing hover:scale-110 transition-transform"
          style={{ left: `calc(${rightPct}% - 8px)`, top: "50%", transform: "translateY(-50%)" }}
          onMouseDown={(e) => { e.preventDefault(); dragging.current = "end"; }}
          onTouchStart={(e) => { e.preventDefault(); dragging.current = "end"; }}
        />
      </div>

      {/* year labels */}
      <div className="flex justify-between text-[11px] text-ink-muted font-mono px-0.5">
        <span>{start}</span>
        <span>{end}</span>
      </div>
    </div>
  );
}
