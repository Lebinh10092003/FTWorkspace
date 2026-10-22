import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Card } from './card';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive?: boolean;
    label?: string;
  };
  variant?: 'blue' | 'emerald' | 'amber' | 'rose' | 'slate';
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = 'blue',
  className,
}: StatCardProps) {
  const iconVariants = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
  };

  return (
    <Card className={cn('p-5 hover:shadow-md transition-shadow relative overflow-hidden', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</span>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center border', iconVariants[variant])}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold tracking-tight text-slate-900">{value}</span>
        {trend && (
          <span
            className={cn(
              'inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full',
              trend.isPositive
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-rose-50 text-rose-700'
            )}
          >
            {trend.value}
          </span>
        )}
      </div>
      {(subtitle || trend?.label) && (
        <p className="mt-1 text-xs text-slate-500">
          {trend?.label ? `${trend.label} • ` : ''}
          {subtitle}
        </p>
      )}
    </Card>
  );
}
