import React from 'react';
import { ChevronRight } from 'lucide-react';

export type ResponsiveDataListItemProps = {
  id: string | number;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  statusBadge?: React.ReactNode;
  metadata?: Array<{
    label: string;
    value: React.ReactNode;
    icon?: React.ComponentType<{ className?: string }>;
  }>;
  actions?: React.ReactNode;
  onClick?: () => void;
  className?: string;
};

export type ResponsiveDataListProps<T> = {
  items: T[];
  keyExtractor: (item: T, index: number) => string | number;
  renderCard?: (item: T, index: number) => React.ReactNode;
  primaryExtractor?: (item: T) => React.ReactNode;
  secondaryExtractor?: (item: T) => React.ReactNode;
  badgeExtractor?: (item: T) => React.ReactNode;
  metadataExtractor?: (item: T) => Array<{ label: string; value: React.ReactNode }>;
  actionsExtractor?: (item: T) => React.ReactNode;
  onItemClick?: (item: T) => void;
  emptyMessage?: string;
  className?: string;
};

export function ResponsiveDataCard({
  primary,
  secondary,
  statusBadge,
  metadata,
  actions,
  onClick,
  className = '',
}: ResponsiveDataListItemProps) {
  const isClickable = Boolean(onClick);

  return (
    <div
      onClick={onClick}
      className={`relative rounded-[12px] border border-[#DDE5EF] bg-white p-3.5 shadow-xs transition-all ${
        isClickable ? 'cursor-pointer hover:border-[#0B72CE]/40 hover:shadow-sm active:bg-slate-50/70' : ''
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#0F1F33] leading-snug break-words">
            {primary}
          </div>
          {secondary && (
            <div className="mt-1 text-xs text-[#4A5B70] leading-relaxed break-words">
              {secondary}
            </div>
          )}
        </div>
        {statusBadge && <div className="shrink-0">{statusBadge}</div>}
      </div>

      {metadata && metadata.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2.5 text-xs">
          {metadata.map((meta, idx) => {
            const Icon = meta.icon;
            return (
              <div key={idx} className="min-w-0">
                <span className="block text-[11px] font-medium text-slate-400 truncate">
                  {meta.label}
                </span>
                <span className="mt-0.5 flex items-center gap-1 font-semibold text-slate-700 truncate">
                  {Icon && <Icon className="h-3 w-3 shrink-0 text-slate-400" />}
                  {meta.value}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {actions && (
        <div
          className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-2.5"
          onClick={e => e.stopPropagation()}
        >
          {actions}
        </div>
      )}

      {isClickable && !actions && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none">
          <ChevronRight className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

export default function ResponsiveDataList<T>({
  items,
  keyExtractor,
  renderCard,
  primaryExtractor,
  secondaryExtractor,
  badgeExtractor,
  metadataExtractor,
  actionsExtractor,
  onItemClick,
  emptyMessage = 'Không có dữ liệu',
  className = '',
}: ResponsiveDataListProps<T>) {
  if (!items || items.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-slate-200 bg-white p-6 text-center text-xs sm:text-sm text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`space-y-2.5 ${className}`}>
      {items.map((item, index) => {
        const key = keyExtractor(item, index);
        if (renderCard) {
          return <React.Fragment key={key}>{renderCard(item, index)}</React.Fragment>;
        }

        return (
          <ResponsiveDataCard
            key={key}
            id={key}
            primary={primaryExtractor ? primaryExtractor(item) : String(key)}
            secondary={secondaryExtractor ? secondaryExtractor(item) : undefined}
            statusBadge={badgeExtractor ? badgeExtractor(item) : undefined}
            metadata={metadataExtractor ? metadataExtractor(item) : undefined}
            actions={actionsExtractor ? actionsExtractor(item) : undefined}
            onClick={onItemClick ? () => onItemClick(item) : undefined}
          />
        );
      })}
    </div>
  );
}
