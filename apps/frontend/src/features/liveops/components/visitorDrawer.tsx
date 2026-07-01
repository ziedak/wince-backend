import { X, ShoppingCart, Smartphone, Monitor, Zap, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { DRAWER_TIMELINE } from "../data";
import { mono } from "../helpers";

export function VisitorDrawer({ session, onClose }: { session: DrawerSession | null; onClose: () => void }) {
  const [launched, setLaunched] = useState(false);
  if (!session) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed top-0 bottom-0 right-0 z-50 flex flex-col overflow-hidden border-l shadow-2xl border-white/8" style={{ width: 380, background: "#13161d" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 text-xs font-bold text-blue-400 border rounded-full bg-blue-500/20 border-blue-500/30" style={mono}>
              {session.name.split(" ").map((n) => n[0]).join("")}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{session.name}</div>
              <div className="text-xs text-white/40" style={mono}>#{session.id}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/6 text-white/40 hover:text-white transition-colors"><X size={15} /></button>
        </div>
        <div className="flex flex-col flex-1 gap-5 px-5 py-4 overflow-y-auto scrollbar-hide">
          <div className="rounded-xl border border-red-500/20 bg-red-500/6 p-3.5">
            <div className="flex items-start justify-between mb-2">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <ShoppingCart size={13} className="text-red-400" />
                  <span className="text-xs text-white/50">Cart</span>
                  <span className="text-base font-bold text-white" style={mono}>${session.cart}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/40">
                  {session.device === "mobile" ? <Smartphone size={11} /> : <Monitor size={11} />}
                  <span className="capitalize">{session.device}</span><span>·</span><span>{session.stage}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-red-400" style={mono}>{session.risk}%</div>
                <div className="text-xs text-white/40">risk</div>
              </div>
            </div>
            <div className="w-full h-1 overflow-hidden rounded-full bg-white/5">
              <div className="h-full bg-red-500 rounded-full" style={{ width: `${session.risk}%` }} />
            </div>
          </div>
          <div>
            <div className="mb-3 text-xs tracking-widest uppercase text-white/40" style={{ ...mono, fontSize: "0.6rem" }}>Session Journey</div>
            <div className="flex flex-col">
              {DRAWER_TIMELINE.map((step, i) => {
                const Icon = step.icon;
                const isLast = i === DRAWER_TIMELINE.length - 1;
                return (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="flex items-center justify-center w-6 h-6 border rounded-full shrink-0" style={{ borderColor: step.color + "44", background: step.color + "15" }}>
                        <Icon size={10} style={{ color: step.color }} />
                      </div>
                      {!isLast && <div className="flex-1 w-px my-1" style={{ background: "rgba(255,255,255,0.06)", minHeight: 16 }} />}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-white">{step.label}</span>
                        <span className="text-xs text-white/30" style={{ ...mono, fontSize: "0.62rem" }}>{step.time}</span>
                      </div>
                      <div className="text-xs italic text-white/40">"{step.note}"</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs tracking-widest uppercase text-white/40" style={{ ...mono, fontSize: "0.6rem" }}>Evidence</div>
            <div className="flex flex-wrap gap-1.5">
              {["Exit intent (mobile)", "Hovered shipping 6s", "VIP LTV $4,200", "Cross‑border IP", "54% AI confidence"].map((chip) => (
                <span key={chip} className="text-xs px-2.5 py-1 rounded-full border border-white/8 text-white/60" style={{ background: "#1a1d26" }}>{chip}</span>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs tracking-widest uppercase text-white/40" style={{ ...mono, fontSize: "0.6rem" }}>Recovery Action</div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/6 p-3.5">
              <div className="flex items-center gap-2 mb-2"><Zap size={11} className="text-amber-400" /><span className="text-xs font-semibold tracking-wider uppercase text-amber-400" style={{ fontSize: "0.6rem" }}>Recommended</span></div>
              <div className="mb-3 text-sm font-semibold text-white">Offer Free Shipping</div>
              <div className="flex gap-4 mb-3">
                <div><div className="text-xs text-white/40 mb-0.5">Impact</div><div className="text-sm font-semibold text-emerald-400" style={mono}>+$890</div></div>
                <div><div className="text-xs text-white/40 mb-0.5">Confidence</div><div className="text-sm font-semibold text-white" style={mono}>54%</div></div>
              </div>
              <button
                onClick={() => { setLaunched(true); toast.success("Offer launched for " + session.name); }}
                className={`w-full py-2 rounded-xl text-xs font-semibold transition-all ${launched ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-blue-500 text-white hover:bg-blue-400 active:scale-[0.98]"}`}
              >
                {launched ? <span className="flex items-center justify-center gap-1.5"><CheckCircle size={12} /> Launched</span> : "Launch for this visitor"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
function useState(arg0: boolean): [any, any] {
    throw new Error("Function not implemented.");
}

