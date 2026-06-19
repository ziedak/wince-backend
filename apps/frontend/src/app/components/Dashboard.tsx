import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, Users, Zap, ArrowRight, Brain, Activity } from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { revenueRecoveryData, interventionPerformanceData, mockVisitors, mockAIDecisions } from "../lib/mockData";
import { Link } from "react-router";

const TEAL = "#00d4a8";
const INDIGO = "#6366f1";
const AMBER = "#f59e0b";
const ROSE = "#f43f5e";

function KPICard({
  title,
  value,
  change,
  icon: Icon,
  subtitle,
  accent = TEAL,
}: {
  title: string;
  value: string;
  change: number;
  icon: React.ElementType;
  subtitle?: string;
  accent?: string;
}) {
  const pos = change >= 0;
  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-3 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{title}</p>
          <p className="text-2xl font-semibold text-foreground font-mono">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}18` }}>
          <Icon className="w-4.5 h-4.5" style={{ color: accent }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {pos ? (
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
        )}
        <span className={`text-xs font-semibold font-mono ${pos ? "text-emerald-400" : "text-rose-400"}`}>
          {pos ? "+" : ""}{change}%
        </span>
        <span className="text-xs text-muted-foreground">vs last week</span>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs">
      <p className="text-muted-foreground mb-2 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground capitalize">{p.dataKey}:</span>
          <span className="text-foreground font-mono font-medium">${p.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
};

const riskColor = (prob: number) => {
  if (prob >= 0.7) return "#f43f5e";
  if (prob >= 0.45) return "#f59e0b";
  return "#00d4a8";
};

export function Dashboard() {
  const highRisk = mockVisitors.filter(v => v.abandonmentProbability > 0.6);
  const revenueRecovered = 43250;
  const recoveryRate = 28.4;
  const aiLift = 42.3;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time cart recovery performance — Jun 18, 2026</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-foreground">247 live sessions</span>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard title="Revenue Recovered" value={`$${revenueRecovered.toLocaleString()}`} change={18.2} icon={DollarSign} subtitle="This month" accent={TEAL} />
        <KPICard title="Recovery Rate" value={`${recoveryRate}%`} change={5.4} icon={ShoppingCart} accent={INDIGO} />
        <KPICard title="Active Visitors" value="247" change={-12.3} icon={Users} subtitle="Right now" accent={AMBER} />
        <KPICard title="AI Lift" value={`${aiLift}%`} change={8.7} icon={Brain} subtitle="Above baseline" accent="#8b5cf6" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue trend — spans 2 cols */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Revenue Recovery Trend</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Recovered vs potential · last 8 days</p>
            </div>
            <span className="text-xs font-mono text-primary font-semibold">+$5,100 MTD</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={revenueRecoveryData}>
              <defs>
                <linearGradient id="tealGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TEAL} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="indigoGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={INDIGO} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={INDIGO} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
              <XAxis dataKey="date" stroke="rgba(148,163,184,0.4)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="rgba(148,163,184,0.4)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="potential" stroke={INDIGO} strokeWidth={1.5} fill="url(#indigoGrad)" name="potential" />
              <Area type="monotone" dataKey="recovered" stroke={TEAL} strokeWidth={2} fill="url(#tealGrad)" name="recovered" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Intervention Performance */}
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-foreground">Top Interventions</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Conversions by type</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={interventionPerformanceData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" horizontal={false} />
              <XAxis type="number" stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis dataKey="name" type="category" stroke="rgba(148,163,184,0.4)" fontSize={10} tickLine={false} axisLine={false} width={72} />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.04)" }}
                contentStyle={{ backgroundColor: "#0c1526", border: "1px solid rgba(148,163,184,0.09)", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
              />
              <Bar dataKey="conversions" fill={TEAL} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row: High-risk sessions + AI activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* High-risk sessions */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">High-Risk Sessions</h2>
            <Link to="/live-sessions" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {highRisk.map(v => (
              <Link
                key={v.id}
                to={`/journey/${v.id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-accent/50 transition-colors"
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff" }}>
                  {v.name.split(" ").map(n => n[0]).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{v.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">{v.currentPage}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-mono font-semibold text-foreground">${v.cartValue.toFixed(0)}</p>
                  <div className="flex items-center gap-1 justify-end">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: riskColor(v.abandonmentProbability) }} />
                    <p className="text-[11px] font-mono" style={{ color: riskColor(v.abandonmentProbability) }}>
                      {(v.abandonmentProbability * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent AI decisions */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Recent AI Decisions</h2>
            <Link to="/ai-decisions" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {mockAIDecisions.slice(0, 4).map(d => (
              <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${TEAL}18` }}
                >
                  <Brain className="w-3.5 h-3.5" style={{ color: TEAL }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{d.visitorName}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{d.intervention}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-mono font-semibold text-foreground">{(d.confidence * 100).toFixed(0)}%</p>
                  <p className="text-[11px]" style={{
                    color: d.actualOutcome === "converted" ? "#00d4a8" : d.actualOutcome === "abandoned" ? "#f43f5e" : "#f59e0b"
                  }}>
                    {d.actualOutcome ?? "pending"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom metrics strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Avg Intervention Delay", value: "2.4s", icon: Activity, note: "from trigger to display" },
          { label: "Model Accuracy", value: "87.3%", icon: Brain, note: "last 1,000 decisions" },
          { label: "Revenue per Session", value: "$14.82", icon: DollarSign, note: "+$2.14 vs avg" },
          { label: "Interventions Today", value: "1,284", icon: Zap, note: "342 converted" },
        ].map(m => (
          <div key={m.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <m.icon className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{m.label}</p>
            </div>
            <p className="text-lg font-semibold text-foreground font-mono">{m.value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{m.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
