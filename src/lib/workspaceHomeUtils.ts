/**
 * Utility functions for FT Workspace Home Dashboard (Direction A)
 * Pure, side-effect free logic for calendar week calculation, Friday deadline,
 * task statuses and greeting strings.
 */

export type WeekDayInfo = {
  date: Date;
  dateStr: string; // YYYY-MM-DD
  dayOfWeekVN: string; // T2, T3, T4, T5, T6, T7, CN
  fullDayOfWeekVN: string; // Thứ Hai, Thứ Ba...
  dayNumber: number; // 1-31
  monthNumber: number; // 1-12
  isToday: boolean;
};

export type FridayDeadlineInfo = {
  targetDate: Date;
  daysRemaining: number;
  hoursRemaining: number;
  minutesRemaining: number;
  isToday: boolean;
  summaryText: string;
};

export type TaskStatusDisplay = {
  label: string;
  bgClass: string;
  textClass: string;
  badgeStyle: { backgroundColor: string; color: string };
  isDone: boolean;
  isDoing: boolean;
  isTodo: boolean;
  isDueToday: boolean;
};

const VN_DAY_NAMES: readonly string[] = [
  'CN',
  'T2',
  'T3',
  'T4',
  'T5',
  'T6',
  'T7',
];

const VN_FULL_DAY_NAMES: readonly string[] = [
  'Chủ Nhật',
  'Thứ Hai',
  'Thứ Ba',
  'Thứ Tư',
  'Thứ Năm',
  'Thứ Sáu',
  'Thứ Bảy',
];

/**
 * Returns ISO 8601 week number (1-53)
 */
export function getIsoWeekNumber(d: Date = new Date()): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Formats a Date object to YYYY-MM-DD in local time
 */
export function formatDateIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns 7 days for the week containing baseDate, Monday through Sunday.
 */
export function getWeekDays(baseDate: Date = new Date()): WeekDayInfo[] {
  const current = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const todayStr = formatDateIso(new Date());

  // In JS getDay(): 0 is Sunday, 1 is Monday ... 6 is Saturday
  const currentDay = current.getDay();
  // Distance from Monday (if Sunday (0), distance is -6; if Monday (1), distance is 0)
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;

  const monday = new Date(current);
  monday.setDate(current.getDate() + diffToMonday);

  const days: WeekDayInfo[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = formatDateIso(d);
    const dayOfWeek = d.getDay();

    days.push({
      date: d,
      dateStr,
      dayOfWeekVN: VN_DAY_NAMES[dayOfWeek],
      fullDayOfWeekVN: VN_FULL_DAY_NAMES[dayOfWeek],
      dayNumber: d.getDate(),
      monthNumber: d.getMonth() + 1,
      isToday: dateStr === todayStr,
    });
  }

  return days;
}

/**
 * Calculates remaining time to Friday 16:45:00 (Weekly report deadline).
 */
export function getTimeUntilFridayDeadline(now: Date = new Date()): FridayDeadlineInfo {
  const current = new Date(now);
  const currentDay = current.getDay(); // 0: Sun, 1: Mon, ... 5: Fri, 6: Sat

  // Distance to Friday (5) of current week
  // If currentDay is Fri (5), check if before or after 16:45
  let diffToFriday = 5 - currentDay;

  const target = new Date(current.getFullYear(), current.getMonth(), current.getDate() + diffToFriday, 16, 45, 0, 0);

  // If Friday has already passed 16:45, move to next week's Friday
  if (current.getTime() >= target.getTime()) {
    target.setDate(target.getDate() + 7);
  }

  const diffMs = Math.max(0, target.getTime() - current.getTime());
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const daysRemaining = Math.floor(totalMinutes / (24 * 60));
  const hoursRemaining = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutesRemaining = totalMinutes % 60;

  const isToday = formatDateIso(current) === formatDateIso(target);

  let summaryText = '';
  if (isToday) {
    if (hoursRemaining === 0) {
      summaryText = `Hạn nộp hôm nay: còn ${minutesRemaining} phút (16:45)`;
    } else {
      summaryText = `Hạn nộp hôm nay: còn ${hoursRemaining} giờ ${minutesRemaining} phút (16:45)`;
    }
  } else if (daysRemaining === 1) {
    summaryText = `Còn 1 ngày ${hoursRemaining} giờ tới hạn nộp (Thứ Sáu 16:45)`;
  } else {
    summaryText = `Còn ${daysRemaining} ngày tới hạn nộp (Thứ Sáu 16:45)`;
  }

  return {
    targetDate: target,
    daysRemaining,
    hoursRemaining,
    minutesRemaining,
    isToday,
    summaryText,
  };
}

/**
 * Vietnamese time-based greeting string.
 */
export function getGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

/**
 * Format full date in Vietnamese: "Thứ Ba, 27/10/2026"
 */
export function formatVietnameseFullDate(date: Date = new Date()): string {
  const dayName = VN_FULL_DAY_NAMES[date.getDay()];
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${dayName}, ${day}/${month}/${year}`;
}

/**
 * Maps task status codes to Direction A visual design tokens.
 */
export function mapTaskStatus(status?: string, taskDateStr?: string, todayStr?: string): TaskStatusDisplay {
  const normalized = String(status || '').trim().toLowerCase();
  const today = todayStr || formatDateIso(new Date());
  const isDueToday = taskDateStr === today && normalized !== 'completed' && normalized !== 'reviewed';

  if (normalized === 'completed' || normalized === 'reviewed' || normalized === 'done') {
    return {
      label: 'Đã xong',
      bgClass: 'bg-[#E3F5EC]',
      textClass: 'text-[#0E5A38]',
      badgeStyle: { backgroundColor: '#E3F5EC', color: '#0E5A38' },
      isDone: true,
      isDoing: false,
      isTodo: false,
      isDueToday: false,
    };
  }

  if (normalized === 'doing' || normalized === 'in_progress') {
    return {
      label: 'Đang làm',
      bgClass: 'bg-[#E5F0FB]',
      textClass: 'text-[#0A5BA5]',
      badgeStyle: { backgroundColor: '#E5F0FB', color: '#0A5BA5' },
      isDone: false,
      isDoing: true,
      isTodo: false,
      isDueToday,
    };
  }

  if (isDueToday) {
    return {
      label: 'Hạn hôm nay',
      bgClass: 'bg-[#FFF1D6]',
      textClass: 'text-[#7A4300]',
      badgeStyle: { backgroundColor: '#FFF1D6', color: '#7A4300' },
      isDone: false,
      isDoing: false,
      isTodo: true,
      isDueToday: true,
    };
  }

  return {
    label: 'Chưa làm',
    bgClass: 'bg-[#EEF1F5]',
    textClass: 'text-[#3C4C61]',
    badgeStyle: { backgroundColor: '#EEF1F5', color: '#3C4C61' },
    isDone: false,
    isDoing: false,
    isTodo: true,
    isDueToday: false,
  };
}
