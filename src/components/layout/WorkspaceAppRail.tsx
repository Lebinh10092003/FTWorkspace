import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronsUpDown, LayoutGrid, PanelLeftClose, PanelLeftOpen, Search, Sparkles } from 'lucide-react';
import { WORKSPACE_AREAS, WorkspaceArea, WorkspaceAreaId } from '../../config/workspaceNavigation';
import { DepartmentLayout, groupByDepartment } from '../../config/departmentLayout';

const COMPACT_STORAGE_KEY = 'ft-workspace-rail-compact';
const OTHERS_STORAGE_KEY = 'ft-workspace-rail-others';

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* Ignore */
  }
}

export type WorkspaceAppRailProps = {
  activeAreaId: WorkspaceAreaId | null;
  canAccess: (area: WorkspaceArea) => boolean;
  onSelect: (area: WorkspaceArea) => void;
  layout?: DepartmentLayout | null;
  userName?: string;
  userRole?: string;
  onOpenSearch?: () => void;
};

export default function WorkspaceAppRail({
  activeAreaId,
  canAccess,
  onSelect,
  layout = null,
  userName = 'Quản trị viên',
  userRole = 'ADMIN',
  onOpenSearch,
}: WorkspaceAppRailProps) {
  const [compact, setCompact] = useState(() => readFlag(COMPACT_STORAGE_KEY));
  const [othersOpen, setOthersOpen] = useState(() => readFlag(OTHERS_STORAGE_KEY));
  const visibleAreas = WORKSPACE_AREAS.filter(canAccess);

  useEffect(() => { writeFlag(COMPACT_STORAGE_KEY, compact); }, [compact]);
  useEffect(() => { writeFlag(OTHERS_STORAGE_KEY, othersOpen); }, [othersOpen]);

  const renderItem = (area: WorkspaceArea) => {
    const Icon = area.icon;
    const isActive = activeAreaId === area.id;
    const isNew = area.id === 'digital-training';

    return (
      <button
        key={area.id}
        type="button"
        onClick={() => onSelect(area)}
        className={`group relative flex items-center w-full transition-all duration-150 cursor-pointer rounded-lg select-none ${
          compact
            ? 'flex-col justify-center min-h-[3.25rem] px-1 py-1.5 gap-1'
            : 'gap-3 px-3 py-2 text-xs font-medium'
        } ${
          isActive
            ? 'bg-slate-900 text-white font-semibold shadow-xs'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
        aria-current={isActive ? 'page' : undefined}
        title={area.label}
      >
        <Icon
          className={`shrink-0 transition-colors ${
            compact ? 'h-5 w-5' : 'h-4 w-4'
          } ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-900'}`}
          aria-hidden="true"
        />

        {!compact ? (
          <div className="flex flex-1 items-center justify-between min-w-0">
            <span className="truncate leading-tight">{area.label}</span>
            {isNew && (
              <span
                className={`ml-1.5 px-1.5 py-0.2 rounded-md text-[10px] font-semibold border ${
                  isActive
                    ? 'bg-white/20 text-white border-white/30'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                }`}
              >
                Mới
              </span>
            )}
          </div>
        ) : (
          <span className="text-[10px] line-clamp-1 leading-none text-center font-normal">{area.shortLabel}</span>
        )}

        {compact && (
          <span
            className="absolute left-full top-1/2 ml-2 -translate-y-1/2 z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap rounded-md bg-slate-900 text-white px-2 py-1 text-xs font-medium shadow-md"
            role="tooltip"
          >
            {area.label}
          </span>
        )}
      </button>
    );
  };

  const mainAreas = visibleAreas.filter(area =>
    ['work-schedule', 'examination', 'digital-training', 'finance-report', 'attendance'].includes(area.id)
  );
  const toolAreas = visibleAreas.filter(area =>
    !['work-schedule', 'examination', 'digital-training', 'finance-report', 'attendance'].includes(area.id)
  );

  return (
    <nav
      className={`ft-app-rail ${compact ? 'is-compact' : ''} fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200/90 bg-white transition-[width] duration-200 ease-in-out ${
        compact ? 'w-[4.5rem] p-2' : 'w-64 p-3'
      }`}
      aria-label="Điều hướng chính FermatTech Workspace"
    >
      {/* 1. Brand Workspace Header */}
      <div className={`flex items-center gap-2.5 pb-3 border-b border-slate-100 ${compact ? 'justify-center' : 'px-1'}`}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs">
          <LayoutGrid className="h-4 w-4" />
        </div>
        {!compact && (
          <div className="flex flex-1 items-center justify-between min-w-0">
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight text-slate-900 truncate">FermatTech</h2>
              <p className="text-[11px] text-slate-400 font-medium truncate">Workspace OS</p>
            </div>
            <span className="flex h-5 items-center rounded-full bg-blue-50 px-2 text-[10px] font-semibold text-blue-700 border border-blue-200/60">
              v2.5
            </span>
          </div>
        )}
      </div>

      {/* 2. Quick Search Bar */}
      {!compact && (
        <div className="pt-3 pb-1">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/70 px-2.5 py-1.5 text-xs text-slate-400 hover:border-slate-300 hover:bg-slate-100/70 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <span>Tìm kiếm nhanh...</span>
            </div>
            <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-500 shadow-2xs">
              ⌘K
            </kbd>
          </button>
        </div>
      )}

      {/* 3. Navigation Items */}
      <div className="flex-1 overflow-y-auto space-y-4 pt-2 overscroll-contain pr-0.5 scrollbar-thin">
        {/* Dashboards Section */}
        {mainAreas.length > 0 && (
          <div className="space-y-1">
            {!compact && (
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Phân hệ nghiệp vụ
              </p>
            )}
            {mainAreas.map(renderItem)}
          </div>
        )}

        {/* Apps & Tools Section */}
        {toolAreas.length > 0 && (
          <div className="space-y-1">
            {!compact && (
              <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Công cụ & Quản trị
              </p>
            )}
            {toolAreas.map(renderItem)}
          </div>
        )}
      </div>

      {/* 4. Bottom User Profile & Rail Toggle */}
      <div className="pt-2 border-t border-slate-100 space-y-2">
        {!compact ? (
          <div className="flex items-center justify-between rounded-lg bg-slate-50/80 p-2 border border-slate-200/60">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-xs shadow-2xs">
                {userName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate leading-tight">{userName}</p>
                <p className="text-[10px] text-slate-500 truncate leading-tight">{userRole}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCompact(true)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition-colors cursor-pointer"
              title="Thu gọn thanh điều hướng"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCompact(false)}
            className="flex w-full items-center justify-center p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Mở rộng thanh điều hướng"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </nav>
  );
}
