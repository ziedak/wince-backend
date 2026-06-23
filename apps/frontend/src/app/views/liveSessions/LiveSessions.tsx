import { useState } from 'react';
import {
  Monitor,
  Smartphone,
  Tablet,
  MapPin,
  Clock,
  Search,
} from 'lucide-react';
import { mockVisitors } from '../../lib/mockData';
import { Link } from 'react-router';
import { Header } from '@/app/components/ui/header';
import { MetricCards } from './components/MetricCards';
import { FallbackAvatar } from '@/app/components/ui/fallbackAvatar';
import { Progress } from '@/app/components/ui/progress';
import { Chip } from '@/app/components/ui/chip';
import { Dot } from '@/app/components/ui/dot';
import { SimpleTable } from '@/app/components/simpleTable';

const deviceIcons = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };

const riskLabel = (p: number) => {
  if (p >= 0.7)
    return { label: 'Critical', color: '#f43f5e', bg: 'rgba(244,63,94,0.12)' };
  if (p >= 0.45)
    return { label: 'High', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  return { label: 'Low', color: '#00d4a8', bg: 'rgba(0,212,168,0.12)' };
};

const stateLabel = (s: string) => {
  switch (s) {
    case 'triggered':
      return { label: 'Intervening', color: '#6366f1' };
    case 'converted':
      return { label: 'Converted', color: '#00d4a8' };
    case 'dismissed':
      return { label: 'Dismissed', color: '#64748b' };
    default:
      return { label: 'Monitoring', color: '#64748b' };
  }
};

export function LiveSessions() {
  const [filterDevice, setFilterDevice] = useState('all');
  const [filterRisk, setFilterRisk] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  let filtered = mockVisitors;
  if (filterDevice !== 'all')
    filtered = filtered.filter((v) => v.device === filterDevice);
  if (filterRisk === 'critical')
    filtered = filtered.filter((v) => v.abandonmentProbability >= 0.7);
  else if (filterRisk === 'high')
    filtered = filtered.filter(
      (v) => v.abandonmentProbability >= 0.45 && v.abandonmentProbability < 0.7,
    );
  else if (filterRisk === 'low')
    filtered = filtered.filter((v) => v.abandonmentProbability < 0.45);
  if (searchQuery)
    filtered = filtered.filter(
      (v) =>
        v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.currentPage.toLowerCase().includes(searchQuery.toLowerCase()),
    );

  const statCounts = {
    total: mockVisitors.length,
    critical: mockVisitors.filter((v) => v.abandonmentProbability >= 0.7)
      .length,
    intervening: mockVisitors.filter((v) => v.interventionState === 'triggered')
      .length,
    converted: mockVisitors.filter((v) => v.interventionState === 'converted')
      .length,
  };

  const formatDuration = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <div className="space-y-5">
      <Header
        title="Live Sessions"
        subtitle="Real-time visitor monitoring · updated every 5s"
      >
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-foreground">
            {statCounts.total} active
          </span>
        </div>
      </Header>
      {/* Stats strip */}
      <MetricCards
        summaries={[
          {
            title: 'Total Sessions',
            value: statCounts.total.toString(),
            accent: '#e2e8f4',
          },
          {
            title: 'Critical Risk',
            value: statCounts.critical.toString(),
            accent: '#f43f5e',
          },
          {
            title: 'Intervening',
            value: statCounts.intervening.toString(),
            accent: '#6366f1',
          },
          {
            title: 'Converted',
            value: statCounts.converted.toString(),
            accent: '#00d4a8',
          },
        ]}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-50 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search visitors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
          {['all', 'desktop', 'mobile', 'tablet'].map((d) => (
            <button
              key={d}
              onClick={() => setFilterDevice(d)}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize"
              style={{
                backgroundColor:
                  filterDevice === d ? 'var(--accent)' : 'transparent',
                color:
                  filterDevice === d
                    ? 'var(--accent-foreground)'
                    : 'var(--muted-foreground)',
              }}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
          {[
            { key: 'all', label: 'All Risk' },
            { key: 'critical', label: 'Critical' },
            { key: 'high', label: 'High' },
            { key: 'low', label: 'Low' },
          ].map((r) => (
            <button
              key={r.key}
              onClick={() => setFilterRisk(r.key)}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
              style={{
                backgroundColor:
                  filterRisk === r.key ? 'var(--accent)' : 'transparent',
                color:
                  filterRisk === r.key
                    ? 'var(--accent-foreground)'
                    : 'var(--muted-foreground)',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sessions table */}
      <SimpleTable
        columns={[
          {
            header: 'Visitor',
            render: (row) => (
              <Link
                to={`/journey/${row.id}`}
                className="flex items-center gap-2.5 group"
              >
                <FallbackAvatar name={row.name} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground group-hover:text-primary transition-colors truncate">
                    {row.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {row.email}
                  </p>
                </div>
              </Link>
            ),
          },
          {
            header: 'Device',
            render: (row) => {
              const DevIcon = deviceIcons[row.device];
              return (
                <div className="flex items-center gap-1.5">
                  <DevIcon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground capitalize">
                    {row.device}
                  </span>
                </div>
              );
            },
          },
          {
            header: 'Current Page',
            render: (row) => (
              <div>
                <p className="text-xs text-foreground font-mono truncate max-w-35">
                  {row.currentPage}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 text-muted-foreground" />
                  <p className="text-[11px] text-muted-foreground">
                    {row.location}
                  </p>
                </div>
              </div>
            ),
          },
          {
            header: 'Cart',
            render: (row) => (
              <p className="text-xs font-mono font-semibold text-foreground">
                ${row.cartValue.toFixed(2)}
              </p>
            ),
          },
          {
            header: 'Abandonment Risk',
            render: (row) => {
              const risk = riskLabel(row.abandonmentProbability);
              return (
                <Progress
                  showPercentage={true}
                  value={row.abandonmentProbability * 100}
                  className="w-16 h-1.5"
                  accent={risk.color}
                />
              );
            },
          },
          {
            header: 'Frustration',
            render: (row) => {
              const risk = riskLabel(row.frustrationScore);
              return (
                <Progress
                  showPercentage={true}
                  value={row.frustrationScore * 100}
                  className="w-16 h-1.5"
                  accent={risk.color}
                />
              );
            },
          },

          {
            header: 'State',
            render: (row) => {
              const state = stateLabel(row.interventionState);

              return (
                <Chip accent={state.color}>
                  {row.interventionState === 'triggered' && (
                    <Dot className="animate-pulse" accent={state.color} />
                  )}
                  {state.label}
                </Chip>
              );
            },
          },
          {
            header: 'Session',
            render: (row) => (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="w-3 h-3" />
                {formatDuration(row.timeOnSite)}
              </div>
            ),
          },
        ]}
        data={filtered.map((v) => ({
          ...v,
        }))}
      />
    </div>
  );
}
