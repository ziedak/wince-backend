import { useState, useEffect } from 'react'
import {
  Zap,
  ChevronDown,
  Terminal,
  AlertTriangle,
  Shield,
  FlaskConical,
  FileText,
  Search,
  Plus,
  Pause,
  Play,
  SlidersHorizontal,
  CheckSquare,
  Square,
  X,
} from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { ApprovalDrawer } from './components/approvalDrawer'
import { CompaignBar } from './components/campaign/campaignBar'
import { CommandPalette } from './components/commandPalette'
import { RecoveryTicker } from './components/recoveryTicker'
import { SensitivitySlider } from './components/sensitivitySlider'
import {
  ALL_CAMPAIGNS,
  PENDING_INIT,
  ANOMALIES,
  FUNNEL,
  EXCEPTIONS,
  DRAWER_SESSION,
  AI_ADAPTATIONS,
  AUTO_DECISIONS,
} from './data'
import { mono, funnelColor, anomalyMeta } from './helpers'

export default function LiveOps() {
  const [campaigns, setCampaigns] = useState(ALL_CAMPAIGNS)

  // const [showCampaignMgr, setShowCampaignMgr] = useState(false)
  const [pending, setPending] = useState(PENDING_INIT)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [approvalDrawer, setApprovalDrawer] = useState<PendingApproval | null>(
    null
  )
  const [autoPaused, setAutoPaused] = useState(false)
  const [showCmd, setShowCmd] = useState(false)
  const [budget, setBudget] = useState({ used: 320, total: 500 })
  const [manualSearch, setManualSearch] = useState('')
  const [dismissedAnomalies, setDismissedAnomalies] = useState<Set<number>>(
    new Set()
  )

  const toggleCampaign = (id: string) =>
    setCampaigns((c) =>
      c.map((x) => (x.id === id ? { ...x, active: !x.active } : x))
    )

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
    const ids = [...checked]
    ids.forEach((id) => {
      const item = pending.find((x) => x.id === id)
      if (item)
        approveSessions(
          id,
          item.items.map((x) => x.sid)
        )
    })
    setChecked(new Set())
  }

  const budgetPct = Math.round((budget.used / budget.total) * 100)
  const budgetLow = budgetPct >= 70

  const visibleAnomalies = ANOMALIES.filter(
    (_, i) => !dismissedAnomalies.has(i)
  )

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCmd((s) => !s)
      }
      if (e.key === 'Escape') {
        setShowCmd(false)
        setApprovalDrawer(null)
        // setShowCampaignMgr(false)
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
      {/* <VisitorDrawer
        session={visitorDrawer}
        onClose={() => setVisitorDrawer(null)}
      /> */}

      {/* Floating batch bar */}
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
            className='flex items-center gap-1.5 rounded-lg border border-white/8 px-2.5 py-1 text-xs text-white/40 transition-colors hover:text-white/70'
          >
            <Terminal size={11} /> ⌘K
          </button>
          <button className='flex items-center gap-1 text-xs transition-colors text-white/60 hover:text-white'>
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
            <div className='mb-1.5 text-xs font-medium text-white/40'>
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
                    className='ml-1 flex items-center gap-0.5 rounded-lg border border-blue-500/30 px-1.5 py-0.5 text-xs text-blue-400 transition-colors hover:text-blue-300'
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
                    className='mt-0.5 text-xs text-white/25'
                    style={{ fontSize: '0.62rem' }}
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
            <span className='text-xs text-amber-400'>Paused</span>
          </div>
        )}
      </div>

      {/* ── Campaigns Bar ── */}
      <CompaignBar campaigns={campaigns} onToggle={toggleCampaign} />

      {/* ── Main Two Columns ── */}
      <div className='flex flex-1 min-h-0 overflow-hidden'>
        {/* ── Left 45%: OBSERVE ── */}
        <div
          className='flex flex-col overflow-hidden border-r border-white/6'
          style={{ width: '45%' }}
        >
          <div
            className='px-4 py-2 border-b shrink-0 border-white/6'
            style={{ background: '#0f1117' }}
          >
            <span
              className='text-xs font-semibold tracking-widest uppercase text-white/35'
              style={{ ...mono, fontSize: '0.6rem' }}
            >
              Observe
            </span>
          </div>
          <div className='flex-1 overflow-y-auto scrollbar-hide'>
            {/* Live Funnel */}
            <div className='px-4 py-3 border-b border-white/6'>
              <div
                className='mb-3 text-xs font-semibold tracking-widest uppercase text-white/35'
                style={{ ...mono, fontSize: '0.6rem' }}
              >
                Live Funnel
              </div>
              <div className='mb-3 flex flex-col gap-1.5'>
                {FUNNEL.map((step) => {
                  const color = funnelColor(step.health)
                  return (
                    <div key={step.label} className='flex items-center gap-3'>
                      <div className='w-[72px] shrink-0 text-right text-xs text-white/50'>
                        {step.label}
                      </div>
                      <div className='flex-1 h-5 overflow-hidden rounded-lg bg-white/4'>
                        <div
                          className='flex items-center h-full pl-2 transition-all duration-700 rounded-lg'
                          style={{
                            width: `${Math.max(step.pct, 4)}%`,
                            background: color + '22',
                            borderRight: `2px solid ${color}55`,
                          }}
                        >
                          <span
                            className='text-xs font-semibold whitespace-nowrap text-white/70'
                            style={mono}
                          >
                            {step.count.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {step.drop !== null && (
                        <div className='w-10 text-right shrink-0'>
                          <span
                            className='text-xs font-semibold'
                            style={{ ...mono, color, fontSize: '0.65rem' }}
                          >
                            ↓{step.drop}%
                          </span>
                        </div>
                      )}
                      {step.health === 'danger' && (
                        <AlertTriangle
                          size={10}
                          className='text-red-400 shrink-0'
                        />
                      )}
                    </div>
                  )
                })}
              </div>
              <div className='px-3 py-2 border rounded-xl border-red-500/20 bg-red-500/6'>
                <div className='flex items-center gap-2'>
                  <div className='h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500' />
                  <span className='text-xs font-semibold text-red-400'>
                    🛑 Checkout mobile drop −12%
                  </span>
                  <span className='ml-auto text-xs text-red-400/50'>
                    vs. baseline
                  </span>
                </div>
              </div>
            </div>

            {/* Anomaly Feed — compact single-line rows */}
            <div className='px-4 py-3'>
              <div
                className='mb-2.5 text-xs font-semibold tracking-widest text-white/35 uppercase'
                style={{ ...mono, fontSize: '0.6rem' }}
              >
                Anomaly Feed
              </div>
              <div
                className='flex flex-col overflow-hidden border divide-y divide-white/4 rounded-xl border-white/5'
                style={{ background: '#1a1d26' }}
              >
                {visibleAnomalies.length === 0 && (
                  <div className='px-3 py-3 text-xs italic text-white/25'>
                    No active anomalies
                  </div>
                )}
                {visibleAnomalies.map((item, i) => {
                  const m = anomalyMeta(item.status)
                  return (
                    <div
                      key={i}
                      className='group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-white/[0.03]'
                    >
                      <div
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`}
                      />
                      <span
                        className='text-xs shrink-0 text-white/25'
                        style={{ ...mono, fontSize: '0.62rem' }}
                      >
                        {item.time}
                      </span>
                      <span className='flex-1 text-xs truncate text-white/65'>
                        {item.event}
                      </span>
                      <span
                        className={`shrink-0 text-xs font-medium ${m.text}`}
                        style={{ fontSize: '0.65rem' }}
                      >
                        {m.label}
                      </span>
                      <button
                        onClick={() =>
                          setDismissedAnomalies(
                            (p) => new Set([...p, ANOMALIES.indexOf(item)])
                          )
                        }
                        className='shrink-0 rounded p-0.5 text-white/25 opacity-0 transition-all group-hover:opacity-100 hover:bg-white/10 hover:text-white'
                      >
                        <X size={10} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right 55%: UNDERSTAND & APPROVE ── */}
        <div className='flex flex-col overflow-hidden' style={{ width: '55%' }}>
          <div
            className='px-4 py-2 border-b shrink-0 border-white/6'
            style={{ background: '#0f1117' }}
          >
            <span
              className='text-xs font-semibold tracking-widest uppercase text-white/35'
              style={{ ...mono, fontSize: '0.6rem' }}
            >
              Understand & Approve
            </span>
          </div>
          <div className='flex flex-col flex-1 min-h-0 overflow-y-auto scrollbar-hide'>
            {/* Pending Approvals */}
            <div className='px-4 pt-3 pb-2'>
              <div className='flex items-center justify-between mb-2'>
                <div className='flex items-center gap-2'>
                  <span
                    className='text-xs font-semibold tracking-widest uppercase text-white/35'
                    style={{ ...mono, fontSize: '0.6rem' }}
                  >
                    Pending Approvals
                  </span>
                  <span
                    className='rounded-full bg-white/8 px-2 py-0.5 text-xs font-semibold text-white/50'
                    style={mono}
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
                  <div className='px-4 py-5 text-xs italic text-center text-white/25'>
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
                        {/* Checkbox — stop propagation so clicking it doesn't open drawer */}
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
                          <div className='text-xs font-medium truncate text-white/80'>
                            {item.title}
                          </div>
                          <div
                            className='mt-0.5 flex items-center gap-1.5 text-white/30'
                            style={{ fontSize: '0.65rem' }}
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
                          className='text-xs font-semibold shrink-0 text-emerald-400'
                          style={mono}
                        >
                          +${item.est.toLocaleString()}
                        </span>
                        <div
                          className='flex items-center gap-0 overflow-hidden border rounded-lg shrink-0 border-white/8'
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() =>
                              approveSessions(
                                item.id,
                                item.items.map((x) => x.sid)
                              )
                            }
                            className='border-r border-white/8 px-2.5 py-1 text-xs font-semibold text-blue-400 transition-colors hover:bg-blue-500/15 hover:text-blue-300'
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => denyApproval(item.id)}
                            className='px-2.5 py-1 text-xs text-white/25 transition-colors hover:bg-white/5 hover:text-white/50'
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
            <div className='flex-1 px-4 pt-1 pb-3'>
              <div className='flex items-center justify-between mb-2'>
                <span
                  className='text-xs font-semibold tracking-widest uppercase text-white/35'
                  style={{ ...mono, fontSize: '0.6rem' }}
                >
                  Exceptions
                </span>
                <div className='flex items-center gap-1 text-xs text-white/25'>
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
                              className={`truncate text-xs font-semibold ${isVip ? 'text-red-400' : 'text-amber-400'}`}
                            >
                              {ex.label}
                            </div>
                            <div
                              className='mt-0.5 flex items-center gap-2 text-white/30'
                              style={{ fontSize: '0.65rem' }}
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
                            className='text-xs font-medium underline transition-colors shrink-0 text-white/35 underline-offset-2 hover:text-white/70'
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
        </div>
      </div>

      {/* ── Actions Strip ── */}
      <div
        className='px-5 py-3 border-t shrink-0 border-white/6'
        style={{ background: '#0f1117' }}
      >
        <div className='flex flex-wrap items-start gap-5'>
          <div>
            <div
              className='mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-widest text-white/30 uppercase'
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
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${autoPaused ? 'border-emerald-500/40 bg-emerald-500/8 text-emerald-400' : 'border-white/8 bg-white/4 text-white/60 hover:border-white/15 hover:text-white/80'}`}
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
              className='mb-2 text-xs font-semibold tracking-widest uppercase text-white/30'
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
                  className='flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs font-medium text-white/60 transition-all hover:border-white/15 hover:text-white/80'
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          </div>
          <div className='self-stretch w-px bg-white/6' />
          <div>
            <div
              className='mb-2 text-xs font-semibold tracking-widest uppercase text-white/30'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              Manual Recovery
            </div>
            <div className='relative'>
              <Search
                size={11}
                className='absolute -translate-y-1/2 pointer-events-none top-1/2 left-3 text-white/25'
              />
              <input
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
                placeholder='Search by email, ID, or cart value…'
                className='py-2 pr-3 text-xs text-white transition-colors border outline-none w-60 rounded-xl border-white/8 bg-white/4 pl-7 placeholder:text-white/25 focus:border-blue-500/40'
              />
            </div>
          </div>
        </div>
      </div>

      <RecoveryTicker />

      {/* ── Learning & System Health ── */}
      <div
        className='border-t shrink-0 border-white/6'
        style={{ background: '#0f1117' }}
      >
        <div className='grid grid-cols-3 divide-x divide-white/6'>
          <div className='px-5 py-3'>
            <div
              className='mb-2 text-xs font-semibold tracking-widest uppercase text-white/30'
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
                  <span className='text-xs text-white/35'>{s.label}</span>
                  {s.value && (
                    <span
                      className='text-xs font-semibold text-white'
                      style={mono}
                    >
                      {s.value}
                    </span>
                  )}
                  {s.badge && (
                    <span
                      className={`text-xs font-semibold ${s.badgeColor}`}
                      style={mono}
                    >
                      {s.badge}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className='px-5 py-3'>
            <div
              className='mb-2 text-xs font-semibold tracking-widest uppercase text-white/30'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              Recent AI Adaptations
            </div>
            <div className='flex flex-col gap-1.5'>
              {AI_ADAPTATIONS.map((t, i) => (
                <div key={i} className='flex items-start gap-1.5'>
                  <span className='mt-0.5 shrink-0 text-white/20'>•</span>
                  <span className='text-xs leading-relaxed text-white/40'>
                    {t}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className='px-5 py-3'>
            <div
              className='mb-2 text-xs font-semibold tracking-widest uppercase text-white/30'
              style={{ ...mono, fontSize: '0.58rem' }}
            >
              Recent Auto‑Decisions
            </div>
            <div className='mb-3 flex flex-col gap-1.5'>
              {AUTO_DECISIONS.map((d, i) => (
                <div key={i} className='flex items-start gap-2'>
                  <span className='text-xs shrink-0 text-white/25' style={mono}>
                    {d.time}
                  </span>
                  <span className='text-xs text-white/50'>
                    {d.visitor} — {d.action}
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowCmd(true)}
              className='flex items-center gap-2 rounded-lg border border-white/6 px-2.5 py-1.5 text-xs text-white/25 transition-colors hover:border-white/12 hover:text-white/50'
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
