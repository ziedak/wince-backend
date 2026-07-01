import { useState, useEffect } from "react";
import { RECOVERIES } from "../data";
import { mono } from "../helpers";

export function RecoveryTicker() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setOffset((o) => (o + 0.4) % (RECOVERIES.length * 68)), 25);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-3 px-4 py-2 overflow-hidden shrink-0" style={{ background: "#080a10" }}>
      <span className="text-xs text-emerald-400/50 shrink-0 uppercase tracking-[0.15em]" style={{ ...mono, fontSize: "0.58rem" }}>Recovered</span>
      <div className="flex-1 overflow-hidden">
        <div className="flex gap-6" style={{ transform: `translateX(-${offset}px)`, willChange: "transform" }}>
          {[...RECOVERIES, ...RECOVERIES, ...RECOVERIES, ...RECOVERIES].map((v, i) => (
            <span key={i} className="font-semibold text-emerald-400 shrink-0" style={{ ...mono, fontSize: "0.75rem", textShadow: "0 0 8px rgba(16,185,129,0.4)" }}>{v}</span>
          ))}
        </div>
      </div>
    </div>
  );
}