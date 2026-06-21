import { useParams, Link } from "react-router";
import { ArrowLeft, Monitor, Smartphone, Tablet, Clock, MapPin, DollarSign, MousePointer, AlertTriangle, Zap, CheckCircle, ShoppingCart, Eye, Brain } from "lucide-react";
import { mockVisitors, generateCustomerEvents } from "../lib/mockData";

const TEAL = "#00d4a8";

const eventConfig = {
  page_view: { icon: Eye, color: "#6366f1", label: "Page View" },
  cart_add: { icon: ShoppingCart, color: "#00d4a8", label: "Cart Add" },
  cart_remove: { icon: ShoppingCart, color: "#f43f5e", label: "Cart Remove" },
  scroll: { icon: MousePointer, color: "#64748b", label: "Scroll" },
  hesitation: { icon: Clock, color: "#f59e0b", label: "Hesitation" },
  frustration: { icon: AlertTriangle, color: "#f43f5e", label: "Frustration" },
  intervention: { icon: Zap, color: "#8b5cf6", label: "Intervention" },
  conversion: { icon: CheckCircle, color: "#00d4a8", label: "Conversion" },
};

const deviceIcons = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };

const timeAgo = (d: Date) => {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
};

export function CustomerJourney() {
  const { id } = useParams();
  const visitor = mockVisitors.find(v => v.id === id);
  const events = generateCustomerEvents(id || "");
  const DevIcon = visitor ? deviceIcons[visitor.device] : Monitor;

  if (!visitor) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-muted-foreground mb-3">Visitor not found</p>
        <Link to="/live-sessions" className="text-xs font-medium hover:underline" style={{ color: TEAL }}>
          ← Back to Live Sessions
        </Link>
      </div>
    );
  }

  const riskColor = visitor.abandonmentProbability >= 0.7 ? "#f43f5e" : visitor.abandonmentProbability >= 0.45 ? "#f59e0b" : "#00d4a8";

  return (
    <div className="space-y-5">
      <Link to="/live-sessions" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Live Sessions
      </Link>

      {/* Visitor header */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff" }}>
              {visitor.name.split(" ").map(n => n[0]).join("")}
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground">{visitor.name}</h1>
              <p className="text-xs text-muted-foreground mb-2">{visitor.email}</p>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1">
                  <DevIcon className="w-3 h-3" />
                  <span className="capitalize">{visitor.device}</span>
                </div>
                <div className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  <span>{visitor.location}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>Started {timeAgo(visitor.sessionStart)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Cart Value", value: `$${visitor.cartValue.toFixed(2)}`, color: "#e2e8f4" },
              { label: "Abandonment Risk", value: `${(visitor.abandonmentProbability * 100).toFixed(0)}%`, color: riskColor },
              { label: "Frustration", value: `${(visitor.frustrationScore * 100).toFixed(0)}%`, color: "#f59e0b" },
            ].map(m => (
              <div key={m.label} className="bg-muted/40 rounded-lg p-3 border border-border text-center">
                <p className="text-[11px] text-muted-foreground mb-1">{m.label}</p>
                <p className="text-base font-semibold font-mono" style={{ color: m.color }}>{m.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid  lg:grid-cols-3 gap-4">
        {/* Timeline */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-foreground mb-5">Journey Timeline</h2>
          <div className="space-y-1">
            {events.map((event, idx) => {
              const cfg = eventConfig[event.type];
              const Icon = cfg.icon;
              const isLast = idx === events.length - 1;

              return (
                <div key={event.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${cfg.color}18`, border: `1px solid ${cfg.color}40` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                    </div>
                    {!isLast && <div className="w-px flex-1 min-h-[24px] mt-1" style={{ backgroundColor: "rgba(148,163,184,0.1)" }} />}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{cfg.label}</span>
                        <span className="text-[11px] font-mono text-muted-foreground">{event.page}</span>
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                        {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(event.timestamp)}
                      </span>
                    </div>
                    {event.data && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {Object.entries(event.data).map(([k, v]) => (
                          <span key={k} className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(148,163,184,0.08)", color: "#94a3b8" }}>
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Behavior insights */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-xs font-semibold text-foreground mb-3">Behavior Insights</h3>
            <div className="space-y-3">
              {[
                { label: "Engagement Level", value: 78, level: "High", color: "#00d4a8" },
                { label: "Purchase Intent", value: 62, level: "Medium", color: "#f59e0b" },
                { label: "Price Sensitivity", value: 35, level: "Low", color: "#6366f1" },
              ].map(b => (
                <div key={b.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-muted-foreground">{b.label}</span>
                    <span className="text-[11px] font-medium" style={{ color: b.color }}>{b.level}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(148,163,184,0.1)" }}>
                    <div className="h-full rounded-full" style={{ width: `${b.value}%`, backgroundColor: b.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Session stats */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-xs font-semibold text-foreground mb-3">Session Stats</h3>
            <div className="space-y-2">
              {[
                { label: "Pages Viewed", value: "8" },
                { label: "Time on Site", value: `${Math.floor(visitor.timeOnSite / 60)}m ${visitor.timeOnSite % 60}s` },
                { label: "Cart Actions", value: "3" },
                { label: "Scroll Depth", value: "75%" },
                { label: "Current Page", value: visitor.currentPage },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">{s.label}</span>
                  <span className="text-[11px] font-mono font-semibold text-foreground">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI Recommendation */}
          <div className="rounded-lg p-4 border" style={{ backgroundColor: `${TEAL}08`, borderColor: `${TEAL}30` }}>
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-3.5 h-3.5" style={{ color: TEAL }} />
              <span className="text-xs font-semibold" style={{ color: TEAL }}>AI Recommendation</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Trigger urgency intervention with limited stock message. Predicted conversion probability:{" "}
              <span className="font-semibold font-mono text-foreground">68%</span>
            </p>
            <button className="mt-3 w-full py-1.5 rounded-lg text-[11px] font-semibold transition-colors" style={{ backgroundColor: TEAL, color: "#070d1b" }}>
              Apply Recommendation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
