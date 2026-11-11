import React from 'react';
import { Search } from 'lucide-react';
import ModuleTopNav from './ModuleTopNav';
import { ModuleNavItem } from '../../config/workspaceNavigation';
import WorkspaceNotifications from '../WorkspaceNotifications';

export type ModuleShellHeaderProps = {
  /** Module name, shown at the far left. The logo lives in the shared rail. */
  title: string;
  /** Optional small line above the title (breadcrumb / context). */
  eyebrow?: string;
  items: ModuleNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
  /** Module-specific controls (search, "new" buttons). */
  actions?: React.ReactNode;
  /** Ẩn nút "Tìm nhanh" khi trang đã có ô tìm riêng trên thanh này (Ctrl K vẫn dùng được). */
  quickSearch?: boolean;
};

export default function ModuleShellHeader({
  title,
  eyebrow,
  items,
  activeId,
  onSelect,
  ariaLabel,
  actions,
  quickSearch = true,
}: ModuleShellHeaderProps) {
  const handleOpenSearch = () => {
    window.dispatchEvent(new CustomEvent('toggle-command-palette'));
  };

  return (
    <header className="sticky top-0 z-30 flex flex-col w-full border-b border-[var(--ft-border,#DDE5EF)] bg-[var(--workspace-card,#FFFFFF)] text-[var(--workspace-surface-text,#0F1F33)] backdrop-blur-md">
      <div className="flex min-h-14 w-full min-w-0 items-center px-3 py-1 sm:px-6">
        <div className="flex w-full min-w-0 items-center justify-start overflow-hidden">
          <ModuleTopNav items={items} activeId={activeId} onSelect={onSelect} ariaLabel={ariaLabel || `Điều hướng ${title}`} />
        </div>
      </div>
      <div className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 border-t border-[var(--ft-border-soft,#e2e8f0)] px-3 py-1.5 sm:px-6">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--workspace-surface-muted,#64748b)]">
          <a href="/" className="hover:text-[var(--workspace-surface-text,#0F1F33)]">Workspace</a>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">/</span>
          <span aria-current="page" className="truncate font-bold text-[var(--workspace-surface-text,#0F1F33)]">{title}</span>
          {eyebrow && <span className="sr-only">{eyebrow}</span>}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {quickSearch && (
          <button
            type="button"
            onClick={handleOpenSearch}
            className="hidden xl:flex items-center justify-between rounded-lg border border-[var(--ft-border-soft,#e2e8f0)] bg-[var(--ft-surface-2,rgba(255,255,255,0.06))] px-2.5 py-1.5 text-xs text-[var(--workspace-surface-muted,#64748b)] hover:border-slate-300 transition-colors cursor-pointer w-40"
            title="Tìm kiếm nhanh (Ctrl K)"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <Search className="h-3.5 w-3.5 text-[var(--workspace-surface-muted,#64748b)] shrink-0" />
              <span className="truncate">Tìm nhanh...</span>
            </div>
            <kbd className="rounded border border-[var(--ft-border-soft,#e2e8f0)] bg-[var(--workspace-card,#FFFFFF)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--workspace-surface-muted,#64748b)] shadow-2xs shrink-0">
              Ctrl K
            </kbd>
          </button>
          )}

          {actions && <div className="hidden sm:flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
          {/* Tài khoản nằm ở thanh điều hướng (rail / thanh trên mobile); ở đây chỉ còn thông báo trên máy tính. */}
          <div className="hidden lg:block pl-1">
            <WorkspaceNotifications />
          </div>
        </div>
      </div>

      {/* Mobile action bar for sub-controls */}
      {actions && (
        <div className="sm:hidden flex items-center justify-start gap-2 px-3 py-2 border-t border-[var(--ft-border-soft,#f1f5f9)] bg-[var(--workspace-card,#FFFFFF)] overflow-x-auto w-full scrollbar-none flex-nowrap">
          {actions}
        </div>
      )}
    </header>
  );
}
