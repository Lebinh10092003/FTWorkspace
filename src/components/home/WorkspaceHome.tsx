import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  CalendarCheck,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  ExternalLink,
  GraduationCap,
  Layers3,
  Mail,
  Megaphone,
  Plus,
  QrCode,
  ReceiptText,
  Search,
  ShieldUser,
  Sparkles,
  Trophy,
  User,
  X,
} from 'lucide-react';
import WorkspaceNotifications from '../WorkspaceNotifications';
import AccountMenu from '../AccountMenu';
import {
  formatDateIso,
  formatVietnameseFullDate,
  getGreeting,
  getIsoWeekNumber,
  getTimeUntilFridayDeadline,
  getWeekDays,
  mapTaskStatus,
  WeekDayInfo,
} from '../../lib/workspaceHomeUtils';

export type WorkspaceHomeProps = {
  user: {
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string | null;
  };
  userRole: string;
  idToken: string | null;
  isGuest: boolean;
  canAccessView: (mode: any) => boolean;
  onNavigate: (mode: any, tab?: string) => void;
  onOpenCommandPalette: () => void;
  onLogin: () => void;
  onAccountClick?: () => void;
  onLogout?: () => void;
};

type ScheduleItem = {
  id: number;
  title: string;
  displayTitle?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  status: string;
  displayStatus?: string;
};

type AttendanceEntry = {
  id: number;
  workDate: string;
  shiftStart: string;
  shiftEnd: string;
  workMode: string;
  isDayOff: boolean;
  workedMinutes: number;
};

type WeeklyReportSummary = {
  id: number;
  completedWeek: number;
  plannedWeek: number;
  completedCount: number;
  plannedCount: number;
  status: string;
  plannedWarning?: string | null;
};

export default function WorkspaceHome({
  user,
  userRole,
  idToken,
  isGuest,
  canAccessView,
  onNavigate,
  onOpenCommandPalette,
  onLogin,
  onAccountClick,
  onLogout,
}: WorkspaceHomeProps) {
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');

  const [attendanceEntry, setAttendanceEntry] = useState<AttendanceEntry | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportSummary | null>(null);
  const [weeklyReportLoading, setWeeklyReportLoading] = useState(false);

  const now = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => formatDateIso(now), [now]);
  const weekDays = useMemo(() => getWeekDays(now), [now]);
  const isoWeek = useMemo(() => getIsoWeekNumber(now), [now]);
  const greeting = useMemo(() => getGreeting(now), [now]);
  const fullDateText = useMemo(() => formatVietnameseFullDate(now), [now]);
  const deadlineInfo = useMemo(() => getTimeUntilFridayDeadline(now), [now]);

  // Selected day for mobile horizontal strip view (defaults to today)
  const [selectedMobileDate, setSelectedMobileDate] = useState<string>(todayStr);
  const todayChipRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll today's chip into view on mobile
  useEffect(() => {
    if (todayChipRef.current) {
      try {
        todayChipRef.current.scrollIntoView({ inline: 'center', block: 'nearest' });
      } catch {}
    }
  }, []);

  // 1. Fetch current week's work schedule items
  useEffect(() => {
    if (isGuest || !idToken) return;

    let active = true;
    setScheduleLoading(true);
    setScheduleError('');

    const start = weekDays[0].dateStr;
    const end = weekDays[6].dateStr;

    fetch(`/api/work-schedule/items?start=${start}&end=${end}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(res => {
        if (!res.ok) throw new Error('Không thể tải lịch làm việc.');
        return res.json();
      })
      .then(data => {
        if (!active) return;
        setScheduleItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(err => {
        if (!active) return;
        setScheduleError(err.message || 'Lỗi tải lịch làm việc.');
      })
      .finally(() => {
        if (active) setScheduleLoading(false);
      });

    return () => {
      active = false;
    };
  }, [idToken, isGuest, weekDays]);

  // 2. Fetch today's timesheet prefill / record
  useEffect(() => {
    if (isGuest || !idToken) return;

    let active = true;
    setAttendanceLoading(true);

    fetch(`/api/attendance/timesheet/prefill?date=${todayStr}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!active || !data) return;
        const existing = data.existing;
        if (Array.isArray(existing) && existing.length > 0) {
          setAttendanceEntry(existing[0]);
        } else {
          setAttendanceEntry(null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAttendanceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [idToken, isGuest, todayStr]);

  // 3. Fetch latest weekly report
  useEffect(() => {
    if (isGuest || !idToken) return;

    let active = true;
    setWeeklyReportLoading(true);

    fetch('/api/documents/weekly-reports', {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!active || !data) return;
        const reports = data.reports;
        if (Array.isArray(reports) && reports.length > 0) {
          const first = reports[0];
          setWeeklyReport({
            id: first.id,
            completedWeek: first.completedWeek,
            plannedWeek: first.plannedWeek,
            completedCount: Array.isArray(first.completedItems) ? first.completedItems.length : 0,
            plannedCount: Array.isArray(first.plannedItems) ? first.plannedItems.length : 0,
            status: first.status,
            plannedWarning: first.plannedWarning,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setWeeklyReportLoading(false);
      });

    return () => {
      active = false;
    };
  }, [idToken, isGuest]);

  // Group schedule items by date
  const itemsByDate = useMemo(() => {
    const map: Record<string, ScheduleItem[]> = {};
    for (const d of weekDays) {
      map[d.dateStr] = [];
    }
    for (const item of scheduleItems) {
      if (map[item.date]) {
        map[item.date].push(item);
      }
    }
    return map;
  }, [weekDays, scheduleItems]);

  // Today's tasks
  const todayTasks = useMemo(() => {
    return itemsByDate[todayStr] || [];
  }, [itemsByDate, todayStr]);

  // Selected mobile date's tasks
  const mobileSelectedTasks = useMemo(() => {
    return itemsByDate[selectedMobileDate] || [];
  }, [itemsByDate, selectedMobileDate]);

  // Unified task list (switches with mobile day selection or shows today)
  const displayedTasks = useMemo(() => {
    return selectedMobileDate === todayStr ? todayTasks : mobileSelectedTasks;
  }, [selectedMobileDate, todayStr, todayTasks, mobileSelectedTasks]);

  // Curated list of quick tools, filtered by user permissions
  const quickTools = useMemo(() => {
    const all = [
      {
        mode: 'work-schedule',
        title: 'Lịch làm việc',
        description: 'Lập lịch cá nhân, theo dõi việc đội nhóm và nhắc hạn.',
        icon: CalendarRange,
      },
      {
        mode: 'attendance',
        title: 'Chấm công',
        description: 'Ghi nhận giờ vào, giờ ra và theo dõi dữ liệu công tháng.',
        icon: CalendarCheck,
      },
      {
        mode: 'weekly-report',
        title: 'Báo cáo tuần',
        description: 'Xem, sửa và xuất file Word báo cáo chuẩn công ty.',
        icon: ClipboardList,
      },
      {
        mode: 'digital-training',
        title: 'Công nghệ & Đào tạo số',
        description: 'Khách hàng, lịch tập huấn, BNDC và chuyển đổi số.',
        icon: GraduationCap,
      },
      {
        mode: 'examination',
        title: 'Khảo thí',
        description: 'Quản lý cuộc thi, ca coi thi, thí sinh và đối tác.',
        icon: Trophy,
      },
      {
        mode: 'social-dashboard',
        title: 'Truyền thông',
        description: 'Theo dõi Facebook, Zalo OA và báo cáo tương tác.',
        icon: Layers3,
      },
      {
        mode: 'qr-generator',
        title: 'Tạo mã QR',
        description: 'Tạo mã QR nhanh với logo FermatTech và bảng màu.',
        icon: QrCode,
      },
      {
        mode: 'email-builder',
        title: 'Thiết kế Email',
        description: 'Soạn email HTML chuẩn nhận diện gửi học sinh & đối tác.',
        icon: Mail,
      },
      {
        mode: 'funding-proposal',
        title: 'Phiếu đề xuất kinh phí',
        description: 'Lập và in phiếu đề xuất kinh phí nội bộ.',
        icon: ReceiptText,
      },
      {
        mode: 'account-management',
        title: 'Quản lý nhân viên',
        description: 'Phân quyền, cấp tài khoản thành viên Workspace.',
        icon: ShieldUser,
      },
      {
        mode: 'finance-report',
        title: 'Báo cáo thu chi',
        description: 'Theo dõi dòng tiền, đối soát khảo thí và hợp đồng.',
        icon: BadgeDollarSign,
      },
    ];

    return all.filter(t => canAccessView(t.mode));
  }, [canAccessView]);

  return (
    <div className="w-full min-h-dvh flex flex-col bg-[#F3F6FA] text-[#0F1F33]">
      {/* ========================================================= */}
      {/* DESKTOP TOP BAR (64px)                                    */}
      {/* ========================================================= */}
      <header className="hidden lg:flex h-16 w-full items-center justify-between border-b border-[#DDE5EF] bg-white px-8 sticky top-0 z-20">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex items-center justify-between rounded-[10px] border border-slate-200/90 bg-slate-50/80 px-3.5 py-2 text-xs text-slate-400 hover:border-slate-300 hover:bg-slate-100/70 transition-colors cursor-pointer w-80 shadow-2xs"
          title="Tìm kiếm nhanh trong Workspace (Ctrl K)"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="truncate">Tìm kiếm phân hệ, công việc...</span>
          </div>
          <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-500 shadow-2xs shrink-0">
            Ctrl K
          </kbd>
        </button>

        <div className="flex items-center gap-3">
          <WorkspaceNotifications />
          <AccountMenu
            userName={user.displayName}
            photoURL={user.photoURL}
            userRole={userRole}
            isGuest={isGuest}
            onAccountClick={onAccountClick || (() => {})}
            onLogout={onLogout}
            onLogin={onLogin}
            variant="header"
          />
        </div>
      </header>

      {/* ========================================================= */}
      {/* MAIN CONTENT                                              */}
      {/* ========================================================= */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-32 lg:pb-12 max-w-7xl w-full mx-auto space-y-6">
        {/* 1. Header Greeting & Date */}
        <section className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[#DDE5EF] pb-5">
          <div>
            <h1 className="text-2xl sm:text-[26px] font-bold tracking-tight text-[#0F1F33]">
              {greeting}, {user.displayName || 'bạn'}
            </h1>
            <p className="text-sm text-[#4A5B70] font-medium mt-0.5">
              {fullDateText} • <span className="tabular-nums font-semibold">Tuần {isoWeek}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('work-schedule')}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#0B72CE] hover:bg-[#075CA8] text-white px-3.5 py-2 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Thêm lịch làm việc</span>
            </button>
          </div>
        </section>

        {/* 2. Thanh tuần (7 ngày) */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-[#0B72CE]" />
              <h2 className="text-sm sm:text-base font-bold text-[#0F1F33]">
                Lịch công tác tuần này
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('work-schedule')}
              className="text-xs font-semibold text-[#0B72CE] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>Xem chi tiết</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Desktop 7-column calendar view (>=1024px) */}
          <div className="hidden lg:grid grid-cols-7 gap-2.5">
            {weekDays.map(day => {
              const dayTasks = itemsByDate[day.dateStr] || [];
              const isToday = day.isToday;

              return (
                <div
                  key={day.dateStr}
                  onClick={() => onNavigate('work-schedule')}
                  className={`flex flex-col rounded-[12px] p-3 border transition-all cursor-pointer min-h-[170px] ${
                    isToday
                      ? 'bg-white border-[#0B72CE] ring-2 ring-[#0B72CE]/20 shadow-xs'
                      : 'bg-white border-[#DDE5EF] hover:border-slate-300 hover:shadow-xs'
                  }`}
                >
                  {/* Day header */}
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-xs font-bold ${
                          isToday ? 'text-[#0B72CE]' : 'text-[#0F1F33]'
                        }`}
                      >
                        {day.dayOfWeekVN}
                      </span>
                      <span
                        className={`text-xs tabular-nums ${
                          isToday ? 'font-bold text-[#0B72CE]' : 'text-[#4A5B70]'
                        }`}
                      >
                        {day.dayNumber}/{day.monthNumber}
                      </span>
                    </div>
                    {dayTasks.length > 0 && (
                      <span
                        className={`text-[10px] tabular-nums font-bold px-1.5 py-0.2 rounded-full ${
                          isToday
                            ? 'bg-[#E5F0FB] text-[#0A5BA5]'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {dayTasks.length}
                      </span>
                    )}
                  </div>

                  {/* Day tasks list */}
                  <div className="flex-1 space-y-1.5 overflow-hidden">
                    {dayTasks.length === 0 ? (
                      <p className="text-xs text-[#4A5B70] font-medium pt-2 text-center">
                        Không có việc
                      </p>
                    ) : (
                      dayTasks.slice(0, 3).map(task => {
                        const statusInfo = mapTaskStatus(task.status, task.date, todayStr);
                        return (
                          <div
                            key={task.id}
                            className="p-1.5 rounded-lg bg-slate-50 border border-slate-100 hover:bg-slate-100 transition-colors text-left"
                            title={task.title}
                          >
                            {task.startTime && (
                              <p className="text-[10px] tabular-nums font-semibold text-[#0B72CE] leading-tight">
                                {task.startTime}
                              </p>
                            )}
                            <p className="text-xs font-medium text-slate-800 line-clamp-1 leading-snug">
                              {task.title}
                            </p>
                          </div>
                        );
                      })
                    )}
                    {dayTasks.length > 3 && (
                      <p className="text-[10px] font-semibold text-[#0B72CE] text-center pt-0.5">
                        +{dayTasks.length - 3} việc nữa
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile horizontal scrolling day chips (<1024px) */}
          <div className="lg:hidden">
            <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none select-none overscroll-x-contain touch-pan-x">
              {weekDays.map(day => {
                const dayTasks = itemsByDate[day.dateStr] || [];
                const isSelected = selectedMobileDate === day.dateStr;
                const isToday = day.isToday;

                return (
                  <button
                    key={day.dateStr}
                    ref={isToday ? todayChipRef : undefined}
                    type="button"
                    onClick={() => setSelectedMobileDate(day.dateStr)}
                    className={`flex flex-col items-center justify-center shrink-0 w-[52px] h-[68px] rounded-[12px] border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#0B72CE] text-white border-[#0B72CE] shadow-xs'
                        : isToday
                        ? 'bg-white text-[#0B72CE] border-[#0B72CE] ring-2 ring-[#0B72CE]/40 font-bold'
                        : 'bg-white text-slate-700 border-[#DDE5EF]'
                    }`}
                  >
                    <span
                      className={`text-[11px] font-semibold uppercase ${
                        isSelected ? 'text-white/80' : isToday ? 'text-[#0B72CE]' : 'text-slate-400'
                      }`}
                    >
                      {day.dayOfWeekVN}
                    </span>
                    <span className="text-base font-bold tabular-nums leading-tight my-0.5">
                      {day.dayNumber}
                    </span>
                    <div className="h-1.5 flex items-center justify-center">
                      {dayTasks.length > 0 && (
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isSelected ? 'bg-white' : 'bg-[#0B72CE]'
                          }`}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 3. Grid: Việc hôm nay (Trái) & Báo cáo + Chấm công (Phải) */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Cột trái: Việc hôm nay (7/12) */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#0B72CE]" />
                <h2 className="text-sm sm:text-base font-bold text-[#0F1F33]">
                  {selectedMobileDate === todayStr ? 'Nhiệm vụ hôm nay' : `Nhiệm vụ ngày ${selectedMobileDate}`}
                </h2>
                <span className="rounded-full bg-blue-50 text-[#0B72CE] border border-blue-200/60 px-2 py-0.2 text-xs font-bold tabular-nums">
                  {displayedTasks.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('work-schedule')}
                className="text-xs font-semibold text-[#0B72CE] hover:underline cursor-pointer"
              >
                Mở Lịch làm việc →
              </button>
            </div>

            <div className="rounded-[12px] bg-white border border-[#DDE5EF] p-4 shadow-xs space-y-2.5">
              {displayedTasks.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-xs sm:text-sm text-slate-500">
                    {selectedMobileDate === todayStr
                      ? 'Hôm nay bạn chưa có lịch công tác nào.'
                      : `Ngày ${selectedMobileDate} chưa có lịch công tác nào.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('work-schedule')}
                    className="inline-flex items-center gap-1.5 rounded-[10px] bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Tạo công việc mới</span>
                  </button>
                </div>
              ) : (
                displayedTasks.map(task => {
                  const statusInfo = mapTaskStatus(task.status, task.date, todayStr);
                  return (
                    <div
                      key={task.id}
                      onClick={() => onNavigate('work-schedule')}
                      className="group flex items-start sm:items-center justify-between p-3 rounded-[10px] border border-slate-200/70 bg-slate-50/50 hover:bg-white hover:border-[#0B72CE]/40 hover:shadow-xs transition-all cursor-pointer min-h-[60px] gap-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                          {task.startTime ? (
                            <span className="text-xs font-bold tabular-nums text-[#0B72CE] shrink-0">
                              {task.startTime}{task.endTime ? ` - ${task.endTime}` : ''}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 shrink-0">Trong ngày</span>
                          )}
                          <h3 className="text-xs sm:text-sm font-semibold text-[#0F1F33] break-words whitespace-normal leading-snug group-hover:text-[#0B72CE] transition-colors">
                            {task.title}
                          </h3>
                        </div>
                      </div>

                      <span
                        className="px-2.5 py-1 rounded-[12px] text-xs font-semibold shrink-0 self-start sm:self-center"
                        style={statusInfo.badgeStyle}
                      >
                        {statusInfo.label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Cột phải: Báo cáo tuần & Chấm công (5/12) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Thẻ Báo cáo cuối tuần */}
            <div className="rounded-[12px] bg-white border border-[#DDE5EF] p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-[#0B72CE]" />
                  <h3 className="text-xs sm:text-sm font-bold text-[#0F1F33]">
                    Báo cáo tuần {isoWeek}
                  </h3>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/60 px-2 py-0.5 rounded-full">
                  <Clock className="h-3 w-3" />
                  <span>Hạn T6 16:45</span>
                </span>
              </div>

              <p className="text-xs text-[#4A5B70] leading-relaxed">
                {deadlineInfo.summaryText}
              </p>

              {weeklyReport ? (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/60 text-xs space-y-1">
                  <div className="flex justify-between text-slate-700">
                    <span>Đã làm trong tuần:</span>
                    <b className="tabular-nums font-bold">{weeklyReport.completedCount} việc</b>
                  </div>
                  <div className="flex justify-between text-slate-700">
                    <span>Kế hoạch tuần sau:</span>
                    <b className="tabular-nums font-bold">{weeklyReport.plannedCount} việc</b>
                  </div>
                  {weeklyReport.plannedWarning && (
                    <p className="text-[11px] font-medium text-amber-700 pt-1 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      <span>{weeklyReport.plannedWarning}</span>
                    </p>
                  )}
                </div>
              ) : (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/60 text-xs text-slate-500">
                  Chưa tạo bản nháp tuần này. Báo cáo tự động tổng hợp lúc 16:45 thứ Sáu.
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onNavigate('weekly-report')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-[#0B72CE] hover:bg-[#075CA8] text-white px-3 py-2 text-xs font-semibold shadow-xs transition-colors cursor-pointer min-h-[44px]"
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  <span>Xem bản nháp</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('weekly-report')}
                  className="hidden sm:inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#0B72CE]/40 bg-blue-50/50 hover:bg-blue-50 text-[#0B72CE] px-3 py-2 text-xs font-semibold transition-colors cursor-pointer min-h-[44px]"
                  title="Nhờ AI viết lại theo văn phong chuẩn công ty"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AI viết lại</span>
                </button>
              </div>
            </div>

            {/* Thẻ Chấm công hôm nay */}
            <div className="rounded-[12px] bg-white border border-[#DDE5EF] p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4 text-[#0B72CE]" />
                  <h3 className="text-xs sm:text-sm font-bold text-[#0F1F33]">
                    Chấm công hôm nay
                  </h3>
                </div>
                {attendanceEntry ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#E3F5EC] text-[#0E5A38]">
                    {attendanceEntry.isDayOff ? 'Nghỉ' : 'Đã ghi nhận'}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFF1D6] text-[#7A4300]">
                    Chưa chấm công
                  </span>
                )}
              </div>

              {attendanceEntry ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/60">
                    <span className="text-[11px] text-slate-400 block">Giờ vào:</span>
                    <b className="text-sm font-bold tabular-nums text-slate-800">
                      {attendanceEntry.shiftStart || '—'}
                    </b>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/60">
                    <span className="text-[11px] text-slate-400 block">Giờ ra:</span>
                    <b className="text-sm font-bold tabular-nums text-slate-800">
                      {attendanceEntry.shiftEnd || '—'}
                    </b>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#4A5B70]">
                  Ghi nhận công ca của bạn đúng giờ để hoàn thành bảng lương tháng.
                </p>
              )}

              <button
                type="button"
                onClick={() => onNavigate('attendance')}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 px-3 py-2 text-xs font-semibold transition-colors cursor-pointer min-h-[44px]"
              >
                <span>{attendanceEntry ? 'Xem bảng công tháng' : 'Chấm công ngay'}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </section>

        {/* 4. Công cụ & Phân hệ hay dùng */}
        <section className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm sm:text-base font-bold text-[#0F1F33]">
              Phân hệ & Công cụ Workspace
            </h2>
            <span className="text-xs text-slate-400 font-medium">
              {quickTools.length} ứng dụng
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {quickTools.map(tool => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.mode}
                  type="button"
                  onClick={() => onNavigate(tool.mode)}
                  className="group flex items-start gap-3 p-3.5 rounded-[12px] bg-white border border-[#DDE5EF] hover:border-[#0B72CE]/40 hover:shadow-xs transition-all text-left cursor-pointer min-h-[72px]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-slate-50 border border-slate-200 text-slate-700 group-hover:bg-[#E5F0FB] group-hover:text-[#0B72CE] group-hover:border-[#0B72CE]/30 transition-colors">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs sm:text-sm font-semibold text-[#0F1F33] group-hover:text-[#0B72CE] transition-colors leading-tight">
                      {tool.title}
                    </h3>
                    <p className="text-[11px] text-[#4A5B70] line-clamp-2 leading-relaxed mt-0.5">
                      {tool.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
