import { X, Pin, PinOff } from "lucide-react";
import { TrendBadge } from "./trendBadge";
import { Toggle } from "./toggle";

export function CampaignManager({
  campaigns, pinned, onToggleCampaign, onTogglePin, onClose,
}: {
  campaigns: Campaign[];
  pinned: Set<string>;
  onToggleCampaign: (id: string) => void;
  onTogglePin: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute left-0 z-40 mt-2 overflow-hidden border shadow-2xl top-full rounded-xl border-white/8" style={{ background: "#13161d", width: 320 }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/6">
          <span className="text-xs font-semibold text-white">Manage Campaigns</span>
          <button onClick={onClose} className="p-1 transition-colors rounded-lg hover:bg-white/6 text-white/40 hover:text-white"><X size={13} /></button>
        </div>
        <div className="py-1 overflow-y-auto max-h-72 scrollbar-hide">
          {campaigns.map((c) => {
            const isPinned = pinned.has(c.id);
            return (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03] group transition-colors">
                {/* Pin toggle */}
                <button
                  onClick={() => onTogglePin(c.id)}
                  className={`shrink-0 transition-colors ${isPinned ? "text-blue-400" : "text-white/15 hover:text-white/40"}`}
                  title={isPinned ? "Unpin from bar" : "Pin to bar"}
                >
                  {isPinned ? <Pin size={12} /> : <PinOff size={12} />}
                </button>
                {/* Name */}
                <span className={`flex-1 text-xs font-medium ${isPinned ? "text-white/80" : "text-white/40"}`}>{c.name}</span>
                {/* Trend */}
                <TrendBadge trend={c.trend} active={c.active} />
                {/* On/off toggle */}
                <Toggle active={c.active} onToggle={() => onToggleCampaign(c.id)} />
              </div>
            );
          })}
        </div>
        <div className="px-4 py-2.5 border-t border-white/6 flex items-center gap-1.5 text-xs text-white/25">
          <Pin size={10} className="text-blue-400/60" />
          <span>Pinned campaigns appear in the top bar</span>
        </div>
      </div>
    </>
  );
}
