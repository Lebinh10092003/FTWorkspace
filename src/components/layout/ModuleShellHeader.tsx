import React, { useContext, useEffect } from 'react';
import { Search } from 'lucide-react';
import ModuleTopNav from './ModuleTopNav';
import { ModuleNavItem } from '../../config/workspaceNavigation';
import WorkspaceNotifications from '../WorkspaceNotifications';
import { WorkspaceModuleContext } from './WorkspaceModuleNavigation';

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
  /** Current record or editor, after its owning list in the breadcrumb. */
  detailTitle?: string;
  parentHref?: string;
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
  detailTitle,
  parentHref,
}: ModuleShellHeaderProps) {
  const moduleContext = useContext(WorkspaceModuleContext);
  const register = moduleContext?.register;
  const areaId = moduleContext?.areaId || null;
  useEffect(() => {
    register?.({ areaId, items, activeId, onSelect });
    return () => register?.(null);
  }, [register, areaId, items, activeId, onSelect]);
  const currentItem = items.flatMap(item => item.children || [item]).find(item => item.id === activeId);
  const areaTitle = moduleContext?.areaTitle || title;
  const pageTitle = currentItem?.label || title;
  const firstLeaf = (rows: ModuleNavItem[]): ModuleNavItem | undefined => {
    const first = rows[0]; return first?.children?.length ? firstLeaf(first.children) : first;
  };
  const rootItem = items.find(item => item.id === areaId) || firstLeaf(items);
  const navigateLink = (event: React.MouseEvent<HTMLAnchorElement>, action?: () => void) => {
    if (!action || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); action();
  };
  const breadcrumbLink = 'rounded px-0.5 py-1 text-left transition-colors hover:text-[var(--ft-blue,#0B72CE)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
  const handleOpenSearch = () => {
    window.dispatchEvent(new CustomEvent('toggle-command-palette'));
  };

  return (
    <header className="sticky top-0 z-30 flex flex-col w-full border-b border-[var(--ft-border,#DDE5EF)] bg-[var(--workspace-card,#FFFFFF)] text-[var(--workspace-surface-text,#0F1F33)] backdrop-blur-md">
      <div className="flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-1 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center justify-start overflow-hidden">
          <ModuleTopNav items={items} activeId={activeId} onSelect={onSelect} ariaLabel={ariaLabel || `Điều hướng ${title}`} />
        </div>
        <div className="hidden shrink-0 items-center gap-2 lg:flex" aria-label="Tiện ích Workspace">
          {quickSearch && <button type="button" onClick={handleOpenSearch} aria-label="Tìm nhanh (Ctrl K)" title="Tìm nhanh (Ctrl K)"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--ft-border-soft,#e2e8f0)] bg-[var(--workspace-card,#FFFFFF)] px-2.5 text-xs text-[var(--workspace-surface-muted,#64748b)] transition-colors hover:border-slate-300 xl:w-auto xl:justify-between">
            <Search className="h-4 w-4 shrink-0" /><span className="hidden whitespace-nowrap xl:inline">Tìm nhanh...</span><kbd className="hidden whitespace-nowrap rounded border border-[var(--ft-border-soft,#e2e8f0)] px-1 text-[10px] xl:inline">Ctrl K</kbd>
          </button>}
          <WorkspaceNotifications />
        </div>
      </div>
      <div className="w-full border-t border-[var(--ft-border-soft,#e2e8f0)] bg-[var(--ft-page-bg,#F3F6FA)] px-3 py-2 sm:px-6">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-medium text-[var(--workspace-surface-muted,#64748b)]">
          <a href="/" onClick={event => navigateLink(event, moduleContext?.goHome)} className={breadcrumbLink}>Workspace</a>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">/</span>
          {pageTitle !== areaTitle || detailTitle ? <a href={moduleContext?.areaPath || '#'} onClick={event => navigateLink(event, rootItem ? () => onSelect(rootItem.id) : undefined)} className={breadcrumbLink}>{areaTitle}</a> : <span aria-current="page" className="font-bold">{areaTitle}</span>}
          {pageTitle !== areaTitle && <><span aria-hidden="true" className="text-slate-300 dark:text-slate-600">/</span>{detailTitle ? parentHref ? <a href={parentHref} onClick={event => navigateLink(event, () => onSelect(activeId))} className={breadcrumbLink}>{pageTitle}</a> : <button type="button" onClick={() => onSelect(activeId)} className={breadcrumbLink}>{pageTitle}</button> : <span aria-current="page" className="font-bold text-[var(--workspace-surface-text,#0F1F33)]">{pageTitle}</span>}</>}
          {detailTitle && <><span aria-hidden="true" className="text-slate-300 dark:text-slate-600">/</span><span aria-current="page" className="max-w-full break-words font-bold text-[var(--workspace-surface-text,#0F1F33)]">{detailTitle}</span></>}
          {eyebrow && ![areaTitle, pageTitle, detailTitle].includes(eyebrow) && <span className="sr-only">{eyebrow}</span>}
        </nav>
      </div>
      {actions && <div className="flex w-full items-center justify-start gap-2 overflow-x-auto border-t border-[var(--ft-border-soft,#e2e8f0)] px-3 py-2 scrollbar-none sm:flex-wrap sm:justify-end sm:px-6" aria-label="Công cụ của trang">{actions}</div>}

    </header>
  );
}
