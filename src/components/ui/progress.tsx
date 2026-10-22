import React from 'react';
import { cn } from '../../lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  indicatorClassName?: string;
}

export function Progress({
  className,
  value = 0,
  max = 100,
  indicatorClassName,
  ...props
}: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-slate-100',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'h-full w-full flex-1 bg-blue-600 transition-all duration-300 ease-in-out',
          indicatorClassName
        )}
        style={{ transform: `translateX(-${100 - percentage}%)` }}
      />
    </div>
  );
}
