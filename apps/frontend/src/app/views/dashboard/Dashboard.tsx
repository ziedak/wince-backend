import {
  DollarSign,
  ShoppingCart,
  Users,
  Zap,
  Brain,
  Activity,
  Truck,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  revenueRecoveryData,
  interventionPerformanceData,
  mockVisitors,
} from '../../lib/mockData';
import { KPICards } from './components/KPICards';
import { MetricCards } from './components/MetricCards';
import { SimpleList } from '@/app/components/primitives/simpleList';
import { Header } from '@/app/components/primitives/header';

const TEAL = '#00d4a8';
const INDIGO = '#6366f1';
const AMBER = '#f59e0b';
const ROSE = '#f43f5e';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs">
      <p className="text-muted-foreground mb-2 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-muted-foreground capitalize">{p.dataKey}:</span>
          <span className="text-foreground font-mono font-medium">
            ${p.value?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
};

const riskColor = (prob: number) => {
  if (prob >= 0.7) return '#f43f5e';
  if (prob >= 0.45) return '#f59e0b';
  return '#00d4a8';
};

export function Dashboard() {
  const highRisk = mockVisitors.filter((v) => v.abandonmentProbability > 0.6);
  const revenueRecovered = 43250;
  const recoveryRate = 28.4;
  const aiLift = 42.3;

  return (
    <div className="space-y-5">
      {/* Header */}
      <Header
        title="Dashboard"
        subtitle="Real-time insights into your revenue recovery performance"
      >
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-foreground">
            247 live sessions
          </span>
        </div>
      </Header>
      {/* KPI Grid */}
      <KPICards
        summaries={[
          {
            title: 'Revenue Recovered',
            value: revenueRecovered,
            oldValue: revenueRecovered - 5000,
            subtitle: 'This month',
            icon: DollarSign,
            accent: TEAL,
            periode: 'month',
          },
          {
            title: 'Recovery Rate',
            value: recoveryRate,
            oldValue: recoveryRate - 5.4,
            subtitle: 'This month',
            icon: ShoppingCart,
            accent: INDIGO,
            periode: 'month',
          },
          {
            title: 'Active Visitors',
            value: 247,
            oldValue: 247,
            subtitle: 'Right now',
            icon: Users,
            accent: AMBER,
            periode: 'month',
          },
          {
            title: 'AI Lift',
            value: aiLift,
            oldValue: aiLift + 8.7,
            subtitle: 'Above baseline',
            icon: Brain,
            accent: '#8b5cf6',
            periode: 'month',
          },
        ]}
      />

      {/* Charts */}
      <div className="grid  lg:grid-cols-3 gap-4">
        {/* Revenue trend — spans 2 cols */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Revenue Recovery Trend
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Recovered vs potential · last 8 days
              </p>
            </div>
            <span className="text-xs font-mono text-primary font-semibold">
              +$5,100 MTD
            </span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={revenueRecoveryData}>
              <defs>
                <linearGradient id="tealGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TEAL} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="indigoGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={INDIGO} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={INDIGO} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(148,163,184,0.06)"
              />
              <XAxis
                dataKey="date"
                stroke="rgba(148,163,184,0.4)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="rgba(148,163,184,0.4)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="potential"
                stroke={INDIGO}
                strokeWidth={1.5}
                fill="url(#indigoGrad)"
                name="potential"
              />
              <Area
                type="monotone"
                dataKey="recovered"
                stroke={TEAL}
                strokeWidth={2}
                fill="url(#tealGrad)"
                name="recovered"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Intervention Performance */}
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-foreground">
              Top Interventions
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Conversions by type
            </p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={interventionPerformanceData} layout="vertical">
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(148,163,184,0.06)"
                horizontal={false}
              />
              <XAxis
                type="number"
                stroke="rgba(148,163,184,0.4)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                dataKey="name"
                type="category"
                stroke="rgba(148,163,184,0.4)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={72}
              />
              <Tooltip
                cursor={{ fill: 'rgba(148,163,184,0.04)' }}
                contentStyle={{
                  backgroundColor: '#0c1526',
                  border: '1px solid rgba(148,163,184,0.09)',
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Bar dataKey="conversions" fill={TEAL} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row: High-risk sessions + AI activity */}
      <div className="grid  lg:grid-cols-2 gap-4">
        <SimpleList
          title="Recent AI Decisions"
          url="/ai-decisions"
          items={[
            {
              title: 'John D.',
              subtitle: 'Offered 10% discount',
              value: '85%',
              accent: riskColor(0.85),
              note: 'converted',
              url: '/journey/123',
            },
            {
              title: 'Emily R.',
              subtitle: 'Offered free shipping',
              value: '72%',
              accent: riskColor(0.72),
              note: 'abandoned',
              url: '/journey/124',
            },
            {
              title: 'Michael S.',
              subtitle: 'Offered 15% discount',
              value: '60%',
              accent: riskColor(0.6),
              note: 'pending',
              url: '/journey/125',
            },
          ]}
        />

        <SimpleList
          title="Recent Interventions"
          items={[
            {
              title: 'Summer Sale Promo',
              subtitle: 'Applied to 342 sessions',
              value: '1,284',
              accent: '#f43f5e',
              note: '',
            },
            {
              title: '10% Off Coupon',
              subtitle: 'Applied to 128 sessions',
              value: '256',
              icon: ShoppingCart,
              accent: '#8b5cf6',
              note: '',
            },
            {
              title: 'Free Shipping',
              subtitle: 'Applied to 76 sessions',
              value: '142',
              icon: Truck,
              accent: '#00d4a8',
              note: '20% conversion rate',
            },
          ]}
        />

        <SimpleList
          title=" High-Risk Sessions"
          url="/live-sessions"
          items={highRisk.slice(0, 5).map((v) => ({
            title: v.name,
            subtitle: v.currentPage,
            value: v.cartValue.toFixed(0),
            accent: riskColor(v.abandonmentProbability),
            note: `${(v.abandonmentProbability * 100).toFixed(0)}%`,
            url: `/journey/${v.id}`,
          }))}
        />
      </div>
      {/* Bottom metrics strip */}
      <MetricCards
        summaries={[
          {
            title: 'Avg Intervention Delay',
            value: '2.4s',
            accent: '#8b5cf6',
            icon: Activity,
            note: 'from trigger to display',
          },
          {
            title: 'Model Accuracy',
            value: '87.3%',
            icon: Brain,
            note: 'last 1,000 decisions',
          },
          {
            title: 'Revenue per Session',
            value: '$14.82',
            icon: DollarSign,
            note: '+$2.14 vs avg',
          },
          {
            title: 'Interventions Today',
            value: '1,284',
            icon: Zap,
            note: '342 converted',
          },
        ]}
      />
    </div>
  );
}
