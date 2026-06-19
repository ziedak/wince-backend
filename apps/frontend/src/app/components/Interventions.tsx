import { Plus, Pause, Play, Edit, BarChart3, Eye, TrendingUp, Zap, X, Tag, Clock, Shield } from "lucide-react";
import { mockInterventions } from "../lib/mockData";
import { useState } from "react";

const TEAL = "#00d4a8";

const typeConfig: Record<string, { label: string; color: string }> = {
  discount: { label: "Discount", color: "#00d4a8" },
  urgency: { label: "Urgency", color: "#f43f5e" },
  social_proof: { label: "Social Proof", color: "#6366f1" },
  reminder: { label: "Reminder", color: "#f59e0b" },
  recommendation: { label: "Recommend", color: "#8b5cf6" },
};

export function Interventions() {
  const [showBuilder, setShowBuilder] = useState(false);

  const totalConversions = mockInterventions.reduce((sum, i) => sum + i.conversions, 0);
  const totalRevenue = mockInterventions.reduce((sum, i) => sum + i.revenue, 0);
  const activeCount = mockInterventions.filter(i => i.status === "active").length;
  const avgCvr = (mockInterventions.reduce((sum, i) => sum + i.conversions / i.views, 0) / mockInterventions.length * 100).toFixed(1);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Interventions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Create and manage cart recovery interventions</p>
        </div>
        <button
          onClick={() => setShowBuilder(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
          style={{ backgroundColor: TEAL, color: "#070d1b" }}
        >
          <Plus className="w-3.5 h-3.5" />
          New Intervention
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Conversions", value: totalConversions.toLocaleString(), color: TEAL },
          { label: "Total Revenue", value: `$${(totalRevenue / 1000).toFixed(0)}k`, color: "#e2e8f4" },
          { label: "Active", value: activeCount, color: "#6366f1" },
          { label: "Avg CVR", value: `${avgCvr}%`, color: "#f59e0b" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{s.label}</p>
            <p className="text-2xl font-semibold font-mono" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Intervention table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Intervention", "Type", "Status", "Views", "CVR", "Revenue", ""].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mockInterventions.map(i => {
                const cvr = (i.conversions / i.views * 100).toFixed(1);
                const type = typeConfig[i.type];

                return (
                  <tr key={i.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-4">
                      <p className="text-xs font-medium text-foreground">{i.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Modified {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(i.lastModified)}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{ backgroundColor: `${type.color}15`, color: type.color }}
                      >
                        {type.label}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {i.status === "active" ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#00d4a8" }}>
                          <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-emerald-400" />
                          Active
                        </span>
                      ) : i.status === "paused" ? (
                        <span className="text-[11px] font-medium text-muted-foreground">Paused</span>
                      ) : (
                        <span className="text-[11px] font-medium text-indigo-400">Draft</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        <Eye className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs font-mono text-foreground">{i.views.toLocaleString()}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground font-mono">{i.conversions} conversions</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-xs font-mono font-semibold text-foreground">{cvr}%</p>
                      <div className="w-12 h-1 rounded-full mt-1 overflow-hidden" style={{ backgroundColor: "rgba(148,163,184,0.12)" }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(parseFloat(cvr) * 2.5, 100)}%`, backgroundColor: TEAL }} />
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-xs font-mono font-semibold text-foreground">${i.revenue.toLocaleString()}</p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1">
                        {i.status === "active" ? (
                          <button className="p-1.5 rounded-lg hover:bg-accent transition-colors" title="Pause">
                            <Pause className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        ) : (
                          <button className="p-1.5 rounded-lg hover:bg-accent transition-colors" title="Activate">
                            <Play className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        )}
                        <button className="p-1.5 rounded-lg hover:bg-accent transition-colors" title="Edit">
                          <Edit className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                        <button className="p-1.5 rounded-lg hover:bg-accent transition-colors" title="Analytics">
                          <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: Tag, label: "Best Performing", name: "Exit Intent Popup", value: "$51,230", sub: "18.1% CVR", color: TEAL },
          { icon: TrendingUp, label: "Fastest Growing", name: "15% First-Time Discount", value: "+24% WoW", sub: "342 conversions", color: "#6366f1" },
          { icon: Shield, label: "Needs Attention", name: "Recommended Products", value: "13.6% CVR", sub: "Paused", color: "#f59e0b" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${s.color}15` }}>
              <s.icon className="w-4 h-4" style={{ color: s.color }} />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{s.label}</p>
              <p className="text-xs font-semibold text-foreground">{s.name}</p>
              <p className="text-sm font-mono font-semibold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[11px] text-muted-foreground">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Builder modal */}
      {showBuilder && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Create New Intervention</h2>
              <button onClick={() => setShowBuilder(false)} className="p-1 rounded hover:bg-accent text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Intervention Name</label>
                <input type="text" placeholder="e.g., Summer Sale 20% Off" className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Intervention Type</label>
                <select className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-muted text-foreground focus:outline-none focus:border-primary/50">
                  <option>Discount</option>
                  <option>Urgency Message</option>
                  <option>Social Proof</option>
                  <option>Reminder</option>
                  <option>Product Recommendation</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Trigger Conditions</label>
                <div className="space-y-2">
                  {["Cart value > $50", "Abandonment probability > 60%", "Time on site > 5 min"].map(c => (
                    <label key={c} className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                      <input type="checkbox" className="rounded border-border" />
                      {c}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Message Template</label>
                <textarea rows={3} placeholder="Enter your intervention message..." className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Display Style</label>
                <select className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-muted text-foreground focus:outline-none focus:border-primary/50">
                  <option>Popup Modal</option>
                  <option>Top Banner</option>
                  <option>Slide-in Panel</option>
                  <option>Inline Message</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end px-5 py-4 border-t border-border">
              <button onClick={() => setShowBuilder(false)} className="px-3 py-2 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent transition-colors">
                Cancel
              </button>
              <button onClick={() => setShowBuilder(false)} className="px-3 py-2 rounded-lg text-xs font-semibold transition-colors" style={{ backgroundColor: TEAL, color: "#070d1b" }}>
                Create Intervention
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
