export const mono = { fontFamily: "var(--font-mono)" } as const;
export const funnelColor = (h: "good" | "warn" | "danger") => h === "danger" ? "#ef4444" : h === "warn" ? "#f59e0b" : "#10b981";
export const anomalyMeta = (s: AnomalyItem["status"]) =>
  s === "active"     ? { dot: "bg-red-500 animate-pulse",   text: "text-red-400",     label: "⚡ Active" } :
  s === "monitoring" ? { dot: "bg-amber-400",               text: "text-amber-400",   label: "👁 Monitoring" } :
                       { dot: "bg-emerald-400",             text: "text-emerald-400", label: "✓ Resolved" };
