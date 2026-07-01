import { Download, Calendar, TrendingUp, DollarSign, BarChart3, Target } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import { revenueRecoveryData, hourlyActivityData, segmentPerformanceData, interventionPerformanceData } from "../lib/mockData";

const TEAL = "#00d4a8";
const INDIGO = "#6366f1";
const AMBER = "#f59e0b";
const ROSE = "#f43f5e";
const PURPLE = "#8b5cf6";
const COLORS = [TEAL, INDIGO, AMBER, ROSE, PURPLE];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs">
      <p className="text-muted-foreground mb-2 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.dataKey}:</span>
          <span className="text-foreground font-mono font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export function Analytics() {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Analytics & Reporting</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Deep insights into cart recovery performance</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent transition-colors">
            <Calendar className="w-3.5 h-3.5" />
            Last 7 days
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors" style={{ backgroundColor: TEAL, color: "#070d1b" }}>
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Revenue Recovered", value: "$43,250", change: "+18.2%", icon: DollarSign, color: TEAL },
          { label: "Average Order Value", value: "$187.42", change: "+5.3%", icon: TrendingUp, color: INDIGO },
          { label: "Avg Recovery Rate", value: "28.4%", change: "+3.1%", icon: Target, color: AMBER },
          { label: "Total Interventions", value: "6,619", change: "+12.7%", icon: BarChart3, color: PURPLE },
        ].map(m => (
          <div key={m.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium leading-tight">{m.label}</p>
              <m.icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: m.color }} />
            </div>
            <p className="text-xl font-semibold font-mono text-foreground">{m.value}</p>
            <p className="text-[11px] font-mono font-semibold mt-0.5" style={{ color: TEAL }}>{m.change} vs last period</p>
          </div>
        ))}
      </div>

      {/* Revenue + Hourly charts */}
      <div className="grid  lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Revenue Recovery Trend</h2>
          <p className="text-xs text-muted-foreground mb-4">Recovered vs potential · 8 days</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={revenueRecoveryData}>
              <defs>
                <linearGradient id="tG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TEAL} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="iG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={INDIGO} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={INDIGO} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
              <XAxis dataKey="date" stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="line" wrapperStyle={{ fontSize: 11, color: "#64748b" }} />
              <Area type="monotone" dataKey="potential" stroke={INDIGO} strokeWidth={1.5} fill="url(#iG)" />
              <Area type="monotone" dataKey="recovered" stroke={TEAL} strokeWidth={2} fill="url(#tG)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Hourly Activity</h2>
          <p className="text-xs text-muted-foreground mb-4">Visitors and conversions by hour</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourlyActivityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
              <XAxis dataKey="hour" stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 11, color: "#64748b" }} />
              <Bar dataKey="visitors" fill={INDIGO} opacity={0.7} radius={[2, 2, 0, 0]} />
              <Bar dataKey="conversions" fill={TEAL} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Intervention performance + Segments */}
      <div className="grid  lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Intervention Revenue</h2>
          <p className="text-xs text-muted-foreground mb-4">Revenue attribution by type</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={interventionPerformanceData} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                {interventionPerformanceData.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: "#0c1526", border: "1px solid rgba(148,163,184,0.09)", borderRadius: 8, fontSize: 11 }}
                formatter={(v: any) => [`$${v.toLocaleString()}`, "Revenue"]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Segment table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Segment Performance</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Segment</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recovery Rate</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Avg Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {segmentPerformanceData.map(s => (
                <tr key={s.segment} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 text-xs text-foreground">{s.segment}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-12 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(148,163,184,0.12)" }}>
                        <div className="h-full rounded-full" style={{ width: `${s.recoveryRate * 1.5}%`, backgroundColor: TEAL }} />
                      </div>
                      <span className="text-xs font-mono font-semibold text-foreground">{s.recoveryRate}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-mono font-semibold text-foreground">${s.avgRevenue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
