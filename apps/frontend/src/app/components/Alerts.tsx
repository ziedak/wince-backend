import { AlertTriangle, CheckCircle, XCircle, Info, Activity, Database, Zap, RefreshCw } from "lucide-react";
import { useState } from "react";

interface Alert {
  id: string;
  type: "error" | "warning" | "success" | "info";
  category: "recovery" | "ai" | "traffic" | "system";
  title: string;
  message: string;
  timestamp: Date;
  resolved: boolean;
}

const mockAlerts: Alert[] = [
  { id: "a1", type: "warning", category: "ai", title: "AI Model Confidence Drop", message: "AI prediction confidence decreased by 8% in the last hour. This may indicate data drift or changing user behavior patterns.", timestamp: new Date(Date.now() - 1800000), resolved: false },
  { id: "a2", type: "error", category: "recovery", title: "Intervention Failure Spike", message: "15% discount intervention failing to display for mobile users. 23 potential conversions affected in the last 30 minutes.", timestamp: new Date(Date.now() - 3600000), resolved: false },
  { id: "a3", type: "success", category: "traffic", title: "Traffic Surge Handled", message: "200% increase in traffic detected from social campaign. AI automatically scaled intervention capacity.", timestamp: new Date(Date.now() - 7200000), resolved: true },
  { id: "a4", type: "info", category: "system", title: "Scheduled Maintenance", message: "System maintenance tonight at 2:00 AM PST. Expected downtime: 30 minutes.", timestamp: new Date(Date.now() - 10800000), resolved: false },
  { id: "a5", type: "warning", category: "traffic", title: "Unusual Traffic Pattern", message: "Bot-like behavior detected from 12 IP addresses. Traffic filtering automatically enabled.", timestamp: new Date(Date.now() - 14400000), resolved: true },
];

const alertStyles = {
  error: { icon: XCircle, color: "#f43f5e", bg: "rgba(244,63,94,0.1)", border: "rgba(244,63,94,0.3)" },
  warning: { icon: AlertTriangle, color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)" },
  success: { icon: CheckCircle, color: "#00d4a8", bg: "rgba(0,212,168,0.1)", border: "rgba(0,212,168,0.3)" },
  info: { icon: Info, color: "#6366f1", bg: "rgba(99,102,241,0.1)", border: "rgba(99,102,241,0.3)" },
};

const categoryIcons = { recovery: Zap, ai: Activity, traffic: Activity, system: Database };

const formatTime = (d: Date) => {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
};

export function Alerts() {
  const [alerts, setAlerts] = useState(mockAlerts);
  const active = alerts.filter(a => !a.resolved);
  const resolved = alerts.filter(a => a.resolved);

  const resolve = (id: string) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, resolved: true } : a));

  const systemHealth = [
    { label: "API Response Time", status: "Healthy", value: "124ms", pct: 95, color: "#00d4a8" },
    { label: "AI Model Performance", status: "Degraded", value: "78% accuracy", pct: 78, color: "#f59e0b" },
    { label: "Database Connectivity", status: "Healthy", value: "All stable", pct: 100, color: "#00d4a8" },
    { label: "Webhook Delivery", status: "Healthy", value: "99.7% success", pct: 99.7, color: "#00d4a8" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Alerts & Operations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">System health monitoring and operational issues</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Critical", value: alerts.filter(a => !a.resolved && a.type === "error").length, color: "#f43f5e" },
          { label: "Warnings", value: alerts.filter(a => !a.resolved && a.type === "warning").length, color: "#f59e0b" },
          { label: "Info", value: alerts.filter(a => !a.resolved && a.type === "info").length, color: "#6366f1" },
          { label: "Resolved", value: resolved.length, color: "#00d4a8" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{s.label}</p>
            <p className="text-2xl font-semibold font-mono" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* System health */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">System Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {systemHealth.map(h => (
            <div key={h.label}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-foreground">{h.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-muted-foreground">{h.value}</span>
                  <span className="text-[11px] font-medium" style={{ color: h.color }}>{h.status}</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(148,163,184,0.1)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${h.pct}%`, backgroundColor: h.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active alerts */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Active Alerts</h2>
          {active.length > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(244,63,94,0.15)", color: "#f43f5e" }}>
              {active.length} unresolved
            </span>
          )}
        </div>
        <div className="divide-y divide-border">
          {active.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle className="w-8 h-8 mx-auto mb-2" style={{ color: "#00d4a8" }} />
              <p className="text-sm text-muted-foreground">No active alerts. All systems operational.</p>
            </div>
          ) : (
            active.map(alert => {
              const style = alertStyles[alert.type];
              const Icon = style.icon;
              const CatIcon = categoryIcons[alert.category];

              return (
                <div key={alert.id} className="px-5 py-4 border-l-2" style={{ borderLeftColor: style.color }}>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: style.bg }}>
                      <Icon className="w-4 h-4" style={{ color: style.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-xs font-semibold text-foreground">{alert.title}</h3>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium capitalize" style={{ backgroundColor: style.bg, color: style.color }}>
                            <CatIcon className="w-3 h-3" />
                            {alert.category}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap font-mono">{formatTime(alert.timestamp)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-3">{alert.message}</p>
                      <div className="flex gap-2">
                        <button className="px-2.5 py-1 rounded-lg text-[11px] font-semibold" style={{ backgroundColor: "#00d4a8", color: "#070d1b" }}>
                          Investigate
                        </button>
                        <button
                          onClick={() => resolve(alert.id)}
                          className="px-2.5 py-1 border border-border rounded-lg text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors"
                        >
                          Mark Resolved
                        </button>
                        <button className="px-2.5 py-1 border border-border rounded-lg text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors">
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Resolved */}
      {resolved.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Recently Resolved</h2>
          </div>
          <div className="divide-y divide-border">
            {resolved.map(alert => {
              const style = alertStyles[alert.type];
              const Icon = style.icon;

              return (
                <div key={alert.id} className="px-5 py-4 opacity-50 hover:opacity-100 transition-opacity">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: style.bg }}>
                      <Icon className="w-4 h-4" style={{ color: style.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-xs font-semibold text-foreground">{alert.title}</h3>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "rgba(0,212,168,0.1)", color: "#00d4a8" }}>
                          <CheckCircle className="w-2.5 h-2.5" /> Resolved
                        </span>
                        <span className="text-[11px] text-muted-foreground font-mono ml-auto">{formatTime(alert.timestamp)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{alert.message}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
