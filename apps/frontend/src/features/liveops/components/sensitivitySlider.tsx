import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { mono } from "../helpers";

export function SensitivitySlider() {
  const [value, setValue] = useState(50);
  const [open, setOpen] = useState(false);
  const label = value < 34 ? "Conservative" : value < 67 ? "Balanced" : "Aggressive";
  return (
    <div className="relative">
      <button onClick={() => setOpen((s) => !s)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${open ? "border-blue-500/50 bg-blue-500/10 text-blue-400" : "border-white/8 bg-white/4 text-white/60 hover:border-white/15 hover:text-white/80"}`}>
        <SlidersHorizontal size={13} /> Adjust Sensitivity
      </button>
      {open && (
        <div className="absolute left-0 z-40 w-64 p-4 mt-2 border shadow-2xl top-full rounded-xl border-white/8" style={{ background: "#13161d" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-white">AI Sensitivity</span>
            <span className="text-xs font-semibold text-blue-400" style={mono}>{label}</span>
          </div>
          <input type="range" min={0} max={100} value={value} onChange={(e) => setValue(+e.target.value)} className="w-full mb-2 accent-blue-500" />
          <div className="flex justify-between text-xs text-white/30" style={{ fontSize: "0.62rem" }}>
            <span>Conservative</span><span>Balanced</span><span>Aggressive</span>
          </div>
        </div>
      )}
    </div>
  );
}
