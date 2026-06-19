import { useState } from "react";
import { Monitor, Smartphone, Tablet, MapPin, Clock, DollarSign, Zap, Search, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { mockVisitors } from "../lib/mockData";
import { Link } from "react-router";

const deviceIcons = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };

const riskLabel = (p: number) => {
  if (p >= 0.7) return { label: "Critical", color: "#f43f5e", bg: "rgba(244,63,94,0.12)" };
  if (p >= 0.45) return { label: "High", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" };
  return { label: "Low", color: "#00d4a8", bg: "rgba(0,212,168,0.12)" };
};

const stateLabel = (s: string) => {
  switch (s) {
    case "triggered": return { label: "Intervening", color: "#6366f1" };
    case "converted": return { label: "Converted", color: "#00d4a8" };
    case "dismissed": return { label: "Dismissed", color: "#64748b" };
    default: return { label: "Monitoring", color: "#64748b" };
  }
};

export function LiveSessions() {
  const [filterDevice, setFilterDevice] = useState("all");
  const [filterRisk, setFilterRisk] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  let filtered = mockVisitors;
  if (filterDevice !== "all") filtered = filtered.filter(v => v.device === filterDevice);
  if (filterRisk === "critical") filtered = filtered.filter(v => v.abandonmentProbability >= 0.7);
  else if (filterRisk === "high") filtered = filtered.filter(v => v.abandonmentProbability >= 0.45 && v.abandonmentProbability < 0.7);
  else if (filterRisk === "low") filtered = filtered.filter(v => v.abandonmentProbability < 0.45);
  if (searchQuery) filtered = filtered.filter(v =>
    v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.currentPage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const statCounts = {
    total: mockVisitors.length,
    critical: mockVisitors.filter(v => v.abandonmentProbability >= 0.7).length,
    intervening: mockVisitors.filter(v => v.interventionState === "triggered").length,
    converted: mockVisitors.filter(v => v.interventionState === "converted").length,
  };

  const formatDuration = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Live Sessions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time visitor monitoring · updated every 5s</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-foreground">{statCounts.total} active</span>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Sessions", value: statCounts.total, color: "#e2e8f4" },
          { label: "Critical Risk", value: statCounts.critical, color: "#f43f5e" },
          { label: "Intervening", value: statCounts.intervening, color: "#6366f1" },
          { label: "Converted", value: statCounts.converted, color: "#00d4a8" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{s.label}</p>
            <p className="text-2xl font-semibold font-mono" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search visitors..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
          {["all", "desktop", "mobile", "tablet"].map(d => (
            <button
              key={d}
              onClick={() => setFilterDevice(d)}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize"
              style={{
                backgroundColor: filterDevice === d ? "var(--accent)" : "transparent",
                color: filterDevice === d ? "var(--accent-foreground)" : "var(--muted-foreground)",
              }}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
          {[
            { key: "all", label: "All Risk" },
            { key: "critical", label: "Critical" },
            { key: "high", label: "High" },
            { key: "low", label: "Low" },
          ].map(r => (
            <button
              key={r.key}
              onClick={() => setFilterRisk(r.key)}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
              style={{
                backgroundColor: filterRisk === r.key ? "var(--accent)" : "transparent",
                color: filterRisk === r.key ? "var(--accent-foreground)" : "var(--muted-foreground)",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sessions table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Visitor", "Device", "Current Page", "Cart", "Abandonment Risk", "Frustration", "State", "Session"].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(v => {
                const risk = riskLabel(v.abandonmentProbability);
                const state = stateLabel(v.interventionState);
                const DevIcon = deviceIcons[v.device];

                return (
                  <tr key={v.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/journey/${v.id}`} className="flex items-center gap-2.5 group">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff" }}>
                          {v.name.split(" ").map(n => n[0]).join("")}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground group-hover:text-primary transition-colors truncate">{v.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{v.email}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <DevIcon className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground capitalize">{v.device}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-foreground font-mono truncate max-w-[140px]">{v.currentPage}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-muted-foreground" />
                        <p className="text-[11px] text-muted-foreground">{v.location}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-mono font-semibold text-foreground">${v.cartValue.toFixed(2)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(148,163,184,0.12)" }}>
                          <div className="h-full rounded-full" style={{ width: `${v.abandonmentProbability * 100}%`, backgroundColor: risk.color }} />
                        </div>
                        <span className="text-xs font-mono font-semibold" style={{ color: risk.color }}>
                          {(v.abandonmentProbability * 100).toFixed(0)}%
                        </span>
                      </div>
                      <span className="text-[11px]" style={{ color: risk.color }}>{risk.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(148,163,184,0.12)" }}>
                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${v.frustrationScore * 100}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground font-mono">{(v.frustrationScore * 100).toFixed(0)}%</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border" style={{ color: state.color, borderColor: `${state.color}40`, backgroundColor: `${state.color}12` }}>
                        {v.interventionState === "triggered" && <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: state.color }} />}
                        {state.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatDuration(v.timeOnSite)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No sessions match your filters</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
