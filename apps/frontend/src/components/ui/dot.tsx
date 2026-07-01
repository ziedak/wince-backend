import { cn } from '@utils/utils';

export const Dot: React.FC<{ className?: string; accent?: string }> = ({ className, accent = '#E0E0E0' }) => {
  return (
    <div
      className={cn('w-1.5 h-1.5 rounded-full', className)}
      style={{ backgroundColor: accent }}
    />
  );
}