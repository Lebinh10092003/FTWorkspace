import React, { useEffect, useState } from 'react';
import {
  CalendarCheck,
  CalendarRange,
  ClipboardList,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react';
import { WORKSPACE_AREAS, WorkspaceArea, WorkspaceAreaId } from '../../config/workspaceNavigation';
import { DepartmentLayout } from '../../config/departmentLayout';

const COMPACT_STORAGE_KEY = 'ft-workspace-rail-compact';

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
  onAccountClick?: () => void;
};

export default function WorkspaceAppRail({
  activeAreaId,
  canAccess,
  onSelect,
  userName = 'Người dùng',
  userRole = 'EMPLOYEE',
  onOpenSearch,
  onAccountClick,
}: WorkspaceAppRailProps) {
  const [compact, setCompact] = useState(() => readFlag(COMPACT_STORAGE_KEY));
  const visibleAreas = WORKSPACE_AREAS.filter(canAccess);

  useEffect(() => {
    writeFlag(COMPACT_STORAGE_KEY, compact);
  }, [compact]);

  const renderItem = (area: WorkspaceArea) => {
    const Icon = area.icon;
    const isActive = activeAreaId === area.id;

    return (
      <button
        key={area.id}
        type="button"
        onClick={() => onSelect(area)}
        className={`group relative flex items-center w-full transition-all duration-150 cursor-pointer rounded-[10px] select-none ${
          compact
            ? 'flex-col justify-center min-h-[3.25rem] px-1 py-1.5 gap-1'
            : 'gap-3 px-3 py-2 text-xs font-medium'
        } ${
          isActive
            ? 'bg-white/14 text-white font-semibold shadow-xs'
            : 'text-[#C9D6E6] hover:bg-white/8 hover:text-white'
        }`}
        aria-current={isActive ? 'page' : undefined}
        title={area.label}
      >
        <Icon
          className={`shrink-0 transition-colors ${
            compact ? 'h-5 w-5' : 'h-4 w-4'
          } ${isActive ? 'text-white' : 'text-[#8FA6C0] group-hover:text-white'}`}
          aria-hidden="true"
        />

        {!compact ? (
          <div className="flex flex-1 items-center justify-between min-w-0">
            <span className="truncate leading-tight text-left">{area.label}</span>
          </div>
        ) : (
          <span className="text-[10px] line-clamp-1 leading-none text-center font-normal">
            {area.shortLabel}
          </span>
        )}

        {compact && (
          <span
            className="absolute left-full top-1/2 ml-2 -translate-y-1/2 z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap rounded-md bg-[#0B2A4A] text-white px-2 py-1 text-xs font-medium shadow-md border border-white/10"
            role="tooltip"
          >
            {area.label}
          </span>
        )}
      </button>
    );
  };

  // Grouping according to Direction A
  // 1. Home
  const homeArea = visibleAreas.find(area => area.id === 'workspace');

  // 2. Nhóm "Của tôi": Lịch công tác, Chấm công, Báo cáo tuần
  const myAreasOrder: WorkspaceAreaId[] = ['work-schedule', 'attendance', 'weekly-report'];
  const myAreas = myAreasOrder
    .map(id => visibleAreas.find(a => a.id === id))
    .filter((a): a is WorkspaceArea => Boolean(a));

  // 3. Nhóm "Phân hệ": Tất cả các phân hệ & công cụ còn lại
  const myAreaIds = new Set(['workspace', ...myAreasOrder]);
  const departmentAreas = visibleAreas.filter(area => !myAreaIds.has(area.id));

  return (
    <nav
      className={`fixed inset-y-0 left-0 z-40 hidden lg:flex flex-col border-r border-[#0B2A4A]/20 bg-[#0B2A4A] transition-[width] duration-200 ease-in-out ${
        compact ? 'w-[4.5rem] p-2' : 'w-[248px] p-3'
      }`}
      aria-label="Điều hướng chính FermatTech Workspace"
    >
      {/* 1. Brand Workspace Header with White Plate Logo */}
      <div
        className={`flex items-center gap-2.5 pb-3 border-b border-white/10 ${
          compact ? 'justify-center' : 'px-1'
        }`}
      >
        <div className="flex h-9 shrink-0 items-center justify-center rounded-[10px] bg-white p-1.5 shadow-xs">
          <img src="/logo.png" alt="FermatTech" className="h-6 w-auto object-contain" />
        </div>
        {!compact && (
          <div className="flex flex-1 items-center justify-between min-w-0">
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight text-white truncate">FermatTech</h2>
              <p className="text-[11px] text-[#8FA6C0] font-medium truncate">Workspace OS</p>
            </div>
            <span className="flex h-5 items-center rounded-full bg-white/10 px-2 text-[10px] font-semibold text-[#C9D6E6] border border-white/15">
              v2.5
            </span>
          </div>
        )}
      </div>

      {/* 2. Quick Search Bar on Desktop Rail */}
      {!compact && onOpenSearch && (
        <div className="pt-3 pb-1">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex w-full items-center justify-between rounded-[10px] border border-white/10 bg-white/6 px-2.5 py-1.5 text-xs text-[#8FA6C0] hover:border-white/20 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-[#8FA6C0]" />
              <span>Tìm kiếm nhanh...</span>
            </div>
            <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-[#C9D6E6]">
              Ctrl K
            </kbd>
          </button>
        </div>
      )}

      {/* 3. Navigation Groups */}
      <div className="flex-1 overflow-y-auto space-y-3 pt-2 overscroll-contain pr-0.5 scrollbar-thin">
        {/* Trang chủ */}
        {homeArea && (
          <div className="space-y-1">
            {renderItem(homeArea)}
          </div>
        )}

        {/* Nhóm CỦA TÔI */}
        {myAreas.length > 0 && (
          <div className="space-y-1">
            {!compact && (
              <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[#8FA6C0]">
                Của tôi
              </p>
            )}
            {myAreas.map(renderItem)}
          </div>
        )}

        {/* Nhóm PHÂN HỆ */}
        {departmentAreas.length > 0 && (
          <div className="space-y-1">
            {!compact && (
              <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#8FA6C0]">
                Phân hệ
              </p>
            )}
            {departmentAreas.map(renderItem)}
          </div>
        )}
      </div>

      {/* 4. Bottom User Profile & Rail Toggle */}
      <div className="pt-2 border-t border-white/10 space-y-2 mt-auto">
        {!compact ? (
          <div className="flex items-center justify-between rounded-[10px] bg-white/6 p-2 border border-white/10">
            <button
              type="button"
              onClick={onAccountClick}
              className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer flex-1 group"
              title="Thông tin tài khoản"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0B72CE] text-white font-bold text-xs shadow-xs">
                {userName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate leading-tight group-hover:text-blue-200">
                  {userName}
                </p>
                <p className="text-[10px] text-[#8FA6C0] truncate leading-tight">
                  {userRole}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setCompact(true)}
              className="p-1 rounded-md text-[#8FA6C0] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Thu gọn thanh điều hướng"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCompact(false)}
            className="flex w-full items-center justify-center p-2 rounded-lg text-[#8FA6C0] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Mở rộng thanh điều hướng"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </nav>
  );
}
