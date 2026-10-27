import React from 'react';
import { ChevronsUpDown, Search } from 'lucide-react';
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
  /** Module-specific controls (search, "new" buttons) placed before the account menu. */
  actions?: React.ReactNode;
  account?: React.ReactNode;
};

export default function ModuleShellHeader({
  title,
  eyebrow,
  items,
  activeId,
  onSelect,
  ariaLabel,
  actions,
  account,
}: ModuleShellHeaderProps) {
  const handleOpenSearch = () => {
    window.dispatchEvent(new CustomEvent('toggle-command-palette'));
  };

  return (
    <header className="sticky top-0 z-30 flex flex-col w-full border-b border-[var(--ft-border,#DDE5EF)] bg-[var(--workspace-card,#FFFFFF)] text-[var(--workspace-surface-text,#0F1F33)] backdrop-blur-md">
      <div className="flex h-14 lg:h-16 w-full items-center justify-between px-3 sm:px-6">
        {/* Left: Department Switcher & Breadcrumbs */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-[var(--ft-border-soft,#e2e8f0)] bg-[var(--ft-surface-2,rgba(255,255,255,0.06))] px-2.5 py-1 text-xs font-semibold text-[var(--workspace-surface-text,#0F1F33)] shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="truncate max-w-[130px]">{eyebrow || 'FermatTech'}</span>
            <ChevronsUpDown className="h-3 w-3 text-[var(--workspace-surface-muted,#94a6be)]" />
          </div>
          <div className="h-4 w-px bg-[var(--ft-border-soft,#e2e8f0)] hidden sm:block" />
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-[var(--workspace-surface-muted,#64748b)] font-medium min-w-0">
            <span className="hover:text-[var(--workspace-surface-text,#0F1F33)] transition-colors cursor-pointer hidden md:inline">Workspace</span>
            <span className="text-slate-300 dark:text-slate-600 hidden md:inline">/</span>
            <span className="text-[var(--workspace-surface-text,#0F1F33)] font-bold truncate max-w-[200px] sm:max-w-none">{title}</span>
          </nav>
        </div>

        {/* Center: Module Sub-navigation tabs */}
        <div className="flex flex-1 items-center justify-center px-1 sm:px-3 min-w-0 overflow-hidden">
          <ModuleTopNav items={items} activeId={activeId} onSelect={onSelect} ariaLabel={ariaLabel || `Điều hướng ${title}`} />
        </div>

        {/* Right: Search, Actions & User Avatar */}
        <div className="flex items-center gap-2 shrink-0">
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

          {actions && <div className="hidden sm:flex items-center gap-2">{actions}</div>}
          {account && (
            <div className="flex items-center gap-2 pl-1">
              <div className="hidden lg:block">
                <WorkspaceNotifications />
              </div>
              {account}
            </div>
          )}
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
