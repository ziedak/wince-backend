import { TrendingUp, TrendingDown } from "lucide-react";
import { mono } from "../helpers";

export function TrendBadge({ trend, active }: { trend: number | null; active: boolean }) {
  if (!active || trend === null) return null;
  const up = trend > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold ${up ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`} style={{ ...mono, fontSize: "0.6rem" }}>
      {up ? <TrendingUp size={8} /> : <TrendingDown size={8} />}{up ? "+" : ""}{trend}%
    </span>
  );
}
