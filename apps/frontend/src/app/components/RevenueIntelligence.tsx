import { TrendingUp, DollarSign, Users, ArrowUpRight, Calendar, Download } from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ComposedChart, Line,
} from "recharts";
import { revenueForecastData, cohortRetentionData, revenueAttributionData } from "../lib/mockData";

const TEAL = "#00d4a8";
const INDIGO = "#6366f1";
const AMBER = "#f59e0b";
const PURPLE = "#8b5cf6";

const retentionColor = (val: number | null) => {
  if (val === null) return { bg: "#0c1526", text: "#1a2d44" };
  if (val >= 80) return { bg: "rgba(0,212,168,0.25)", text: "#00d4a8" };
  if (val >= 60) return { bg: "rgba(0,212,168,0.15)", text: "#00d4a8" };
  if (val >= 40) return { bg: "rgba(99,102,241,0.15)", text: "#818cf8" };
  if (val >= 20) return { bg: "rgba(245,158,11,0.12)", text: "#f59e0b" };
  return { bg: "rgba(244,63,94,0.12)", text: "#f87171" };
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs">
      <p className="text-muted-foreground mb-2 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || p.fill }} />
          <span className="text-muted-foreground">{p.name || p.dataKey}:</span>
          <span className="text-foreground font-mono font-medium">
            {typeof p.value === "number" && p.value > 1000 ? `$${p.value.toLocaleString()}` : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export function RevenueIntelligence() {
  const kpis = [
    { label: "Projected Monthly", value: "$198,400", change: "+22.1%", icon: DollarSign, color: TEAL },
    { label: "YoY Revenue Growth", value: "+34.7%", change: "+8.2pp", icon: TrendingUp, color: INDIGO },
    { label: "Avg Customer LTV", value: "$847", change: "+$112", icon: Users, color: AMBER },
    { label: "Recovery ROI", value: "11.4×", change: "+1.8×", icon: ArrowUpRight, color: PURPLE },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Revenue Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Forecasting, cohort analysis, and LTV attribution</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent transition-colors">
            <Calendar className="w-3.5 h-3.5" />
            Jun 2026
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors" style={{ backgroundColor: TEAL, color: "#070d1b" }}>
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors">
            <div className="flex items-start justify-between mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${k.color}15` }}>
                <k.icon className="w-4 h-4" style={{ color: k.color }} />
              </div>
              <span className="text-[11px] font-mono font-semibold" style={{ color: TEAL }}>{k.change}</span>
            </div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{k.label}</p>
            <p className="text-xl font-semibold font-mono text-foreground">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Revenue Forecast chart */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Revenue Forecast</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Actuals + 12-day AI forecast with 80% confidence band</p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 rounded" style={{ backgroundColor: TEAL }} /><span className="text-muted-foreground">Actual</span></div>
            <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 rounded border-dashed border-t border-amber-400" /><span className="text-muted-foreground">Forecast</span></div>
            <div className="flex items-center gap-1.5"><div className="w-4 h-3 rounded opacity-40" style={{ backgroundColor: AMBER }} /><span className="text-muted-foreground">CI Band</span></div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={revenueForecastData}>
            <defs>
              <linearGradient id="tealForecastGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TEAL} stopOpacity={0.2} />
                <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="ciBandGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={AMBER} stopOpacity={0.15} />
                <stop offset="100%" stopColor={AMBER} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
            <XAxis dataKey="date" stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="upper" fill="url(#ciBandGrad)" stroke="none" name="Upper bound" />
            <Area type="monotone" dataKey="lower" fill="#0c1526" stroke="none" name="Lower bound" />
            <Area type="monotone" dataKey="actual" stroke={TEAL} strokeWidth={2} fill="url(#tealForecastGrad)" name="Actual" connectNulls={false} />
            <Line type="monotone" dataKey="forecast" stroke={AMBER} strokeWidth={2} strokeDasharray="5 3" dot={false} name="Forecast" connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Cohort retention + Attribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cohort table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Cohort Retention</h2>
            <p className="text-xs text-muted-foreground mt-0.5">% of customers still active by months since acquisition</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-muted-foreground">Cohort</th>
                  {["M0", "M1", "M2", "M3", "M4", "M5"].map(m => (
                    <th key={m} className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-muted-foreground">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cohortRetentionData.map(row => (
                  <tr key={row.cohort}>
                    <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{row.cohort}</td>
                    {[row.m0, row.m1, row.m2, row.m3, row.m4, row.m5].map((val, i) => {
                      const style = retentionColor(val);
                      return (
                        <td key={i} className="px-3 py-2.5 text-center" style={{ backgroundColor: style.bg }}>
                          {val !== null ? (
                            <span className="font-mono font-semibold" style={{ color: style.text }}>{val}%</span>
                          ) : (
                            <span className="text-border">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Revenue attribution */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Revenue Attribution</h2>
          <p className="text-xs text-muted-foreground mb-4">Revenue recovered by intervention channel</p>
          <div className="space-y-2.5">
            {revenueAttributionData.map((r, i) => {
              const colors = [TEAL, INDIGO, AMBER, "#f43f5e", PURPLE, "#06b6d4"];
              const col = colors[i % colors.length];
              return (
                <div key={r.channel}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-foreground">{r.channel}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-muted-foreground">{r.pct}%</span>
                      <span className="text-xs font-mono font-semibold text-foreground">${r.value.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(148,163,184,0.08)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${r.pct}%`, backgroundColor: col }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t border-border grid grid-cols-3 gap-3">
            {[
              { label: "Total Attributed", value: "$169,850" },
              { label: "Top Channel", value: "Exit Intent" },
              { label: "Unattributed", value: "$14,200" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-[11px] text-muted-foreground mb-1">{s.label}</p>
                <p className="text-xs font-mono font-semibold text-foreground">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* LTV Distribution */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">LTV Distribution by Segment</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Average lifetime value across customer segments</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={[
            { segment: "Loyal Returners", ltv: 1420, recovered: 340 },
            { segment: "High-Intent", ltv: 892, recovered: 287 },
            { segment: "Comparison", ltv: 654, recovered: 183 },
            { segment: "Price-Sensitive", ltv: 312, recovered: 94 },
            { segment: "Impulse", ltv: 215, recovered: 127 },
            { segment: "Mobile Browsers", ltv: 142, recovered: 69 },
          ]}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
            <XAxis dataKey="segment" stroke="rgba(148,163,184,0.4)" fontSize={9} tickLine={false} axisLine={false} />
            <YAxis stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
            <Tooltip content={<CustomTooltip />} />
            <Legend iconType="square" wrapperStyle={{ fontSize: 11, color: "#64748b" }} />
            <Bar dataKey="ltv" fill={INDIGO} opacity={0.7} radius={[3, 3, 0, 0]} name="Avg LTV" />
            <Bar dataKey="recovered" fill={TEAL} radius={[3, 3, 0, 0]} name="Avg Recovered" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
