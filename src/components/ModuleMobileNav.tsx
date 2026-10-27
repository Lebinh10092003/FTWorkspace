import React from 'react';
import { ArrowLeft } from 'lucide-react';

export type ModuleMobileNavItem = {
  id: string;
  label: string;
  icon?: React.ElementType;
};

type ModuleMobileNavProps = {
  items: ModuleMobileNavItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  onBack?: () => void;
  backLabel?: string;
  ariaLabel?: string;
  className?: string;
};

export default function ModuleMobileNav({
  items,
  activeId,
  onSelect,
  onBack,
  backLabel = 'Workspace',
  ariaLabel = 'Điều hướng mô-đun',
  className = '',
}: ModuleMobileNavProps) {
  return (
    <nav
      className={`flex items-center gap-1.5 overflow-x-auto p-2 bg-white border-b border-[#DDE5EF] scrollbar-none select-none ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {onBack && (
        <button
          type="button"
          className="flex items-center gap-1 px-3 py-2 rounded-[10px] text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors shrink-0 min-h-[44px] cursor-pointer"
          onClick={onBack}
          title={`Quay lại ${backLabel}`}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{backLabel}</span>
        </button>
      )}
      {items.map(({ id, label, icon: Icon }) => {
        const isActive = activeId === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-xs transition-all shrink-0 min-h-[44px] cursor-pointer ${
              isActive
                ? 'bg-[#E5F0FB] text-[#0A5BA5] font-semibold border border-[#0B72CE]/30 shadow-2xs'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200/60 font-medium'
            }`}
          >
            {Icon && (
              <Icon
                className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#0B72CE]' : 'text-slate-400'}`}
                aria-hidden="true"
              />
            )}
            <span className="whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
