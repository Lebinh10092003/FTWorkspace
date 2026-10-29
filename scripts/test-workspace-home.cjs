const test = require('node:test');
const assert = require('node:assert/strict');

const { loadTsModule } = require('./load-ts-module.cjs');

// Test chạy trên chính src/lib/workspaceHomeUtils.ts, không chép lại logic.
const {
  getIsoWeekNumber,
  formatDateIso,
  getWeekDays,
  getTimeUntilFridayDeadline,
  getGreeting,
  mapTaskStatus,
  cleanTaskTitleForDisplay,
} = loadTsModule('src/lib/workspaceHomeUtils.ts');

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

