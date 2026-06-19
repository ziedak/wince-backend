import { FlaskConical, TrendingUp, Trophy, Pause, Play, Plus, ChevronDown, ChevronUp, Info } from "lucide-react";
import { mockABTests } from "../lib/mockData";
import { useState } from "react";

const TEAL = "#00d4a8";
const INDIGO = "#6366f1";
const AMBER = "#f59e0b";

const statusConfig = {
  running: { color: TEAL, bg: `${TEAL}15`, label: "Running" },
  completed: { color: INDIGO, bg: `${INDIGO}15`, label: "Completed" },
  paused: { color: AMBER, bg: `${AMBER}15`, label: "Paused" },
  draft: { color: "#94a3b8", bg: "rgba(148,163,184,0.1)", label: "Draft" },
};

function significanceBadge(sig: number) {
  if (sig >= 95) return { label: "Significant", color: TEAL };
  if (sig >= 80) return { label: "Trending", color: AMBER };
  return { label: "Inconclusive", color: "#94a3b8" };
}

export function ABTesting() {
  const [expandedId, setExpandedId] = useState<string | null>(mockABTests[0].id);

  const running = mockABTests.filter(t => t.status === "running").length;
  const completed = mockABTests.filter(t => t.status === "completed").length;
  const totalRevenueLift = 24600;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">A/B Testing Lab</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Design, run, and analyze intervention experiments</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ backgroundColor: TEAL, color: "#070d1b" }}>
          <Plus className="w-3.5 h-3.5" />
          New Experiment
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Running Tests", value: running, color: TEAL },
          { label: "Completed Tests", value: completed, color: INDIGO },
          { label: "Revenue Lift", value: `+$${totalRevenueLift.toLocaleString()}`, color: AMBER },
          { label: "Avg Significance", value: `${Math.round(mockABTests.reduce((s, t) => s + t.significance, 0) / mockABTests.length)}%`, color: "#e2e8f4" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{s.label}</p>
            <p className="text-2xl font-semibold font-mono" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tests */}
      <div className="space-y-3">
        {mockABTests.map(test => {
          const expanded = expandedId === test.id;
          const statusCfg = statusConfig[test.status];
          const sigBadge = significanceBadge(test.significance);
          const totalVisitors = test.variants.reduce((s, v) => s + v.visitors, 0);
          const totalConversions = test.variants.reduce((s, v) => s + v.conversions, 0);
          const overallCvr = (totalConversions / totalVisitors * 100).toFixed(1);

          const variantA = test.variants[0];
          const variantB = test.variants[1];
          const cvrA = variantA.conversions / variantA.visitors * 100;
          const cvrB = variantB.conversions / variantB.visitors * 100;
          const lift = ((cvrB - cvrA) / cvrA * 100).toFixed(1);
          const bIsWinner = cvrB > cvrA;

          return (
            <div key={test.id} className="bg-card border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedId(expanded ? null : test.id)}
                className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-accent/20 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <h2 className="text-sm font-semibold text-foreground">{test.name}</h2>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}>
                      {test.status === "running" && <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: statusCfg.color }} />}
                      {statusCfg.label}
                    </span>
                    {test.winner && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ backgroundColor: `${TEAL}15`, color: TEAL }}>
                        <Trophy className="w-3 h-3" /> Winner declared
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{test.targetSegment} · {totalVisitors.toLocaleString()} visitors · {overallCvr}% CVR</p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  {/* Significance gauge */}
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground mb-1">Significance</p>
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(148,163,184,0.1)" }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${test.significance}%`, backgroundColor: sigBadge.color }}
                        />
                      </div>
                      <span className="text-xs font-mono font-semibold" style={{ color: sigBadge.color }}>{test.significance}%</span>
                    </div>
                    <span className="text-[11px]" style={{ color: sigBadge.color }}>{sigBadge.label}</span>
                  </div>

                  {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>

              {expanded && (
                <div className="px-5 pb-5 border-t border-border">
                  {/* Hypothesis */}
                  <div className="flex items-start gap-2 py-4 mb-4 border-b border-border">
                    <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">{test.hypothesis}</p>
                  </div>

                  {/* Variant comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    {test.variants.map((v, idx) => {
                      const cvr = (v.conversions / v.visitors * 100).toFixed(1);
                      const isWinner = test.winner === v.id || (!test.winner && idx === (bIsWinner ? 1 : 0));
                      const variantColor = idx === 0 ? INDIGO : TEAL;

                      return (
                        <div
                          key={v.id}
                          className="rounded-lg p-4 border"
                          style={{
                            borderColor: isWinner && (test.status === "completed" || test.significance >= 80) ? `${variantColor}50` : "var(--border)",
                            backgroundColor: isWinner && (test.status === "completed" || test.significance >= 80) ? `${variantColor}06` : "var(--muted)",
                          }}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${variantColor}20`, color: variantColor }}>
                                {v.id.toUpperCase()}
                              </span>
                              <span className="text-xs font-semibold text-foreground">{v.name}</span>
                            </div>
                            {isWinner && (test.status === "completed" || test.significance >= 80) && (
                              <Trophy className="w-3.5 h-3.5" style={{ color: variantColor }} />
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-3">{v.description}</p>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: "Visitors", value: v.visitors.toLocaleString() },
                              { label: "CVR", value: `${cvr}%` },
                              { label: "Revenue", value: `$${(v.revenue / 1000).toFixed(0)}k` },
                            ].map(m => (
                              <div key={m.label} className="text-center">
                                <p className="text-[11px] text-muted-foreground">{m.label}</p>
                                <p className="text-sm font-mono font-semibold" style={{ color: variantColor }}>{m.value}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Lift indicator */}
                  <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-border" style={{ backgroundColor: "rgba(148,163,184,0.04)" }}>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-3.5 h-3.5" style={{ color: parseFloat(lift) >= 0 ? TEAL : "#f43f5e" }} />
                      <span className="text-xs text-muted-foreground">
                        Treatment vs Control lift:
                      </span>
                      <span className="text-sm font-mono font-semibold" style={{ color: parseFloat(lift) >= 0 ? TEAL : "#f43f5e" }}>
                        {parseFloat(lift) >= 0 ? "+" : ""}{lift}%
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {test.status === "running" && (
                        <button className="flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors">
                          <Pause className="w-3 h-3" /> Pause
                        </button>
                      )}
                      {test.status === "paused" && (
                        <button className="flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors">
                          <Play className="w-3 h-3" /> Resume
                        </button>
                      )}
                      <button className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold" style={{ backgroundColor: TEAL, color: "#070d1b" }}>
                        {test.status === "completed" ? "View Report" : "Declare Winner"}
                      </button>
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="flex items-center gap-2 mt-3 text-[11px] text-muted-foreground">
                    <span>Started: {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(test.startDate)}</span>
                    {test.endDate && <><span>·</span><span>Ended: {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(test.endDate)}</span></>}
                    <span>·</span>
                    <span>{Math.round((Date.now() - test.startDate.getTime()) / 86400000)} days running</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
