import { cn, generateColors } from './utils';
export const Chip: React.FC<{
  children: React.ReactNode;
  className?: string;
  accent?: string;
}> = ({ children, className, accent = '#E0E0E0' }) => {
  // const colors=generateColors(accent);

  return (
    <div
      className={cn(
        'inline-flex items-center  gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium border',
        'bg-muted text-muted-foreground',
        className,
      )}
      style={{
        color: accent,
        borderColor: `${accent}40`,
        backgroundColor: `${accent}12`,
      }}
      // style={{ backgroundColor: colors.backgroundColor, borderColor: colors.backgroundColor, color: colors.color }}
    >
      {children}
    </div>
  );
};
