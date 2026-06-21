export type SimpleSummaryCardProps = {
  title: string;
  value: string;
  accent?: string;
  icon?: React.ElementType;
  note?: string;
};
export const SimpleSummaryCard: React.FC<SimpleSummaryCardProps> = ({
  title,
  value,
  icon: Icon,
  note,
  accent,
}: SimpleSummaryCardProps) => {
  return (
    <div
      key={title}
      className="bg-card border border-border rounded-lg px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1">
        {Icon && (
          <Icon
            className="w-3.5 h-3.5 text-muted-foreground"
            style={{ color: accent }}
          />
        )}
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
          {title}
        </p>
      </div>
      <p className="text-lg font-semibold text-foreground font-mono">{value}</p>
      {note && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{note}</p>
      )}
    </div>
  );
};
