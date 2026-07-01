import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { DEFAULT_PINNED } from '../../data'
import { mono } from '../../helpers'
import { CampaignManager } from '../campaignManager'
import { Toggle } from '../toggle'
import { TrendBadge } from '../trendBadge'

export const CompaignBar = ({
  campaigns,
  onToggle,
}: {
  campaigns: Campaign[]
  onToggle: (campaignId: string) => void
}) => {
  const [showCampaignMgr, setShowCampaignMgr] = useState(false)
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(
    new Set(DEFAULT_PINNED)
  )
  const pinnedCampaigns = campaigns.filter((c) => pinnedIds.has(c.id))
  const togglePin = (id: string) =>
    setPinnedIds((p) => {
      const n = new Set(p)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  return (
    <div
      className='relative flex shrink-0 flex-wrap items-center gap-2 border-b border-white/6 px-5 py-2.5'
      style={{ background: '#0f1117' }}
    >
      <span className='mr-1 text-xs text-white/30'>Campaigns</span>
      {pinnedCampaigns.map((c) => (
        <div
          key={c.id}
          className='flex items-center gap-2 rounded-xl border border-white/6 px-3 py-1.5 transition-colors hover:border-white/10'
          style={{ background: '#1a1d26' }}
        >
          <span className='text-xs font-medium text-white/70'>{c.name}</span>
          <div className='flex items-center gap-1'>
            <div
              className={`h-1.5 w-1.5 rounded-full ${c.active ? 'bg-emerald-400 shadow-[0_0_4px_#10b981]' : 'bg-white/15'}`}
            />
            <span
              className='text-xs font-semibold'
              style={{
                ...mono,
                fontSize: '0.62rem',
                color: c.active ? '#10b981' : 'rgba(255,255,255,0.25)',
              }}
            >
              {c.active ? 'ON' : 'OFF'}
            </span>
          </div>
          <Toggle active={c.active} onToggle={() => onToggle(c.id)} />
          <TrendBadge trend={c.trend} active={c.active} />
        </div>
      ))}
      {/* Manage campaigns button */}
      <div className='relative'>
        <button
          onClick={() => setShowCampaignMgr((s) => !s)}
          className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all ${showCampaignMgr ? 'border-blue-500/40 bg-blue-500/10 text-blue-400' : 'border-white/8 text-white/30 hover:border-white/15 hover:text-white/60'}`}
        >
          <Settings2 size={12} />
          <span>
            {campaigns.length - pinnedIds.size > 0
              ? `+${campaigns.length - pinnedIds.size}`
              : 'Manage'}
          </span>
        </button>
        {showCampaignMgr && (
          <CampaignManager
            campaigns={campaigns}
            pinned={pinnedIds}
            onToggleCampaign={onToggle}
            onTogglePin={togglePin}
            onClose={() => setShowCampaignMgr(false)}
          />
        )}
      </div>
    </div>
  )
}
