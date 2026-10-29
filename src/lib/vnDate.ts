// Ngày theo giờ Việt Nam (YYYY-MM-DD). Không dùng `new Date().toISOString().slice(0, 10)`:
// đó là ngày UTC, từ 0h đến 7h sáng ở Việt Nam sẽ ra ngày hôm qua.
export const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: VIETNAM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Ngày (YYYY-MM-DD) của một thời điểm, theo giờ Việt Nam. */
export const dateKeyVN = (date: Date = new Date()): string => {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/** Hôm nay theo giờ Việt Nam. */
export const todayVN = (): string => dateKeyVN(new Date());

/** Cộng/trừ số ngày vào một ngày YYYY-MM-DD (không phụ thuộc múi giờ máy). */
export const shiftDateKey = (dateKey: string, days: number): string => {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Cộng/trừ số tháng vào một ngày YYYY-MM-DD (giống Date.setMonth). */
export const shiftDateKeyMonths = (dateKey: string, months: number): string => {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
};

/** Ngày cách hôm nay `days` ngày về trước, theo giờ Việt Nam. */
export const pastDateVN = (days: number): string => shiftDateKey(todayVN(), -days);
