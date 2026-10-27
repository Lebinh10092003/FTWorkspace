const test = require('node:test');
const assert = require('node:assert/strict');

// Import utilities transpiled or inline logic check
// Since this is CJS running in Node, let's test the pure logic matching workspaceHomeUtils
function getIsoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatDateIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const VN_DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function getWeekDays(baseDate) {
  const current = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const todayStr = formatDateIso(new Date());

  const currentDay = current.getDay();
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;

  const monday = new Date(current);
  monday.setDate(current.getDate() + diffToMonday);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = formatDateIso(d);
    const dayOfWeek = d.getDay();

    days.push({
      date: d,
      dateStr,
      dayOfWeekVN: VN_DAY_NAMES[dayOfWeek],
      dayNumber: d.getDate(),
      monthNumber: d.getMonth() + 1,
      isToday: dateStr === todayStr,
    });
  }
  return days;
}

function getTimeUntilFridayDeadline(now) {
  const current = new Date(now);
  const currentDay = current.getDay();
  const diffToFriday = 5 - currentDay;

  const target = new Date(current.getFullYear(), current.getMonth(), current.getDate() + diffToFriday, 16, 45, 0, 0);

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

  return { targetDate: target, daysRemaining, hoursRemaining, minutesRemaining, isToday, summaryText };
}

function getGreeting(now) {
  const hour = now.getHours();
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

function mapTaskStatus(status, taskDateStr, todayStr) {
  const normalized = String(status || '').trim().toLowerCase();
  const today = todayStr || formatDateIso(new Date());
  const isDueToday = taskDateStr === today && normalized !== 'completed' && normalized !== 'reviewed';

  if (normalized === 'completed' || normalized === 'reviewed' || normalized === 'done') {
    return { label: 'Đã xong', isDone: true, isDoing: false, isTodo: false, isDueToday: false };
  }
  if (normalized === 'doing' || normalized === 'in_progress') {
    return { label: 'Đang làm', isDone: false, isDoing: true, isTodo: false, isDueToday };
  }
  if (isDueToday) {
    return { label: 'Hạn hôm nay', isDone: false, isDoing: false, isTodo: true, isDueToday: true };
  }
  return { label: 'Chưa làm', isDone: false, isDoing: false, isTodo: true, isDueToday: false };
}

test('getWeekDays generates exact 7 days Monday to Sunday', () => {
  // Tuesday 2026-10-27
  const tuesday = new Date(2026, 9, 27);
  const days = getWeekDays(tuesday);

  assert.equal(days.length, 7);
  assert.equal(days[0].dayOfWeekVN, 'T2');
  assert.equal(days[0].dateStr, '2026-10-26');
  assert.equal(days[1].dayOfWeekVN, 'T3');
  assert.equal(days[1].dateStr, '2026-10-27');
  assert.equal(days[6].dayOfWeekVN, 'CN');
  assert.equal(days[6].dateStr, '2026-11-01');
});

test('getTimeUntilFridayDeadline on Tuesday 14:00 has 3 days remaining', () => {
  const tuesday = new Date(2026, 9, 27, 14, 0, 0);
  const info = getTimeUntilFridayDeadline(tuesday);

  assert.equal(info.daysRemaining, 3);
  assert.equal(info.isToday, false);
  assert.match(info.summaryText, /Còn 3 ngày/);
});

test('getTimeUntilFridayDeadline on Friday 10:00 reports deadline today', () => {
  const fridayMorning = new Date(2026, 9, 30, 10, 0, 0);
  const info = getTimeUntilFridayDeadline(fridayMorning);

  assert.equal(info.isToday, true);
  assert.equal(info.daysRemaining, 0);
  assert.equal(info.hoursRemaining, 6);
  assert.equal(info.minutesRemaining, 45);
  assert.match(info.summaryText, /Hạn nộp hôm nay/);
});

test('getTimeUntilFridayDeadline on Friday 17:00 rolls over to next week', () => {
  const fridayEvening = new Date(2026, 9, 30, 17, 0, 0);
  const info = getTimeUntilFridayDeadline(fridayEvening);

  assert.equal(info.isToday, false);
  assert.equal(info.daysRemaining, 6);
  assert.equal(formatDateIso(info.targetDate), '2026-11-06');
});

test('getGreeting returns correct Vietnamese greetings based on hour', () => {
  assert.equal(getGreeting(new Date(2026, 9, 27, 8, 30)), 'Chào buổi sáng');
  assert.equal(getGreeting(new Date(2026, 9, 27, 14, 15)), 'Chào buổi chiều');
  assert.equal(getGreeting(new Date(2026, 9, 27, 19, 45)), 'Chào buổi tối');
});

test('getIsoWeekNumber returns correct week number', () => {
  assert.equal(getIsoWeekNumber(new Date(2026, 9, 27)), 44);
});

test('mapTaskStatus maps statuses to standard labels', () => {
  assert.equal(mapTaskStatus('completed', '2026-10-27', '2026-10-27').label, 'Đã xong');
  assert.equal(mapTaskStatus('reviewed', '2026-10-27', '2026-10-27').label, 'Đã xong');
  assert.equal(mapTaskStatus('doing', '2026-10-27', '2026-10-27').label, 'Đang làm');
  assert.equal(mapTaskStatus('todo', '2026-10-27', '2026-10-27').label, 'Hạn hôm nay');
  assert.equal(mapTaskStatus('todo', '2026-10-28', '2026-10-27').label, 'Chưa làm');
});

function cleanTaskTitleForDisplay(title) {
  const originalTitle = String(title || '').trim();
  if (!originalTitle) {
    return {
      cleanTitle: '',
      links: [],
      hasLinks: false,
      originalTitle: '',
    };
  }

  const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"'{}|\\^`]+[^\s<>"'{}|\\^`.,;:?!)]/gi;
  const rawLinks = originalTitle.match(urlRegex) || [];
  const links = rawLinks.map(l => (l.startsWith('www.') ? `https://${l}` : l));

  const linkLabelAndUrlRegex = /(?:(?:Meet|Google\s*Meet|Zoom|Link|Liên\s*kết)\s*:\s*)?(?:https?:\/\/|www\.)[^\s<>"'{}|\\^`]+[^\s<>"'{}|\\^`.,;:?!)]/gi;
  let text = originalTitle.replace(linkLabelAndUrlRegex, '').trim();

  const prefixRegex = /^\s*(?:(?:\d{1,2}(?:[:h]\d{2}|h))(?:\s*[\-\–~]\s*(?:\d{1,2}(?:[:h]\d{2}|h)))?)?\s*(?:\(\s*(?:giờ\s*việt\s*nam|giờ\s*vn|ict|gmt\+7)\s*\))?\s*[:\-\–~]\s*/i;

  let prevText = '';
  while (text !== prevText) {
    prevText = text;
    text = text.replace(prefixRegex, '').trim();
  }

  text = text.replace(/^\s*\(\s*(?:giờ\s*việt\s*nam|giờ\s*vn|ict|gmt\+7)\s*\)\s*[:\-\–~]?\s*/i, '').trim();
  text = text.replace(/[\s\-\–:.,;…]+$/, '').trim();

  const cleanTitle = text || originalTitle;

  return {
    cleanTitle,
    links,
    hasLinks: links.length > 0,
    originalTitle,
  };
}

test('cleanTaskTitleForDisplay strips duplicate time prefix "9h30: "', () => {
  const res = cleanTaskTitleForDisplay('9h30: Qua làm việc với đối tác tại cơ sở');
  assert.equal(res.cleanTitle, 'Qua làm việc với đối tác tại cơ sở');
  assert.equal(res.hasLinks, false);
  assert.equal(res.links.length, 0);
  assert.equal(res.originalTitle, '9h30: Qua làm việc với đối tác tại cơ sở');
});

test('cleanTaskTitleForDisplay strips time range and (giờ Việt Nam) prefix and extracts Meet link', () => {
  const raw = '15:00-16:00 (giờ Việt Nam): Họp trực tuyến với Gimasys về triển khai Workspace … Meet: https://meet.google.com/abc-defg-hij';
  const res = cleanTaskTitleForDisplay(raw);
  assert.equal(res.cleanTitle, 'Họp trực tuyến với Gimasys về triển khai Workspace');
  assert.equal(res.hasLinks, true);
  assert.equal(res.links.length, 1);
  assert.equal(res.links[0], 'https://meet.google.com/abc-defg-hij');
  assert.equal(res.originalTitle, raw);
});

test('cleanTaskTitleForDisplay handles "09:30 -" and "14h00 - 16h30 (giờ VN) -"', () => {
  const res1 = cleanTaskTitleForDisplay('09:30 - Họp phòng Công nghệ');
  assert.equal(res1.cleanTitle, 'Họp phòng Công nghệ');

  const res2 = cleanTaskTitleForDisplay('14h00 - 16h30 (giờ VN) - Tập huấn giáo viên trực tuyến');
  assert.equal(res2.cleanTitle, 'Tập huấn giáo viên trực tuyến');
});

test('cleanTaskTitleForDisplay preserves regular titles without time prefix', () => {
  const res = cleanTaskTitleForDisplay('Rà soát tài liệu Khảo thí');
  assert.equal(res.cleanTitle, 'Rà soát tài liệu Khảo thí');
  assert.equal(res.hasLinks, false);
});

