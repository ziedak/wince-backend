'use client';

import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';

import { cn } from '@utils/utils';

function Progress({
  className,
  value,
  showPercentage = false,
  accent,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  accent?: string;
  showPercentage?: boolean;
}) {
  return (
   <div className="flex items-center gap-2">
      <ProgressPrimitive.Root
        data-slot="progress"
        className={cn(
          'bg-primary/20 relative h-2 w-full overflow-hidden rounded-full',
          className,
        )}
        style={{ backgroundColor: 'rgba(148,163,184,0.12)' }}
        {...props}
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn('h-full w-full flex-1 transition-all')}
          style={{
            transform: `translateX(-${100 - (value || 0)}%)`,
            backgroundColor: accent,
          }}
        />
      </ProgressPrimitive.Root>
      {showPercentage && value && (
        <span
          className="text-xs font-mono font-semibold"
          style={{ color: accent }}
        >
          {value.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

export { Progress };
