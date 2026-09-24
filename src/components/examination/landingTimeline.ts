/** Mốc thời gian dùng chung cho các trang landing FIMO, FIEO và SIAIO.
 *  Trạng thái được tính theo ngày hiện tại để trang luôn nêu rõ mốc kế tiếp. */

export type LandingMilestone = { title?: string; date?: string; mode?: string };
export type MilestoneStatus = 'done' | 'today' | 'next' | 'upcoming' | 'unknown';

export type MilestoneView = {
  index: number;
  title: string;
  mode: string;
  status: MilestoneStatus;
  date: string;
  dayMonth: string;
  day: string;
  month: string;
  year: string;
  weekday: string;
  full: string;
  daysAway: number | null;
};

export type MilestoneSummary = {
  items: MilestoneView[];
  next: MilestoneView | null;
  done: number;
  dated: number;
  total: number;
  season: string;
  range: string;
};

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 86_400_000;

export function parseLandingDate(value?: string) {
  const match = ISO_DATE.exec((value || '').trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** dd/mm/yyyy cho ngày ISO, giữ nguyên chuỗi tự do do Ban tổ chức nhập. */
export function displayLandingDate(value?: string) {
  const date = parseLandingDate(value);
  if (!date) return (value || '').trim();
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

export function countdownLabel(days: number | null) {
  if (days === null) return '';
  if (days < 0) return 'Đã diễn ra';
  if (days === 0) return 'Diễn ra hôm nay';
  if (days === 1) return 'Còn 1 ngày';
  return `Còn ${days} ngày`;
}

export function statusLabel(status: MilestoneStatus) {
  if (status === 'done') return 'Đã diễn ra';
  if (status === 'today') return 'Diễn ra hôm nay';
  if (status === 'next') return 'Mốc kế tiếp';
  if (status === 'upcoming') return 'Sắp diễn ra';
  return 'Đang cập nhật';
}

/** Chuẩn hóa danh sách mốc thi thành dữ liệu hiển thị kèm tiến độ mùa thi. */
export function describeMilestones(list: LandingMilestone[] | undefined): MilestoneSummary {
  const source = (list || []).filter(item => item && (item.title || item.date));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let nextIndex = -1;

  const items: MilestoneView[] = source.map((item, index) => {
    const date = parseLandingDate(item.date);
    const daysAway = date ? Math.round((date.getTime() - today) / DAY) : null;
    let status: MilestoneStatus = 'unknown';
    if (daysAway !== null) status = daysAway < 0 ? 'done' : daysAway === 0 ? 'today' : 'upcoming';
    if (nextIndex < 0 && (status === 'today' || status === 'upcoming')) nextIndex = index;
    return {
      index,
      title: (item.title || '').trim() || `Mốc ${index + 1}`,
      mode: (item.mode || '').trim(),
      status,
      date: (item.date || '').trim(),
      day: date ? String(date.getDate()).padStart(2, '0') : '--',
      month: date ? String(date.getMonth() + 1).padStart(2, '0') : '--',
      dayMonth: date ? `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}` : 'Đang cập nhật',
      year: date ? String(date.getFullYear()) : '',
      weekday: date ? WEEKDAYS[date.getDay()] : '',
      full: date ? `${WEEKDAYS[date.getDay()]}, ${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}` : 'Ngày thi đang được cập nhật',
      daysAway,
    };
  });

  if (nextIndex >= 0 && items[nextIndex].status === 'upcoming') items[nextIndex].status = 'next';

  const years = items.filter(item => item.year).map(item => Number(item.year));
  const first = items.find(item => item.date);
  const last = [...items].reverse().find(item => item.date);
  const season = years.length
    ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)} – ${Math.max(...years)}`)
    : '';

  return {
    items,
    next: nextIndex >= 0 ? items[nextIndex] : null,
    done: items.filter(item => item.status === 'done').length,
    dated: items.filter(item => item.date).length,
    total: items.length,
    season,
    range: first && last ? `${displayLandingDate(first.date)} → ${displayLandingDate(last.date)}` : '',
  };
}
