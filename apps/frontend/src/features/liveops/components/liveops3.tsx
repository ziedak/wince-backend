import { useState, useEffect, useRef } from 'react'
import {
  Zap,
  ChevronDown,
  Terminal,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Shield,
  FlaskConical,
  FileText,
  Plus,
  Pause,
  Play,
  SlidersHorizontal,
  CheckSquare,
  Square,
  X,
  ArrowRight,
  ShoppingCart,
  Monitor,
  Smartphone,
  CreditCard,
  Home,
  Package,
  MousePointer2,
  CheckCircle,
  Pin,
  PinOff,
  Settings2,
} from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { SidebarMenu } from '@/components/ui/sidebar'
import {
  DrawerController,
  DrawerTrigger,
} from '@/components/custom/genericDrawer'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string
  name: string
  active: boolean
  trend: number | null
}
interface AnomalyItem {
  time: string
  event: string
  status: 'active' | 'monitoring' | 'resolved'
}
interface ApprovalSubItem {
  sid: string
  visitor: string
  cart: number
  stage: string
  device: 'mobile' | 'desktop'
}
interface PendingApproval {
  id: string
  title: string
  batchCount: number
  cost: number
  est: number
  extra?: string
  description: string
  items: ApprovalSubItem[]
}
interface ExceptionItem {
  id: string
  level: 'vip' | 'high'
  label: string
  cart: number
  confidence: number
  reason: string
}
interface DrawerSession {
  id: string
  name: string
  cart: number
  risk: number
  device: 'mobile' | 'desktop'
  stage: string
}

// stageSeconds: time spent in current funnel stage — the urgency dimension
// aiStatus: what the AI is doing for this session — the triage dimension
// pendingAction: brief description of active/proposed AI action
interface ActiveSession {
  id: string
  visitor: string
  cart: number
  stage: 'Product' | 'Cart' | 'Checkout'
  device: 'mobile' | 'desktop'
  risk: number
  signal: string
  stageSeconds: number
  aiStatus: 'exception' | 'pending' | 'auto' | 'none'
  pendingAction?: string
}

interface AutoDecision {
  time: string
  visitor: string
  action: string
  detail: string
  status: 'auto' | 'held'
}

// ─── AI Status Meta ───────────────────────────────────────────────────────────
// Module-level so SessionCard can reference without prop-drilling

const AI_STATUS_META = {
  exception: {
    label: 'Exception',
    textCls: 'text-red-400',
    borderCls: 'border-red-500/25',
    bgCls: 'bg-red-500/10',
  },
  pending: {
    label: 'Pending',
    textCls: 'text-blue-400',
    borderCls: 'border-blue-500/25',
    bgCls: 'bg-blue-500/10',
  },
  auto: {
    label: 'AI active',
    textCls: 'text-emerald-400',
    borderCls: 'border-emerald-500/25',
    bgCls: 'bg-emerald-500/10',
  },
  none: {
    label: 'No action',
    textCls: 'text-white/25',
    borderCls: 'border-white/10',
    bgCls: 'bg-white/[0.03]',
  },
} as const

// ─── Static Data ──────────────────────────────────────────────────────────────

const ALL_CAMPAIGNS: Campaign[] = [
  { id: 'summer', name: 'Summer Disc', active: true, trend: 12 },
  { id: 'freeship', name: 'Free Ship', active: true, trend: -4 },
  { id: 'exitpop', name: 'Exit Popup', active: false, trend: null },
  { id: 'cart', name: 'Cart Remind', active: true, trend: 3 },
  { id: 'loyalty', name: 'Loyalty Reward', active: true, trend: 7 },
  { id: 'flash', name: 'Flash Sale', active: false, trend: null },
  { id: 'vip', name: 'VIP Early Access', active: true, trend: 21 },
  { id: 'bundle', name: 'Bundle Offer', active: false, trend: -2 },
  { id: 'referral', name: 'Referral Bonus', active: true, trend: 5 },
]

const DEFAULT_PINNED = new Set(['summer', 'freeship', 'exitpop', 'cart'])

const FUNNEL = [
  {
    label: 'Homepage',
    count: 1244,
    pct: 100,
    drop: null,
    health: 'good' as const,
  },
  { label: 'Product', count: 814, pct: 65, drop: 82, health: 'good' as const },
  { label: 'Cart', count: 238, pct: 19, drop: 38, health: 'warn' as const },
  { label: 'Checkout', count: 71, pct: 6, drop: 29, health: 'danger' as const },
  { label: 'Purchase', count: 51, pct: 4, drop: 72, health: 'good' as const },
]

const ANOMALIES: AnomalyItem[] = [
  {
    time: '14:22',
    event: 'Mobile checkout drop −12% vs. baseline',
    status: 'active',
  },
  {
    time: '14:25',
    event: 'New bot‑like pattern detected',
    status: 'monitoring',
  },
  { time: '14:28', event: 'Model confidence recovering', status: 'resolved' },
]

// ── Active Sessions: the primary operational surface ──────────────────────────
// Sorted by risk desc. Each session carries:
//   stageSeconds — time in current stage (urgency signal)
//   aiStatus     — what the AI is doing right now (triage signal)
//   pendingAction — brief AI action context shown inline on card

const ACTIVE_SESSIONS: ActiveSession[] = [
  {
    id: 'K9L0',
    visitor: 'Priya K.',
    cart: 890,
    stage: 'Checkout',
    device: 'mobile',
    risk: 87,
    signal: 'VIP — low AI confidence',
    stageSeconds: 374,
    aiStatus: 'exception',
    pendingAction: 'Free shipping recommended — review needed',
  },
  {
    id: 'A1F2',
    visitor: 'Guest #A1F2',
    cart: 320,
    stage: 'Checkout',
    device: 'mobile',
    risk: 84,
    signal: 'Exit intent detected',
    stageSeconds: 168,
    aiStatus: 'pending',
    pendingAction: 'Free shipping — awaiting your approval',
  },
  {
    id: 'T7U8',
    visitor: 'James L.',
    cart: 420,
    stage: 'Checkout',
    device: 'desktop',
    risk: 78,
    signal: 'Dwell on shipping cost',
    stageSeconds: 242,
    aiStatus: 'pending',
    pendingAction: '5% loyalty discount — awaiting your approval',
  },
  {
    id: 'M1N2',
    visitor: 'Guest #M1N2',
    cart: 190,
    stage: 'Cart',
    device: 'mobile',
    risk: 73,
    signal: 'Price hesitation',
    stageSeconds: 93,
    aiStatus: 'auto',
    pendingAction: 'Urgency banner active',
  },
  {
    id: 'V9W0',
    visitor: 'Priya N.',
    cart: 360,
    stage: 'Cart',
    device: 'mobile',
    risk: 68,
    signal: 'Repeated cart edits',
    stageSeconds: 197,
    aiStatus: 'pending',
    pendingAction: '5% loyalty discount — awaiting your approval',
  },
  {
    id: 'B3C4',
    visitor: 'Sarah M.',
    cart: 210,
    stage: 'Checkout',
    device: 'mobile',
    risk: 64,
    signal: 'Mobile checkout drop',
    stageSeconds: 115,
    aiStatus: 'pending',
    pendingAction: 'Free shipping — awaiting your approval',
  },
  {
    id: 'D5E6',
    visitor: 'Guest #D5E6',
    cart: 178,
    stage: 'Cart',
    device: 'mobile',
    risk: 59,
    signal: 'Tab switching detected',
    stageSeconds: 47,
    aiStatus: 'auto',
    pendingAction: 'Urgency banner active',
  },
  {
    id: 'G7H8',
    visitor: 'Tom R.',
    cart: 155,
    stage: 'Checkout',
    device: 'mobile',
    risk: 54,
    signal: 'Coupon field focus',
    stageSeconds: 131,
    aiStatus: 'none',
    pendingAction: undefined,
  },
  {
    id: 'P3Q4',
    visitor: 'Aisha K.',
    cart: 210,
    stage: 'Checkout',
    device: 'mobile',
    risk: 51,
    signal: 'Exit intent detected',
    stageSeconds: 63,
    aiStatus: 'auto',
    pendingAction: 'Urgency banner active',
  },
]

const PENDING_INIT: PendingApproval[] = [
  {
    id: 'p1',
    title: 'Free Shipping for carts >$150',
    batchCount: 4,
    cost: 0,
    est: 1120,
    description:
      'AI flagged 4 sessions where free shipping has >88% confidence of recovery. All are mobile users hesitating at checkout.',
    items: [
      {
        sid: 'A1F2',
        visitor: 'Guest #A1F2',
        cart: 320,
        stage: 'Checkout',
        device: 'mobile',
      },
      {
        sid: 'B3C4',
        visitor: 'Sarah M.',
        cart: 210,
        stage: 'Checkout',
        device: 'mobile',
      },
      {
        sid: 'D5E6',
        visitor: 'Guest #D5E6',
        cart: 178,
        stage: 'Cart',
        device: 'mobile',
      },
      {
        sid: 'G7H8',
        visitor: 'Tom R.',
        cart: 155,
        stage: 'Checkout',
        device: 'mobile',
      },
    ],
  },
  {
    id: 'p2',
    title: '10% Discount — first‑time visitor',
    batchCount: 1,
    cost: 28,
    est: 312,
    extra: 'cart $340',
    description:
      'Single high-value first-time visitor on desktop, price-comparing. 10% discount keeps margin positive.',
    items: [
      {
        sid: 'K9L0',
        visitor: 'Guest #K9L0',
        cart: 340,
        stage: 'Product',
        device: 'desktop',
      },
    ],
  },
  {
    id: 'p3',
    title: 'Urgency banner — exit intent (mobile)',
    batchCount: 3,
    cost: 0,
    est: 540,
    description:
      "3 mobile sessions showing exit intent signals. Zero-cost urgency message ('Only 2 left') recommended.",
    items: [
      {
        sid: 'M1N2',
        visitor: 'Guest #M1N2',
        cart: 190,
        stage: 'Cart',
        device: 'mobile',
      },
      {
        sid: 'P3Q4',
        visitor: 'Aisha K.',
        cart: 210,
        stage: 'Checkout',
        device: 'mobile',
      },
      {
        sid: 'R5S6',
        visitor: 'Guest #R5S6',
        cart: 140,
        stage: 'Cart',
        device: 'mobile',
      },
    ],
  },
  {
    id: 'p4',
    title: '5% Loyalty discount — returning buyers',
    batchCount: 2,
    cost: 44,
    est: 780,
    extra: 'carts >$200',
    description:
      "2 returning customers who haven't triggered the loyalty tier yet. Small discount nudges them to purchase.",
    items: [
      {
        sid: 'T7U8',
        visitor: 'James L.',
        cart: 420,
        stage: 'Checkout',
        device: 'desktop',
      },
      {
        sid: 'V9W0',
        visitor: 'Priya N.',
        cart: 360,
        stage: 'Cart',
        device: 'mobile',
      },
    ],
  },
  {
    id: 'p5',
    title: 'Free express shipping — VIP segment',
    batchCount: 1,
    cost: 18,
    est: 890,
    extra: 'cart $890',
    description:
      'High-LTV VIP customer with cross-border pricing concern. Express shipping removes last friction point.',
    items: [
      {
        sid: 'X1Y2',
        visitor: 'Priya K.',
        cart: 890,
        stage: 'Checkout',
        device: 'mobile',
      },
    ],
  },
  {
    id: 'p6',
    title: 'Abandoned cart reminder — 2h delay',
    batchCount: 6,
    cost: 0,
    est: 430,
    description:
      '6 sessions that left without purchasing. Scheduled reminder at 2h window has 61% open rate for this segment.',
    items: [
      {
        sid: 'Z3A4',
        visitor: 'Guest #Z3A4',
        cart: 95,
        stage: 'Cart',
        device: 'desktop',
      },
      {
        sid: 'B5C6',
        visitor: 'Lena W.',
        cart: 78,
        stage: 'Cart',
        device: 'mobile',
      },
      {
        sid: 'D7E8',
        visitor: 'Guest #D7E8',
        cart: 110,
        stage: 'Cart',
        device: 'desktop',
      },
      {
        sid: 'F9G0',
        visitor: 'Omar S.',
        cart: 64,
        stage: 'Cart',
        device: 'mobile',
      },
      {
        sid: 'H1I2',
        visitor: 'Guest #H1I2',
        cart: 52,
        stage: 'Cart',
        device: 'mobile',
      },
      {
        sid: 'J3K4',
        visitor: 'Nina T.',
        cart: 88,
        stage: 'Cart',
        device: 'desktop',
      },
    ],
  },
]

const EXCEPTIONS: ExceptionItem[] = [
  {
    id: 'e1',
    level: 'vip',
    label: 'VIP customer (LTV $4,200)',
    cart: 890,
    confidence: 54,
    reason: 'Cross‑border pricing anomaly',
  },
  {
    id: 'e2',
    level: 'high',
    label: 'High‑value + first‑time visitor',
    cart: 340,
    confidence: 68,
    reason: 'Unusual session pattern',
  },
]

const RECOVERIES = [
  '+$48',
  '+$73',
  '+$31',
  '+$18',
  '+$52',
  '+$67',
  '+$29',
  '+$94',
  '+$55',
  '+$140',
  '+$220',
]

const AI_ADAPTATIONS = [
  'Detected mobile shipping hesitation → auto‑deployed express shipping promo',
  'Flagged bot‑like behaviour on gift card page → paused interventions for segment',
]

const AUTO_DECISIONS: AutoDecision[] = [
  {
    time: '14:28',
    visitor: 'Guest #R5S6',
    action: 'Urgency banner',
    detail: 'Exit intent — zero cost',
    status: 'auto',
  },
  {
    time: '14:27',
    visitor: 'Aisha K.',
    action: 'Free shipping',
    detail: 'Mobile checkout hesitation',
    status: 'auto',
  },
  {
    time: '14:25',
    visitor: 'Guest #F1A0',
    action: '10% disc — held',
    detail: 'Exceeds safety budget',
    status: 'held',
  },
  {
    time: '14:24',
    visitor: 'Lena W.',
    action: 'Cart reminder',
    detail: 'Queued 2h delay',
    status: 'auto',
  },
  {
    time: '14:23',
    visitor: 'John D.',
    action: 'Free shipping',
    detail: 'Tier‑1, margin‑safe',
    status: 'auto',
  },
  {
    time: '14:22',
    visitor: 'Guest #A3C2',
    action: 'Urgency message',
    detail: 'Cart >$200, exit intent',
    status: 'auto',
  },
  {
    time: '14:21',
    visitor: 'Omar S.',
    action: 'VIP offer — held',
    detail: 'Confidence below 60%',
    status: 'held',
  },
  {
    time: '14:19',
    visitor: 'Nina T.',
    action: 'Bundle cross‑sell',
    detail: 'High-margin add-on',
    status: 'auto',
  },
]

const DRAWER_SESSION: DrawerSession = {
  id: '2401',
  name: 'Priya K.',
  cart: 890,
  risk: 87,
  device: 'mobile',
  stage: 'Checkout',
}

const DRAWER_TIMELINE = [
  {
    icon: Home,
    label: 'Landed on Homepage',
    note: 'Via Google Shopping ad',
    time: '14:08',
    color: '#10b981',
  },
  {
    icon: Package,
    label: 'Viewed product page',
    note: '3 min 20s — high engagement',
    time: '14:12',
    color: '#10b981',
  },
  {
    icon: ShoppingCart,
    label: 'Added to cart',
    note: '$890 item',
    time: '14:16',
    color: '#f59e0b',
  },
  {
    icon: CreditCard,
    label: 'Reached checkout',
    note: 'Paused 6s on shipping cost',
    time: '14:21',
    color: '#ef4444',
  },
  {
    icon: MousePointer2,
    label: 'Exit intent fired',
    note: 'Mobile swipe‑up gesture',
    time: '14:22',
    color: '#ef4444',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mono = { fontFamily: 'var(--font-mono)' } as const
const funnelColor = (h: 'good' | 'warn' | 'danger') =>
  h === 'danger' ? '#ef4444' : h === 'warn' ? '#f59e0b' : '#10b981'
const riskColor = (r: number) =>
  r >= 80 ? '#ef4444' : r >= 60 ? '#f59e0b' : 'rgba(255,255,255,0.35)'
const anomalyMeta = (s: AnomalyItem['status']) =>
  s === 'active'
    ? {
        dot: 'bg-red-500 animate-pulse',
        text: 'text-red-400',
        label: '⚡ Active',
      }
    : s === 'monitoring'
      ? { dot: 'bg-amber-400', text: 'text-amber-400', label: '👁 Monitoring' }
      : { dot: 'bg-emerald-400', text: 'text-emerald-400', label: '✓ Resolved' }

// Convert seconds to "Xm YYs" for display in session cards
const formatStageTime = (secs: number): string => {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({
  active,
  onToggle,
}: {
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-[18px] w-8 items-center rounded-full transition-all duration-200 ${active ? 'bg-blue-500' : 'bg-white/10'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${active ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

function TrendBadge({
  trend,
  active,
}: {
  trend: number | null
  active: boolean
}) {
  if (!active || trend === null) return null
  const up = trend > 0
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}
      style={{ ...mono, fontSize: '0.6rem' }}
    >
      {up ? <TrendingUp size={8} /> : <TrendingDown size={8} />}
      {up ? '+' : ''}
      {trend}%
    </span>
  )
}

// ─── Recovery Ticker ──────────────────────────────────────────────────────────

function RecoveryTicker() {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const id = setInterval(
      () => setOffset((o) => (o + 0.4) % (RECOVERIES.length * 68)),
      25
    )
    return () => clearInterval(id)
  }, [])
  return (
    <div
      className='flex items-center gap-3 px-4 py-2 overflow-hidden shrink-0'
      style={{ background: '#080a10' }}
    >
      <span
        className='shrink-0 tracking-[0.15em] text-emerald-400/50 uppercase'
        style={{ ...mono, fontSize: '0.58rem' }}
      >
        Recovered
      </span>
      <div className='flex-1 overflow-hidden'>
        <div
          className='flex gap-6'
          style={{
            transform: `translateX(-${offset}px)`,
            willChange: 'transform',
          }}
        >
          {[...RECOVERIES, ...RECOVERIES, ...RECOVERIES, ...RECOVERIES].map(
            (v, i) => (
              <span
                key={i}
                className='font-semibold shrink-0 text-emerald-400'
                style={{
                  ...mono,
                  fontSize: '0.75rem',
                  textShadow: '0 0 8px rgba(16,185,129,0.4)',
                }}
              >
                {v}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sensitivity Slider ───────────────────────────────────────────────────────

function SensitivitySlider() {
  const [value, setValue] = useState(50)
  const [open, setOpen] = useState(false)
  const label =
    value < 34 ? 'Conservative' : value < 67 ? 'Balanced' : 'Aggressive'
  return (
    <div className='relative'>
      <button
        onClick={() => setOpen((s) => !s)}
        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${open ? 'border-blue-500/50 bg-blue-500/10 text-blue-400' : 'border-white/8 bg-white/4 text-white/60 hover:border-white/15 hover:text-white/80'}`}
      >
        <SlidersHorizontal size={13} /> Adjust Sensitivity
      </button>
      {open && (
        <div
          className='absolute left-0 z-40 w-64 p-4 mt-2 border shadow-2xl top-full rounded-xl border-white/8'
          style={{ background: '#13161d' }}
        >
          <div className='flex items-center justify-between mb-3'>
            <span className='text-xs font-semibold text-white'>
              AI Sensitivity
            </span>
            <span className='text-xs font-semibold text-blue-400' style={mono}>
              {label}
            </span>
          </div>
          <input
            type='range'
            min={0}
            max={100}
            value={value}
            onChange={(e) => setValue(+e.target.value)}
            className='w-full mb-2 accent-blue-500'
          />
          <div
            className='flex justify-between text-white/30'
            style={{ fontSize: '0.62rem' }}
          >
            <span>Conservative</span>
            <span>Balanced</span>
            <span>Aggressive</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Campaign Manager Popover ─────────────────────────────────────────────────

function CampaignManager({
  campaigns,
  pinned,
  onToggleCampaign,
  onTogglePin,
  onClose,
}: {
  campaigns: Campaign[]
  pinned: Set<string>
  onToggleCampaign: (id: string) => void
  onTogglePin: (id: string) => void
  onClose: () => void
}) {
  return (
    <>
      <div className='fixed inset-0 z-30' onClick={onClose} />
      <div
        className='absolute left-0 z-40 mt-2 overflow-hidden border shadow-2xl top-full rounded-xl border-white/8'
        style={{ background: '#13161d', width: 320 }}
      >
        <div className='flex items-center justify-between px-4 py-3 border-b border-white/6'>
          <span className='text-xs font-semibold text-white'>
            Manage Campaigns
          </span>
          <button
            onClick={onClose}
            className='p-1 transition-colors rounded-lg text-white/40 hover:bg-white/6 hover:text-white'
          >
            <X size={13} />
          </button>
        </div>
        <div className='py-1 overflow-y-auto scrollbar-hide max-h-72'>
          {campaigns.map((c) => {
            const isPinned = pinned.has(c.id)
            return (
              <div
                key={c.id}
                className='flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.03]'
              >
                <button
                  onClick={() => onTogglePin(c.id)}
                  className={`shrink-0 transition-colors ${isPinned ? 'text-blue-400' : 'text-white/15 hover:text-white/40'}`}
                  title={isPinned ? 'Unpin from bar' : 'Pin to bar'}
                >
                  {isPinned ? <Pin size={12} /> : <PinOff size={12} />}
                </button>
                <span
                  className={`flex-1 text-xs font-medium ${isPinned ? 'text-white/80' : 'text-white/40'}`}
                >
                  {c.name}
                </span>
                <TrendBadge trend={c.trend} active={c.active} />
                <Toggle
                  active={c.active}
                  onToggle={() => onToggleCampaign(c.id)}
                />
              </div>
            )
          })}
        </div>
        <div
          className='flex items-center gap-1.5 border-t border-white/6 px-4 py-2.5 text-white/25'
          style={{ fontSize: '0.65rem' }}
        >
          <Pin size={10} className='text-blue-400/60' />
          <span>Pinned campaigns appear in the top bar</span>
        </div>
      </div>
    </>
  )
}

// ─── Approval Drawer ──────────────────────────────────────────────────────────

function ApprovalDrawer({
  item,
  onClose,
  onApprove,
  onDeny,
}: {
  item: PendingApproval | null
  onClose: () => void
  onApprove: (id: string, sids: string[]) => void
  onDeny: (id: string) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (item) setSelected(new Set(item.items.map((x) => x.sid)))
  }, [item?.id])
  if (!item) return null

  const toggleSid = (sid: string) =>
    setSelected((p) => {
      const n = new Set(p)
      n.has(sid) ? n.delete(sid) : n.add(sid)
      return n
    })
  const allSelected = selected.size === item.items.length
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(item.items.map((x) => x.sid)))
  const avgCart = item.items.reduce((a, b) => a + b.cart, 0) / item.items.length
  const selectedEst = item.items
    .filter((x) => selected.has(x.sid))
    .reduce(
      (s, x) =>
        s + Math.round((item.est / item.batchCount) * (x.cart / avgCart)),
      0
    )

  return (
    <>
      <div
        className='fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]'
        onClick={onClose}
      />
      <div
        className='fixed top-0 bottom-0 right-0 z-50 flex flex-col border-l shadow-2xl border-white/8'
        style={{ width: 400, background: '#13161d' }}
      >
        <div className='flex items-start justify-between px-5 py-4 border-b shrink-0 border-white/6'>
          <div className='flex-1 min-w-0 pr-3'>
            <div
              className='mb-1 font-semibold tracking-widest uppercase text-white/35'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              Pending Approval
            </div>
            <div className='text-sm font-semibold leading-snug text-white'>
              {item.title}
            </div>
          </div>
          <button
            onClick={onClose}
            className='shrink-0 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/6 hover:text-white'
          >
            <X size={15} />
          </button>
        </div>
        <div className='px-5 py-3 border-b shrink-0 border-white/6'>
          <p
            className='leading-relaxed text-white/45'
            style={{ fontSize: '0.72rem' }}
          >
            {item.description}
          </p>
          <div
            className='mt-2.5 flex items-center gap-3 text-white/30'
            style={{ fontSize: '0.72rem' }}
          >
            {item.cost > 0 && (
              <span>
                Cost{' '}
                <span className='font-semibold text-white/60' style={mono}>
                  ${item.cost}
                </span>
              </span>
            )}
            <span>
              Est. recovery{' '}
              <span className='font-semibold text-emerald-400' style={mono}>
                +${item.est.toLocaleString()}
              </span>
            </span>
          </div>
        </div>
        <div className='flex-1 overflow-y-auto scrollbar-hide'>
          <div className='flex items-center gap-3 border-b border-white/5 bg-white/[0.01] px-5 py-2.5'>
            <button
              onClick={toggleAll}
              className='transition-colors shrink-0 text-white/30 hover:text-white/60'
            >
              {allSelected ? (
                <CheckSquare size={13} className='text-blue-400' />
              ) : (
                <Square size={13} />
              )}
            </button>
            <span
              className='font-medium text-white/35'
              style={{ fontSize: '0.72rem' }}
            >
              Select all ({item.items.length})
            </span>
            {selected.size > 0 && selected.size < item.items.length && (
              <span
                className='text-white/25'
                style={{ ...mono, fontSize: '0.68rem' }}
              >
                {selected.size} of {item.items.length}
              </span>
            )}
          </div>
          {item.items.map((sub, idx) => {
            const isSel = selected.has(sub.sid)
            const isLast = idx === item.items.length - 1
            return (
              <div
                key={sub.sid}
                onClick={() => toggleSid(sub.sid)}
                className={`flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors ${!isLast ? 'border-b border-white/4' : ''} ${isSel ? 'bg-blue-500/6' : 'hover:bg-white/[0.02]'}`}
              >
                <div className='shrink-0 text-white/25'>
                  {isSel ? (
                    <CheckSquare size={13} className='text-blue-400' />
                  ) : (
                    <Square size={13} />
                  )}
                </div>
                <div className='flex-1 min-w-0'>
                  <div className='mb-0.5 flex items-center gap-2'>
                    <span className='text-xs font-medium text-white/80'>
                      {sub.visitor}
                    </span>
                    <span
                      className='text-white/25'
                      style={{ ...mono, fontSize: '0.62rem' }}
                    >
                      #{sub.sid}
                    </span>
                  </div>
                  <div
                    className='flex items-center gap-2 text-white/30'
                    style={{ fontSize: '0.65rem' }}
                  >
                    {sub.device === 'mobile' ? (
                      <Smartphone size={9} />
                    ) : (
                      <Monitor size={9} />
                    )}
                    <span className='capitalize'>{sub.device}</span>
                    <span>·</span>
                    <span>{sub.stage}</span>
                  </div>
                </div>
                <span
                  className='text-xs font-semibold shrink-0 text-white/60'
                  style={mono}
                >
                  ${sub.cart}
                </span>
              </div>
            )
          })}
        </div>
        <div
          className='flex flex-col gap-2 px-5 py-4 border-t shrink-0 border-white/6'
          style={{ background: '#0f1117' }}
        >
          {selected.size > 0 && (
            <div className='mb-1 text-white/30' style={{ fontSize: '0.72rem' }}>
              Approving{' '}
              <span className='font-semibold text-white/60' style={mono}>
                {selected.size}
              </span>{' '}
              session{selected.size > 1 ? 's' : ''} · est.{' '}
              <span className='font-semibold text-emerald-400' style={mono}>
                +${selectedEst.toLocaleString()}
              </span>
            </div>
          )}
          <div className='flex gap-2'>
            <button
              disabled={selected.size === 0}
              onClick={() => {
                onApprove(item.id, [...selected])
                onClose()
              }}
              className='flex-1 rounded-xl bg-blue-500 py-2.5 text-xs font-semibold text-white transition-all hover:bg-blue-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30'
            >
              Approve{' '}
              {selected.size > 0
                ? `${selected.size === item.items.length ? 'all ' : ''}${selected.size}`
                : ''}
            </button>
            <button
              onClick={() => {
                onDeny(item.id)
                onClose()
              }}
              className='rounded-xl border border-white/8 px-5 py-2.5 text-xs text-white/40 transition-all hover:border-white/15 hover:text-white/60'
            >
              Deny all
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Visitor Drawer ───────────────────────────────────────────────────────────

function VisitorDrawer({
  session,
  onClose,
}: {
  session: DrawerSession | null
  onClose: () => void
}) {
  const [launched, setLaunched] = useState(false)
  if (!session) return null
  return (
    <>
      <div
        className='fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]'
        onClick={onClose}
      />
      <div
        className='fixed top-0 bottom-0 right-0 z-50 flex flex-col overflow-hidden border-l shadow-2xl border-white/8'
        style={{ width: 380, background: '#13161d' }}
      >
        <div className='flex items-center justify-between px-5 py-4 border-b border-white/6'>
          <div className='flex items-center gap-2.5'>
            <div
              className='flex items-center justify-center w-8 h-8 text-xs font-bold text-blue-400 border rounded-full border-blue-500/30 bg-blue-500/20'
              style={mono}
            >
              {session.name
                .split(' ')
                .map((n) => n[0])
                .join('')}
            </div>
            <div>
              <div className='text-sm font-semibold text-white'>
                {session.name}
              </div>
              <div
                className='text-white/40'
                style={{ ...mono, fontSize: '0.68rem' }}
              >
                #{session.id}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className='rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/6 hover:text-white'
          >
            <X size={15} />
          </button>
        </div>
        <div className='flex flex-col flex-1 gap-5 px-5 py-4 overflow-y-auto scrollbar-hide'>
          <div className='rounded-xl border border-red-500/20 bg-red-500/6 p-3.5'>
            <div className='flex items-start justify-between mb-2'>
              <div className='flex flex-col gap-1.5'>
                <div className='flex items-center gap-2'>
                  <ShoppingCart size={13} className='text-red-400' />
                  <span
                    className='text-white/50'
                    style={{ fontSize: '0.72rem' }}
                  >
                    Cart
                  </span>
                  <span className='text-base font-bold text-white' style={mono}>
                    ${session.cart}
                  </span>
                </div>
                <div
                  className='flex items-center gap-2 text-white/40'
                  style={{ fontSize: '0.72rem' }}
                >
                  {session.device === 'mobile' ? (
                    <Smartphone size={11} />
                  ) : (
                    <Monitor size={11} />
                  )}
                  <span className='capitalize'>{session.device}</span>
                  <span>·</span>
                  <span>{session.stage}</span>
                </div>
              </div>
              <div className='text-right'>
                <div className='text-xl font-bold text-red-400' style={mono}>
                  {session.risk}%
                </div>
                <div className='text-white/40' style={{ fontSize: '0.68rem' }}>
                  risk
                </div>
              </div>
            </div>
            <div className='w-full h-1 overflow-hidden rounded-full bg-white/5'>
              <div
                className='h-full bg-red-500 rounded-full'
                style={{ width: `${session.risk}%` }}
              />
            </div>
          </div>
          <div>
            <div
              className='mb-3 tracking-widest uppercase text-white/40'
              style={{ ...mono, fontSize: '0.6rem' }}
            >
              Session Journey
            </div>
            <div className='flex flex-col'>
              {DRAWER_TIMELINE.map((step, i) => {
                const Icon = step.icon
                const isLast = i === DRAWER_TIMELINE.length - 1
                return (
                  <div key={i} className='flex gap-3'>
                    <div className='flex flex-col items-center'>
                      <div
                        className='flex items-center justify-center w-6 h-6 border rounded-full shrink-0'
                        style={{
                          borderColor: step.color + '44',
                          background: step.color + '15',
                        }}
                      >
                        <Icon size={10} style={{ color: step.color }} />
                      </div>
                      {!isLast && (
                        <div
                          className='flex-1 w-px my-1'
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            minHeight: 16,
                          }}
                        />
                      )}
                    </div>
                    <div className='flex-1 pb-4'>
                      <div className='mb-0.5 flex items-center gap-2'>
                        <span className='text-xs font-medium text-white'>
                          {step.label}
                        </span>
                        <span
                          className='text-white/30'
                          style={{ ...mono, fontSize: '0.62rem' }}
                        >
                          {step.time}
                        </span>
                      </div>
                      <div
                        className='italic text-white/40'
                        style={{ fontSize: '0.68rem' }}
                      >
                        "{step.note}"
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <div
              className='mb-2 tracking-widest uppercase text-white/40'
              style={{ ...mono, fontSize: '0.6rem' }}
            >
              Evidence
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {[
                'Exit intent (mobile)',
                'Hovered shipping 6s',
                'VIP LTV $4,200',
                'Cross‑border IP',
                '54% AI confidence',
              ].map((chip) => (
                <span
                  key={chip}
                  className='rounded-full border border-white/8 px-2.5 py-1 text-white/60'
                  style={{ background: '#1a1d26', fontSize: '0.7rem' }}
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div
              className='mb-2 tracking-widest uppercase text-white/40'
              style={{ ...mono, fontSize: '0.6rem' }}
            >
              Recovery Action
            </div>
            <div className='rounded-xl border border-amber-500/20 bg-amber-500/6 p-3.5'>
              <div className='flex items-center gap-2 mb-2'>
                <Zap size={11} className='text-amber-400' />
                <span
                  className='font-semibold tracking-wider uppercase text-amber-400'
                  style={{ fontSize: '0.6rem' }}
                >
                  Recommended
                </span>
              </div>
              <div className='mb-3 text-sm font-semibold text-white'>
                Offer Free Shipping
              </div>
              <div className='flex gap-4 mb-3'>
                <div>
                  <div
                    className='mb-0.5 text-white/40'
                    style={{ fontSize: '0.68rem' }}
                  >
                    Impact
                  </div>
                  <div
                    className='text-sm font-semibold text-emerald-400'
                    style={mono}
                  >
                    +$890
                  </div>
                </div>
                <div>
                  <div
                    className='mb-0.5 text-white/40'
                    style={{ fontSize: '0.68rem' }}
                  >
                    Confidence
                  </div>
                  <div
                    className='text-sm font-semibold text-white'
                    style={mono}
                  >
                    54%
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setLaunched(true)
                  toast.success('Offer launched for ' + session.name)
                }}
                className={`w-full rounded-xl py-2 text-xs font-semibold transition-all ${launched ? 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-400' : 'bg-blue-500 text-white hover:bg-blue-400 active:scale-[0.98]'}`}
              >
                {launched ? (
                  <span className='flex items-center justify-center gap-1.5'>
                    <CheckCircle size={12} /> Launched
                  </span>
                ) : (
                  'Launch for this visitor'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Session Card ─────────────────────────────────────────────────────────────
// Production-ready card for the primary sessions list.
//
// Layout (left → right):
//   [risk bar] [risk%] [visitor + signal + pendingAction] [cart + time + AI badge + arrow]
//
// The left-side risk bar gives a scannable color column even when reading fast.
// AI status badge answers "what is the AI doing?" without opening the drawer.
// Time-in-stage answers "how urgent?" — the dimension missing from the original.

function SessionCard({
  session,
  onReview,
}: {
  session: ActiveSession
  onReview: () => void
}) {
  const rc = riskColor(session.risk)
  const statusMeta = AI_STATUS_META[session.aiStatus]
  const isKnown = !session.visitor.startsWith('Guest')

  return (
    <div
      className='group flex cursor-pointer border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]'
      onClick={onReview}
    >
      {/* Left risk bar — color-coded, always visible */}
      <div
        className='w-0.5 shrink-0 self-stretch'
        style={{ background: rc + '80' }}
      />

      <div className='flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5'>
        {/* Risk % — fixed width column for scannability */}
        <div className='w-8 text-right shrink-0'>
          <span className='text-xs font-bold' style={{ ...mono, color: rc }}>
            {session.risk}%
          </span>
        </div>

        {/* Visitor identity + behavioral signal */}
        <div className='flex-1 min-w-0'>
          <div className='mb-0.5 flex items-center gap-1.5 overflow-hidden'>
            <span
              className={`truncate text-xs font-semibold ${isKnown ? 'text-white/85' : 'text-white/45'}`}
            >
              {session.visitor}
            </span>
            {session.device === 'mobile' ? (
              <Smartphone size={9} className='shrink-0 text-white/20' />
            ) : (
              <Monitor size={9} className='shrink-0 text-white/20' />
            )}
            <span
              className='shrink-0 text-white/20'
              style={{ fontSize: '0.6rem' }}
            >
              {session.stage}
            </span>
          </div>
          <div
            className='italic truncate text-white/30'
            style={{ fontSize: '0.62rem' }}
          >
            {session.signal}
            {session.pendingAction && (
              <span className='not-italic text-white/20'>
                {' '}
                · {session.pendingAction}
              </span>
            )}
          </div>
        </div>

        {/* Right: cart value + urgency time + AI status badge + action */}
        <div className='flex items-center gap-2 shrink-0'>
          <div className='text-right'>
            <div className='text-xs font-bold text-white/65' style={mono}>
              ${session.cart}
            </div>
            <div
              className='text-white/30'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              {formatStageTime(session.stageSeconds)}
            </div>
          </div>
          <span
            className={`rounded border px-1.5 py-0.5 font-semibold ${statusMeta.textCls} ${statusMeta.borderCls} ${statusMeta.bgCls}`}
            style={{ fontSize: '0.58rem', whiteSpace: 'nowrap' }}
          >
            {statusMeta.label}
          </span>
          <div className='p-1 transition-all border rounded-lg border-white/8 text-white/20 group-hover:border-white/20 group-hover:text-white/60'>
            <ArrowRight size={10} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Command Palette ──────────────────────────────────────────────────────────

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div
      className='fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm'
      onClick={onClose}
    >
      <div
        className='w-full max-w-lg overflow-hidden border shadow-2xl rounded-2xl border-white/8'
        style={{ background: '#13161d' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex items-center gap-3 border-b border-white/6 px-4 py-3.5'>
          <Terminal size={14} className='text-blue-400' />
          <input
            ref={ref}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Search any visitor, order, or session…'
            className='flex-1 text-sm text-white bg-transparent outline-none placeholder:text-white/30'
          />
          <kbd
            className='rounded border border-white/8 px-1.5 py-0.5 text-white/30'
            style={{ ...mono, fontSize: '0.68rem' }}
          >
            ESC
          </kbd>
        </div>
        <div
          className='py-8 text-center text-white/30'
          style={{ fontSize: '0.72rem' }}
        >
          Type to search visitors, sessions, or orders…
        </div>
        <div className='flex gap-5 border-t border-white/6 px-4 py-2.5'>
          {['↑↓ navigate', '↵ open', 'ESC close'].map((t) => (
            <span
              key={t}
              className='text-white/25'
              style={{ fontSize: '0.68rem' }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
// ─── Quick Recovery ───────────────────────────────────────────────────────────
// Manual segment-level intervention. Differs from Pending Approvals (AI-initiated)
// and Visitor Drawer (single session). This is the "break glass" tool for when
// the merchant sees a pattern and wants to act on a group immediately.

function QuickRecovery({ budgetLeft }: { budgetLeft: number }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('checkout-mobile')
  const [action, setAction] = useState('urgency')
  const [phase, setPhase] = useState<'idle' | 'deploying' | 'done'>('idle')

  const TARGETS = [
    {
      id: 'checkout-mobile',
      label: 'Checkout · Mobile',
      sub: 'mobile checkout drop active',
      count: 4 as number,
    },
    {
      id: 'critical',
      label: 'Critical sessions ≥80%',
      sub: 'highest exit risk right now',
      count: 2 as number,
    },
    {
      id: 'cart-all',
      label: 'All Cart sessions',
      sub: 'price hesitation signals',
      count: 3 as number,
    },
  ] as const

  const ACTIONS = [
    {
      id: 'urgency',
      label: 'Urgency banner',
      tier: 'Tier 0',
      unitCost: 0,
      est: 540,
    },
    {
      id: 'freeship',
      label: 'Free shipping',
      tier: 'Tier 1',
      unitCost: 0,
      est: 820,
    },
    {
      id: 'disc10',
      label: '10% discount',
      tier: 'Tier 2',
      unitCost: 17,
      est: 1240,
    },
  ] as const

  const t = TARGETS.find((x) => x.id === target)!
  const a = ACTIONS.find((x) => x.id === action)!
  const totalCost = a.unitCost * t.count
  const overBudget = totalCost > budgetLeft

  const deploy = () => {
    setPhase('deploying')
    setTimeout(() => {
      setPhase('done')
      toast.success(`${a.label} deployed to ${t.count} sessions`, {
        description: `Est. recovery +$${a.est}`,
      })
      setTimeout(() => {
        setPhase('idle')
        setOpen(false)
      }, 2000)
    }, 1200)
  }

  return (
    <div className='relative'>
      <div
        className='mb-2 text-xs font-semibold tracking-widest uppercase text-white/30'
        style={{ ...mono, fontSize: '0.58rem' }}
      >
        Quick Recovery
      </div>
      <button
        onClick={() => setOpen((s) => !s)}
        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
          open
            ? 'border-amber-500/45 bg-amber-500/12 text-amber-400'
            : 'border-amber-500/25 bg-amber-500/6 text-amber-400/75 hover:border-amber-500/40 hover:text-amber-400'
        }`}
      >
        <Zap size={12} /> Manual intervention
      </button>

      {open && (
        <>
          <div className='fixed inset-0 z-30' onClick={() => setOpen(false)} />
          <div
            className='absolute left-0 z-40 p-4 mb-2 border shadow-2xl bottom-full rounded-2xl border-white/8'
            style={{ background: '#13161d', width: 284 }}
          >
            <div
              className='mb-3 font-semibold tracking-widest uppercase text-white/30'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              Deploy intervention now
            </div>

            {/* Target segment */}
            <div
              className='mb-1.5 text-white/30'
              style={{ fontSize: '0.65rem' }}
            >
              Target segment
            </div>
            <div className='flex flex-col gap-1 mb-3'>
              {TARGETS.map((tgt) => (
                <button
                  key={tgt.id}
                  onClick={() => setTarget(tgt.id)}
                  className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                    target === tgt.id
                      ? 'border-blue-500/28 bg-blue-500/8'
                      : 'border-white/6 hover:border-white/10 hover:bg-white/[0.02]'
                  }`}
                >
                  <div
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-all ${
                      target === tgt.id
                        ? 'border-blue-400 bg-blue-500/20'
                        : 'border-white/15'
                    }`}
                  >
                    {target === tgt.id && (
                      <div className='h-1.5 w-1.5 rounded-full bg-blue-400' />
                    )}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div
                      className={`font-medium transition-colors ${target === tgt.id ? 'text-blue-300' : 'text-white/50'}`}
                      style={{ fontSize: '0.68rem' }}
                    >
                      {tgt.label}
                    </div>
                    <div
                      className='text-white/22'
                      style={{ fontSize: '0.6rem' }}
                    >
                      {tgt.sub}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 font-bold transition-colors ${target === tgt.id ? 'text-blue-400/70' : 'text-white/25'}`}
                    style={{ ...mono, fontSize: '0.6rem' }}
                  >
                    {tgt.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Intervention type */}
            <div
              className='mb-1.5 text-white/30'
              style={{ fontSize: '0.65rem' }}
            >
              Intervention
            </div>
            <div className='mb-3 flex gap-1.5'>
              {ACTIONS.map((act) => (
                <button
                  key={act.id}
                  onClick={() => setAction(act.id)}
                  className={`flex-1 rounded-lg border py-1.5 text-center font-medium transition-colors ${
                    action === act.id
                      ? 'border-blue-500/28 bg-blue-500/10 text-blue-300'
                      : 'border-white/7 text-white/30 hover:border-white/12 hover:text-white/50'
                  }`}
                  style={{ fontSize: '0.6rem' }}
                >
                  {act.label}
                  <div
                    className={`mt-0.5 ${action === act.id ? 'text-blue-400/45' : 'text-white/20'}`}
                    style={{ ...mono, fontSize: '0.54rem' }}
                  >
                    {act.tier}
                  </div>
                </button>
              ))}
            </div>

            {/* Impact estimate */}
            <div
              className='flex mb-3 overflow-hidden border rounded-xl border-white/5'
              style={{ background: '#1a1d26' }}
            >
              {[
                {
                  label: 'Est. recovery',
                  value: `+$${a.est}`,
                  color: 'text-emerald-400',
                },
                {
                  label: 'Budget impact',
                  value: totalCost > 0 ? `-$${totalCost}` : 'Free',
                  color: totalCost > 0 ? 'text-amber-400' : 'text-emerald-400',
                },
                { label: 'Tier', value: a.tier, color: 'text-white/40' },
              ].map((cell, i) => (
                <div
                  key={cell.label}
                  className={`flex-1 py-2.5 text-center ${i < 2 ? 'border-r border-white/5' : ''}`}
                >
                  <div
                    className='mb-0.5 text-white/25'
                    style={{ fontSize: '0.58rem' }}
                  >
                    {cell.label}
                  </div>
                  <div
                    className={`font-bold ${cell.color}`}
                    style={{ ...mono, fontSize: '0.78rem' }}
                  >
                    {cell.value}
                  </div>
                </div>
              ))}
            </div>

            {overBudget && (
              <div className='mb-2 flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/6 px-3 py-2'>
                <AlertTriangle size={10} className='shrink-0 text-amber-400' />
                <span
                  className='text-amber-400/80'
                  style={{ fontSize: '0.62rem' }}
                >
                  Exceeds remaining budget (${budgetLeft} left)
                </span>
              </div>
            )}

            <button
              onClick={deploy}
              disabled={phase !== 'idle' || overBudget}
              className={`w-full rounded-xl py-2.5 text-xs font-semibold transition-all active:scale-[0.98] ${
                phase === 'done'
                  ? 'border border-emerald-500/25 bg-emerald-500/15 text-emerald-400'
                  : phase === 'deploying'
                    ? 'cursor-wait border border-white/8 bg-white/5 text-white/25'
                    : overBudget
                      ? 'cursor-not-allowed border border-white/8 bg-white/4 text-white/25'
                      : 'bg-amber-500 text-black hover:bg-amber-400'
              }`}
            >
              {phase === 'done'
                ? `✓ Deployed to ${t.count} sessions`
                : phase === 'deploying'
                  ? 'Deploying…'
                  : `Deploy to ${t.count} session${t.count !== 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
// ─── App ──────────────────────────────────────────────────────────────────────

export default function LiveOps() {
  const [campaigns, setCampaigns] = useState(ALL_CAMPAIGNS)
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(
    new Set(DEFAULT_PINNED)
  )
  const [showCampaignMgr, setShowCampaignMgr] = useState(false)
  const [pending, setPending] = useState(PENDING_INIT)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [approvalDrawer, setApprovalDrawer] = useState<PendingApproval | null>(
    null
  )
  const [visitorDrawer, setVisitorDrawer] = useState<DrawerSession | null>(null)
  const [autoPaused, setAutoPaused] = useState(false)
  const [showCmd, setShowCmd] = useState(false)
  const [budget, setBudget] = useState({ used: 320, total: 500 })
  const [dismissedAnomalies, setDismissedAnomalies] = useState<Set<number>>(
    new Set()
  )

  // Session list controls — live in App so count badge in header stays reactive
  const [sessionStage, setSessionStage] = useState('All')
  const [sessionSort, setSessionSort] = useState<'risk' | 'cart' | 'time'>(
    'risk'
  )

  const toggleCampaign = (id: string) =>
    setCampaigns((c) =>
      c.map((x) => (x.id === id ? { ...x, active: !x.active } : x))
    )
  const togglePin = (id: string) =>
    setPinnedIds((p) => {
      const n = new Set(p)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const toggleCheck = (id: string) =>
    setChecked((p) => {
      const n = new Set(p)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const approveSessions = (id: string, sids: string[]) => {
    const item = pending.find((x) => x.id === id)
    if (!item) return
    const remaining = item.items.filter((x) => !sids.includes(x.sid))
    if (remaining.length === 0) {
      setPending((p) => p.filter((x) => x.id !== id))
    } else {
      setPending((p) =>
        p.map((x) =>
          x.id === id
            ? { ...x, batchCount: remaining.length, items: remaining }
            : x
        )
      )
    }
    setChecked((p) => {
      const n = new Set(p)
      n.delete(id)
      return n
    })
    toast.success(
      `Approved ${sids.length} session${sids.length > 1 ? 's' : ''}`,
      { description: item.title }
    )
  }

  const denyApproval = (id: string) => {
    const item = pending.find((x) => x.id === id)
    setPending((p) => p.filter((x) => x.id !== id))
    setChecked((p) => {
      const n = new Set(p)
      n.delete(id)
      return n
    })
    toast('Denied', { description: item?.title })
  }

  const approveSelected = () => {
    ;[...checked].forEach((id) => {
      const item = pending.find((x) => x.id === id)
      if (item)
        approveSessions(
          id,
          item.items.map((x) => x.sid)
        )
    })
    setChecked(new Set())
  }

  // Session list — filter + sort computed here so count badge in header is reactive
  const filteredSessions = ACTIVE_SESSIONS.filter(
    (s) => sessionStage === 'All' || s.stage === sessionStage
  )
  const sortedSessions = [...filteredSessions].sort((a, b) => {
    if (sessionSort === 'risk') return b.risk - a.risk
    if (sessionSort === 'cart') return b.cart - a.cart
    return b.stageSeconds - a.stageSeconds
  })
  const criticalSessions = sortedSessions.filter((s) => s.risk >= 80)
  const highSessions = sortedSessions.filter((s) => s.risk >= 60 && s.risk < 80)
  const mediumSessions = sortedSessions.filter((s) => s.risk < 60)

  const budgetPct = Math.round((budget.used / budget.total) * 100)
  const budgetLow = budgetPct >= 70
  const pinnedCampaigns = campaigns.filter((c) => pinnedIds.has(c.id))

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCmd((s) => !s)
      }
      if (e.key === 'Escape') {
        setShowCmd(false)
        setVisitorDrawer(null)
        setApprovalDrawer(null)
        setShowCampaignMgr(false)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    const id = setTimeout(
      () =>
        toast('🔥 High-value cart saved!', {
          description: 'AI auto‑recovered $320',
        }),
      9000
    )
    return () => clearTimeout(id)
  }, [])

  return (
    <div
      className='flex flex-col w-full h-screen overflow-hidden bg-background text-foreground'
      style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--font-size)' }}
    >
      <Toaster
        theme='dark'
        position='top-right'
        toastOptions={{
          style: {
            background: '#13161d',
            border: '1px solid rgba(255,255,255,0.06)',
            color: '#f1f5f9',
            fontSize: '0.78rem',
            borderRadius: '12px',
          },
        }}
      />

      {showCmd && <CommandPalette onClose={() => setShowCmd(false)} />}
      <ApprovalDrawer
        item={approvalDrawer}
        onClose={() => setApprovalDrawer(null)}
        onApprove={approveSessions}
        onDeny={denyApproval}
      />
      <VisitorDrawer
        session={visitorDrawer}
        onClose={() => setVisitorDrawer(null)}
      />

      {/* Floating batch approval bar */}
      {checked.size > 0 && (
        <div
          className='fixed z-30 flex items-center gap-3 px-5 py-3 -translate-x-1/2 border shadow-2xl bottom-6 left-1/2 rounded-2xl border-blue-500/30'
          style={{ background: '#13161d', backdropFilter: 'blur(12px)' }}
        >
          <CheckSquare size={14} className='text-blue-400' />
          <span className='text-sm font-medium text-white'>
            {checked.size} selected
          </span>
          <span className='text-white/30'>·</span>
          <span className='text-sm font-semibold text-emerald-400' style={mono}>
            +$
            {pending
              .filter((p) => checked.has(p.id))
              .reduce((s, p) => s + p.est, 0)
              .toLocaleString()}{' '}
            est.
          </span>
          <button
            onClick={approveSelected}
            className='ml-2 rounded-xl bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-400'
          >
            Approve selected
          </button>
          <button
            onClick={() => setChecked(new Set())}
            className='p-1 transition-colors rounded-lg text-white/40 hover:bg-white/8 hover:text-white'
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Navbar ── */}
      <header
        className='flex items-center justify-between h-12 px-5 border-b shrink-0 border-white/6'
        style={{ background: '#0f1117' }}
      >
        <div className='flex items-center gap-3'>
          <div className='flex items-center justify-center w-6 h-6 bg-blue-500 rounded-lg'>
            <Zap size={13} className='text-white' />
          </div>
          <span
            className='text-sm font-semibold tracking-[0.1em] text-white uppercase'
            style={{ fontFamily: 'var(--font-display)' }}
          >
            LiveOps
          </span>
        </div>
        <div className='flex items-center gap-2'>
          <button className='flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/15'>
            <div className='h-1.5 w-1.5 animate-pulse rounded-full bg-red-500' />{' '}
            {pending.length} pending
          </button>
          <button className='flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/15'>
            <div className='h-1.5 w-1.5 rounded-full bg-amber-400' /> 1 anomaly
          </button>
        </div>
        <div className='flex items-center gap-3'>
          <button
            onClick={() => setShowCmd(true)}
            className='flex items-center gap-1.5 rounded-lg border border-white/8 px-2.5 py-1 text-white/40 transition-colors hover:text-white/70'
            style={{ fontSize: '0.72rem' }}
          >
            <Terminal size={11} /> ⌘K
          </button>
          <button
            className='flex items-center gap-1 transition-colors text-white/60 hover:text-white'
            style={{ fontSize: '0.72rem' }}
          >
            Store: Main <ChevronDown size={11} />
          </button>
          <div
            className='flex items-center justify-center text-xs font-bold text-blue-400 border rounded-full h-7 w-7 border-blue-500/30 bg-blue-500/20'
            style={mono}
          >
            M
          </div>
          <div className='h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]' />
        </div>
      </header>

      {/* ── Recovery Bar ── */}
      <div
        className='flex items-stretch border-b shrink-0 border-white/6'
        style={{ background: 'linear-gradient(to bottom, #13161d, #0f1117)' }}
      >
        {[
          {
            label: 'Recovered Today',
            extra: 'value',
            value: '$12,480',
            color: 'text-emerald-400',
            sub: 'since 00:00 UTC',
          },
          {
            label: 'Auto‑Recovery Rate',
            extra: 'value',
            value: '92%',
            color: 'text-white',
            sub: null,
          },
          {
            label: 'Safety Budget Left',
            extra: 'budget',
            value: null,
            color: budgetLow ? 'text-amber-400' : 'text-white',
            sub: null,
          },
          {
            label: 'AI Health',
            extra: 'health',
            value: null,
            color: 'text-emerald-400',
            sub: null,
          },
        ].map((m, i) => (
          <div
            key={i}
            className={`flex flex-1 flex-col justify-center px-5 py-3.5 ${i < 3 ? 'border-r border-white/6' : ''}`}
          >
            <div
              className='mb-1.5 font-medium text-white/40'
              style={{ fontSize: '0.72rem' }}
            >
              {m.label}
            </div>
            {m.extra === 'budget' ? (
              <div>
                <div className='mb-1.5 flex items-center gap-2'>
                  <span className={`text-xl font-bold ${m.color}`} style={mono}>
                    ${budget.used}
                  </span>
                  <span className='text-sm text-white/30' style={mono}>
                    / ${budget.total}
                  </span>
                  <button
                    onClick={() => {
                      setBudget((b) => ({ ...b, total: b.total + 200 }))
                      toast('Budget increased by $200')
                    }}
                    className='ml-1 flex items-center gap-0.5 rounded-lg border border-blue-500/30 px-1.5 py-0.5 text-blue-400 transition-colors hover:text-blue-300'
                    style={{ fontSize: '0.68rem' }}
                  >
                    <Plus size={9} /> Add
                  </button>
                </div>
                <div className='w-full h-1 overflow-hidden rounded-full bg-white/5'>
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${budgetLow ? 'bg-amber-400' : 'bg-blue-500'}`}
                    style={{ width: `${budgetPct}%` }}
                  />
                </div>
              </div>
            ) : m.extra === 'health' ? (
              <div className='flex items-center gap-2'>
                <div className='h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]' />
                <span className='text-xl font-bold text-emerald-400'>
                  Optimal
                </span>
              </div>
            ) : (
              <div>
                <div className={`text-xl font-bold ${m.color}`} style={mono}>
                  {m.value}
                </div>
                {m.sub && (
                  <div
                    className='mt-0.5 text-white/25'
                    style={{ fontSize: '0.6rem' }}
                  >
                    {m.sub}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {autoPaused && (
          <div className='flex items-center gap-2 px-4 border-l shrink-0 border-amber-500/20 bg-amber-500/5'>
            <Pause size={11} className='text-amber-400' />
            <span className='text-amber-400' style={{ fontSize: '0.72rem' }}>
              Paused
            </span>
          </div>
        )}
      </div>
      
      {/* ── Campaigns Bar ── */}
      <div
        className='relative flex shrink-0 flex-wrap items-center gap-2 border-b border-white/6 px-5 py-2.5'
        style={{ background: '#0f1117' }}
      >
        <span className='mr-1 text-white/30' style={{ fontSize: '0.72rem' }}>
          Campaigns
        </span>
        {pinnedCampaigns.map((c) => (
          <div
            key={c.id}
            className='flex items-center gap-2 rounded-xl border border-white/6 px-3 py-1.5 transition-colors hover:border-white/10'
            style={{ background: '#1a1d26' }}
          >
            <span
              className='font-medium text-white/70'
              style={{ fontSize: '0.72rem' }}
            >
              {c.name}
            </span>
            <div className='flex items-center gap-1'>
              <div
                className={`h-1.5 w-1.5 rounded-full ${c.active ? 'bg-emerald-400 shadow-[0_0_4px_#10b981]' : 'bg-white/15'}`}
              />
              <span
                className='font-semibold'
                style={{
                  ...mono,
                  fontSize: '0.6rem',
                  color: c.active ? '#10b981' : 'rgba(255,255,255,0.25)',
                }}
              >
                {c.active ? 'ON' : 'OFF'}
              </span>
            </div>
            <Toggle active={c.active} onToggle={() => toggleCampaign(c.id)} />
            <TrendBadge trend={c.trend} active={c.active} />
          </div>
        ))}
        <div className='relative'>
          <button
            onClick={() => setShowCampaignMgr((s) => !s)}
            className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 font-medium transition-all ${showCampaignMgr ? 'border-blue-500/40 bg-blue-500/10 text-blue-400' : 'border-white/8 text-white/30 hover:border-white/15 hover:text-white/60'}`}
            style={{ fontSize: '0.72rem' }}
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
              onToggleCampaign={toggleCampaign}
              onTogglePin={togglePin}
              onClose={() => setShowCampaignMgr(false)}
            />
          )}
        </div>
      </div>

      {/* ── Main Two Columns ── */}
      <div className='flex flex-1 min-h-0 overflow-hidden'>
        {/* ── Left 45%: OBSERVE + ACTIVE SESSIONS ── */}
        {/* Funnel compressed to a single strip. Sessions are the primary operational surface. */}
        <div
          className='flex flex-col overflow-hidden border-r border-white/6'
          style={{ width: '45%' }}
        >
          <div
            className='px-4 py-2 border-b shrink-0 border-white/6'
            style={{ background: '#0f1117' }}
          >
            <span
              className='font-semibold tracking-widest uppercase text-white/35'
              style={{ ...mono, fontSize: '0.6rem' }}
            >
              Observe
            </span>
          </div>

          {/* ── Mini funnel strip — monitoring context, not the action surface ── */}
          <div
            className='px-4 py-2 border-b shrink-0 border-white/6'
            style={{ background: '#0c0e14' }}
          >
            <div className='flex flex-wrap items-center gap-1.5'>
              {FUNNEL.map((step, i) => {
                const color = funnelColor(step.health)
                const isLast = i === FUNNEL.length - 1
                return (
                  <div key={step.label} className='flex items-center gap-1'>
                    <div className='flex flex-col items-center'>
                      <span
                        className='font-bold leading-tight'
                        style={{ color, ...mono, fontSize: '0.72rem' }}
                      >
                        {step.count.toLocaleString()}
                      </span>
                      <span
                        className='leading-tight text-white/25'
                        style={{ fontSize: '0.54rem' }}
                      >
                        {step.label}
                      </span>
                    </div>
                    {!isLast && (
                      <div className='mx-0.5 flex items-center gap-0.5'>
                        {step.drop && (
                          <span
                            className='text-white/18'
                            style={{ ...mono, fontSize: '0.54rem' }}
                          >
                            ↓{step.drop}%
                          </span>
                        )}
                        <ArrowRight size={7} className='text-white/12' />
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Checkout anomaly inline — keeps the alert without a dedicated section */}
              <div className='ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/8 px-2 py-0.5'>
                <div className='w-1 h-1 bg-red-500 rounded-full animate-pulse' />
                <span
                  className='font-semibold text-red-400/90'
                  style={{ fontSize: '0.58rem' }}
                >
                  Checkout −12%
                </span>
              </div>
            </div>
          </div>

          {/* ── Active Sessions header: count + stage filter + sort ── */}
          <div
            className='flex items-center gap-2 px-3 py-2 border-b shrink-0 border-white/6'
            style={{ background: '#0f1117' }}
          >
            <div className='flex items-center gap-1.5'>
              <div className='h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400' />
              <span
                className='font-semibold tracking-widest uppercase text-white/35'
                style={{ ...mono, fontSize: '0.58rem' }}
              >
                Active Sessions
              </span>
              <span
                className='rounded-full bg-white/8 px-2 py-0.5 font-semibold text-white/40'
                style={{ ...mono, fontSize: '0.6rem' }}
              >
                {filteredSessions.length}
              </span>
            </div>
            {/* Stage filter chips */}
            <div className='flex items-center gap-1 ml-auto'>
              {['All', 'Product', 'Cart', 'Checkout'].map((v) => (
                <button
                  key={v}
                  onClick={() => setSessionStage(v)}
                  className={`rounded border px-2 py-0.5 font-medium transition-colors ${
                    sessionStage === v
                      ? 'border-blue-500/30 bg-blue-500/20 text-blue-400'
                      : 'border-white/6 text-white/25 hover:border-white/10 hover:text-white/50'
                  }`}
                  style={{ fontSize: '0.6rem' }}
                >
                  {v}
                </button>
              ))}
              {/* Sort: click-to-cycle through risk / cart / time */}
              <button
                onClick={() =>
                  setSessionSort((k) =>
                    k === 'risk' ? 'cart' : k === 'cart' ? 'time' : 'risk'
                  )
                }
                className='ml-1 rounded border border-white/8 px-2 py-0.5 font-medium text-white/30 transition-colors hover:border-white/15 hover:text-white/55'
                style={{ fontSize: '0.6rem', whiteSpace: 'nowrap' }}
              >
                {sessionSort === 'risk'
                  ? 'Risk ↓'
                  : sessionSort === 'cart'
                    ? 'Cart ↓'
                    : 'Time ↓'}
              </button>
            </div>
          </div>

          {/* ── Session list — grouped by risk tier ── */}
          {/* Each group header is sticky so tier label stays visible while scrolling */}
          <div
            className='flex-1 overflow-y-auto scrollbar-hide'
            style={{ background: '#13161d' }}
          >
            {filteredSessions.length === 0 ? (
              <div
                className='px-4 py-10 italic text-center text-white/25'
                style={{ fontSize: '0.72rem' }}
              >
                No active sessions at this stage
              </div>
            ) : (
              <>
                {criticalSessions.length > 0 && (
                  <>
                    <div
                      className='sticky top-0 z-10 flex items-center gap-2 px-4 py-1.5'
                      style={{ background: '#111318' }}
                    >
                      <div className='h-1.5 w-1.5 animate-pulse rounded-full bg-red-500' />
                      <span
                        className='font-semibold'
                        style={{
                          ...mono,
                          fontSize: '0.58rem',
                          color: '#ef4444',
                        }}
                      >
                        Critical ≥80%
                      </span>
                      <span
                        style={{
                          ...mono,
                          fontSize: '0.58rem',
                          color: 'rgba(239,68,68,0.4)',
                        }}
                      >
                        {criticalSessions.length}
                      </span>
                    </div>
                    {criticalSessions.map((s) => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        onReview={() => setVisitorDrawer(DRAWER_SESSION)}
                      />
                    ))}
                  </>
                )}
                {highSessions.length > 0 && (
                  <>
                    <div
                      className='sticky top-0 z-10 flex items-center gap-2 px-4 py-1.5'
                      style={{ background: '#111318' }}
                    >
                      <div className='h-1.5 w-1.5 rounded-full bg-amber-400' />
                      <span
                        className='font-semibold'
                        style={{
                          ...mono,
                          fontSize: '0.58rem',
                          color: '#f59e0b',
                        }}
                      >
                        High 60–79%
                      </span>
                      <span
                        style={{
                          ...mono,
                          fontSize: '0.58rem',
                          color: 'rgba(245,158,11,0.4)',
                        }}
                      >
                        {highSessions.length}
                      </span>
                    </div>
                    {highSessions.map((s) => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        onReview={() => setVisitorDrawer(DRAWER_SESSION)}
                      />
                    ))}
                  </>
                )}
                {mediumSessions.length > 0 && (
                  <>
                    <div
                      className='sticky top-0 z-10 flex items-center gap-2 px-4 py-1.5'
                      style={{ background: '#111318' }}
                    >
                      <div
                        className='h-1.5 w-1.5 rounded-full'
                        style={{ background: 'rgba(255,255,255,0.25)' }}
                      />
                      <span
                        className='font-semibold text-white/30'
                        style={{ ...mono, fontSize: '0.58rem' }}
                      >
                        Medium &lt;60%
                      </span>
                      <span
                        className='text-white/20'
                        style={{ ...mono, fontSize: '0.58rem' }}
                      >
                        {mediumSessions.length}
                      </span>
                    </div>
                    {mediumSessions.map((s) => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        onReview={() => setVisitorDrawer(DRAWER_SESSION)}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right 55%: UNDERSTAND & APPROVE ── */}
        <div className='flex flex-col overflow-hidden' style={{ width: '55%' }}>
          <div
            className='px-4 py-2 border-b shrink-0 border-white/6'
            style={{ background: '#0f1117' }}
          >
            <span
              className='font-semibold tracking-widest uppercase text-white/35'
              style={{ ...mono, fontSize: '0.6rem' }}
            >
              Understand & Approve
            </span>
          </div>

          {/* Upper scrollable: Pending Approvals + Exceptions */}
          <div className='flex flex-col flex-1 min-h-0 overflow-y-auto scrollbar-hide'>
            {/* Pending Approvals */}
            <div className='px-4 pt-3 pb-2'>
              <div className='flex items-center justify-between mb-2'>
                <div className='flex items-center gap-2'>
                  <span
                    className='font-semibold tracking-widest uppercase text-white/35'
                    style={{ ...mono, fontSize: '0.6rem' }}
                  >
                    Pending Approvals
                  </span>
                  <span
                    className='rounded-full bg-white/8 px-2 py-0.5 font-semibold text-white/50'
                    style={{ ...mono, fontSize: '0.65rem' }}
                  >
                    {pending.length}
                  </span>
                </div>
                {checked.size > 0 && (
                  <button
                    onClick={approveSelected}
                    className='text-xs font-semibold text-blue-400 transition-colors hover:text-blue-300'
                  >
                    Approve {checked.size} selected
                  </button>
                )}
              </div>
              <div
                className='overflow-hidden border rounded-xl border-white/6'
                style={{ background: '#13161d' }}
              >
                {pending.length === 0 ? (
                  <div
                    className='px-4 py-5 italic text-center text-white/25'
                    style={{ fontSize: '0.72rem' }}
                  >
                    All caught up — no pending approvals.
                  </div>
                ) : (
                  pending.map((item, idx) => {
                    const isChecked = checked.has(item.id)
                    const isLast = idx === pending.length - 1
                    return (
                      <div
                        key={item.id}
                        className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors ${!isLast ? 'border-b border-white/5' : ''} ${isChecked ? 'bg-blue-500/8' : 'hover:bg-white/[0.025]'}`}
                        onClick={() => setApprovalDrawer(item)}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleCheck(item.id)
                          }}
                          className='transition-colors shrink-0 text-white/25 hover:text-white/60'
                        >
                          {isChecked ? (
                            <CheckSquare size={13} className='text-blue-400' />
                          ) : (
                            <Square size={13} />
                          )}
                        </button>
                        <div className='flex-1 min-w-0'>
                          <div
                            className='font-medium truncate text-white/80'
                            style={{ fontSize: '0.72rem' }}
                          >
                            {item.title}
                          </div>
                          <div
                            className='mt-0.5 flex items-center gap-1.5 text-white/30'
                            style={{ fontSize: '0.62rem' }}
                          >
                            <span style={mono}>{item.batchCount}×</span>
                            {item.extra && (
                              <>
                                <span>·</span>
                                <span>{item.extra}</span>
                              </>
                            )}
                            {item.cost > 0 && (
                              <>
                                <span>·</span>
                                <span>
                                  cost <span style={mono}>${item.cost}</span>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <span
                          className='font-semibold shrink-0 text-emerald-400'
                          style={{ ...mono, fontSize: '0.72rem' }}
                        >
                          +${item.est.toLocaleString()}
                        </span>
                        <div
                          className='flex items-center overflow-hidden border rounded-lg shrink-0 border-white/8'
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() =>
                              approveSessions(
                                item.id,
                                item.items.map((x) => x.sid)
                              )
                            }
                            className='border-r border-white/8 px-2.5 py-1 font-semibold text-blue-400 transition-colors hover:bg-blue-500/15 hover:text-blue-300'
                            style={{ fontSize: '0.68rem' }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => denyApproval(item.id)}
                            className='px-2.5 py-1 text-white/25 transition-colors hover:bg-white/5 hover:text-white/50'
                            style={{ fontSize: '0.68rem' }}
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Exceptions */}
            <div className='px-4 pt-1 pb-3'>
              <div className='flex items-center justify-between mb-2'>
                <span
                  className='font-semibold tracking-widest uppercase text-white/35'
                  style={{ ...mono, fontSize: '0.6rem' }}
                >
                  Exceptions
                </span>
                <div
                  className='flex items-center gap-1 text-white/25'
                  style={{ fontSize: '0.68rem' }}
                >
                  <Shield size={10} className='text-emerald-400' />
                  <span>
                    <span
                      className='font-semibold text-emerald-400'
                      style={mono}
                    >
                      200+
                    </span>{' '}
                    auto‑handled in last 15 min
                  </span>
                </div>
              </div>
              <div className='flex flex-col gap-2'>
                {EXCEPTIONS.map((ex) => {
                  const isVip = ex.level === 'vip'
                  return (
                    <div
                      key={ex.id}
                      className='overflow-hidden transition-all border cursor-pointer rounded-xl border-white/6 hover:border-white/10'
                      style={{ background: '#13161d' }}
                      onClick={() => setVisitorDrawer(DRAWER_SESSION)}
                    >
                      <div className='flex'>
                        <div
                          className='w-0.5 shrink-0'
                          style={{ background: isVip ? '#ef4444' : '#f59e0b' }}
                        />
                        <div className='flex flex-1 items-center gap-3 px-3 py-2.5'>
                          <div
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${isVip ? 'bg-red-500 shadow-[0_0_5px_#ef4444]' : 'bg-amber-400'}`}
                          />
                          <div className='flex-1 min-w-0'>
                            <div
                              className={`truncate font-semibold ${isVip ? 'text-red-400' : 'text-amber-400'}`}
                              style={{ fontSize: '0.72rem' }}
                            >
                              {ex.label}
                            </div>
                            <div
                              className='mt-0.5 flex items-center gap-2 text-white/30'
                              style={{ fontSize: '0.62rem' }}
                            >
                              <span>
                                Cart{' '}
                                <span
                                  className='font-medium text-white/60'
                                  style={mono}
                                >
                                  ${ex.cart}
                                </span>
                              </span>
                              <span>·</span>
                              <span>
                                Confidence{' '}
                                <span
                                  className={`font-medium ${ex.confidence < 60 ? 'text-red-400' : 'text-amber-400'}`}
                                  style={mono}
                                >
                                  {ex.confidence}%
                                </span>
                              </span>
                              <span>·</span>
                              <span className='italic truncate'>
                                {ex.reason}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setVisitorDrawer(DRAWER_SESSION)
                            }}
                            className='font-medium underline transition-colors shrink-0 text-white/35 underline-offset-2 hover:text-white/70'
                            style={{ fontSize: '0.68rem' }}
                          >
                            Review
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── AI Activity strip — always visible at bottom of right panel ── */}
          <div
            className='px-4 py-3 border-t shrink-0 border-white/6'
            style={{ background: '#0f1117' }}
          >
            <div className='flex items-center justify-between mb-2'>
              <div className='flex items-center gap-2'>
                <div className='h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400' />
                <span
                  className='font-semibold tracking-widest uppercase text-white/35'
                  style={{ ...mono, fontSize: '0.6rem' }}
                >
                  AI Activity
                </span>
                <span className='text-white/20' style={{ fontSize: '0.6rem' }}>
                  last 15 min
                </span>
              </div>
              <button
                className='flex items-center gap-1 transition-colors text-white/25 hover:text-white/50'
                style={{ fontSize: '0.68rem' }}
              >
                <FileText size={10} /> Audit log →
              </button>
            </div>
            <div
              className='divide-y divide-white/[0.04] overflow-y-auto rounded-xl border border-white/5'
              style={{ background: '#13161d', maxHeight: 152 }}
            >
              {AUTO_DECISIONS.map((d, i) => (
                <div
                  key={i}
                  className='flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-white/[0.02]'
                >
                  <span
                    className='shrink-0 text-white/20'
                    style={{ ...mono, fontSize: '0.6rem' }}
                  >
                    {d.time}
                  </span>
                  <div
                    className={`h-1 w-1 shrink-0 rounded-full ${d.status === 'auto' ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  />
                  <span
                    className='max-w-[80px] shrink-0 truncate text-white/35'
                    style={{ fontSize: '0.65rem' }}
                  >
                    {d.visitor}
                  </span>
                  <span className='shrink-0 text-white/15'>·</span>
                  <span
                    className={`flex-1 truncate ${d.status === 'held' ? 'text-amber-400/80' : 'text-white/65'}`}
                    style={{ fontSize: '0.65rem' }}
                  >
                    {d.action}
                  </span>
                  <span
                    className='max-w-[110px] shrink-0 truncate text-white/20 italic'
                    style={{ fontSize: '0.6rem' }}
                  >
                    {d.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Actions Strip — simplified now that sessions are in the main panel ── */}
      <div
        className='px-5 py-3 border-t shrink-0 border-white/6'
        style={{ background: '#0f1117' }}
      >
        <div className='flex flex-wrap items-start gap-5'>
          <div>
            <div
              className='mb-2 flex items-center gap-1.5 font-semibold tracking-widest text-white/30 uppercase'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              <Zap size={9} className='text-amber-400' /> Quick Controls
            </div>
            <div className='flex items-center gap-2'>
              <button
                onClick={() => {
                  setAutoPaused((s) => !s)
                  toast(autoPaused ? 'Resumed' : 'Paused for 30 min')
                }}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 font-medium transition-all ${autoPaused ? 'border-emerald-500/40 bg-emerald-500/8 text-emerald-400' : 'border-white/8 bg-white/4 text-white/60 hover:border-white/15 hover:text-white/80'}`}
                style={{ fontSize: '0.72rem' }}
              >
                {autoPaused ? (
                  <>
                    <Play size={12} /> Resume
                  </>
                ) : (
                  <>
                    <Pause size={12} /> Pause 30 min
                  </>
                )}
              </button>
              <SensitivitySlider />
            </div>
          </div>
          <div className='self-stretch w-px bg-white/6' />
          <div>
            <div
              className='mb-2 font-semibold tracking-widest uppercase text-white/30'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              ── Strategic ──
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              {[
                { icon: FlaskConical, label: 'Launch A/B Test' },
                { icon: SlidersHorizontal, label: 'Policy Panel' },
                { icon: FileText, label: 'AI Audit Log' },
              ].map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  className='flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/4 px-3 py-2 font-medium text-white/60 transition-all hover:border-white/15 hover:text-white/80'
                  style={{ fontSize: '0.72rem' }}
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          </div>
          <div className='self-stretch w-px bg-white/6' />
          <QuickRecovery budgetLeft={budget.total - budget.used} />
          {/* Visitor Lookup — ⌘K for historical search by ID/email/order */}
          {/* <div>
            <div className="mb-2 font-semibold tracking-widest uppercase text-white/30" style={{ ...mono, fontSize: "0.58rem" }}>Visitor Lookup</div>
            <button
              onClick={() => setShowCmd(true)}
              className="flex items-center gap-2 px-3 py-2 font-medium transition-all border rounded-xl border-white/8 bg-white/4 text-white/60 hover:border-white/15 hover:text-white/80"
              style={{ fontSize: "0.72rem" }}
            >
              <Terminal size={12} />
              <span>⌘K Search by email, ID, or order</span>
            </button>
          </div> */}
        </div>
      </div>

      <RecoveryTicker />

      {/* ── Learning & System Health ── */}
      <div
        className='border-t shrink-0 border-white/6'
        style={{ background: '#0f1117' }}
      >
        <div className='grid grid-cols-3 divide-x divide-white/6'>
          {/* Col 1: This Week */}
          <div className='px-5 py-3'>
            <div
              className='mb-2 font-semibold tracking-widest uppercase text-white/30'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              This Week
            </div>
            <div className='flex flex-col gap-1'>
              {[
                {
                  label: 'AI recovered',
                  value: '$8,420',
                  badge: null,
                  badgeColor: '',
                },
                {
                  label: 'Model accuracy',
                  value: '96%',
                  badge: '↑4%',
                  badgeColor: 'text-emerald-400',
                },
                {
                  label: 'False positives',
                  value: '2.1%',
                  badge: '↓0.5%',
                  badgeColor: 'text-emerald-400',
                },
                {
                  label: 'Intervention rate',
                  value: null,
                  badge: '↓14%',
                  badgeColor: 'text-emerald-400',
                },
              ].map((s) => (
                <div key={s.label} className='flex items-center gap-2'>
                  <span
                    className='text-white/35'
                    style={{ fontSize: '0.68rem' }}
                  >
                    {s.label}
                  </span>
                  {s.value && (
                    <span
                      className='font-semibold text-white'
                      style={{ ...mono, fontSize: '0.68rem' }}
                    >
                      {s.value}
                    </span>
                  )}
                  {s.badge && (
                    <span
                      className={`font-semibold ${s.badgeColor}`}
                      style={{ ...mono, fontSize: '0.68rem' }}
                    >
                      {s.badge}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Col 2: AI Adaptations */}
          <div className='px-5 py-3'>
            <div
              className='mb-2 font-semibold tracking-widest uppercase text-white/30'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              Recent AI Adaptations
            </div>
            <div className='flex flex-col gap-1.5'>
              {AI_ADAPTATIONS.map((t, i) => (
                <div key={i} className='flex items-start gap-1.5'>
                  <span className='mt-0.5 shrink-0 text-white/20'>•</span>
                  <span
                    className='leading-relaxed text-white/40'
                    style={{ fontSize: '0.68rem' }}
                  >
                    {t}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Col 3: Anomaly Feed + ⌘K */}
          <div className='px-5 py-3'>
            <div
              className='mb-2 font-semibold tracking-widest uppercase text-white/30'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              Anomaly Feed
            </div>
            <div className='mb-3 flex flex-col gap-1.5'>
              {ANOMALIES.map((item, i) => {
                if (dismissedAnomalies.has(i)) return null
                const m = anomalyMeta(item.status)
                return (
                  <div key={i} className='flex items-center gap-2 group'>
                    <div
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`}
                    />
                    <span
                      className='shrink-0 text-white/25'
                      style={{ ...mono, fontSize: '0.62rem' }}
                    >
                      {item.time}
                    </span>
                    <span
                      className='flex-1 truncate text-white/45'
                      style={{ fontSize: '0.65rem' }}
                    >
                      {item.event}
                    </span>
                    <span
                      className={`shrink-0 font-medium ${m.text}`}
                      style={{ fontSize: '0.6rem' }}
                    >
                      {m.label}
                    </span>
                    <button
                      onClick={() =>
                        setDismissedAnomalies((p) => new Set([...p, i]))
                      }
                      className='shrink-0 rounded p-0.5 text-white/25 opacity-0 transition-all group-hover:opacity-100 hover:bg-white/10 hover:text-white'
                    >
                      <X size={9} />
                    </button>
                  </div>
                )
              })}
              {dismissedAnomalies.size === ANOMALIES.length && (
                <div
                  className='italic text-white/25'
                  style={{ fontSize: '0.65rem' }}
                >
                  No active anomalies
                </div>
              )}
            </div>
            <button
              onClick={() => setShowCmd(true)}
              className='flex items-center gap-2 rounded-lg border border-white/6 px-2.5 py-1.5 text-white/25 transition-colors hover:border-white/12 hover:text-white/50'
              style={{ fontSize: '0.68rem' }}
            >
              <Terminal size={10} />
              <span>⌘K Search any visitor, order, or session…</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
