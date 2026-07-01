import { GitBranch, Plus, Pause, Play, Edit, BarChart3, ChevronRight, Clock, Zap, GitMerge, AlertCircle, CheckCircle2 } from "lucide-react";
import { mockPlaybooks } from "../lib/mockData";
import { useState } from "react";

const TEAL = "#00d4a8";
const INDIGO = "#6366f1";
const AMBER = "#f59e0b";

const stepTypeConfig = {
  action: { icon: Zap, color: TEAL, bg: `${TEAL}15` },
  wait: { icon: Clock, color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
  condition: { icon: GitMerge, color: AMBER, bg: `${AMBER}15` },
  branch: { icon: GitBranch, color: INDIGO, bg: `${INDIGO}15` },
};

const statusConfig = {
  active: { color: TEAL, label: "Active" },
  paused: { color: AMBER, label: "Paused" },
  draft: { color: "#94a3b8", label: "Draft" },
};

export function Playbooks() {
  const [selectedId, setSelectedId] = useState(mockPlaybooks[0].id);
  const selected = mockPlaybooks.find(p => p.id === selectedId)!;

  const totalTriggered = mockPlaybooks.reduce((s, p) => s + p.stats.triggered, 0);
  const totalConverted = mockPlaybooks.reduce((s, p) => s + p.stats.converted, 0);
  const totalRevenue = mockPlaybooks.reduce((s, p) => s + p.stats.revenue, 0);
  const avgCvr = (totalConverted / totalTriggered * 100).toFixed(1);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Playbooks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Automated multi-step cart recovery workflows</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ backgroundColor: TEAL, color: "#070d1b" }}>
          <Plus className="w-3.5 h-3.5" />
          New Playbook
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Triggered", value: totalTriggered.toLocaleString(), color: "#e2e8f4" },
          { label: "Total Converted", value: totalConverted.toLocaleString(), color: TEAL },
          { label: "Avg CVR", value: `${avgCvr}%`, color: INDIGO },
          { label: "Revenue Generated", value: `$${(totalRevenue / 1000).toFixed(0)}k`, color: AMBER },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{s.label}</p>
            <p className="text-2xl font-semibold font-mono" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid  lg:grid-cols-3 gap-4">
        {/* Playbook list */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-semibold text-foreground">{mockPlaybooks.length} Playbooks</p>
          </div>
          <div className="divide-y divide-border">
            {mockPlaybooks.map(p => {
              const status = statusConfig[p.status];
              const cvr = (p.stats.converted / p.stats.triggered * 100).toFixed(0);
              const isSelected = selectedId === p.id;

              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors"
                  style={{ backgroundColor: isSelected ? "var(--accent)" : "transparent" }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(26,45,68,0.4)"; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: `${TEAL}12` }}>
                    <GitBranch className="w-4 h-4" style={{ color: TEAL }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-xs font-semibold text-foreground truncate">{p.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium" style={{ color: status.color }}>
                        {status.label}
                      </span>
                      <span className="text-muted-foreground text-[11px]">·</span>
                      <span className="text-[11px] text-muted-foreground font-mono">{p.steps.length} steps</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="font-mono">{p.stats.triggered.toLocaleString()} triggered</span>
                      <span className="font-mono" style={{ color: TEAL }}>{cvr}% CVR</span>
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-2" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Playbook detail */}
        <div className="lg:col-span-2 space-y-4">
          {/* Header */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-1">{selected.name}</h2>
                <p className="text-xs text-muted-foreground">{selected.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selected.status === "active" ? (
                  <button className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors">
                    <Pause className="w-3 h-3" /> Pause
                  </button>
                ) : (
                  <button className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors">
                    <Play className="w-3 h-3" /> Activate
                  </button>
                )}
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors">
                  <Edit className="w-3 h-3" /> Edit
                </button>
              </div>
            </div>

            {/* Trigger */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-border" style={{ backgroundColor: `${AMBER}08`, borderColor: `${AMBER}30` }}>
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: AMBER }} />
              <div>
                <p className="text-[11px] font-semibold text-foreground mb-0.5">Trigger Condition</p>
                <p className="text-[11px] text-muted-foreground font-mono">{selected.trigger}</p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[
                { label: "Triggered", value: selected.stats.triggered.toLocaleString(), color: "#e2e8f4" },
                { label: "Converted", value: `${selected.stats.converted.toLocaleString()} (${(selected.stats.converted / selected.stats.triggered * 100).toFixed(0)}%)`, color: TEAL },
                { label: "Revenue", value: `$${(selected.stats.revenue / 1000).toFixed(0)}k`, color: AMBER },
              ].map(s => (
                <div key={s.label} className="p-3 rounded-lg border border-border bg-muted/30 text-center">
                  <p className="text-[11px] text-muted-foreground mb-1">{s.label}</p>
                  <p className="text-sm font-semibold font-mono" style={{ color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Workflow visualization */}
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-xs font-semibold text-foreground mb-4">Workflow Steps</h3>
            <div className="space-y-1">
              {selected.steps.map((step, idx) => {
                const cfg = stepTypeConfig[step.type];
                const Icon = cfg.icon;
                const isLast = idx === selected.steps.length - 1;

                return (
                  <div key={step.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border"
                        style={{ backgroundColor: cfg.bg, borderColor: `${cfg.color}40` }}
                      >
                        <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                      </div>
                      {!isLast && (
                        <div className="w-px flex-1 min-h-[20px] mt-1" style={{ backgroundColor: "rgba(148,163,184,0.12)" }} />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: cfg.color }}>{step.type}</span>
                        {step.delay && (
                          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(148,163,184,0.08)", color: "#94a3b8" }}>
                            {step.delay}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-foreground">{step.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{step.detail}</p>
                    </div>
                  </div>
                );
              })}

              {/* End node */}
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border" style={{ backgroundColor: `${TEAL}15`, borderColor: `${TEAL}40` }}>
                  <CheckCircle2 className="w-4 h-4" style={{ color: TEAL }} />
                </div>
                <div className="flex-1 pb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: TEAL }}>END</span>
                  <p className="text-xs font-semibold text-foreground">Playbook Complete</p>
                  <p className="text-[11px] text-muted-foreground">Session marked as recovered or exhausted</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
