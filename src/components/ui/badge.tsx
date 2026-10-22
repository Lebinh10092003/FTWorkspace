import React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const baseStyles = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2';

  const variants: Record<string, string> = {
    default: 'border-transparent bg-blue-600 text-white shadow hover:bg-blue-700',
    secondary: 'border-transparent bg-slate-100 text-slate-800 hover:bg-slate-200/80',
    destructive: 'border-transparent bg-red-100 text-red-700 hover:bg-red-200',
    outline: 'border border-slate-200 text-slate-700',
    success: 'border-transparent bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
    warning: 'border-transparent bg-amber-100 text-amber-800 hover:bg-amber-200',
    info: 'border-transparent bg-blue-50 text-blue-700 border border-blue-200',
  };

  return (
    <div className={cn(baseStyles, variants[variant] || variants.default, className)} {...props} />
  );
}
