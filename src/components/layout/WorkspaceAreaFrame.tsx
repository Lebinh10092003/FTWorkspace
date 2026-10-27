import React, { useState, useEffect } from 'react';
import {
  CalendarCheck,
  CalendarRange,
  ClipboardList,
  Compass,
  LayoutGrid,
  Menu,
  MoreHorizontal,
  Search,
  User,
  X,
} from 'lucide-react';
import WorkspaceAppRail from './WorkspaceAppRail';
import CommandPalette from './CommandPalette';
import WorkspaceNotifications from '../WorkspaceNotifications';
import {
  WORKSPACE_AREAS,
  WorkspaceArea,
  WorkspaceAreaId,
} from '../../config/workspaceNavigation';
import type { DepartmentLayout } from '../../config/departmentLayout';

export type WorkspaceAreaFrameProps = {
  activeAreaId: WorkspaceAreaId | null;
  canAccess: (area: WorkspaceArea) => boolean;
  onSelect: (area: WorkspaceArea) => void;
  layout?: DepartmentLayout | null;
  userName?: string;
  userRole?: string;
  onAccountClick?: () => void;
  children: React.ReactNode;
};

/**
 * Direction A Shared Layout Frame
 * - Desktop (>=1024px): Fixed 248px Navy rail on left + top bar / body on right.
 * - Mobile (<1024px): 56px Navy top bar + 64px fixed 5-tab bottom bar + "Thêm" sheet.
 */
export default function WorkspaceAreaFrame({
  activeAreaId,
  canAccess,
  onSelect,
  layout = null,
  userName = 'Người dùng',
  userRole = 'EMPLOYEE',
  onAccountClick,
  children,
}: WorkspaceAreaFrameProps) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [moreDrawerOpen, setMoreDrawerOpen] = useState(false);

  useEffect(() => {
    const handleToggle = () => setCommandPaletteOpen(prev => !prev);
    window.addEventListener('toggle-command-palette', handleToggle);
    return () => window.removeEventListener('toggle-command-palette', handleToggle);
  }, []);

  const visibleAreas = WORKSPACE_AREAS.filter(canAccess);

  // Tab definitions for mobile 5-item bottom bar
  const findArea = (id: WorkspaceAreaId) => visibleAreas.find(a => a.id === id);

  const homeArea = findArea('workspace');
  const scheduleArea = findArea('work-schedule');
  const attendanceArea = findArea('attendance');
  const weeklyReportArea = findArea('weekly-report');

  const bottomTabs = [
    {
      id: 'workspace',
      label: 'Trang chủ',
      icon: LayoutGrid,
      area: homeArea,
      isActive: activeAreaId === 'workspace' || !activeAreaId,
    },
    {
      id: 'work-schedule',
      label: 'Lịch',
      icon: CalendarRange,
      area: scheduleArea,
      isActive: activeAreaId === 'work-schedule',
    },
    {
      id: 'attendance',
      label: 'Chấm công',
      icon: CalendarCheck,
      area: attendanceArea,
      isActive: activeAreaId === 'attendance',
    },
    {
      id: 'weekly-report',
      label: 'Báo cáo',
      icon: ClipboardList,
      area: weeklyReportArea,
      isActive: activeAreaId === 'weekly-report',
    },
    {
      id: 'more',
      label: 'Thêm',
      icon: MoreHorizontal,
      area: null,
      isActive:
        Boolean(activeAreaId) &&
        !['workspace', 'work-schedule', 'attendance', 'weekly-report'].includes(
          activeAreaId || ''
        ),
    },
  ];

  const handleTabClick = (tab: (typeof bottomTabs)[number]) => {
    if (tab.id === 'more') {
      setMoreDrawerOpen(true);
      return;
    }
    if (tab.area) {
      onSelect(tab.area);
    }
  };

  // Remaining areas for "Thêm" drawer
  const moreAreas = visibleAreas.filter(
    area => !['workspace', 'work-schedule', 'attendance', 'weekly-report'].includes(area.id)
  );

  return (
    <div className="ft-workspace-frame min-h-dvh flex flex-col bg-[#F3F6FA] text-[#0F1F33] relative overflow-x-hidden">
      {/* ========================================================= */}
      {/* DESKTOP SIDEBAR (>=1024px)                                */}
      {/* ========================================================= */}
      <WorkspaceAppRail
        activeAreaId={activeAreaId}
        canAccess={canAccess}
        onSelect={onSelect}
        layout={layout}
        userName={userName}
        userRole={userRole}
        onOpenSearch={() => setCommandPaletteOpen(true)}
        onAccountClick={onAccountClick}
      />

      {/* ========================================================= */}
      {/* MOBILE TOP BAR (<1024px)                                  */}
      {/* ========================================================= */}
      <header
        className="lg:hidden fixed top-0 inset-x-0 z-40 flex h-14 items-center justify-between border-b border-[#0B2A4A]/20 bg-[#0B2A4A] px-3 text-white shadow-xs"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <button
          type="button"
          onClick={() => homeArea && onSelect(homeArea)}
          className="flex items-center gap-2 rounded-lg bg-white px-2 py-1 shadow-xs cursor-pointer"
          title="Về Trang chủ"
        >
          <img src="/logo.png" alt="FermatTech" className="h-6 w-auto object-contain" />
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-[#C9D6E6] hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            aria-label="Tìm kiếm nhanh"
            title="Tìm kiếm"
          >
            <Search className="h-5 w-5" />
          </button>

          <WorkspaceNotifications />

          {onAccountClick && (
            <button
              type="button"
              onClick={onAccountClick}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0B72CE] text-white font-bold text-xs ml-1 cursor-pointer shadow-xs"
              title="Tài khoản cá nhân"
            >
              {userName.charAt(0).toUpperCase()}
            </button>
          )}
        </div>
      </header>

      {/* ========================================================= */}
      {/* MAIN CONTENT AREA                                         */}
      {/* ========================================================= */}
      <div className="ft-workspace-frame-body flex-1 min-w-0 pt-14 lg:pt-0 pb-[calc(8.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
        {children}
      </div>

      {/* ========================================================= */}
      {/* MOBILE BOTTOM TAB BAR (<1024px)                           */}
      {/* ========================================================= */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex min-h-[64px] items-center justify-around border-t border-[#DDE5EF] bg-white shadow-lg select-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Điều hướng tab dưới màn hình"
      >
        {bottomTabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab)}
              className={`ft-bottom-tab flex flex-1 flex-col items-center justify-center py-1.5 px-1 min-h-[56px] transition-colors cursor-pointer ${
                tab.isActive
                  ? 'text-[#0B72CE] font-semibold'
                  : 'text-slate-500 hover:text-slate-900 font-normal'
              }`}
              aria-current={tab.isActive ? 'page' : undefined}
            >
              <Icon
                className={`h-5 w-5 mb-1 transition-transform ${
                  tab.isActive ? 'scale-110 text-[#0B72CE]' : 'text-slate-500'
                }`}
                aria-hidden="true"
              />
              <span className="text-[11px] leading-tight line-clamp-1">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* ========================================================= */}
      {/* MOBILE "THÊM" BOTTOM SHEET                                */}
      {/* ========================================================= */}
      {moreDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/45 backdrop-blur-xs transition-opacity"
          onClick={() => setMoreDrawerOpen(false)}
        >
          <div
            className="w-full rounded-t-3xl border-t border-[#DDE5EF] bg-white p-5 shadow-2xl max-h-[85vh] overflow-y-auto"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Tất cả chức năng"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Compass className="h-5 w-5 text-[#0B72CE]" />
                <h3 className="text-base font-bold text-[#0F1F33]">Tất cả phân hệ & tiện ích</h3>
              </div>
              <button
                type="button"
                onClick={() => setMoreDrawerOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                aria-label="Đóng"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="py-4 space-y-4">
              {/* Phân hệ nghiệp vụ */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5B70] mb-2 px-1">
                  Phân hệ nghiệp vụ
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {moreAreas.map(area => {
                    const Icon = area.icon;
                    const isSelected = activeAreaId === area.id;
                    return (
                      <button
                        key={area.id}
                        type="button"
                        onClick={() => {
                          setMoreDrawerOpen(false);
                          onSelect(area);
                        }}
                        className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer min-h-[52px] ${
                          isSelected
                            ? 'bg-[#E5F0FB] border-[#0B72CE]/30 text-[#0B72CE] font-semibold'
                            : 'bg-slate-50/70 border-slate-200/80 text-slate-800 hover:bg-slate-100'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            isSelected ? 'bg-[#0B72CE] text-white' : 'bg-white text-slate-600 border border-slate-200'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate leading-tight">{area.label}</p>
                          <p className="text-[11px] text-slate-500 truncate leading-tight mt-0.5">
                            {area.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tài khoản & Hệ thống */}
              {onAccountClick && (
                <div className="pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setMoreDrawerOpen(false);
                      onAccountClick();
                    }}
                    className="flex w-full items-center justify-between p-3 rounded-xl bg-slate-50 text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer min-h-[48px]"
                  >
                    <div className="flex items-center gap-2.5">
                      <User className="h-4 w-4 text-[#0B72CE]" />
                      <span className="text-xs font-semibold">Tùy chỉnh tài khoản & giao diện</span>
                    </div>
                    <span className="text-xs text-slate-400">→</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* COMMAND PALETTE DIALOG                                    */}
      {/* ========================================================= */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  );
}
