import { X, CheckSquare, Square, Smartphone, Monitor } from "lucide-react";
import { useState, useEffect } from "react";
import { mono } from "../helpers";

export function ApprovalDrawer({
  item, onClose, onApprove, onDeny,
}: {
  item: PendingApproval | null;
  onClose: () => void;
  onApprove: (id: string, sids: string[]) => void;
  onDeny: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (item) setSelected(new Set(item.items.map((x) => x.sid)));
  }, [item?.id]);

  if (!item) return null;

  const toggleSid = (sid: string) =>
    setSelected((p) => { const n = new Set(p); n.has(sid) ? n.delete(sid) : n.add(sid); return n; });

  const allSelected = selected.size === item.items.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(item.items.map((x) => x.sid)));

  const selectedEst = item.items
    .filter((x) => selected.has(x.sid))
    .reduce((s, x) => s + Math.round((item.est / item.batchCount) * (x.cart / (item.items.reduce((a, b) => a + b.cart, 0) / item.items.length))), 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed top-0 bottom-0 right-0 z-50 flex flex-col border-l shadow-2xl border-white/8" style={{ width: 400, background: "#13161d" }}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-white/6 shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <div className="mb-1 text-xs font-semibold tracking-widest uppercase text-white/35" style={{ ...mono, fontSize: "0.58rem" }}>Pending Approval</div>
            <div className="text-sm font-semibold leading-snug text-white">{item.title}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/6 text-white/40 hover:text-white transition-colors shrink-0"><X size={15} /></button>
        </div>

        {/* Description */}
        <div className="px-5 py-3 border-b border-white/6 shrink-0">
          <p className="text-xs leading-relaxed text-white/45">{item.description}</p>
          <div className="flex items-center gap-3 mt-2.5 text-xs text-white/30">
            {item.cost > 0 && <span>Cost <span className="font-semibold text-white/60" style={mono}>${item.cost}</span></span>}
            <span>Est. recovery <span className="font-semibold text-emerald-400" style={mono}>+${item.est.toLocaleString()}</span></span>
          </div>
        </div>

        {/* Sub-item list */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {/* Select all row */}
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/5 bg-white/[0.01]">
            <button onClick={toggleAll} className="transition-colors shrink-0 text-white/30 hover:text-white/60">
              {allSelected ? <CheckSquare size={13} className="text-blue-400" /> : <Square size={13} />}
            </button>
            <span className="text-xs font-medium text-white/35">Select all ({item.items.length})</span>
            {selected.size > 0 && selected.size < item.items.length && (
              <span className="text-xs text-white/25" style={mono}>{selected.size} of {item.items.length}</span>
            )}
          </div>

          {item.items.map((sub, idx) => {
            const isSel = selected.has(sub.sid);
            const isLast = idx === item.items.length - 1;
            return (
              <div
                key={sub.sid}
                onClick={() => toggleSid(sub.sid)}
                className={`flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${!isLast ? "border-b border-white/4" : ""} ${isSel ? "bg-blue-500/6" : "hover:bg-white/[0.02]"}`}
              >
                <div className="shrink-0 text-white/25">
                  {isSel ? <CheckSquare size={13} className="text-blue-400" /> : <Square size={13} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-white/80">{sub.visitor}</span>
                    <span className="text-xs text-white/25" style={{ ...mono, fontSize: "0.62rem" }}>#{sub.sid}</span>
                  </div>
                  <div className="flex items-center gap-2 text-white/30" style={{ fontSize: "0.65rem" }}>
                    {sub.device === "mobile" ? <Smartphone size={9} /> : <Monitor size={9} />}
                    <span className="capitalize">{sub.device}</span>
                    <span>·</span>
                    <span>{sub.stage}</span>
                  </div>
                </div>
                <span className="text-xs font-semibold text-white/60 shrink-0" style={mono}>${sub.cart}</span>
              </div>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="flex flex-col gap-2 px-5 py-4 border-t border-white/6 shrink-0" style={{ background: "#0f1117" }}>
          {selected.size > 0 && (
            <div className="mb-1 text-xs text-white/30">
              Approving <span className="font-semibold text-white/60" style={mono}>{selected.size}</span> session{selected.size > 1 ? "s" : ""} · est. <span className="font-semibold text-emerald-400" style={mono}>+${selectedEst.toLocaleString()}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              disabled={selected.size === 0}
              onClick={() => { onApprove(item.id, [...selected]); onClose(); }}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-blue-500 text-white hover:bg-blue-400 transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Approve {selected.size > 0 ? `${selected.size === item.items.length ? "all " : ""}${selected.size}` : ""}
            </button>
            <button
              onClick={() => { onDeny(item.id); onClose(); }}
              className="px-5 py-2.5 rounded-xl text-xs text-white/40 border border-white/8 hover:border-white/15 hover:text-white/60 transition-all"
            >
              Deny all
            </button>
          </div>
        </div>
      </div>
    </>
  );
}