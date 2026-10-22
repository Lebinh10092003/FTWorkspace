import React from 'react';
import { cn } from '../../lib/utils';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

export function TabsList({ items, activeId, onChange, className }: TabsProps) {
  return (
    <div
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-lg bg-slate-100 p-1 text-slate-500',
        className
      )}
    >
      {items.map((tab) => {
        const isActive = activeId === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold ring-offset-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
              isActive
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            )}
          >
            {Icon && <Icon className="w-3.5 h-3.5" />}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                className={cn(
                  'ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold',
                  isActive
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-200 text-slate-600'
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
