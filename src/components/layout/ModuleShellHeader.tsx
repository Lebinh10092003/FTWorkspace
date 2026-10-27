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
    <header className="sticky top-0 z-30 flex h-14 lg:h-16 w-full items-center justify-between border-b border-[#DDE5EF] bg-white px-4 sm:px-6 backdrop-blur-md">
      {/* Left: Department Switcher & Breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50/70 px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs">
          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="truncate max-w-[130px]">{eyebrow || 'FermatTech'}</span>
          <ChevronsUpDown className="h-3 w-3 text-slate-400" />
        </div>
        <div className="h-4 w-px bg-slate-200 hidden sm:block" />
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-500 font-medium min-w-0">
          <span className="hover:text-slate-900 transition-colors cursor-pointer hidden md:inline">Workspace</span>
          <span className="text-slate-300 hidden md:inline">/</span>
          <span className="text-slate-900 font-bold truncate max-w-[160px]">{title}</span>
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
          className="hidden xl:flex items-center justify-between rounded-lg border border-slate-200/90 bg-slate-50/70 px-2.5 py-1.5 text-xs text-slate-400 hover:border-slate-300 hover:bg-slate-100/70 transition-colors cursor-pointer w-40"
          title="Tìm kiếm nhanh (Ctrl K)"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="truncate">Tìm nhanh...</span>
          </div>
          <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-500 shadow-2xs shrink-0">
            Ctrl K
          </kbd>
        </button>

        {actions && <div className="flex items-center gap-2">{actions}</div>}
        {account && (
          <div className="flex items-center gap-2 pl-1">
            <div className="hidden lg:block">
              <WorkspaceNotifications />
            </div>
            {account}
          </div>
        )}
      </div>
    </header>
  );
}
