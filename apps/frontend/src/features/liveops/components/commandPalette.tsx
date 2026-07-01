import { Terminal } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { mono } from "../helpers";

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden border shadow-2xl rounded-2xl border-white/8" style={{ background: "#13161d" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/6">
          <Terminal size={14} className="text-blue-400" />
          <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any visitor, order, or session…" className="flex-1 text-sm text-white bg-transparent outline-none placeholder:text-white/30" />
          <kbd className="text-xs text-white/30 border border-white/8 rounded px-1.5 py-0.5" style={mono}>ESC</kbd>
        </div>
        <div className="py-8 text-xs text-center text-white/30">Type to search visitors, sessions, or orders…</div>
        <div className="px-4 py-2.5 border-t border-white/6 flex gap-5">
          {["↑↓ navigate", "↵ open", "ESC close"].map((t) => <span key={t} className="text-xs text-white/25">{t}</span>)}
        </div>
      </div>
    </div>
  );
}