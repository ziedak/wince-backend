import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { FallbackAvatar } from './fallbackAvatar';

export type SimpleItemType = {
  icon?: React.ElementType;
  title: string;
  subtitle: string;
  value: string;
  note: string;
  accent: string;
  url?: string;
};
export const SimpleItem: React.FC<SimpleItemType> = ({
  icon: Icon,
  title,
  subtitle,
  value,
  note,
  accent,
  url,
}) => {
  return (
    <Link
      to={url || '#'}
      className="flex items-center gap-3 px-5 py-3 hover:bg-accent/50 transition-colors"
    >
      {Icon && <Icon className="w-4.5 h-4.5" style={{ color: accent }} />}
      {!Icon && <FallbackAvatar name={title} />}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{title}</p>
        <p className="text-[11px] text-muted-foreground font-mono truncate">
          {subtitle}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-mono font-semibold text-foreground">
          {value}
        </p>
        <div className="flex items-center gap-1 justify-end">
          
          <p className="text-[11px] font-mono" style={{ color: accent }}>
            {note}
          </p>
        </div>
      </div>
    </Link>
  );
};
export const SimpleList: React.FC<{
  items: SimpleItemType[];
  title: string;
  url?: string;
}> = ({ items, title, url }) => {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {url && (
          <Link
            to={url}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
      <div className="divide-y divide-border">
        {items.length === 0 && (
          <div className="px-5 py-3 text-xs text-muted-foreground">
            No items to display
          </div>
        )}
        {items.map((v, index) => (
          <SimpleItem key={index} {...v} />
        ))}
      </div>
    </div>
  );
};
