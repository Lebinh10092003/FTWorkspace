/**
 * Deadline parsing and formatting utilities for Gmail Assistant (Client-side).
 *
 * Implements:
 * 1. Extraction of absolute date & time from ISO due_date or relative/VN text strings.
 * 2. Dynamic display relative to REAL TODAY:
 *    - Overdue: "Quá hạn n ngày (dd/mm)"
 *    - Today: "Hôm nay" (or "Hôm nay HH:mm")
 *    - Tomorrow: "Ngày mai" (or "Ngày mai HH:mm")
 *    - Future: "Còn n ngày (dd/mm)"
 * 3. Schedule pre-fill date (default to absolute deadline, or today if overdue).
 */

export type DeadlineInfo = {
  hasDeadline: boolean;
  rawDeadline: string;
  absoluteDateStr: string; // e.g. "30/10/2026" or "17:00 30/10/2026"
  isoDateStr: string | null; // e.g. "2026-10-30" (YYYY-MM-DD)
  timeStr: string | null; // e.g. "17:00"
  diffDays: number; // < 0 if overdue, 0 if today, 1 if tomorrow, > 1 if future
  isOverdue: boolean;
  isToday: boolean;
  isTomorrow: boolean;
  displayText: string;
  scheduleDateStr: string; // YYYY-MM-DD
};

const VN_WEEKDAYS: Record<string, number> = {
  '2': 1,
  hai: 1,
  '3': 2,
  ba: 2,
  '4': 3,
  tư: 3,
  tu: 3,
  bốn: 3,
  bon: 3,
  '5': 4,
  năm: 4,
  nam: 4,
  '6': 5,
  sáu: 5,
  sau: 5,
  '7': 6,
  bảy: 6,
  bay: 6,
  cn: 0,
  'chủ nhật': 0,
  'chu nhat': 0,
};

function extractTime(text: string): { timeStr: string | null; cleaned: string } {
  if (!text) return { timeStr: null, cleaned: '' };
  const raw = text.trim();

  // Pattern 1: HH:MM
  const m1 = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
  if (m1) {
    const hh = String(parseInt(m1[1], 10)).padStart(2, '0');
    const mm = m1[2];
    const cleaned = raw.slice(0, m1.index) + raw.slice(m1.index! + m1[0].length);
    return { timeStr: `${hh}:${mm}`, cleaned: cleaned.trim() };
  }

  // Pattern 2: HHh or HHhMM
  const m2 = raw.match(/\b([01]?\d|2[0-3])\s*[hH]\s*([0-5]\d)?\b/);
  if (m2) {
    let hour = parseInt(m2[1], 10);
    const minute = m2[2] ? m2[2] : '00';
    if (/\b(chiều|tối)\b/i.test(raw) && hour >= 1 && hour <= 11) {
      hour += 12;
    }
    const hh = String(hour).padStart(2, '0');
    const cleaned = raw.slice(0, m2.index) + raw.slice(m2.index! + m2[0].length);
    return { timeStr: `${hh}:${minute}`, cleaned: cleaned.trim() };
  }

  return { timeStr: null, cleaned: raw };
}

export function parseDeadlineInfo(
  rawDeadline?: string | null,
  dueDateIso?: string | null,
  receivedAtIso?: string | null,
  clientNow?: Date
): DeadlineInfo {
  const raw = String(rawDeadline || '').trim();
  const hasRaw = !!raw;
  const hasIso = !!dueDateIso && typeof dueDateIso === 'string' && dueDateIso.trim().length > 0;

  const now = clientNow || new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  if (!hasRaw && !hasIso) {
    return {
      hasDeadline: false,
      rawDeadline: '',
      absoluteDateStr: '',
      isoDateStr: null,
      timeStr: null,
      diffDays: 999,
      isOverdue: false,
      isToday: false,
      isTomorrow: false,
      displayText: '',
      scheduleDateStr: todayStr,
    };
  }

  let targetYear: number | null = null;
  let targetMonth: number | null = null; // 1-12
  let targetDay: number | null = null; // 1-31
  let timeStr: string | null = null;

  // 1. Check ISO due_date
  if (hasIso) {
    const isoMatch = dueDateIso!.match(/(\d{4})[-/](1[0-2]|0?[1-9])[-/](3[01]|[12]\d|0?[1-9])/);
    if (isoMatch) {
      targetYear = parseInt(isoMatch[1], 10);
      targetMonth = parseInt(isoMatch[2], 10);
      targetDay = parseInt(isoMatch[3], 10);
    }
    const isoTimeMatch = dueDateIso!.match(/T([01]?\d|2[0-3]):([0-5]\d)/);
    if (isoTimeMatch && !(isoTimeMatch[1] === '00' && isoTimeMatch[2] === '00')) {
      timeStr = `${String(isoTimeMatch[1]).padStart(2, '0')}:${isoTimeMatch[2]}`;
    }
  }

  // 2. Extract time from rawDeadline if not in ISO
  const extracted = extractTime(raw);
  if (!timeStr && extracted.timeStr) {
    timeStr = extracted.timeStr;
  }

  // 3. Inferred reference date from receivedAt
  let refYear = now.getFullYear();
  let refMonth = now.getMonth() + 1;
  let refDay = now.getDate();

  if (receivedAtIso) {
    const recMatch = String(receivedAtIso).match(/(\d{4})[-/](1[0-2]|0?[1-9])[-/](3[01]|[12]\d|0?[1-9])/);
    if (recMatch) {
      refYear = parseInt(recMatch[1], 10);
      refMonth = parseInt(recMatch[2], 10);
      refDay = parseInt(recMatch[3], 10);
    }
  }
  const refDateObj = new Date(refYear, refMonth - 1, refDay);

  // 4. If target date not found from ISO, parse rawDeadline
  if (!targetYear || !targetMonth || !targetDay) {
    // Pattern A: ISO date in text: YYYY-MM-DD
    const mIso = raw.match(/\b(\d{4})[-/](1[0-2]|0?[1-9])[-/](3[01]|[12]\d|0?[1-9])\b/);
    if (mIso) {
      targetYear = parseInt(mIso[1], 10);
      targetMonth = parseInt(mIso[2], 10);
      targetDay = parseInt(mIso[3], 10);
    }

    // Pattern B: VN date in text: DD/MM/YYYY or DD/MM
    if (!targetYear) {
      const mVn = raw.match(/\b(3[01]|[12]\d|0?[1-9])[-/](1[0-2]|0?[1-9])(?:[-/](\d{4}|\d{2}))?\b/);
      if (mVn) {
        targetDay = parseInt(mVn[1], 10);
        targetMonth = parseInt(mVn[2], 10);
        if (mVn[3]) {
          targetYear = mVn[3].length === 4 ? parseInt(mVn[3], 10) : 2000 + parseInt(mVn[3], 10);
        } else {
          targetYear = refYear;
        }
      }
    }

    // Pattern C: ngày DD tháng MM [năm YYYY]
    if (!targetYear) {
      const mVnText = raw.match(/ngày\s*(3[01]|[12]\d|0?[1-9])\s*tháng\s*(1[0-2]|0?[1-9])(?:\s*năm\s*(\d{4}))?/i);
      if (mVnText) {
        targetDay = parseInt(mVnText[1], 10);
        targetMonth = parseInt(mVnText[2], 10);
        targetYear = mVnText[3] ? parseInt(mVnText[3], 10) : refYear;
      }
    }

    // Pattern D: Relative keywords based on reference date
    if (!targetYear) {
      const norm = raw.toLowerCase();

      // Today keywords
      if (/\b(hôm\s*nay|hom\s*nay|sáng\s*nay|trưa\s*nay|chiều\s*nay|tối\s*nay|trong\s*ngày|hết\s*ngày)\b/i.test(norm)) {
        targetYear = refYear;
        targetMonth = refMonth;
        targetDay = refDay;
      }
      // Tomorrow keywords
      else if (/\b(ngày\s*mai|ngay\s*mai|sáng\s*mai|chiều\s*mai|trưa\s*mai|tối\s*mai|mai)\b/i.test(norm)) {
        const tomorrow = new Date(refDateObj);
        tomorrow.setDate(tomorrow.getDate() + 1);
        targetYear = tomorrow.getFullYear();
        targetMonth = tomorrow.getMonth() + 1;
        targetDay = tomorrow.getDate();
      }
      // Day after tomorrow
      else if (/\b(ngày\s*kia|ngay\s*kia|ngày\s*mốt|ngay\s*mot|mốt)\b/i.test(norm)) {
        const dayAfter = new Date(refDateObj);
        dayAfter.setDate(dayAfter.getDate() + 2);
        targetYear = dayAfter.getFullYear();
        targetMonth = dayAfter.getMonth() + 1;
        targetDay = dayAfter.getDate();
      }
      // Weekday keywords: thứ 2..7, chủ nhật
      else if (/\b(?:thứ\s*([2-7]|hai|ba|tư|tu|bốn|bon|năm|nam|sáu|sau|bảy|bay)|chủ\s*nhật|chu\s*nhat|cn)\b/i.test(norm)) {
        const mWd = norm.match(/\b(?:thứ\s*([2-7]|hai|ba|tư|tu|bốn|bon|năm|nam|sáu|sau|bảy|bay)|(chủ\s*nhật|chu\s*nhat|cn))\b/i);
        if (mWd) {
          const key = (mWd[1] || mWd[2] || '').trim().toLowerCase();
          const targetWd = VN_WEEKDAYS[key];
          if (targetWd !== undefined) {
            const currentWd = refDateObj.getDay(); // 0 is Sunday, 1 is Monday...
            let diff = targetWd - currentWd;
            if (diff < 0) diff += 7;
            if (/\b(tuần\s*sau|tuan\s*sau|tuần\s*tới|tuan\s*toi)\b/i.test(norm)) {
              diff += 7;
            }
            const targetDate = new Date(refDateObj);
            targetDate.setDate(targetDate.getDate() + diff);
            targetYear = targetDate.getFullYear();
            targetMonth = targetDate.getMonth() + 1;
            targetDay = targetDate.getDate();
          }
        }
      }
    }
  }

  // If no date parsed at all
  if (!targetYear || !targetMonth || !targetDay) {
    return {
      hasDeadline: true,
      rawDeadline: raw,
      absoluteDateStr: raw,
      isoDateStr: null,
      timeStr: null,
      diffDays: 999,
      isOverdue: false,
      isToday: false,
      isTomorrow: false,
      displayText: raw,
      scheduleDateStr: todayStr,
    };
  }

  // Valid date obtained
  const dayPad = String(targetDay).padStart(2, '0');
  const monthPad = String(targetMonth).padStart(2, '0');
  const yearPad = String(targetYear);
  const dateShort = `${dayPad}/${monthPad}`;
  const dateFull = `${dayPad}/${monthPad}/${yearPad}`;
  const isoDateStr = `${yearPad}-${monthPad}-${dayPad}`;

  const absoluteDateStr = timeStr ? `${timeStr} ${dateFull}` : dateFull;

  const targetMidnight = new Date(targetYear, targetMonth - 1, targetDay).getTime();
  const diffDays = Math.round((targetMidnight - todayMidnight) / (24 * 60 * 60 * 1000));

  const isOverdue = diffDays < 0;
  const isToday = diffDays === 0;
  const isTomorrow = diffDays === 1;

  let displayText = '';
  if (isOverdue) {
    const overdueDays = Math.abs(diffDays);
    displayText = `Quá hạn ${overdueDays} ngày (${dateShort})`;
  } else if (isToday) {
    displayText = timeStr ? `Hôm nay ${timeStr}` : 'Hôm nay';
  } else if (isTomorrow) {
    displayText = timeStr ? `Ngày mai ${timeStr}` : 'Ngày mai';
  } else {
    displayText = `Còn ${diffDays} ngày (${dateShort})`;
  }

  // Requirement 4: ngày mặc định là ngày hạn tuyệt đối (nếu quá hạn thì mặc định hôm nay)
  const scheduleDateStr = isOverdue ? todayStr : isoDateStr;

  return {
    hasDeadline: true,
    rawDeadline: raw,
    absoluteDateStr,
    isoDateStr,
    timeStr,
    diffDays,
    isOverdue,
    isToday,
    isTomorrow,
    displayText,
    scheduleDateStr,
  };
}
