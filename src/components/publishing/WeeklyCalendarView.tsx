import React, { useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  Sparkles,
  Share2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import type { PostPlan, PlanStatus } from './publishingTypes';
import { PLAN_STATUS_MAP, CHANNEL_KIND_MAP } from './publishingTypes';

interface WeeklyCalendarViewProps {
  plans: PostPlan[];
  currentDate: Date;
  onDateChange: (newDate: Date) => void;
  onSelectPlan: (plan: PostPlan) => void;
  onNewPlanForDate?: (dateStr: string) => void;
}

export const WeeklyCalendarView: React.FC<WeeklyCalendarViewProps> = ({
  plans,
  currentDate,
  onDateChange,
  onSelectPlan,
  onNewPlanForDate,
}) => {
  // Compute Monday of the current week (ICT / local)
  const monday = useMemo(() => {
    const d = new Date(currentDate);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [currentDate]);

  // Days of the week Monday -> Sunday
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      const isToday = new Date().toISOString().split('T')[0] === iso;
      return {
        date: d,
        iso,
        label: ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'][i],
        dayNum: d.getDate(),
        monthNum: d.getMonth() + 1,
        isToday,
      };
    });
  }, [monday]);

  const weekRangeLabel = useMemo(() => {
    const start = weekDays[0];
    const end = weekDays[6];
    return `${start.dayNum}/${start.monthNum} - ${end.dayNum}/${end.monthNum}/${end.date.getFullYear()}`;
  }, [weekDays]);

  const handlePrevWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 7);
    onDateChange(d);
  };

  const handleNextWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    onDateChange(d);
  };

  const handleThisWeek = () => {
    onDateChange(new Date());
  };

  // Group plans by day ISO string
  const plansByDay = useMemo(() => {
    const map = new Map<string, PostPlan[]>();
    for (const p of plans) {
      if (!p.scheduled_at) {
        // If not scheduled, put on created day
        const createdIso = p.created_at ? p.created_at.split('T')[0] : '';
        if (createdIso) {
          const list = map.get(createdIso) || [];
          list.push(p);
          map.set(createdIso, list);
        }
        continue;
      }
      const iso = p.scheduled_at.split('T')[0];
      const list = map.get(iso) || [];
      list.push(p);
      map.set(iso, list);
    }
    return map;
  }, [plans]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-[#0B72CE]" />
          <span className="text-base font-bold text-slate-800 dark:text-slate-100">
            Tuần: {weekRangeLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleThisWeek}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition cursor-pointer"
          >
            Hôm nay
          </button>
          <button
            type="button"
            onClick={handlePrevWeek}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition cursor-pointer"
            title="Tuần trước"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleNextWeek}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition cursor-pointer"
            title="Tuần sau"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Week Grid */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
        {weekDays.map(day => {
          const dayPlans = plansByDay.get(day.iso) || [];
          return (
            <div
              key={day.iso}
              className={`flex flex-col min-h-[300px] md:min-h-[460px] rounded-2xl border p-3 transition ${
                day.isToday
                  ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-300 dark:border-blue-800 shadow-xs'
                  : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700'
              }`}
            >
              {/* Day header */}
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-700/60">
                <div>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {day.label}
                  </div>
                  <div className={`text-base font-bold ${day.isToday ? 'text-[#0B72CE] dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'}`}>
                    {day.dayNum}/{day.monthNum}
                  </div>
                </div>
                {onNewPlanForDate && (
                  <button
                    type="button"
                    onClick={() => onNewPlanForDate(day.iso)}
                    className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-blue-100 hover:text-[#0B72CE] dark:bg-slate-700 dark:hover:bg-blue-950 text-slate-500 transition text-sm cursor-pointer"
                    title={`Thêm lịch đăng ngày ${day.dayNum}/${day.monthNum}`}
                  >
                    +
                  </button>
                )}
              </div>

              {/* Plans in this day */}
              <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
                {dayPlans.length === 0 ? (
                  <div className="text-[11px] text-slate-400 dark:text-slate-500 italic text-center py-4">
                    Trống lịch
                  </div>
                ) : (
                  dayPlans.map(plan => {
                    const statusInfo = PLAN_STATUS_MAP[plan.status as PlanStatus] || {
                      label: plan.status,
                      color: 'bg-slate-100 text-slate-700',
                    };
                    const timeStr = plan.scheduled_at
                      ? new Date(plan.scheduled_at).toLocaleTimeString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '--:--';

                    return (
                      <div
                        key={plan.id}
                        onClick={() => onSelectPlan(plan)}
                        className="group relative flex flex-col gap-1.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#0B72CE] dark:hover:border-blue-500 hover:shadow-md transition cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            <Clock className="w-3 h-3 text-[#0B72CE]" />
                            {timeStr}
                          </span>
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${statusInfo.color}`}
                          >
                            {statusInfo.label}
                          </span>
                        </div>

                        <div className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-2 group-hover:text-[#0B72CE] transition">
                          {plan.title || '(Chưa có tiêu đề)'}
                        </div>

                        {/* Channel icons badges */}
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {plan.variants.map(v => {
                            const kind = CHANNEL_KIND_MAP[v.channel_kind];
                            const isDone = v.status === 'published';
                            const isFail = v.status === 'failed';
                            const isManual = v.status === 'awaiting_manual';

                            return (
                              <span
                                key={v.id}
                                className={`text-[10px] px-1.5 py-0.5 rounded border inline-flex items-center gap-0.5 ${
                                  kind?.color || 'bg-slate-100 text-slate-700'
                                }`}
                                title={`${v.channel_name}: ${v.status}`}
                              >
                                {isDone && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />}
                                {isFail && <AlertCircle className="w-2.5 h-2.5 text-rose-600" />}
                                {isManual && <Share2 className="w-2.5 h-2.5 text-orange-600" />}
                                {v.channel_name.length > 10 ? `${v.channel_name.slice(0, 9)}…` : v.channel_name}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
