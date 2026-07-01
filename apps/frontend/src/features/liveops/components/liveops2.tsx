import { useState, useEffect, useRef } from "react";
import {
  Zap, ChevronDown, Terminal, TrendingUp, TrendingDown, AlertTriangle,
  Shield, FlaskConical, FileText, Plus, Pause, Play,
  SlidersHorizontal, CheckSquare, Square, X, ArrowRight,
  ShoppingCart, Monitor, Smartphone, CreditCard, Home, Package,
  MousePointer2, CheckCircle, Pin, PinOff, Settings2, Users,
} from "lucide-react";
import { toast, Toaster } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign { id: string; name: string; active: boolean; trend: number | null }
interface AnomalyItem { time: string; event: string; status: "active" | "monitoring" | "resolved" }
interface ApprovalSubItem { sid: string; visitor: string; cart: number; stage: string; device: "mobile" | "desktop" }
interface PendingApproval {
  id: string; title: string; batchCount: number; cost: number; est: number;
  extra?: string; description: string; items: ApprovalSubItem[];
}
interface ExceptionItem { id: string; level: "vip" | "high"; label: string; cart: number; confidence: number; reason: string }
interface DrawerSession { id: string; name: string; cart: number; risk: number; device: "mobile" | "desktop"; stage: string }
interface ActiveSession {
  id: string; visitor: string; cart: number;
  stage: "Product" | "Cart" | "Checkout";
  device: "mobile" | "desktop"; risk: number; signal: string;
}
interface AutoDecision { time: string; visitor: string; action: string; detail: string; status: "auto" | "held" }

// ─── Static Data ──────────────────────────────────────────────────────────────

const ALL_CAMPAIGNS: Campaign[] = [
  { id: "summer",   name: "Summer Disc",     active: true,  trend: 12   },
  { id: "freeship", name: "Free Ship",        active: true,  trend: -4   },
  { id: "exitpop",  name: "Exit Popup",       active: false, trend: null },
  { id: "cart",     name: "Cart Remind",      active: true,  trend: 3    },
  { id: "loyalty",  name: "Loyalty Reward",   active: true,  trend: 7    },
  { id: "flash",    name: "Flash Sale",       active: false, trend: null },
  { id: "vip",      name: "VIP Early Access", active: true,  trend: 21   },
  { id: "bundle",   name: "Bundle Offer",     active: false, trend: -2   },
  { id: "referral", name: "Referral Bonus",   active: true,  trend: 5    },
];

const DEFAULT_PINNED = new Set(["summer", "freeship", "exitpop", "cart"]);

const FUNNEL = [
  { label: "Homepage", count: 1244, pct: 100, drop: null, health: "good"   as const },
  { label: "Product",  count: 814,  pct: 65,  drop: 82,   health: "good"   as const },
  { label: "Cart",     count: 238,  pct: 19,  drop: 38,   health: "warn"   as const },
  { label: "Checkout", count: 71,   pct: 6,   drop: 29,   health: "danger" as const },
  { label: "Purchase", count: 51,   pct: 4,   drop: 72,   health: "good"   as const },
];

const ANOMALIES: AnomalyItem[] = [
  { time: "14:22", event: "Mobile checkout drop −12% vs. baseline", status: "active"     },
  { time: "14:25", event: "New bot‑like pattern detected",           status: "monitoring" },
  { time: "14:28", event: "Model confidence recovering",             status: "resolved"   },
];

const PENDING_INIT: PendingApproval[] = [
  {
    id: "p1", title: "Free Shipping for carts >$150", batchCount: 4, cost: 0, est: 1120,
    description: "AI flagged 4 sessions where free shipping has >88% confidence of recovery. All are mobile users hesitating at checkout.",
    items: [
      { sid: "A1F2", visitor: "Guest #A1F2", cart: 320, stage: "Checkout", device: "mobile"  },
      { sid: "B3C4", visitor: "Sarah M.",     cart: 210, stage: "Checkout", device: "mobile"  },
      { sid: "D5E6", visitor: "Guest #D5E6", cart: 178, stage: "Cart",     device: "mobile"  },
      { sid: "G7H8", visitor: "Tom R.",       cart: 155, stage: "Checkout", device: "mobile"  },
    ],
  },
  {
    id: "p2", title: "10% Discount — first‑time visitor", batchCount: 1, cost: 28, est: 312, extra: "cart $340",
    description: "Single high-value first-time visitor on desktop, price-comparing. 10% discount keeps margin positive.",
    items: [{ sid: "K9L0", visitor: "Guest #K9L0", cart: 340, stage: "Product", device: "desktop" }],
  },
  {
    id: "p3", title: "Urgency banner — exit intent (mobile)", batchCount: 3, cost: 0, est: 540,
    description: "3 mobile sessions showing exit intent signals. Zero-cost urgency message ('Only 2 left') recommended.",
    items: [
      { sid: "M1N2", visitor: "Guest #M1N2", cart: 190, stage: "Cart",     device: "mobile" },
      { sid: "P3Q4", visitor: "Aisha K.",    cart: 210, stage: "Checkout", device: "mobile" },
      { sid: "R5S6", visitor: "Guest #R5S6", cart: 140, stage: "Cart",     device: "mobile" },
    ],
  },
  {
    id: "p4", title: "5% Loyalty discount — returning buyers", batchCount: 2, cost: 44, est: 780, extra: "carts >$200",
    description: "2 returning customers who haven't triggered the loyalty tier yet. Small discount nudges them to purchase.",
    items: [
      { sid: "T7U8", visitor: "James L.",  cart: 420, stage: "Checkout", device: "desktop" },
      { sid: "V9W0", visitor: "Priya N.",  cart: 360, stage: "Cart",     device: "mobile"  },
    ],
  },
  {
    id: "p5", title: "Free express shipping — VIP segment", batchCount: 1, cost: 18, est: 890, extra: "cart $890",
    description: "High-LTV VIP customer with cross-border pricing concern. Express shipping removes last friction point.",
    items: [{ sid: "X1Y2", visitor: "Priya K.", cart: 890, stage: "Checkout", device: "mobile" }],
  },
  {
    id: "p6", title: "Abandoned cart reminder — 2h delay", batchCount: 6, cost: 0, est: 430,
    description: "6 sessions that left without purchasing. Scheduled reminder at 2h window has 61% open rate for this segment.",
    items: [
      { sid: "Z3A4", visitor: "Guest #Z3A4", cart: 95,  stage: "Cart", device: "desktop" },
      { sid: "B5C6", visitor: "Lena W.",     cart: 78,  stage: "Cart", device: "mobile"  },
      { sid: "D7E8", visitor: "Guest #D7E8", cart: 110, stage: "Cart", device: "desktop" },
      { sid: "F9G0", visitor: "Omar S.",     cart: 64,  stage: "Cart", device: "mobile"  },
      { sid: "H1I2", visitor: "Guest #H1I2", cart: 52,  stage: "Cart", device: "mobile"  },
      { sid: "J3K4", visitor: "Nina T.",     cart: 88,  stage: "Cart", device: "desktop" },
    ],
  },
];

const EXCEPTIONS: ExceptionItem[] = [
  { id: "e1", level: "vip",  label: "VIP customer (LTV $4,200)",       cart: 890, confidence: 54, reason: "Cross‑border pricing anomaly"  },
  { id: "e2", level: "high", label: "High‑value + first‑time visitor",  cart: 340, confidence: 68, reason: "Unusual session pattern"         },
];

const RECOVERIES = ["+$48", "+$73", "+$31", "+$18", "+$52", "+$67", "+$29", "+$94", "+$55", "+$140", "+$220"];

const AI_ADAPTATIONS = [
  "Detected mobile shipping hesitation → auto‑deployed express shipping promo",
  "Flagged bot‑like behaviour on gift card page → paused interventions for segment",
];

// ── New: real at-risk session list (replaces the blind search input) ───────────

const ACTIVE_SESSIONS: ActiveSession[] = [
  { id: "K9L0", visitor: "Priya K.",     cart: 890, stage: "Checkout", device: "mobile",  risk: 87, signal: "VIP — low confidence"    },
  { id: "A1F2", visitor: "Guest #A1F2",  cart: 320, stage: "Checkout", device: "mobile",  risk: 84, signal: "Exit intent"              },
  { id: "T7U8", visitor: "James L.",     cart: 420, stage: "Checkout", device: "desktop", risk: 78, signal: "Dwell on shipping cost"   },
  { id: "M1N2", visitor: "Guest #M1N2",  cart: 190, stage: "Cart",     device: "mobile",  risk: 73, signal: "Price hesitation"         },
  { id: "V9W0", visitor: "Priya N.",     cart: 360, stage: "Cart",     device: "mobile",  risk: 68, signal: "Repeated cart edits"      },
  { id: "B3C4", visitor: "Sarah M.",     cart: 210, stage: "Checkout", device: "mobile",  risk: 64, signal: "Mobile checkout drop"     },
  { id: "D5E6", visitor: "Guest #D5E6",  cart: 178, stage: "Cart",     device: "mobile",  risk: 59, signal: "Tab switching"            },
  { id: "G7H8", visitor: "Tom R.",       cart: 155, stage: "Checkout", device: "mobile",  risk: 54, signal: "Coupon field focus"       },
  { id: "P3Q4", visitor: "Aisha K.",     cart: 210, stage: "Checkout", device: "mobile",  risk: 51, signal: "Exit intent"              },
];

// ── New: AI decisions with status field (moved into right-panel strip) ─────────

const AUTO_DECISIONS: AutoDecision[] = [
  { time: "14:28", visitor: "Guest #R5S6", action: "Urgency banner",    detail: "Exit intent — zero cost",    status: "auto" },
  { time: "14:27", visitor: "Aisha K.",    action: "Free shipping",      detail: "Mobile checkout hesitation", status: "auto" },
  { time: "14:25", visitor: "Guest #F1A0", action: "10% disc — held",   detail: "Exceeds safety budget",      status: "held" },
  { time: "14:24", visitor: "Lena W.",     action: "Cart reminder",      detail: "Queued 2h delay",            status: "auto" },
  { time: "14:23", visitor: "John D.",     action: "Free shipping",      detail: "Tier‑1, margin‑safe",        status: "auto" },
  { time: "14:22", visitor: "Guest #A3C2", action: "Urgency message",   detail: "Cart >$200, exit intent",    status: "auto" },
  { time: "14:21", visitor: "Omar S.",     action: "VIP offer — held",  detail: "Confidence below 60%",       status: "held" },
  { time: "14:19", visitor: "Nina T.",     action: "Bundle cross‑sell", detail: "High-margin add-on",         status: "auto" },
];

const DRAWER_SESSION: DrawerSession = { id: "2401", name: "Priya K.", cart: 890, risk: 87, device: "mobile", stage: "Checkout" };

const DRAWER_TIMELINE = [
  { icon: Home,          label: "Landed on Homepage",  note: "Via Google Shopping ad",      time: "14:08", color: "#10b981" },
  { icon: Package,       label: "Viewed product page", note: "3 min 20s — high engagement", time: "14:12", color: "#10b981" },
  { icon: ShoppingCart,  label: "Added to cart",       note: "$890 item",                   time: "14:16", color: "#f59e0b" },
  { icon: CreditCard,    label: "Reached checkout",    note: "Paused 6s on shipping cost",  time: "14:21", color: "#ef4444" },
  { icon: MousePointer2, label: "Exit intent fired",   note: "Mobile swipe‑up gesture",     time: "14:22", color: "#ef4444" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mono = { fontFamily: "var(--font-mono)" } as const;
const funnelColor = (h: "good" | "warn" | "danger") =>
  h === "danger" ? "#ef4444" : h === "warn" ? "#f59e0b" : "#10b981";
const riskColor = (r: number) =>
  r >= 75 ? "#ef4444" : r >= 55 ? "#f59e0b" : "#10b981";
const anomalyMeta = (s: AnomalyItem["status"]) =>
  s === "active"     ? { dot: "bg-red-500 animate-pulse",  text: "text-red-400",     label: "⚡ Active"     } :
  s === "monitoring" ? { dot: "bg-amber-400",              text: "text-amber-400",   label: "👁 Monitoring" } :
                       { dot: "bg-emerald-400",            text: "text-emerald-400", label: "✓ Resolved"   };

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-[18px] w-8 items-center rounded-full transition-all duration-200 ${active ? "bg-blue-500" : "bg-white/10"}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${active ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

function TrendBadge({ trend, active }: { trend: number | null; active: boolean }) {
  if (!active || trend === null) return null;
  const up = trend > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold ${up ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}
      style={{ ...mono, fontSize: "0.6rem" }}
    >
      {up ? <TrendingUp size={8} /> : <TrendingDown size={8} />}{up ? "+" : ""}{trend}%
    </span>
  );
}

// ─── Recovery Ticker ──────────────────────────────────────────────────────────

function RecoveryTicker() {
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

// ─── Sensitivity Slider ───────────────────────────────────────────────────────

function SensitivitySlider() {
  const [value, setValue] = useState(50);
  const [open, setOpen] = useState(false);
  const label = value < 34 ? "Conservative" : value < 67 ? "Balanced" : "Aggressive";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((s) => !s)}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${open ? "border-blue-500/50 bg-blue-500/10 text-blue-400" : "border-white/8 bg-white/4 text-white/60 hover:border-white/15 hover:text-white/80"}`}
      >
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

// ─── Campaign Manager Popover ─────────────────────────────────────────────────

function CampaignManager({
  campaigns, pinned, onToggleCampaign, onTogglePin, onClose,
}: {
  campaigns: Campaign[];
  pinned: Set<string>;
  onToggleCampaign: (id: string) => void;
  onTogglePin: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute left-0 z-40 mt-2 overflow-hidden border shadow-2xl top-full rounded-xl border-white/8" style={{ background: "#13161d", width: 320 }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/6">
          <span className="text-xs font-semibold text-white">Manage Campaigns</span>
          <button onClick={onClose} className="p-1 transition-colors rounded-lg hover:bg-white/6 text-white/40 hover:text-white"><X size={13} /></button>
        </div>
        <div className="py-1 overflow-y-auto max-h-72 scrollbar-hide">
          {campaigns.map((c) => {
            const isPinned = pinned.has(c.id);
            return (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03] group transition-colors">
                <button
                  onClick={() => onTogglePin(c.id)}
                  className={`shrink-0 transition-colors ${isPinned ? "text-blue-400" : "text-white/15 hover:text-white/40"}`}
                  title={isPinned ? "Unpin from bar" : "Pin to bar"}
                >
                  {isPinned ? <Pin size={12} /> : <PinOff size={12} />}
                </button>
                <span className={`flex-1 text-xs font-medium ${isPinned ? "text-white/80" : "text-white/40"}`}>{c.name}</span>
                <TrendBadge trend={c.trend} active={c.active} />
                <Toggle active={c.active} onToggle={() => onToggleCampaign(c.id)} />
              </div>
            );
          })}
        </div>
        <div className="px-4 py-2.5 border-t border-white/6 flex items-center gap-1.5 text-xs text-white/25">
          <Pin size={10} className="text-blue-400/60" />
          <span>Pinned campaigns appear in the top bar</span>
        </div>
      </div>
    </>
  );
}

// ─── Approval Drawer ──────────────────────────────────────────────────────────

function ApprovalDrawer({
  item, onClose, onApprove, onDeny,
}: {
  item: PendingApproval | null;
  onClose: () => void;
  onApprove: (id: string, sids: string[]) => void;
  onDeny: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => { if (item) setSelected(new Set(item.items.map((x) => x.sid))); }, [item?.id]);
  if (!item) return null;

  const toggleSid = (sid: string) =>
    setSelected((p) => { const n = new Set(p); n.has(sid) ? n.delete(sid) : n.add(sid); return n; });
  const allSelected = selected.size === item.items.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(item.items.map((x) => x.sid)));
  const avgCart = item.items.reduce((a, b) => a + b.cart, 0) / item.items.length;
  const selectedEst = item.items
    .filter((x) => selected.has(x.sid))
    .reduce((s, x) => s + Math.round((item.est / item.batchCount) * (x.cart / avgCart)), 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed top-0 bottom-0 right-0 z-50 flex flex-col border-l shadow-2xl border-white/8" style={{ width: 400, background: "#13161d" }}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-white/6 shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <div className="mb-1 text-xs font-semibold tracking-widest uppercase text-white/35" style={{ ...mono, fontSize: "0.58rem" }}>Pending Approval</div>
            <div className="text-sm font-semibold leading-snug text-white">{item.title}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/6 text-white/40 hover:text-white transition-colors shrink-0"><X size={15} /></button>
        </div>
        <div className="px-5 py-3 border-b border-white/6 shrink-0">
          <p className="text-xs leading-relaxed text-white/45">{item.description}</p>
          <div className="flex items-center gap-3 mt-2.5 text-xs text-white/30">
            {item.cost > 0 && <span>Cost <span className="font-semibold text-white/60" style={mono}>${item.cost}</span></span>}
            <span>Est. recovery <span className="font-semibold text-emerald-400" style={mono}>+${item.est.toLocaleString()}</span></span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide">
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

// ─── Visitor Drawer ───────────────────────────────────────────────────────────

function VisitorDrawer({ session, onClose }: { session: DrawerSession | null; onClose: () => void }) {
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
              <div className="flex items-center gap-2 mb-2">
                <Zap size={11} className="text-amber-400" />
                <span className="text-xs font-semibold tracking-wider uppercase text-amber-400" style={{ fontSize: "0.6rem" }}>Recommended</span>
              </div>
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

// ─── Active Sessions Drawer ───────────────────────────────────────────────────
// Replaces the blind search input. Filterable real-time list of at-risk sessions.
// ⌘K remains the lookup tool for historical/global search by ID or email.

function ActiveSessionsDrawer({
  onClose, onReview,
}: {
  onClose: () => void;
  onReview: (s: DrawerSession) => void;
}) {
  const [stageFilter, setStageFilter]   = useState("All");
  const [deviceFilter, setDeviceFilter] = useState("All");
  const [riskFilter, setRiskFilter]     = useState("All");

  const filtered = ACTIVE_SESSIONS.filter((s) => {
    if (stageFilter  !== "All" && s.stage  !== stageFilter)  return false;
    if (deviceFilter !== "All" && s.device !== deviceFilter) return false;
    if (riskFilter === "High" && s.risk < 70)                return false;
    if (riskFilter === "Med"  && (s.risk >= 70 || s.risk < 50)) return false;
    return true;
  });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed top-0 bottom-0 right-0 z-50 flex flex-col border-l shadow-2xl border-white/8" style={{ width: 440, background: "#13161d" }}>

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-white/6 shrink-0">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold tracking-widest uppercase text-white/35" style={{ ...mono, fontSize: "0.58rem" }}>
                Live · Active Sessions
              </span>
            </div>
            <div className="text-sm font-semibold text-white">
              {filtered.length} at-risk visitors
              <span className="font-normal text-white/30"> right now</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/6 text-white/40 hover:text-white transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Filters */}
        <div className="px-5 py-2.5 border-b border-white/6 shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="w-10 text-xs text-white/25 shrink-0">Stage</span>
            {["All", "Product", "Cart", "Checkout"].map((v) => (
              <button
                key={v}
                onClick={() => setStageFilter(v)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  stageFilter === v
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "bg-white/4 text-white/35 border border-white/6 hover:text-white/60"
                }`}
              >{v}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-10 text-xs text-white/25 shrink-0">Device</span>
              {[{ v: "All", label: "All" }, { v: "mobile", label: "Mobile" }, { v: "desktop", label: "Desktop" }].map(({ v, label }) => (
                <button
                  key={v}
                  onClick={() => setDeviceFilter(v)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    deviceFilter === v
                      ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      : "bg-white/4 text-white/35 border border-white/6 hover:text-white/60"
                  }`}
                >{label}</button>
              ))}
            </div>
            <div className="w-px h-4 bg-white/8" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/25 shrink-0">Risk</span>
              {[{ v: "All", label: "All" }, { v: "High", label: "≥70%" }, { v: "Med", label: "50–70%" }].map(({ v, label }) => (
                <button
                  key={v}
                  onClick={() => setRiskFilter(v)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    riskFilter === v
                      ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      : "bg-white/4 text-white/35 border border-white/6 hover:text-white/60"
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Session list — sorted by risk desc */}
        <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-white/[0.04]">
          {filtered.length === 0 && (
            <div className="px-5 py-12 text-xs italic text-center text-white/25">No sessions match these filters</div>
          )}
          {filtered.map((s) => {
            const rc = riskColor(s.risk);
            const initials = s.visitor.startsWith("Guest")
              ? "G"
              : s.visitor.split(" ").map((n) => n[0]).join("");
            return (
              <div
                key={s.id}
                className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-white/[0.025] cursor-pointer transition-colors group"
                onClick={() => { onReview(DRAWER_SESSION); onClose(); }}
              >
                <div
                  className="flex items-center justify-center w-8 h-8 text-xs font-bold rounded-full shrink-0"
                  style={{ background: rc + "18", color: rc, border: `1px solid ${rc}28`, fontFamily: "var(--font-mono)" }}
                >
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-white/85">{s.visitor}</span>
                    {s.device === "mobile"
                      ? <Smartphone size={10} className="text-white/20 shrink-0" />
                      : <Monitor size={10} className="text-white/20 shrink-0" />}
                  </div>
                  <div className="flex items-center gap-1.5 text-white/30" style={{ fontSize: "0.65rem" }}>
                    <span className="font-semibold text-white/50" style={mono}>${s.cart}</span>
                    <span>·</span>
                    <span>{s.stage}</span>
                    <span>·</span>
                    <span className="italic truncate">{s.signal}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="text-right">
                    <div className="text-sm font-bold" style={{ ...mono, color: rc }}>{s.risk}%</div>
                    <div className="text-xs text-white/20" style={{ fontSize: "0.58rem" }}>risk</div>
                  </div>
                  <div className="p-1.5 rounded-lg border border-white/8 text-white/20 group-hover:border-white/20 group-hover:text-white/60 transition-all">
                    <ArrowRight size={11} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/6 shrink-0">
          <span className="text-xs text-white/20" style={{ fontSize: "0.62rem" }}>Auto-refreshes every 30s</span>
          <button
            onClick={() => { toast("Use ⌘K to search any visitor by ID or email"); onClose(); }}
            className="text-xs transition-colors text-blue-400/50 hover:text-blue-400"
          >
            ⌘K search by ID →
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Command Palette ──────────────────────────────────────────────────────────

function CommandPalette({ onClose }: { onClose: () => void }) {
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

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [campaigns, setCampaigns]                   = useState(ALL_CAMPAIGNS);
  const [pinnedIds, setPinnedIds]                   = useState<Set<string>>(new Set(DEFAULT_PINNED));
  const [showCampaignMgr, setShowCampaignMgr]       = useState(false);
  const [pending, setPending]                       = useState(PENDING_INIT);
  const [checked, setChecked]                       = useState<Set<string>>(new Set());
  const [approvalDrawer, setApprovalDrawer]         = useState<PendingApproval | null>(null);
  const [visitorDrawer, setVisitorDrawer]           = useState<DrawerSession | null>(null);
  const [showActiveSessions, setShowActiveSessions] = useState(false);
  const [autoPaused, setAutoPaused]                 = useState(false);
  const [showCmd, setShowCmd]                       = useState(false);
  const [budget, setBudget]                         = useState({ used: 320, total: 500 });
  const [dismissedAnomalies, setDismissedAnomalies] = useState<Set<number>>(new Set());

  const toggleCampaign = (id: string) =>
    setCampaigns((c) => c.map((x) => x.id === id ? { ...x, active: !x.active } : x));
  const togglePin = (id: string) =>
    setPinnedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleCheck = (id: string) =>
    setChecked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const approveSessions = (id: string, sids: string[]) => {
    const item = pending.find((x) => x.id === id);
    if (!item) return;
    const remaining = item.items.filter((x) => !sids.includes(x.sid));
    if (remaining.length === 0) {
      setPending((p) => p.filter((x) => x.id !== id));
    } else {
      setPending((p) => p.map((x) => x.id === id ? { ...x, batchCount: remaining.length, items: remaining } : x));
    }
    setChecked((p) => { const n = new Set(p); n.delete(id); return n; });
    toast.success(`Approved ${sids.length} session${sids.length > 1 ? "s" : ""}`, { description: item.title });
  };

  const denyApproval = (id: string) => {
    const item = pending.find((x) => x.id === id);
    setPending((p) => p.filter((x) => x.id !== id));
    setChecked((p) => { const n = new Set(p); n.delete(id); return n; });
    toast("Denied", { description: item?.title });
  };

  const approveSelected = () => {
    [...checked].forEach((id) => {
      const item = pending.find((x) => x.id === id);
      if (item) approveSessions(id, item.items.map((x) => x.sid));
    });
    setChecked(new Set());
  };

  const budgetPct = Math.round((budget.used / budget.total) * 100);
  const budgetLow = budgetPct >= 70;
  const pinnedCampaigns = campaigns.filter((c) => pinnedIds.has(c.id));

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowCmd((s) => !s); }
      if (e.key === "Escape") {
        setShowCmd(false);
        setVisitorDrawer(null);
        setApprovalDrawer(null);
        setShowCampaignMgr(false);
        setShowActiveSessions(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => toast("🔥 High-value cart saved!", { description: "AI auto‑recovered $320" }), 9000);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="flex flex-col w-full h-screen overflow-hidden bg-background text-foreground" style={{ fontFamily: "var(--font-body)", fontSize: "var(--font-size)" }}>
      <Toaster theme="dark" position="top-right" toastOptions={{ style: { background: "#13161d", border: "1px solid rgba(255,255,255,0.06)", color: "#f1f5f9", fontSize: "0.78rem", borderRadius: "12px" } }} />

      {showCmd           && <CommandPalette onClose={() => setShowCmd(false)} />}
      {showActiveSessions && (
        <ActiveSessionsDrawer
          onClose={() => setShowActiveSessions(false)}
          onReview={(s) => { setVisitorDrawer(s); setShowActiveSessions(false); }}
        />
      )}
      <ApprovalDrawer item={approvalDrawer} onClose={() => setApprovalDrawer(null)} onApprove={approveSessions} onDeny={denyApproval} />
      <VisitorDrawer  session={visitorDrawer} onClose={() => setVisitorDrawer(null)} />

      {/* Floating batch bar */}
      {checked.size > 0 && (
        <div className="fixed z-30 flex items-center gap-3 px-5 py-3 -translate-x-1/2 border shadow-2xl bottom-6 left-1/2 rounded-2xl border-blue-500/30" style={{ background: "#13161d", backdropFilter: "blur(12px)" }}>
          <CheckSquare size={14} className="text-blue-400" />
          <span className="text-sm font-medium text-white">{checked.size} selected</span>
          <span className="text-white/30">·</span>
          <span className="text-sm font-semibold text-emerald-400" style={mono}>
            +${pending.filter((p) => checked.has(p.id)).reduce((s, p) => s + p.est, 0).toLocaleString()} est.
          </span>
          <button onClick={approveSelected} className="ml-2 px-4 py-1.5 rounded-xl bg-blue-500 text-white text-xs font-semibold hover:bg-blue-400 transition-colors">Approve selected</button>
          <button onClick={() => setChecked(new Set())} className="p-1 transition-colors rounded-lg hover:bg-white/8 text-white/40 hover:text-white"><X size={13} /></button>
        </div>
      )}

      {/* ── Navbar ── */}
      <header className="flex items-center justify-between h-12 px-5 border-b border-white/6 shrink-0" style={{ background: "#0f1117" }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-6 h-6 bg-blue-500 rounded-lg"><Zap size={13} className="text-white" /></div>
          <span className="text-sm font-semibold text-white uppercase tracking-[0.1em]" style={{ fontFamily: "var(--font-display)" }}>LiveOps</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/15 transition-colors">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> {pending.length} pending
          </button>
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-medium hover:bg-amber-500/15 transition-colors">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" /> 1 anomaly
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowCmd(true)} className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 border border-white/8 rounded-lg px-2.5 py-1 transition-colors"><Terminal size={11} /> ⌘K</button>
          <button className="flex items-center gap-1 text-xs transition-colors text-white/60 hover:text-white">Store: Main <ChevronDown size={11} /></button>
          <div className="flex items-center justify-center text-xs font-bold text-blue-400 border rounded-full w-7 h-7 bg-blue-500/20 border-blue-500/30" style={mono}>M</div>
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
        </div>
      </header>

      {/* ── Recovery Bar ── */}
      <div className="flex items-stretch border-b border-white/6 shrink-0" style={{ background: "linear-gradient(to bottom, #13161d, #0f1117)" }}>
        {[
          { label: "Recovered Today",    extra: "value",  value: "$12,480", color: "text-emerald-400", sub: "since 00:00 UTC" },
          { label: "Auto‑Recovery Rate", extra: "value",  value: "92%",     color: "text-white",       sub: null },
          { label: "Safety Budget Left", extra: "budget", value: null,      color: budgetLow ? "text-amber-400" : "text-white", sub: null },
          { label: "AI Health",          extra: "health", value: null,      color: "text-emerald-400", sub: null },
        ].map((m, i) => (
          <div key={i} className={`flex-1 flex flex-col justify-center px-5 py-3.5 ${i < 3 ? "border-r border-white/6" : ""}`}>
            <div className="text-xs text-white/40 mb-1.5 font-medium">{m.label}</div>
            {m.extra === "budget" ? (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-xl font-bold ${m.color}`} style={mono}>${budget.used}</span>
                  <span className="text-sm text-white/30" style={mono}>/ ${budget.total}</span>
                  <button onClick={() => { setBudget((b) => ({ ...b, total: b.total + 200 })); toast("Budget increased by $200"); }} className="flex items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-lg px-1.5 py-0.5 transition-colors ml-1"><Plus size={9} /> Add</button>
                </div>
                <div className="w-full h-1 overflow-hidden rounded-full bg-white/5">
                  <div className={`h-full rounded-full transition-all duration-700 ${budgetLow ? "bg-amber-400" : "bg-blue-500"}`} style={{ width: `${budgetPct}%` }} />
                </div>
              </div>
            ) : m.extra === "health" ? (
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
                <span className="text-xl font-bold text-emerald-400">Optimal</span>
              </div>
            ) : (
              <div>
                <div className={`text-xl font-bold ${m.color}`} style={mono}>{m.value}</div>
                {m.sub && <div className="text-xs text-white/25 mt-0.5" style={{ fontSize: "0.62rem" }}>{m.sub}</div>}
              </div>
            )}
          </div>
        ))}
        {autoPaused && (
          <div className="flex items-center gap-2 px-4 border-l border-amber-500/20 bg-amber-500/5 shrink-0">
            <Pause size={11} className="text-amber-400" /><span className="text-xs text-amber-400">Paused</span>
          </div>
        )}
      </div>

      {/* ── Campaigns Bar ── */}
      <div className="relative flex items-center gap-2 px-5 py-2.5 border-b border-white/6 shrink-0 flex-wrap" style={{ background: "#0f1117" }}>
        <span className="mr-1 text-xs text-white/30">Campaigns</span>
        {pinnedCampaigns.map((c) => (
          <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/6 transition-colors hover:border-white/10" style={{ background: "#1a1d26" }}>
            <span className="text-xs font-medium text-white/70">{c.name}</span>
            <div className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${c.active ? "bg-emerald-400 shadow-[0_0_4px_#10b981]" : "bg-white/15"}`} />
              <span className="text-xs font-semibold" style={{ ...mono, fontSize: "0.62rem", color: c.active ? "#10b981" : "rgba(255,255,255,0.25)" }}>{c.active ? "ON" : "OFF"}</span>
            </div>
            <Toggle active={c.active} onToggle={() => toggleCampaign(c.id)} />
            <TrendBadge trend={c.trend} active={c.active} />
          </div>
        ))}
        <div className="relative">
          <button
            onClick={() => setShowCampaignMgr((s) => !s)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-all ${showCampaignMgr ? "border-blue-500/40 bg-blue-500/10 text-blue-400" : "border-white/8 text-white/30 hover:border-white/15 hover:text-white/60"}`}
          >
            <Settings2 size={12} />
            <span>{campaigns.length - pinnedIds.size > 0 ? `+${campaigns.length - pinnedIds.size}` : "Manage"}</span>
          </button>
          {showCampaignMgr && (
            <CampaignManager campaigns={campaigns} pinned={pinnedIds} onToggleCampaign={toggleCampaign} onTogglePin={togglePin} onClose={() => setShowCampaignMgr(false)} />
          )}
        </div>
      </div>

      {/* ── Main Two Columns ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left 45%: OBSERVE ── */}
        <div className="flex flex-col overflow-hidden border-r border-white/6" style={{ width: "45%" }}>
          <div className="px-4 py-2 border-b border-white/6 shrink-0" style={{ background: "#0f1117" }}>
            <span className="text-xs font-semibold tracking-widest uppercase text-white/35" style={{ ...mono, fontSize: "0.6rem" }}>Observe</span>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-hide">

            {/* Live Funnel — occupies the full left panel now that anomaly feed moved to footer */}
            <div className="px-4 py-3">
              <div className="mb-3 text-xs font-semibold tracking-widest uppercase text-white/35" style={{ ...mono, fontSize: "0.6rem" }}>Live Funnel</div>
              <div className="flex flex-col gap-1.5 mb-3">
                {FUNNEL.map((step) => {
                  const color = funnelColor(step.health);
                  return (
                    <div key={step.label} className="flex items-center gap-3">
                      <div className="w-[72px] shrink-0 text-xs text-white/50 text-right">{step.label}</div>
                      <div className="flex-1 h-5 overflow-hidden rounded-lg bg-white/4">
                        <div className="flex items-center h-full pl-2 transition-all duration-700 rounded-lg" style={{ width: `${Math.max(step.pct, 4)}%`, background: color + "22", borderRight: `2px solid ${color}55` }}>
                          <span className="text-xs font-semibold text-white/70 whitespace-nowrap" style={mono}>{step.count.toLocaleString()}</span>
                        </div>
                      </div>
                      {step.drop !== null && (
                        <div className="w-10 text-right shrink-0">
                          <span className="text-xs font-semibold" style={{ ...mono, color, fontSize: "0.65rem" }}>↓{step.drop}%</span>
                        </div>
                      )}
                      {step.health === "danger" && <AlertTriangle size={10} className="text-red-400 shrink-0" />}
                    </div>
                  );
                })}
              </div>

              {/* Primary anomaly alert — keeps its place in the funnel */}
              <div className="px-3 py-2 mb-2 border rounded-xl border-red-500/20 bg-red-500/6">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <span className="text-xs font-semibold text-red-400">🛑 Checkout mobile drop −12%</span>
                  <span className="ml-auto text-xs text-red-400/50">vs. baseline</span>
                </div>
              </div>

              {/* Compact secondary anomaly summary — feed detail is now in footer */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/6" style={{ background: "#1a1d26" }}>
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <span className="text-xs text-white/35">Bot pattern monitoring</span>
                <span className="mx-1 text-white/15">·</span>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-xs text-white/35">Confidence recovering</span>
                <span className="ml-auto text-xs text-white/20">↓ feed</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right 55%: UNDERSTAND & APPROVE ── */}
        <div className="flex flex-col overflow-hidden" style={{ width: "55%" }}>
          <div className="px-4 py-2 border-b border-white/6 shrink-0" style={{ background: "#0f1117" }}>
            <span className="text-xs font-semibold tracking-widest uppercase text-white/35" style={{ ...mono, fontSize: "0.6rem" }}>Understand & Approve</span>
          </div>

          {/* Upper scrollable area: Pending Approvals + Exceptions */}
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto scrollbar-hide">

            {/* Pending Approvals */}
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold tracking-widest uppercase text-white/35" style={{ ...mono, fontSize: "0.6rem" }}>Pending Approvals</span>
                  <span className="text-xs font-semibold text-white/50 bg-white/8 rounded-full px-2 py-0.5" style={mono}>{pending.length}</span>
                </div>
                {checked.size > 0 && (
                  <button onClick={approveSelected} className="text-xs font-semibold text-blue-400 transition-colors hover:text-blue-300">
                    Approve {checked.size} selected
                  </button>
                )}
              </div>
              <div className="overflow-hidden border rounded-xl border-white/6" style={{ background: "#13161d" }}>
                {pending.length === 0 ? (
                  <div className="px-4 py-5 text-xs italic text-center text-white/25">All caught up — no pending approvals.</div>
                ) : (
                  pending.map((item, idx) => {
                    const isChecked = checked.has(item.id);
                    const isLast = idx === pending.length - 1;
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${!isLast ? "border-b border-white/5" : ""} ${isChecked ? "bg-blue-500/8" : "hover:bg-white/[0.025]"}`}
                        onClick={() => setApprovalDrawer(item)}
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleCheck(item.id); }}
                          className="transition-colors shrink-0 text-white/25 hover:text-white/60"
                        >
                          {isChecked ? <CheckSquare size={13} className="text-blue-400" /> : <Square size={13} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate text-white/80">{item.title}</div>
                          <div className="flex items-center gap-1.5 mt-0.5 text-white/30" style={{ fontSize: "0.65rem" }}>
                            <span style={mono}>{item.batchCount}×</span>
                            {item.extra && <><span>·</span><span>{item.extra}</span></>}
                            {item.cost > 0 && <><span>·</span><span>cost <span style={mono}>${item.cost}</span></span></>}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-emerald-400 shrink-0" style={mono}>+${item.est.toLocaleString()}</span>
                        <div className="flex items-center overflow-hidden border rounded-lg shrink-0 border-white/8" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => approveSessions(item.id, item.items.map((x) => x.sid))} className="px-2.5 py-1 text-xs font-semibold text-blue-400 hover:bg-blue-500/15 hover:text-blue-300 transition-colors border-r border-white/8">
                            Approve
                          </button>
                          <button onClick={() => denyApproval(item.id)} className="px-2.5 py-1 text-xs text-white/25 hover:bg-white/5 hover:text-white/50 transition-colors">
                            Deny
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Exceptions */}
            <div className="px-4 pt-1 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold tracking-widest uppercase text-white/35" style={{ ...mono, fontSize: "0.6rem" }}>Exceptions</span>
                <div className="flex items-center gap-1 text-xs text-white/25">
                  <Shield size={10} className="text-emerald-400" />
                  <span><span className="font-semibold text-emerald-400" style={mono}>200+</span> auto‑handled in last 15 min</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {EXCEPTIONS.map((ex) => {
                  const isVip = ex.level === "vip";
                  return (
                    <div
                      key={ex.id}
                      className="overflow-hidden transition-all border cursor-pointer rounded-xl border-white/6 hover:border-white/10"
                      style={{ background: "#13161d" }}
                      onClick={() => setVisitorDrawer(DRAWER_SESSION)}
                    >
                      <div className="flex">
                        <div className="w-0.5 shrink-0" style={{ background: isVip ? "#ef4444" : "#f59e0b" }} />
                        <div className="flex-1 flex items-center gap-3 px-3 py-2.5">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isVip ? "bg-red-500 shadow-[0_0_5px_#ef4444]" : "bg-amber-400"}`} />
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-semibold truncate ${isVip ? "text-red-400" : "text-amber-400"}`}>{ex.label}</div>
                            <div className="flex items-center gap-2 mt-0.5 text-white/30" style={{ fontSize: "0.65rem" }}>
                              <span>Cart <span className="font-medium text-white/60" style={mono}>${ex.cart}</span></span>
                              <span>·</span>
                              <span>Confidence <span className={`font-medium ${ex.confidence < 60 ? "text-red-400" : "text-amber-400"}`} style={mono}>{ex.confidence}%</span></span>
                              <span>·</span>
                              <span className="italic truncate">{ex.reason}</span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setVisitorDrawer(DRAWER_SESSION); }}
                            className="text-xs font-medium underline transition-colors text-white/35 hover:text-white/70 shrink-0 underline-offset-2"
                          >Review</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── AI Activity strip — fixed at bottom of right panel ── */}
          {/* Moved here from footer: this is the primary trust signal showing what the AI is doing. */}
          <div className="px-4 py-3 border-t border-white/6 shrink-0" style={{ background: "#0f1117" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-xs font-semibold tracking-widest uppercase text-white/35" style={{ ...mono, fontSize: "0.6rem" }}>AI Activity</span>
                <span className="text-xs text-white/20" style={{ fontSize: "0.62rem" }}>last 15 min</span>
              </div>
              <button className="flex items-center gap-1 text-xs transition-colors text-white/25 hover:text-white/50">
                <FileText size={10} /> Audit log →
              </button>
            </div>
            <div
              className="rounded-xl border border-white/5 overflow-y-auto divide-y divide-white/[0.04]"
              style={{ background: "#13161d", maxHeight: 152 }}
            >
              {AUTO_DECISIONS.map((d, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.02] transition-colors">
                  <span className="text-xs text-white/20 shrink-0" style={{ ...mono, fontSize: "0.6rem" }}>{d.time}</span>
                  <div className={`w-1 h-1 rounded-full shrink-0 ${d.status === "auto" ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <span className="text-xs text-white/35 shrink-0 max-w-[80px] truncate">{d.visitor}</span>
                  <span className="text-xs text-white/15 shrink-0">·</span>
                  <span className={`text-xs flex-1 truncate ${d.status === "held" ? "text-amber-400/80" : "text-white/65"}`}>{d.action}</span>
                  <span className="text-xs text-white/20 shrink-0 italic truncate max-w-[110px]" style={{ fontSize: "0.6rem" }}>{d.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Actions Strip ── */}
      <div className="px-5 py-3 border-t border-white/6 shrink-0" style={{ background: "#0f1117" }}>
        <div className="flex flex-wrap items-start gap-5">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-white/30 uppercase tracking-widest mb-2 font-semibold" style={{ ...mono, fontSize: "0.58rem" }}>
              <Zap size={9} className="text-amber-400" /> Quick Controls
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setAutoPaused((s) => !s); toast(autoPaused ? "Resumed" : "Paused for 30 min"); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${autoPaused ? "border-emerald-500/40 bg-emerald-500/8 text-emerald-400" : "border-white/8 bg-white/4 text-white/60 hover:border-white/15 hover:text-white/80"}`}
              >
                {autoPaused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause 30 min</>}
              </button>
              <SensitivitySlider />
            </div>
          </div>
          <div className="self-stretch w-px bg-white/6" />
          <div>
            <div className="mb-2 text-xs font-semibold tracking-widest uppercase text-white/30" style={{ ...mono, fontSize: "0.58rem" }}>── Strategic ──</div>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { icon: FlaskConical,   label: "Launch A/B Test" },
                { icon: SlidersHorizontal, label: "Policy Panel"  },
                { icon: FileText,       label: "AI Audit Log"   },
              ].map(({ icon: Icon, label }) => (
                <button key={label} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/8 bg-white/4 text-xs text-white/60 hover:border-white/15 hover:text-white/80 transition-all font-medium">
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          </div>
          <div className="self-stretch w-px bg-white/6" />

          {/* Active Sessions — replaces the blind manual search input */}
          <div>
            <div className="mb-2 text-xs font-semibold tracking-widest uppercase text-white/30" style={{ ...mono, fontSize: "0.58rem" }}>Active Sessions</div>
            <button
              onClick={() => setShowActiveSessions(true)}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium transition-all border rounded-xl border-white/8 bg-white/4 text-white/60 hover:border-white/15 hover:text-white/80"
            >
              <Users size={12} />
              <span>{ACTIVE_SESSIONS.length} at-risk visitors</span>
              <span className="text-white/20 mx-0.5">·</span>
              <span className="text-emerald-400/70">Live</span>
              <ArrowRight size={11} className="ml-1 text-white/25" />
            </button>
            <div className="mt-1.5 text-xs text-white/20" style={{ fontSize: "0.62rem" }}>⌘K to look up any visitor by ID or email</div>
          </div>
        </div>
      </div>

      <RecoveryTicker />

      {/* ── Learning & System Health ── */}
      <div className="border-t border-white/6 shrink-0" style={{ background: "#0f1117" }}>
        <div className="grid grid-cols-3 divide-x divide-white/6">

          {/* Col 1: This Week */}
          <div className="px-5 py-3">
            <div className="mb-2 text-xs font-semibold tracking-widest uppercase text-white/30" style={{ ...mono, fontSize: "0.58rem" }}>This Week</div>
            <div className="flex flex-col gap-1">
              {[
                { label: "AI recovered",     value: "$8,420", badge: null,    badgeColor: ""                  },
                { label: "Model accuracy",   value: "96%",   badge: "↑4%",   badgeColor: "text-emerald-400" },
                { label: "False positives",  value: "2.1%",  badge: "↓0.5%", badgeColor: "text-emerald-400" },
                { label: "Intervention rate",value: null,    badge: "↓14%",  badgeColor: "text-emerald-400" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="text-xs text-white/35">{s.label}</span>
                  {s.value && <span className="text-xs font-semibold text-white" style={mono}>{s.value}</span>}
                  {s.badge && <span className={`text-xs font-semibold ${s.badgeColor}`} style={mono}>{s.badge}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Col 2: AI Adaptations */}
          <div className="px-5 py-3">
            <div className="mb-2 text-xs font-semibold tracking-widest uppercase text-white/30" style={{ ...mono, fontSize: "0.58rem" }}>Recent AI Adaptations</div>
            <div className="flex flex-col gap-1.5">
              {AI_ADAPTATIONS.map((t, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-white/20 mt-0.5 shrink-0">•</span>
                  <span className="text-xs leading-relaxed text-white/40">{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Col 3: Anomaly Feed — demoted here from main area + retains ⌘K */}
          <div className="px-5 py-3">
            <div className="mb-2 text-xs font-semibold tracking-widest uppercase text-white/30" style={{ ...mono, fontSize: "0.58rem" }}>Anomaly Feed</div>
            <div className="flex flex-col gap-1.5 mb-3">
              {ANOMALIES.map((item, i) => {
                if (dismissedAnomalies.has(i)) return null;
                const m = anomalyMeta(item.status);
                return (
                  <div key={i} className="flex items-center gap-2 group">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.dot}`} />
                    <span className="text-xs text-white/25 shrink-0" style={mono}>{item.time}</span>
                    <span className="flex-1 text-xs truncate text-white/45">{item.event}</span>
                    <span className={`text-xs font-medium shrink-0 ${m.text}`} style={{ fontSize: "0.62rem" }}>{m.label}</span>
                    <button
                      onClick={() => setDismissedAnomalies((p) => new Set([...p, i]))}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 text-white/25 hover:text-white transition-all shrink-0"
                    ><X size={9} /></button>
                  </div>
                );
              })}
              {dismissedAnomalies.size === ANOMALIES.length && (
                <div className="text-xs italic text-white/25">No active anomalies</div>
              )}
            </div>
            <button
              onClick={() => setShowCmd(true)}
              className="flex items-center gap-2 text-xs text-white/25 hover:text-white/50 transition-colors border border-white/6 rounded-lg px-2.5 py-1.5 hover:border-white/12"
            >
              <Terminal size={10} /><span>⌘K Search any visitor, order, or session…</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}