import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bell, ChevronDown, X, ChevronLeft, Zap, AlertTriangle, TrendingUp,
  ShoppingCart, Monitor, Smartphone, Activity, ArrowRight, CheckCircle,
  Wand2, Square, CheckSquare, Flag, Terminal, Home, CreditCard, Package,
  MousePointer2, Play, Brain, Clock, Shield,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  cartValue: number;
  risk: number;
  stage: string;
  device: "mobile" | "desktop";
  issue: string;
  status: "critical" | "warning" | "recovering";
  name: string;
  lastAction: string;
  aiConfidence: number;
}

interface FeedItem {
  time: string;
  event: string;
  type: "exit" | "trigger" | "accept" | "purchase";
}

interface Campaign {
  name: string;
  active: boolean;
  perf: "good" | "declining" | "off";
  stat: string;
}

type QueueSort = "urgent" | "value" | "ai";

// ─── Data ─────────────────────────────────────────────────────────────────────

const SESSIONS_DATA: Session[] = [
  { id: "2401", cartValue: 320, risk: 87, stage: "Cart", device: "mobile", issue: "Shipping cost", status: "critical", name: "Priya K.", lastAction: "Hesitating on shipping", aiConfidence: 94 },
  { id: "2345", cartValue: 148, risk: 82, stage: "Checkout", device: "mobile", issue: "Checkout hesitation", status: "critical", name: "Emily R.", lastAction: "Comparing checkout options", aiConfidence: 92 },
  { id: "2289", cartValue: 210, risk: 71, stage: "Price Compare", device: "desktop", issue: "Price sensitivity", status: "warning", name: "Marcus T.", lastAction: "Comparing prices on 3rd party", aiConfidence: 78 },
  { id: "2198", cartValue: 140, risk: 34, stage: "Product", device: "desktop", issue: "Recovering", status: "recovering", name: "James L.", lastAction: "Coupon accepted", aiConfidence: 56 },
];

const FEED: FeedItem[] = [
  { time: "14:25", event: "Purchase completed — $148", type: "purchase" },
  { time: "14:24", event: "Coupon code accepted", type: "accept" },
  { time: "14:23", event: "AI offer triggered for #2289", type: "trigger" },
  { time: "14:22", event: "Exit intent detected — #2401", type: "exit" },
  { time: "14:21", event: "AI offer triggered for #2345", type: "trigger" },
  { time: "14:20", event: "Exit intent detected — #2198", type: "exit" },
];

const CAMPAIGNS_INIT: Campaign[] = [
  { name: "Summer Disc", active: true, perf: "good", stat: "+$3,240 today, +12% vs yesterday" },
  { name: "Free Ship", active: true, perf: "declining", stat: "+$420 today, −8% vs yesterday" },
  { name: "Exit Popup", active: false, perf: "off", stat: "Paused 2 days ago" },
  { name: "Cart Remind", active: true, perf: "good", stat: "+$890 today, +4% vs yesterday" },
];

const FUNNEL = [
  { label: "Homepage", count: 214, dropRate: null, warn: false },
  { label: "Product", count: 93, dropRate: 87, warn: false },
  { label: "Cart", count: 31, dropRate: 33, warn: true },
  { label: "Checkout", count: 11, dropRate: 35, warn: true },
  { label: "Purchase", count: 7, dropRate: 64, warn: false },
];

const TIMELINE_STEPS = [
  { icon: Home, label: "Homepage", note: "Landed via Google ad", time: "14:08", color: "text-cyan-400" },
  { icon: Package, label: "Product Page", note: "Spent 2min on product", time: "14:11", color: "text-cyan-400" },
  { icon: ShoppingCart, label: "Added to Cart", note: "$148 item added", time: "14:14", color: "text-amber-400" },
  { icon: CreditCard, label: "Checkout", note: "Paused 3s on shipping cost — likely price-sensitive", time: "14:19", color: "text-red-400" },
  { icon: MousePointer2, label: "Exit Intent", note: "Hovered toward browser close — mobile swipe up", time: "14:22", color: "text-red-500" },
];

const AI_DISCOVERED = [
  { icon: "🕑", text: "Tue afternoons: express shipping increases abandonment 22% → auto-rule created" },
  { icon: "📱", text: "Mobile checkout friction up 8% → adjusting mobile discount strategy" },
  { icon: "🧠", text: "Override learned: you chose discount over free shipping on #2345, updated similar cases" },
];

const RECOVERIES = ["+$148", "+$73", "+$220", "+$31", "+$95", "+$18", "+$312", "+$55", "+$88", "+$140"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const riskColor = (r: number) =>
  r >= 80 ? "text-red-400" : r >= 60 ? "text-amber-400" : "text-emerald-400";

const riskBg = (r: number) =>
  r >= 80 ? "bg-red-500" : r >= 60 ? "bg-amber-400" : "bg-emerald-400";

const statusDot = (s: Session["status"]) =>
  s === "critical" ? "bg-red-500 shadow-[0_0_5px_#ef4444]" : s === "warning" ? "bg-amber-400" : "bg-emerald-400";

const perfRing = (p: Campaign["perf"]) =>
  p === "good" ? "ring-1 ring-emerald-500/60" : p === "declining" ? "ring-1 ring-amber-400/60" : "ring-1 ring-white/10";

const perfDot = (p: Campaign["perf"]) =>
  p === "good" ? "bg-emerald-400 shadow-[0_0_4px_#10b981]" : p === "declining" ? "bg-amber-400" : "bg-white/20";

const sortSessions = (sessions: Session[], sort: QueueSort) => {
  if (sort === "value") return [...sessions].sort((a, b) => b.cartValue - a.cartValue);
  if (sort === "ai") return [...sessions].sort((a, b) => b.aiConfidence - a.aiConfidence);
  return [...sessions].sort((a, b) => b.risk * b.cartValue - a.risk * a.cartValue);
};

// ─── Recovery Ticker ──────────────────────────────────────────────────────────

function RecoveryTicker() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setOffset((o) => (o + 0.6) % (RECOVERIES.length * 72)), 30);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="overflow-hidden flex items-center gap-2">
      <span className="text-xs text-muted-foreground shrink-0 uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>
        Store-wide recovered
      </span>
      <div className="overflow-hidden flex-1">
        <div className="flex gap-4" style={{ transform: `translateX(-${offset}px)`, willChange: "transform" }}>
          {[...RECOVERIES, ...RECOVERIES, ...RECOVERIES, ...RECOVERIES].map((v, i) => (
            <span key={i} className="text-emerald-400 shrink-0" style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{v}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${active ? "bg-cyan-500" : "bg-white/10"}`}
    >
      <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${active ? "translate-x-3.5" : "translate-x-0.5"}`} />
    </button>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded animate-pulse bg-white/5 ${className}`} />
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      <Skeleton className="h-16 w-full" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-28 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

// ─── Replay Thumbnail ─────────────────────────────────────────────────────────

function ReplayThumbnail({ sessionId }: { sessionId: string }) {
  const [playing, setPlaying] = useState(true);
  const [scrollY, setScrollY] = useState(0);
  const [clicks, setClicks] = useState<{ x: number; y: number; id: number }[]>([]);
  const clickIdRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setScrollY((y) => (y + 1.2) % 60);
      if (Math.random() < 0.08) {
        const newClick = { x: 20 + Math.random() * 60, y: 20 + Math.random() * 60, id: clickIdRef.current++ };
        setClicks((c) => [...c.slice(-3), newClick]);
        setTimeout(() => setClicks((c) => c.filter((cl) => cl.id !== newClick.id)), 700);
      }
    }, 40);
    const stopId = setTimeout(() => setPlaying(false), 3000);
    return () => { clearInterval(id); clearTimeout(stopId); };
  }, [playing, sessionId]);

  return (
    <div className="rounded-lg border border-white/10 overflow-hidden bg-[#0a1628] relative" style={{ height: 80 }}>
      <div className="absolute top-1.5 left-2 flex items-center gap-1.5 z-10">
        <div className={`w-1.5 h-1.5 rounded-full ${playing ? "bg-red-500 animate-pulse" : "bg-white/20"}`} />
        <span className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem" }}>
          {playing ? `LIVE — #${sessionId}` : `REPLAY — #${sessionId}`}
        </span>
      </div>
      {/* Fake screen content */}
      <div className="absolute inset-0 overflow-hidden">
        <div style={{ transform: `translateY(-${scrollY}px)`, transition: "transform 0.1s linear" }} className="pt-7 px-3 flex flex-col gap-1">
          {[60, 40, 80, 55, 30, 70, 45, 65].map((w, i) => (
            <div key={i} className={`h-1.5 rounded-full bg-white/8`} style={{ width: `${w}%` }} />
          ))}
          <div className="h-4 rounded bg-white/5 mt-1" />
          <div className="h-3 rounded bg-cyan-500/20 mt-0.5 w-1/2" />
        </div>
        {clicks.map((c) => (
          <div key={c.id} className="absolute pointer-events-none" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
            <div className="w-4 h-4 rounded-full border border-red-400/80 animate-ping" style={{ animationDuration: "0.6s" }} />
          </div>
        ))}
      </div>
      {!playing && (
        <button
          onClick={() => setPlaying(true)}
          className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/30 transition-colors"
        >
          <div className="flex items-center gap-1.5 text-xs text-white/80">
            <Play size={11} /> Replay
          </div>
        </button>
      )}
    </div>
  );
}

// ─── Mini Timeline ────────────────────────────────────────────────────────────

function MiniTimeline() {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-widest mb-2" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>
        Shopper Journey
      </div>
      <div className="relative flex flex-col gap-0">
        {TIMELINE_STEPS.map((step, i) => {
          const Icon = step.icon;
          const isLast = i === TIMELINE_STEPS.length - 1;
          const isOpen = expanded === i;
          return (
            <div key={i} className="flex gap-2">
              <div className="flex flex-col items-center">
                <button
                  onClick={() => setExpanded(isOpen ? null : i)}
                  className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                    isOpen ? "border-cyan-500/60 bg-cyan-500/15" : "border-white/10 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <Icon size={9} className={step.color} />
                </button>
                {!isLast && <div className="w-px flex-1 bg-white/8 my-0.5 min-h-[12px]" />}
              </div>
              <div className="pb-2 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/80">{step.label}</span>
                  <span className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>{step.time}</span>
                </div>
                {isOpen && (
                  <div className="mt-1 text-xs text-cyan-300/80 italic bg-cyan-500/5 border border-cyan-500/15 rounded px-2 py-1">
                    "{step.note}"
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── What-if Tooltip ──────────────────────────────────────────────────────────

interface AltAction {
  action: string;
  impact: string;
  whatIf: string;
  recoveryChance: string;
}

function AltRow({ alt }: { alt: AltAction }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative flex items-center justify-between px-3 py-2 rounded border border-border hover:border-white/15 hover:bg-white/[0.02] transition-all cursor-pointer group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="text-xs text-foreground/80">{alt.action}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs text-emerald-400" style={{ fontFamily: "var(--font-mono)" }}>{alt.impact}</span>
        <ArrowRight size={11} className="text-muted-foreground group-hover:text-white transition-colors" />
      </div>
      {hovered && (
        <div className="absolute bottom-full left-0 mb-1.5 z-50 bg-[#0d1322] border border-amber-500/30 rounded-lg px-3 py-2 shadow-xl w-56">
          <div className="text-xs text-amber-400 font-semibold mb-1">What-if analysis</div>
          <div className="text-xs text-foreground/70 leading-relaxed">{alt.whatIf}</div>
          <div className="mt-1.5 text-xs text-white/50">Recovery chance: <span className="text-amber-400" style={{ fontFamily: "var(--font-mono)" }}>{alt.recoveryChance}</span></div>
        </div>
      )}
    </div>
  );
}

// ─── Recover All Dropdown ─────────────────────────────────────────────────────

function RecoverAllDropdown({ onClose }: { onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);

  const handleApply = () => {
    setConfirmed(true);
    setTimeout(() => {
      toast.success("Recovering 12 sessions", {
        description: "Top recommendation applied to all sessions above 80% confidence (est. +$620)",
      });
      onClose();
    }, 600);
  };

  return (
    <div className="absolute top-full right-0 mt-1.5 z-50 bg-[#0d1322] border border-cyan-500/25 rounded-lg p-3 shadow-2xl w-64">
      <div className="text-xs font-semibold text-white mb-1.5">Recover All High-Confidence Sessions</div>
      <div className="text-xs text-foreground/60 mb-3 leading-relaxed">
        Apply top recommended intervention to all <span className="text-white">12 sessions</span> above 80% confidence (est. <span className="text-emerald-400" style={{ fontFamily: "var(--font-mono)" }}>+$620</span>)?
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleApply}
          disabled={confirmed}
          className={`flex-1 py-1.5 rounded text-xs font-semibold transition-all ${confirmed ? "bg-emerald-500/20 text-emerald-400" : "bg-cyan-500 text-black hover:bg-cyan-400"}`}
        >
          {confirmed ? <CheckCircle size={11} className="inline mr-1" /> : null}
          {confirmed ? "Launching…" : "Apply to All"}
        </button>
        <button onClick={onClose} className="px-3 py-1.5 rounded text-xs text-muted-foreground border border-border hover:border-white/20 transition-colors">Cancel</button>
      </div>
    </div>
  );
}

// ─── Command Palette ──────────────────────────────────────────────────────────

function CommandPalette({ sessions, onSelectSession, onClose }: { sessions: Session[]; onSelectSession: (s: Session) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = query.length > 0
    ? sessions.filter((s) =>
        s.id.includes(query) ||
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.stage.toLowerCase().includes(query.toLowerCase())
      )
    : sessions;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0d1322] border border-white/10 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Terminal size={14} className="text-cyan-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions, toggle campaigns, launch interventions…"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-muted-foreground outline-none"
          />
          <kbd className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5" style={{ fontFamily: "var(--font-mono)" }}>ESC</kbd>
        </div>
        <div className="py-2 max-h-72 overflow-y-auto scrollbar-hide">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">No results found</div>
          )}
          {results.map((s) => (
            <button
              key={s.id}
              onClick={() => { onSelectSession(s); onClose(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left group"
            >
              <div className={`w-2 h-2 rounded-full ${statusDot(s.status)}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">{s.name}</span>
                  <span className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>#{s.id}</span>
                </div>
                <div className="text-xs text-muted-foreground">{s.stage} · {s.lastAction}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-white" style={{ fontFamily: "var(--font-mono)" }}>${s.cartValue}</span>
                <span className={`text-xs ${riskColor(s.risk)}`} style={{ fontFamily: "var(--font-mono)" }}>{s.risk}%</span>
                <ArrowRight size={11} className="text-muted-foreground group-hover:text-white transition-colors" />
              </div>
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-border flex items-center gap-4">
          <span className="text-xs text-muted-foreground">↑↓ navigate</span>
          <span className="text-xs text-muted-foreground">↵ open session</span>
          <span className="text-xs text-muted-foreground">ESC close</span>
        </div>
      </div>
    </div>
  );
}

// ─── Session Workspace ────────────────────────────────────────────────────────

function SessionWorkspace({ session, onClose, onBack }: { session: Session; onClose: () => void; onBack: () => void }) {
  const [launched, setLaunched] = useState(false);
  const [manualOverride, setManualOverride] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [showFlag, setShowFlag] = useState(false);

  const handleLaunch = () => {
    setLaunched(true);
    toast.success(`Offer launched for ${session.name}`, {
      description: `Free shipping applied to session #${session.id} — est. +$${session.cartValue}`,
    });
  };

  const handleFlag = () => {
    if (!flagNote.trim()) return;
    toast("Session flagged for team", {
      description: `@marketing: ${flagNote}`,
      icon: <Flag size={13} />,
    });
    setFlagNote("");
    setShowFlag(false);
  };

  const handleManual = () => {
    if (!manualOverride.trim()) return;
    toast(`Manual override sent to #${session.id}`, { description: manualOverride });
    setManualOverride("");
  };

  const alts: AltAction[] = [
    { action: "10% Discount", impact: "+$122", whatIf: "If you send a 10% discount instead, recovery chance drops to 64% — lower shipping sensitivity, less conversion certainty.", recoveryChance: "64% (−$26 expected)" },
    { action: "Cart Reminder", impact: "+$80", whatIf: "Reminder emails work well for desktop users. Mobile exit-intent shoppers typically don't return — lower effectiveness here.", recoveryChance: "45% (−$48 expected)" },
  ];

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "var(--font-body)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>Session Workspace</span>
          <span className="text-xs text-cyan-400 border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 rounded" style={{ fontFamily: "var(--font-mono)" }}>#{session.id}</span>
          <span className="text-xs text-foreground/50">— {session.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowFlag((s) => !s)}
            className={`p-1.5 rounded hover:bg-white/5 transition-colors ${showFlag ? "text-amber-400" : "text-muted-foreground"}`}
            title="Flag for team"
          >
            <Flag size={13} />
          </button>
          <button onClick={onBack} className="p-1.5 rounded hover:bg-white/5 text-muted-foreground transition-colors"><ChevronLeft size={13} /></button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/5 text-muted-foreground transition-colors"><X size={13} /></button>
        </div>
      </div>

      {/* Flag for team */}
      {showFlag && (
        <div className="px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/5 flex items-center gap-2">
          <Flag size={12} className="text-amber-400 shrink-0" />
          <input
            value={flagNote}
            onChange={(e) => setFlagNote(e.target.value)}
            placeholder="@marketing — add note for team…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-muted-foreground outline-none"
            onKeyDown={(e) => e.key === "Enter" && handleFlag()}
          />
          <button onClick={handleFlag} className="text-xs text-amber-400 hover:text-amber-300 transition-colors shrink-0">Send</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4 scrollbar-hide">

        {/* Shopper Context */}
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <ShoppingCart size={12} className="text-cyan-400" />
                <span className="text-xs text-muted-foreground">Cart</span>
                <span className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-mono)" }}>${session.cartValue}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Page</span>
                <span className="text-xs text-white">{session.stage}</span>
                {session.device === "mobile" ? <Smartphone size={10} className="text-muted-foreground" /> : <Monitor size={10} className="text-muted-foreground" />}
                <span className="text-xs text-muted-foreground capitalize">{session.device}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className={`text-base font-bold ${riskColor(session.risk)}`} style={{ fontFamily: "var(--font-mono)" }}>{session.risk}%</div>
              <div className="text-xs text-muted-foreground">risk</div>
            </div>
          </div>
          <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${riskBg(session.risk)}`} style={{ width: `${session.risk}%` }} />
          </div>
        </div>

        {/* AI Analysis */}
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-2" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>AI Analysis</div>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="grid grid-cols-2 border-b border-border text-xs text-muted-foreground">
              <div className="px-3 py-2 border-r border-border">Insight</div>
              <div className="px-3 py-2">Explanation</div>
            </div>
            {[
              { k: "Intent", v: "High", desc: "Compared 3× prices" },
              { k: "Risk", v: `${session.risk}%`, desc: "Hovered shipping 4s" },
              { k: "Lift", v: "+$140", desc: "Exit intent (mobile)" },
            ].map((row) => (
              <div key={row.k} className="grid grid-cols-2 border-b border-border last:border-b-0 hover:bg-white/[0.02] transition-colors">
                <div className="px-3 py-2 border-r border-border flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{row.k}</span>
                  <span className="text-xs font-semibold text-white" style={{ fontFamily: "var(--font-mono)" }}>{row.v}</span>
                </div>
                <div className="px-3 py-2 text-xs text-foreground/60">{row.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Mini Timeline */}
        <MiniTimeline />

        {/* Replay Thumbnail */}
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-2" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>
            Behavior Replay
          </div>
          <ReplayThumbnail sessionId={session.id} />
        </div>

        {/* Recovery Actions */}
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-2" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>
            Recovery Actions — for #{session.id}
          </div>

          {/* Primary */}
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={11} className="text-amber-400" />
              <span className="text-xs text-amber-400 font-semibold uppercase tracking-wider" style={{ fontSize: "0.6rem" }}>Recommended</span>
            </div>
            <div className="text-sm font-semibold text-white mb-2">Offer Free Shipping</div>
            <div className="flex gap-4 mb-3">
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Impact</div>
                <div className="text-sm font-semibold text-emerald-400" style={{ fontFamily: "var(--font-mono)" }}>+${session.cartValue}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Confidence</div>
                <div className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-mono)" }}>{session.aiConfidence}%</div>
              </div>
            </div>
            <button
              onClick={handleLaunch}
              className={`w-full py-2 rounded text-xs font-semibold transition-all ${launched ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-cyan-500 text-black hover:bg-cyan-400 active:scale-[0.98]"}`}
            >
              {launched
                ? <span className="flex items-center justify-center gap-1.5"><CheckCircle size={12} /> Launched for #{session.id}</span>
                : "Launch for this shopper"}
            </button>
          </div>

          {/* Alternatives with what-if */}
          <div className="text-xs text-muted-foreground mb-2 uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>
            Alternatives for #{session.id}
          </div>
          <div className="flex flex-col gap-1.5">
            {alts.map((alt) => <AltRow key={alt.action} alt={alt} />)}
          </div>

          {/* Manual override */}
          <div className="mt-3 border border-border rounded-lg p-2.5">
            <div className="text-xs text-muted-foreground mb-1.5">▸ Manual override for #{session.id}</div>
            <div className="flex gap-2">
              <input
                value={manualOverride}
                onChange={(e) => setManualOverride(e.target.value)}
                placeholder="Custom message or coupon code…"
                className="flex-1 bg-white/5 border border-border rounded px-2 py-1 text-xs text-white placeholder:text-muted-foreground outline-none focus:border-cyan-500/40 transition-colors"
                onKeyDown={(e) => e.key === "Enter" && handleManual()}
              />
              <button
                onClick={handleManual}
                className="px-3 py-1 rounded text-xs bg-white/8 hover:bg-white/12 text-foreground/70 hover:text-white border border-border transition-all"
              >
                Trigger
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Empty Workspace ──────────────────────────────────────────────────────────

function EmptyWorkspace() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center">
        <Activity size={16} className="text-muted-foreground" />
      </div>
      <div>
        <div className="text-sm font-medium text-foreground/50 mb-1">No session selected</div>
        <div className="text-xs text-muted-foreground leading-relaxed">Click a shopper in the Priority Queue to open their rescue workspace.</div>
      </div>
      <div className="text-xs text-muted-foreground/50 mt-2">
        Press <kbd className="border border-border rounded px-1 py-0.5 text-xs" style={{ fontFamily: "var(--font-mono)" }}>⌘K</kbd> to search sessions
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [campaigns, setCampaigns] = useState(CAMPAIGNS_INIT);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [queueSort, setQueueSort] = useState<QueueSort>("urgent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showRecoverAll, setShowRecoverAll] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [hoveredCampaign, setHoveredCampaign] = useState<number | null>(null);

  const toggleCampaign = (i: number) =>
    setCampaigns((c) => c.map((cam, j) => j === i ? { ...cam, active: !cam.active } : cam));

  const selectSession = useCallback((s: Session) => {
    if (activeSession?.id === s.id) { setActiveSession(null); return; }
    setSessionLoading(true);
    setActiveSession(null);
    setTimeout(() => { setActiveSession(s); setSessionLoading(false); }, 320);
  }, [activeSession]);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedTotal = [...selected].reduce((sum, id) => {
    const s = SESSIONS_DATA.find((s) => s.id === id);
    return sum + (s?.cartValue ?? 0);
  }, 0);

  const handleBatchRecover = () => {
    toast.success(`Recovering ${selected.size} sessions`, {
      description: `Top recommendation applied — est. +$${selectedTotal} recovered`,
    });
    setSelected(new Set());
  };

  const feedColor = (t: FeedItem["type"]) =>
    t === "purchase" ? "text-emerald-400" : t === "accept" ? "text-cyan-400" : t === "exit" ? "text-red-400" : "text-amber-400";

  const sortedSessions = sortSessions(SESSIONS_DATA, queueSort);

  // ⌘K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowCmdPalette((s) => !s); }
      if (e.key === "Escape") { setShowCmdPalette(false); setShowRecoverAll(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Occasional high-value toast
  useEffect(() => {
    const id = setTimeout(() => {
      toast("🔥 High-value cart saved!", { description: "+$320 recovery — Priya K. completed checkout" });
    }, 8000);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      className="w-full h-screen flex flex-col overflow-hidden bg-background text-foreground"
      style={{ fontFamily: "var(--font-body)", fontSize: "var(--font-size)" }}
    >
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{ style: { background: "#0d1322", border: "1px solid rgba(255,255,255,0.08)", color: "#e2e8f0", fontSize: "0.78rem" } }}
      />

      {showCmdPalette && (
        <CommandPalette
          sessions={SESSIONS_DATA}
          onSelectSession={selectSession}
          onClose={() => setShowCmdPalette(false)}
        />
      )}

      {/* ── Navbar ── */}
      <header className="flex items-center justify-between px-4 h-11 border-b border-border shrink-0 bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-cyan-500 flex items-center justify-center">
              <Zap size={13} className="text-black" />
            </div>
            <span className="text-xs font-semibold tracking-wider text-white uppercase" style={{ fontFamily: "var(--font-display)", letterSpacing: "0.12em" }}>LiveOps</span>
          </div>
          <div className="w-px h-4 bg-border" />
          <span className="text-xs text-muted-foreground">Live Ops</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-amber-400">
            <Bell size={13} />
            <span className="text-xs">2 actions needed</span>
          </div>
          <div className="w-px h-4 bg-border" />
          <button
            onClick={() => setShowCmdPalette(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground/70 transition-colors border border-border rounded px-2 py-1"
          >
            <Terminal size={11} />
            <span>⌘K</span>
          </button>
          <button className="flex items-center gap-1 text-xs text-foreground/70 hover:text-white transition-colors">
            Store: Main <ChevronDown size={11} />
          </button>
          <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
            <span className="text-xs text-cyan-400 font-semibold" style={{ fontFamily: "var(--font-mono)" }}>M</span>
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
        </div>
      </header>

      {/* ── Recovery Bar ── */}
      <div className="flex items-center gap-6 px-4 py-2.5 border-b border-border shrink-0 bg-card/30">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground">Recovered Today</span>
          <span className="text-xs font-semibold text-emerald-400" style={{ fontFamily: "var(--font-mono)" }}>$12,480</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">At Risk Now</span>
            <span className="text-xs font-semibold text-red-400" style={{ fontFamily: "var(--font-mono)" }}>$870</span>
          </div>
          <div className="text-xs text-red-400/60 flex items-center gap-1" style={{ fontSize: "0.62rem" }}>
            <Clock size={9} />
            $320 likely lost in the next 2 min
          </div>
        </div>
        <div className="flex items-baseline gap-2 relative">
          <span className="text-xs text-muted-foreground">Recoverable</span>
          <span className="text-xs font-semibold text-amber-400" style={{ fontFamily: "var(--font-mono)" }}>$620 (71%)</span>
          <div className="relative">
            <button
              onClick={() => setShowRecoverAll((s) => !s)}
              className="p-0.5 rounded hover:bg-white/8 text-cyan-400 hover:text-cyan-300 transition-colors"
              title="Recover all high-confidence sessions"
            >
              <Wand2 size={13} />
            </button>
            {showRecoverAll && <RecoverAllDropdown onClose={() => setShowRecoverAll(false)} />}
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground">Top Issue</span>
          <span className="text-xs font-semibold text-white">Checkout hesitation</span>
        </div>
      </div>

      {/* ── Campaign Health Bar ── */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border shrink-0 bg-card/20 relative">
        <span className="text-xs text-muted-foreground mr-2">Campaigns:</span>
        {campaigns.map((c, i) => (
          <div
            key={c.name}
            className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded border border-border ${perfRing(c.perf)}`}
            onMouseEnter={() => setHoveredCampaign(i)}
            onMouseLeave={() => setHoveredCampaign(null)}
          >
            <span className="text-xs text-foreground/70">{c.name}</span>
            <div className={`w-1.5 h-1.5 rounded-full ${perfDot(c.perf)}`} />
            <Toggle active={c.active} onToggle={() => toggleCampaign(i)} />
            {hoveredCampaign === i && (
              <div className="absolute top-full left-0 mt-1.5 z-40 bg-[#0d1322] border border-white/10 rounded-lg px-3 py-2 shadow-xl w-52 pointer-events-none">
                <div className="text-xs font-semibold text-white mb-1">{c.name}</div>
                <div className="text-xs text-foreground/60">{c.stat}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Main Split ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Left: Global Store View ── */}
        <div className="w-[300px] shrink-0 flex flex-col border-r border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border shrink-0">
            <span className="text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>Global Store View</span>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-hide">

            {/* Customer Funnel */}
            <div className="px-3 py-3 border-b border-border">
              <div className="text-xs text-muted-foreground uppercase tracking-widest mb-3" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>Customer Funnel</div>
              <div className="flex flex-col gap-2">
                {FUNNEL.map((step, i) => (
                  <div key={step.label}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-foreground/80">{step.label}</span>
                        {step.warn && <AlertTriangle size={9} className="text-red-400" />}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white" style={{ fontFamily: "var(--font-mono)" }}>{step.count}</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#10b981]" />
                      </div>
                    </div>
                    {step.dropRate !== null && (
                      <div className="flex items-center gap-1.5 pl-2 mb-0.5">
                        <div className="w-px h-3 bg-border" />
                        <span className={`text-xs ${step.warn ? "text-red-400" : "text-muted-foreground"}`} style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem" }}>
                          ↓ {step.dropRate}%
                        </span>
                        {step.warn && (
                          <div className="flex-1 h-0.5 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full bg-red-500 rounded-full" style={{ width: `${step.dropRate}%` }} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Bottleneck + AI Tip */}
              <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/8 p-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-xs text-red-400 font-medium">Bottleneck: Checkout −35%</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <Brain size={10} className="text-cyan-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs text-foreground/60 leading-relaxed">Offer free shipping for carts &gt;$100 to unstick checkout</div>
                    <button className="mt-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors font-medium">Test this →</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Feed */}
            <div className="px-3 py-3 border-b border-border">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>Live Feed</span>
                </div>
                <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground/70 transition-colors">
                  High Value <ChevronDown size={10} />
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {FEED.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem" }}>{item.time}</span>
                    <span className={`text-xs ${feedColor(item.type)}`}>{item.event}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Priority Queue */}
            <div className="px-3 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>Priority Queue</span>
              </div>

              {/* Sort tabs */}
              <div className="flex gap-1 mb-3 p-0.5 rounded-lg bg-white/5 border border-border">
                {(["urgent", "value", "ai"] as QueueSort[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setQueueSort(s)}
                    className={`flex-1 text-xs py-1 rounded transition-all ${queueSort === s ? "bg-white/10 text-white" : "text-muted-foreground hover:text-foreground/70"}`}
                    style={{ fontSize: "0.65rem" }}
                  >
                    {s === "urgent" ? "Urgent" : s === "value" ? "Value" : "AI ✓"}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-1.5">
                {sortedSessions.map((s) => {
                  const isActive = activeSession?.id === s.id;
                  const isSelected = selected.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => selectSession(s)}
                      className={`w-full text-left rounded-lg border px-2.5 py-2 transition-all group ${
                        isActive ? "border-cyan-500/40 bg-cyan-500/10" : isSelected ? "border-white/15 bg-white/[0.03]" : "border-border hover:border-white/12 hover:bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {/* Checkbox */}
                        <div
                          onClick={(e) => toggleSelect(s.id, e)}
                          className="mt-0.5 shrink-0 text-muted-foreground hover:text-white transition-colors"
                        >
                          {isSelected ? <CheckSquare size={12} className="text-cyan-400" /> : <Square size={12} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${statusDot(s.status)}`} />
                              <span className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem" }}>#{s.id}</span>
                              <span className="text-xs text-foreground/70">{s.name}</span>
                            </div>
                            {isActive && <span className="text-xs text-cyan-400" style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem" }}>active</span>}
                          </div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2.5">
                              <span className="text-xs font-semibold text-white" style={{ fontFamily: "var(--font-mono)" }}>${s.cartValue}</span>
                              <span className={`text-xs font-semibold ${riskColor(s.risk)}`} style={{ fontFamily: "var(--font-mono)" }}>{s.risk}%</span>
                            </div>
                            <span className="text-xs text-muted-foreground">{s.stage}</span>
                          </div>
                          {/* Micro-preview */}
                          <div className="text-xs text-muted-foreground/70 truncate italic" style={{ fontSize: "0.65rem" }}>"{s.lastAction}"</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Session Workspace ── */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          {sessionLoading ? (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <Skeleton className="h-3 w-32" />
              </div>
              <WorkspaceSkeleton />
            </>
          ) : activeSession ? (
            <SessionWorkspace
              key={activeSession.id}
              session={activeSession}
              onClose={() => setActiveSession(null)}
              onBack={() => setActiveSession(null)}
            />
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>Session Workspace</span>
              </div>
              <EmptyWorkspace />
            </>
          )}
        </div>
      </div>

      {/* ── Batch Action Bar ── */}
      {selected.size > 0 && (
        <div className="border-t border-cyan-500/20 bg-cyan-500/5 px-4 py-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <CheckSquare size={13} className="text-cyan-400" />
            <span className="text-xs text-white">{selected.size} selected</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-emerald-400" style={{ fontFamily: "var(--font-mono)" }}>${selectedTotal} total</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBatchRecover}
              className="px-3 py-1 rounded text-xs bg-cyan-500 text-black hover:bg-cyan-400 font-semibold transition-all"
            >
              Recover {selected.size} sessions
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-white border border-border transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="border-t border-border shrink-0">
        {/* Ticker */}
        <div className="px-4 py-2 border-b border-border">
          <RecoveryTicker />
        </div>

        {/* Learning & Trust */}
        <div className="px-4 py-2.5 flex flex-col gap-2">
          {/* Stats row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <TrendingUp size={11} className="text-emerald-400" />
              <span className="text-xs text-muted-foreground">This week:</span>
              <span className="text-xs text-emerald-400 font-semibold" style={{ fontFamily: "var(--font-mono)" }}>+$8,420</span>
            </div>
            <div className="w-px h-3 bg-border" />
            <div className="flex items-center gap-1.5">
              <Brain size={11} className="text-cyan-400" />
              <span className="text-xs text-muted-foreground">Saved by AI:</span>
              <span className="text-xs text-white" style={{ fontFamily: "var(--font-mono)" }}>$6,120</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Saved by you:</span>
              <span className="text-xs text-white" style={{ fontFamily: "var(--font-mono)" }}>$2,300</span>
            </div>
            <div className="w-px h-3 bg-border" />
            <div className="flex items-center gap-1.5">
              <Shield size={11} className="text-cyan-400" />
              <span className="text-xs text-muted-foreground">Trust score:</span>
              <span className="text-xs text-cyan-400 font-semibold" style={{ fontFamily: "var(--font-mono)" }}>92%</span>
            </div>
          </div>

          {/* AI Discovered */}
          <div className="flex items-start gap-4 flex-wrap">
            <span className="text-xs text-muted-foreground uppercase tracking-widest shrink-0" style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem" }}>AI Discovered</span>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {AI_DISCOVERED.map((item, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span style={{ fontSize: "0.7rem" }}>{item.icon}</span>
                  <span className="text-xs text-foreground/50 leading-relaxed" style={{ fontSize: "0.68rem" }}>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
