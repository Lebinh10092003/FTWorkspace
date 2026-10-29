import React, { useEffect, useState } from 'react';
import {
  CalendarCheck,
  CalendarRange,
  ClipboardList,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { WORKSPACE_AREAS, WorkspaceArea, WorkspaceAreaId } from '../../config/workspaceNavigation';
import { DepartmentLayout } from '../../config/departmentLayout';
import AccountMenu, { type AccountMenuOptions } from '../AccountMenu';

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
  onAccountClick?: () => void;
  /** Có thì nút tài khoản mở menu đầy đủ (hồ sơ, giao diện, đăng xuất / đăng nhập). */
  account?: AccountMenuOptions;
};

export default function WorkspaceAppRail({
  activeAreaId,
  canAccess,
  onSelect,
  userName = 'Người dùng',
  userRole = 'EMPLOYEE',
  onAccountClick,
  account,
}: WorkspaceAppRailProps) {
  const withAccountMenu = (
    placement: 'above' | 'right',
    wrapperClassName: string,
    button: (onClick: () => void, isOpen: boolean) => React.ReactNode,
  ) => account
    ? <AccountMenu {...account} placement={placement} wrapperClassName={wrapperClassName} trigger={({ toggle, isOpen }) => button(toggle, isOpen)} />
    : button(() => onAccountClick?.(), false);
  const [compact, setCompact] = useState(() => readFlag(COMPACT_STORAGE_KEY));
  const [activeTooltip, setActiveTooltip] = useState<{ label: string; top: number } | null>(null);
  const visibleAreas = WORKSPACE_AREAS.filter(canAccess);

  useEffect(() => {
    writeFlag(COMPACT_STORAGE_KEY, compact);
    // Dismiss any active floating tooltip when mode toggles
    setActiveTooltip(null);
  }, [compact]);

  const showTooltip = (label: string, e: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    if (!compact) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveTooltip({
      label,
      top: rect.top + rect.height / 2,
    });
  };

  const hideTooltip = () => {
    setActiveTooltip(null);
  };

  const renderItem = (area: WorkspaceArea) => {
    const Icon = area.icon;
    const isActive = activeAreaId === area.id;

    return (
      <button
        key={area.id}
        type="button"
        onClick={() => onSelect(area)}
        onMouseEnter={e => showTooltip(area.label, e)}
        onMouseLeave={hideTooltip}
        onFocus={e => showTooltip(area.label, e)}
        onBlur={hideTooltip}
        className={`group relative flex items-center transition-all duration-150 cursor-pointer rounded-[10px] select-none ${
          compact
            ? 'w-12 h-12 justify-center mx-auto'
            : 'w-full gap-3 px-3 py-2 text-xs font-medium'
        } ${
          isActive
            ? 'bg-white/14 text-white font-semibold shadow-xs'
            : 'text-[#C9D6E6] hover:bg-white/8 hover:text-white'
        }`}
        aria-current={isActive ? 'page' : undefined}
        aria-label={area.label}
        title={!compact ? area.label : undefined}
      >
        <Icon
          className={`shrink-0 transition-colors ${
            compact ? 'h-5 w-5' : 'h-4 w-4'
          } ${isActive ? 'text-white' : 'text-[#8FA6C0] group-hover:text-white'}`}
          aria-hidden="true"
        />

        {!compact && (
          <div className="flex flex-1 items-center justify-between min-w-0">
            <span className="truncate leading-tight text-left">{area.label}</span>
          </div>
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
      className={`ft-desktop-rail fixed inset-y-0 left-0 z-40 hidden lg:flex flex-col border-r border-[#0B2A4A]/20 bg-[#0B2A4A] transition-[width] duration-200 ease-in-out ${
        compact ? 'is-compact w-16 p-2' : 'w-[248px] p-3'
      }`}
      aria-label="Điều hướng chính FermatTech Workspace"
    >
      {/* 1. Brand Workspace Header with White Plate Logo */}
      <div
        className={`flex items-center gap-2.5 pb-3 border-b border-white/10 ${
          compact ? 'justify-center' : 'px-1'
        }`}
      >
        {compact ? (
          <button
            type="button"
            onClick={() => homeArea && onSelect(homeArea)}
            onMouseEnter={e => showTooltip('FermatTech Workspace', e)}
            onMouseLeave={hideTooltip}
            onFocus={e => showTooltip('FermatTech Workspace', e)}
            onBlur={hideTooltip}
            className="ft-logo-plate flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] !bg-white shadow-xs mx-auto select-none cursor-pointer transition-transform hover:scale-105"
            aria-label="FermatTech Workspace"
          >
            <span className="text-sm font-extrabold text-[#0B2A4A] tracking-tighter leading-none select-none">
              FT
            </span>
          </button>
        ) : (
          <>
            <div className="ft-logo-plate flex h-9 shrink-0 items-center justify-center rounded-[10px] !bg-white p-1.5 shadow-xs">
              <img src="/logo.png" alt="FermatTech" className="h-6 w-auto object-contain" />
            </div>
            <div className="flex flex-1 items-center justify-between min-w-0">
              <div className="min-w-0">
                <h2 className="text-sm font-bold tracking-tight text-white truncate">FermatTech</h2>
                <p className="text-[11px] text-[#8FA6C0] font-medium truncate">Workspace OS</p>
              </div>
              <span className="flex h-5 items-center rounded-full bg-white/10 px-2 text-[10px] font-semibold text-[#C9D6E6] border border-white/15">
                v2.5
              </span>
            </div>
          </>
        )}
      </div>

      {/* 2. Navigation Groups */}
      <div className="flex-1 overflow-y-auto space-y-2 pt-2 overscroll-contain pr-0.5 scrollbar-thin">
        {/* Trang chủ */}
        {homeArea && (
          <div className="space-y-1">
            {renderItem(homeArea)}
          </div>
        )}

        {/* Divider between Home and Của tôi */}
        {homeArea && myAreas.length > 0 && compact && (
          <div className="my-2 border-t border-white/10 mx-auto w-8" role="separator" />
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

        {/* Divider between Của tôi and Phân hệ */}
        {myAreas.length > 0 && departmentAreas.length > 0 && compact && (
          <div className="my-2 border-t border-white/10 mx-auto w-8" role="separator" />
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

      {/* 3. Bottom User Profile & Rail Toggle */}
      <div className="pt-2 border-t border-white/10 space-y-2 mt-auto">
        {!compact ? (
          <div className="flex items-center justify-between rounded-[10px] bg-white/6 p-2 border border-white/10">
            {withAccountMenu('above', 'min-w-0 flex-1', (onClick, isOpen) => (
            <button
              type="button"
              onClick={onClick}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-2.5 min-w-0 text-left cursor-pointer flex-1 group"
              title="Tài khoản"
              aria-label={`Tài khoản: ${userName} (${userRole})`}
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
            ))}
            <button
              type="button"
              onClick={() => setCompact(true)}
              className="p-1.5 rounded-md text-[#8FA6C0] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Thu gọn thanh điều hướng"
              aria-label="Thu gọn thanh điều hướng"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            {/* User Avatar Button (48x48 touch target) */}
            {withAccountMenu('right', '', (onClick, isOpen) => (
            <button
              type="button"
              onClick={onClick}
              aria-expanded={isOpen}
              onMouseEnter={e => showTooltip(`${userName} (${userRole})`, e)}
              onMouseLeave={hideTooltip}
              onFocus={e => showTooltip(`${userName} (${userRole})`, e)}
              onBlur={hideTooltip}
              className="flex h-12 w-12 items-center justify-center rounded-[10px] hover:bg-white/8 transition-colors mx-auto cursor-pointer"
              aria-label={`Tài khoản: ${userName} (${userRole})`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0B72CE] text-white font-bold text-xs shadow-xs">
                {userName.charAt(0).toUpperCase()}
              </div>
            </button>
            ))}

            {/* Rail Expand Button (48x48 touch target) */}
            <button
              type="button"
              onClick={() => setCompact(false)}
              onMouseEnter={e => showTooltip('Mở rộng thanh điều hướng', e)}
              onMouseLeave={hideTooltip}
              onFocus={e => showTooltip('Mở rộng thanh điều hướng', e)}
              onBlur={hideTooltip}
              className="flex h-12 w-12 items-center justify-center rounded-[10px] text-[#8FA6C0] hover:text-white hover:bg-white/10 transition-colors mx-auto cursor-pointer"
              aria-label="Mở rộng thanh điều hướng"
            >
              <PanelLeftOpen className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>

      {/* 4. Global Fixed Floating Tooltip for Compact Mode (never cut off by overflow) */}
      {compact && activeTooltip && (
        <div
          className="fixed z-50 pointer-events-none -translate-y-1/2 whitespace-nowrap rounded-md bg-[#0B2A4A] text-white px-2.5 py-1.5 text-xs font-medium shadow-xl border border-white/20 select-none animate-in fade-in-0 duration-100"
          style={{ left: '72px', top: activeTooltip.top }}
          role="tooltip"
        >
          {activeTooltip.label}
        </div>
      )}
    </nav>
  );
}
