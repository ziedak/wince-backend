import { Brain, TrendingUp, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Cpu, Target } from "lucide-react";
import { mockAIDecisions } from "../lib/mockData";
import { useState } from "react";
import { Link } from "react-router";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";

const TEAL = "#00d4a8";
const INDIGO = "#6366f1";

const modelMetrics = [
  { subject: "Accuracy", value: 87 },
  { subject: "Precision", value: 82 },
  { subject: "Recall", value: 91 },
  { subject: "F1 Score", value: 86 },
  { subject: "AUC-ROC", value: 93 },
  { subject: "Coverage", value: 78 },
];

function outcomeStyle(outcome?: string) {
  if (outcome === "converted") return { color: "#00d4a8", bg: "rgba(0,212,168,0.1)", label: "Converted" };
  if (outcome === "abandoned") return { color: "#f43f5e", bg: "rgba(244,63,94,0.1)", label: "Abandoned" };
  return { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", label: "Pending" };
}

function predictedStyle(outcome: string) {
  if (outcome === "convert") return "#00d4a8";
  if (outcome === "abandon") return "#f43f5e";
  return "#f59e0b";
}

export function AIDecisions() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const stats = {
    total: mockAIDecisions.length,
    avgConfidence: (mockAIDecisions.reduce((s, d) => s + d.confidence, 0) / mockAIDecisions.length * 100).toFixed(1),
    converted: mockAIDecisions.filter(d => d.actualOutcome === "converted").length,
    pending: mockAIDecisions.filter(d => d.actualOutcome === "pending").length,
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">AI Decision Center</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Monitor and understand AI-driven intervention decisions</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Decisions", value: stats.total, color: "#e2e8f4", icon: Brain },
          { label: "Avg Confidence", value: `${stats.avgConfidence}%`, color: TEAL, icon: Target },
          { label: "Converted", value: stats.converted, color: "#00d4a8", icon: CheckCircle },
          { label: "Pending", value: stats.pending, color: "#f59e0b", icon: Clock },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${s.color}15` }}>
              <s.icon className="w-4.5 h-4.5" style={{ color: s.color }} />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
              <p className="text-xl font-semibold font-mono" style={{ color: s.color }}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Model performance + recent decisions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Radar chart */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Model Performance</h2>
          <p className="text-xs text-muted-foreground mb-4">v2.4.1 · retrained Jun 15</p>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={modelMetrics}>
              <PolarGrid stroke="rgba(148,163,184,0.1)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: "#64748b", fontSize: 10 }} />
              <Radar dataKey="value" stroke={TEAL} fill={TEAL} fillOpacity={0.15} strokeWidth={1.5} />
            </RadarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {[
              { label: "Accuracy", value: "87.3%" },
              { label: "Precision", value: "82.1%" },
              { label: "Recall", value: "91.4%" },
              { label: "AUC-ROC", value: "0.934" },
            ].map(m => (
              <div key={m.label} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{m.label}</span>
                <span className="font-mono font-semibold text-foreground">{m.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Decision list */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Recent Decisions</h2>
          </div>
          <div className="divide-y divide-border">
            {mockAIDecisions.map(d => {
              const expanded = expandedId === d.id;
              const outcome = outcomeStyle(d.actualOutcome);
              const OutcomeIcon = d.actualOutcome === "converted" ? CheckCircle : d.actualOutcome === "abandoned" ? XCircle : Clock;

              return (
                <div key={d.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff" }}>
                        {d.visitorName.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <Link to={`/journey/${d.visitorId}`} className="text-xs font-semibold text-foreground hover:text-primary transition-colors">
                            {d.visitorName}
                          </Link>
                          <span className="text-[11px] text-muted-foreground">
                            {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d.timestamp)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ backgroundColor: `${TEAL}15`, color: TEAL }}>
                            {d.intervention}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border" style={{ color: outcome.color, borderColor: `${outcome.color}40`, backgroundColor: outcome.bg }}>
                            <OutcomeIcon className="w-3 h-3" />
                            {outcome.label}
                          </span>
                          {d.revenue && (
                            <span className="text-[11px] font-mono font-semibold" style={{ color: "#00d4a8" }}>
                              +${d.revenue.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-[11px] text-muted-foreground mb-1">Confidence</p>
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(148,163,184,0.12)" }}>
                            <div className="h-full rounded-full" style={{ width: `${d.confidence * 100}%`, backgroundColor: TEAL }} />
                          </div>
                          <span className="text-xs font-mono font-semibold text-foreground">{(d.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-muted-foreground mb-1">Predicted</p>
                        <p className="text-xs font-semibold capitalize font-mono" style={{ color: predictedStyle(d.predictedOutcome) }}>
                          {d.predictedOutcome}
                        </p>
                      </div>
                      <button
                        onClick={() => setExpandedId(expanded ? null : d.id)}
                        className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                      >
                        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-3 ml-11">
                      <div className="bg-muted/50 rounded-lg p-3 border border-border">
                        <div className="flex items-center gap-2 mb-2">
                          <Brain className="w-3.5 h-3.5" style={{ color: TEAL }} />
                          <span className="text-xs font-semibold text-foreground">AI Reasoning</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{d.reasoning}</p>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Link
                          to={`/journey/${d.visitorId}`}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                          style={{ backgroundColor: TEAL, color: "#070d1b" }}
                        >
                          View Journey
                        </Link>
                        <button className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent transition-colors">
                          Manual Override
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
