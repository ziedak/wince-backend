import { TrendingDown, TrendingUp } from 'lucide-react';

export type SummaryCardProps = {
  title: string;
  accent: string;
  value: number;
  oldValue?: number;
  icon?: React.ElementType;
  subtitle?: string;
  periode?: 'day' | 'week' | 'month' | 'year';
};
export const SummaryCard: React.FC<SummaryCardProps> = ({
  title,
  value,
  oldValue = value,
  icon: Icon,
  subtitle,
  accent,
  periode = 'week',
}: SummaryCardProps) => {
  const trend = value >= oldValue;
  const prchange = ((value - oldValue) / oldValue) * 100;
  return (
    <div className=" bg-card border border-border rounded-lg p-5 flex flex-col gap-3 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            {title}
          </p>
          <p className="text-2xl font-semibold text-foreground font-mono">
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${accent}18` }}
          >
            <Icon className="w-4.5 h-4.5" style={{ color: accent }} />
          </div>
        )}
      </div>
      {value !== oldValue && (
        <div className=" flex items-center gap-1.5 ">
          {trend ? (
            <TrendingUp className="w-3.5 h-3.5 text-trend-up" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-trend-down" />
          )}
          <span
            className={`text-xs font-semibold font-mono ${trend ? 'text-trend-up' : 'text-trend-down'}`}
          >
            {trend ? '+' : ''}
            {prchange.toFixed(2)}%
          </span>
          <span className="text-xs text-muted-foreground">
            vs last {periode}
          </span>
        </div>
      )}
    </div>
  );
};
