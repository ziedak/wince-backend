import { Plug, CheckCircle, AlertCircle, XCircle, Clock, RefreshCw, ExternalLink, Settings, Zap, Search } from "lucide-react";
import { mockIntegrations } from "../lib/mockData";
import { useState } from "react";

const TEAL = "#00d4a8";
const INDIGO = "#6366f1";

const statusConfig = {
  connected: { icon: CheckCircle, color: TEAL, label: "Connected", bg: `${TEAL}12` },
  disconnected: { icon: XCircle, color: "#64748b", label: "Not Connected", bg: "rgba(148,163,184,0.08)" },
  error: { icon: AlertCircle, color: "#f43f5e", label: "Error", bg: "rgba(244,63,94,0.12)" },
  pending: { icon: Clock, color: "#f59e0b", label: "Pending", bg: "rgba(245,158,11,0.12)" },
};

const categoryColors: Record<string, string> = {
  ecommerce: "#00d4a8",
  email: "#6366f1",
  analytics: "#f59e0b",
  crm: "#8b5cf6",
  payment: "#06b6d4",
};

const iconBg: Record<string, string> = {
  ecommerce: "from-emerald-500 to-teal-600",
  email: "from-indigo-500 to-violet-600",
  analytics: "from-amber-500 to-orange-600",
  crm: "from-purple-500 to-violet-600",
  payment: "from-cyan-500 to-blue-600",
};

const formatSync = (d?: Date) => {
  if (!d) return "Never";
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
};

const webhookLogs = [
  { ts: new Date(Date.now() - 30000), event: "cart.abandoned", source: "Shopify", status: "success", duration: "42ms" },
  { ts: new Date(Date.now() - 62000), event: "session.converted", source: "Shopify", status: "success", duration: "38ms" },
  { ts: new Date(Date.now() - 180000), event: "email.opened", source: "Klaviyo", status: "success", duration: "31ms" },
  { ts: new Date(Date.now() - 240000), event: "payment.failed", source: "Stripe", status: "success", duration: "55ms" },
  { ts: new Date(Date.now() - 420000), event: "crm.sync", source: "HubSpot", status: "error", duration: "timeout" },
  { ts: new Date(Date.now() - 600000), event: "session.start", source: "Shopify", status: "success", duration: "28ms" },
];

export function Integrations() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQ, setSearchQ] = useState("");

  const categories = ["all", "ecommerce", "email", "analytics", "crm", "payment"];
  const filtered = mockIntegrations.filter(i =>
    (selectedCategory === "all" || i.category === selectedCategory) &&
    i.name.toLowerCase().includes(searchQ.toLowerCase())
  );

  const connected = mockIntegrations.filter(i => i.status === "connected").length;
  const errored = mockIntegrations.filter(i => i.status === "error").length;
  const eventsToday = mockIntegrations.reduce((s, i) => s + (i.eventsToday || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Integrations Hub</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Connect your e-commerce stack and data pipeline</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ backgroundColor: TEAL, color: "#070d1b" }}>
          <Plug className="w-3.5 h-3.5" />
          Browse All
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Connected", value: connected, color: TEAL },
          { label: "Errors", value: errored, color: errored > 0 ? "#f43f5e" : "#94a3b8" },
          { label: "Events Today", value: eventsToday.toLocaleString(), color: "#e2e8f4" },
          { label: "Webhooks / hr", value: "1,284", color: INDIGO },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{s.label}</p>
            <p className="text-2xl font-semibold font-mono" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search integrations..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize"
              style={{
                backgroundColor: selectedCategory === cat ? "var(--accent)" : "transparent",
                color: selectedCategory === cat ? "var(--accent-foreground)" : "var(--muted-foreground)",
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Integration cards */}
      <div className="grid  md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map(int => {
          const status = statusConfig[int.status];
          const StatusIcon = status.icon;
          const gradient = iconBg[int.category] || "from-gray-500 to-gray-700";
          const catColor = categoryColors[int.category] || "#94a3b8";

          return (
            <div
              key={int.id}
              className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 hover:border-primary/30 transition-colors group"
            >
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white bg-linear-to-br ${gradient} shrink-0`}>
                  {int.icon}
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusIcon className="w-3.5 h-3.5" style={{ color: status.color }} />
                  <span className="text-[11px] font-medium" style={{ color: status.color }}>{status.label}</span>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-foreground mb-0.5">{int.name}</p>
                <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: `${catColor}15`, color: catColor }}>
                  {int.category}
                </span>
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed flex-1">{int.description}</p>

              {int.status === "connected" && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Last sync</span>
                    <span className="font-mono text-foreground">{formatSync(int.lastSync)}</span>
                  </div>
                  {int.eventsToday !== undefined && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Events today</span>
                      <span className="font-mono font-semibold" style={{ color: TEAL }}>{int.eventsToday.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {int.status === "connected" ? (
                  <>
                    <button className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-border rounded-lg text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors">
                      <Settings className="w-3 h-3" /> Configure
                    </button>
                    <button className="p-1.5 border border-border rounded-lg hover:bg-accent transition-colors">
                      <RefreshCw className="w-3 h-3 text-muted-foreground" />
                    </button>
                  </>
                ) : int.status === "error" ? (
                  <button className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold" style={{ backgroundColor: "#f43f5e", color: "#fff" }}>
                    Reconnect
                  </button>
                ) : (
                  <button className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors" style={{ backgroundColor: TEAL, color: "#070d1b" }}>
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Webhook event log */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Recent Webhook Events</h2>
          <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ExternalLink className="w-3.5 h-3.5" />
            View all logs
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Timestamp", "Event", "Source", "Status", "Duration"].map(c => (
                  <th key={c} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {webhookLogs.map((log, idx) => (
                <tr key={idx} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-2.5 text-[11px] font-mono text-muted-foreground">
                    {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(log.ts)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[11px] font-mono text-foreground">{log.event}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">{log.source}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-medium"
                      style={{ color: log.status === "success" ? TEAL : "#f43f5e" }}
                    >
                      {log.status === "success" ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[11px] font-mono" style={{ color: log.status === "error" ? "#f43f5e" : "#94a3b8" }}>
                    {log.duration}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
