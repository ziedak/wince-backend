import { Users, TrendingUp, TrendingDown, Target, ChevronRight, Search, Filter } from "lucide-react";
import { mockSegments } from "../lib/mockData";
import { useState } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

const riskBadge = (r: string) => ({
  low: { color: "#00d4a8", bg: "rgba(0,212,168,0.12)" },
  medium: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  high: { color: "#f43f5e", bg: "rgba(244,63,94,0.12)" },
}[r] || { color: "#94a3b8", bg: "rgba(148,163,184,0.12)" });

const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  return <circle cx={cx} cy={cy} r={Math.sqrt(payload.size / 50)} fill={payload.color} opacity={0.8} />;
};

const TooltipContent = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs min-w-[180px]">
      <p className="font-semibold text-foreground mb-2" style={{ color: d.color }}>{d.name}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Size</span><span className="font-mono text-foreground">{d.size.toLocaleString()}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Recovery Rate</span><span className="font-mono text-foreground">{d.recoveryRate}%</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Avg Cart Value</span><span className="font-mono text-foreground">${d.avgCartValue}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">LTV</span><span className="font-mono text-foreground">${d.ltv}</span></div>
      </div>
    </div>
  );
};

export function CustomerSegments() {
  const [selected, setSelected] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");

  const filtered = mockSegments.filter(s => s.name.toLowerCase().includes(searchQ.toLowerCase()));
  const selectedSeg = mockSegments.find(s => s.id === selected);

  const scatterData = mockSegments.map(s => ({
    x: s.avgCartValue,
    y: s.recoveryRate,
    size: s.size,
    color: s.color,
    name: s.name,
    ...s,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Customer Segments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">AI-driven behavioral clusters and targeting insights</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors" style={{ backgroundColor: "#00d4a8", color: "#070d1b" }}>
          <Users className="w-3.5 h-3.5" />
          Create Segment
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Segments", value: mockSegments.length, color: "#e2e8f4" },
          { label: "Total Visitors", value: mockSegments.reduce((s, seg) => s + seg.size, 0).toLocaleString(), color: "#00d4a8" },
          { label: "Best Recovery Rate", value: `${Math.max(...mockSegments.map(s => s.recoveryRate))}%`, color: "#6366f1" },
          { label: "Highest LTV", value: `$${Math.max(...mockSegments.map(s => s.ltv)).toLocaleString()}`, color: "#f59e0b" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{s.label}</p>
            <p className="text-2xl font-semibold font-mono" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Segment list */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search segments..."
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>
          <div className="divide-y divide-border">
            {filtered.map(seg => {
              const risk = riskBadge(seg.riskLevel);
              const isSelected = selected === seg.id;

              return (
                <button
                  key={seg.id}
                  onClick={() => setSelected(isSelected ? null : seg.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
                  style={{ backgroundColor: isSelected ? "var(--accent)" : "transparent" }}
                >
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{seg.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{seg.size.toLocaleString()} visitors</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-mono font-semibold text-foreground">{seg.recoveryRate}%</p>
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize"
                      style={{ backgroundColor: risk.bg, color: risk.color }}
                    >
                      {seg.riskLevel}
                    </span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Scatter + detail */}
        <div className="lg:col-span-2 space-y-4">
          {/* Scatter plot */}
          <div className="bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">Segment Map</h2>
            <p className="text-xs text-muted-foreground mb-4">Avg cart value vs recovery rate · bubble size = segment size</p>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
                <XAxis
                  type="number" dataKey="x" name="Avg Cart Value"
                  stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false}
                  tickFormatter={v => `$${v}`}
                  label={{ value: "Avg Cart Value", position: "insideBottom", offset: -2, style: { fill: "#64748b", fontSize: 10 } }}
                />
                <YAxis
                  type="number" dataKey="y" name="Recovery Rate"
                  stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false}
                  tickFormatter={v => `${v}%`}
                  label={{ value: "Recovery Rate", angle: -90, position: "insideLeft", style: { fill: "#64748b", fontSize: 10 } }}
                />
                <Tooltip content={<TooltipContent />} />
                <Scatter data={scatterData} shape={<CustomDot />} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Segment detail or comparison */}
          {selectedSeg ? (
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selectedSeg.color }} />
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{selectedSeg.name}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{selectedSeg.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {selectedSeg.growthRate >= 0 ? (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                  )}
                  <span className={`text-xs font-mono font-semibold ${selectedSeg.growthRate >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {selectedSeg.growthRate >= 0 ? "+" : ""}{selectedSeg.growthRate}% MoM
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Size", value: selectedSeg.size.toLocaleString() },
                  { label: "Recovery Rate", value: `${selectedSeg.recoveryRate}%` },
                  { label: "Avg Cart Value", value: `$${selectedSeg.avgCartValue}` },
                  { label: "LTV", value: `$${selectedSeg.ltv}` },
                ].map(m => (
                  <div key={m.label} className="p-3 rounded-lg border border-border bg-muted/40 text-center">
                    <p className="text-[11px] text-muted-foreground mb-1">{m.label}</p>
                    <p className="text-sm font-semibold font-mono text-foreground">{m.value}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg border border-border" style={{ backgroundColor: `${selectedSeg.color}08` }}>
                <Target className="w-4 h-4 shrink-0 mt-0.5" style={{ color: selectedSeg.color }} />
                <div>
                  <p className="text-xs font-semibold text-foreground mb-1">Primary Signal</p>
                  <p className="text-[11px] text-muted-foreground">{selectedSeg.primarySignal}</p>
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ backgroundColor: selectedSeg.color, color: "#070d1b" }}>
                  Create Intervention
                </button>
                <button className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent transition-colors">
                  View Sessions
                </button>
                <button className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent transition-colors">
                  Export Segment
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Segment Comparison</h2>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Segment", "Size", "Recovery Rate", "Avg Cart", "LTV", "Risk"].map(c => (
                      <th key={c} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mockSegments.map(seg => {
                    const risk = riskBadge(seg.riskLevel);
                    return (
                      <tr key={seg.id} className="hover:bg-accent/30 transition-colors cursor-pointer" onClick={() => setSelected(seg.id)}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                            <span className="text-xs font-medium text-foreground">{seg.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs font-mono text-foreground">{seg.size.toLocaleString()}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-10 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(148,163,184,0.1)" }}>
                              <div className="h-full rounded-full" style={{ width: `${seg.recoveryRate}%`, backgroundColor: seg.color }} />
                            </div>
                            <span className="text-xs font-mono font-semibold text-foreground">{seg.recoveryRate}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs font-mono text-foreground">${seg.avgCartValue}</td>
                        <td className="px-4 py-2.5 text-xs font-mono text-foreground">${seg.ltv}</td>
                        <td className="px-4 py-2.5">
                          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full capitalize" style={{ backgroundColor: risk.bg, color: risk.color }}>{seg.riskLevel}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
