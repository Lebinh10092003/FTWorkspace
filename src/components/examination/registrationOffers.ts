/** Lọc, nhóm và gợi ý cuộc thi trên form đăng ký công khai. */
import type { CompetitionOption } from './registrationConfig';
import { competitionIdentity } from './competitionIdentity';
import { scoCatalogue } from './scoCatalogue';
import { todayVN } from '../../lib/vnDate';

export const money = (amount: number) => `${amount.toLocaleString('vi-VN')}đ`;
/** Lệ phí hiển thị: null là chưa công bố, 0 là miễn phí. */
export const feeLabel = (fee?: number | null, unknown = 'Lệ phí thông báo sau') => fee == null ? unknown : fee === 0 ? 'Miễn phí' : money(fee);

const AREA_BY_CODE: Record<string, string> = { FIAIO: 'Trí tuệ nhân tạo', FISO: 'Khoa học' };
export const GROUPS: Array<{ key: string; title: string; areas: string[] }> = [
  { key: 'math', title: 'Toán & Tư duy', areas: ['toán', 'tư duy'] },
  { key: 'language', title: 'Ngôn ngữ', areas: ['tiếng anh', 'ngôn ngữ'] },
  { key: 'science', title: 'Khoa học', areas: ['khoa học thực hành', 'vật lý', 'hóa học', 'sinh học', 'khoa học'] },
  { key: 'tech', title: 'AI & Công nghệ', areas: ['trí tuệ nhân tạo', 'lập trình'] },
  { key: 'life', title: 'Kỹ năng & Xã hội', areas: [] },
];

export function areaOf(code: string) {
  return competitionIdentity(code).profile?.area || AREA_BY_CODE[code.toUpperCase()] || '';
}

export function groupOf(code: string) {
  const area = areaOf(code).toLocaleLowerCase('vi-VN');
  if (area.includes('xã hội')) return 'life';
  return GROUPS.find(group => group.areas.some(item => area.includes(item)))?.key || 'life';
}

export function gradeRange(option: CompetitionOption) {
  const profile = competitionIdentity(option.code).profile;
  return { min: option.minGrade || profile?.minGrade || 1, max: option.maxGrade || profile?.maxGrade || 12 };
}

export function fitsGrade(option: CompetitionOption, grade: string) {
  if (!grade) return true;
  const value = Number(grade);
  const { min, max } = gradeRange(option);
  return value >= min && value <= max;
}

/** Số ngày còn lại tới hạn đăng ký theo giờ Việt Nam; null khi chưa có hạn. */
export function daysLeft(deadline?: string) {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const toDay = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.round((toDay(deadline) - toDay(todayVN())) / 86_400_000);
}

export const shortDate = (value?: string) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '';

export function deadlineText(deadline?: string) {
  const days = daysLeft(deadline);
  if (days === null) return '';
  if (days <= 0) return 'Hạn đăng ký: hôm nay';
  if (days === 1) return 'Còn 1 ngày · hạn ngày mai';
  return `Còn ${days} ngày · hạn ${shortDate(deadline)}`;
}

/** Gợi ý đăng ký thêm: hợp khối, cùng hệ hoặc lĩnh vực gần với cuộc thi đã chọn, hạn gần trước. */
export function suggestions(options: CompetitionOption[], chosen: string[], grade: string, limit = 3) {
  const picked = options.filter(item => chosen.includes(item.code));
  const families = new Set(picked.map(item => competitionIdentity(item.code).family));
  const groups = new Set(picked.map(item => groupOf(item.code)));
  const score = (item: CompetitionOption) => (families.has(competitionIdentity(item.code).family) ? 2 : 0) + (groups.has(groupOf(item.code)) ? 1 : 0);
  return options
    .filter(item => !chosen.includes(item.code) && fitsGrade(item, grade))
    .sort((a, b) => score(b) - score(a) || (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.code.localeCompare(b.code))
    .slice(0, limit);
}

/** Thông tin vừa nhập được giữ trong tab trình duyệt để đăng ký thêm cuộc thi không phải gõ lại. */
const PREFILL_KEY = 'ft-registration-prefill';
export function savePrefill(fields: Record<string, string>, codes: string[]) {
  try { sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ fields, codes })); } catch { /* trình duyệt chặn lưu tạm */ }
}
export function loadPrefill(): { fields: Record<string, string>; codes: string[] } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PREFILL_KEY) || 'null');
    return value && typeof value.fields === 'object' ? { fields: value.fields, codes: Array.isArray(value.codes) ? value.codes : [] } : null;
  } catch { return null; }
}

/** Lời giới thiệu ngắn trên thẻ cuộc thi; nội dung theo bảng "Danh sách các kỳ thi năm 2026-2027"
 *  và danh mục SCO. Không ghi lệ phí ở đây: lệ phí chỉ hiện sau khi phụ huynh chọn. */
const PITCH: Record<string, string> = {
  FIMO: 'Tư duy logic, nhận diện quy luật và giải quyết vấn đề qua đề song ngữ Việt – Anh.',
  FIEO: 'Đánh giá kỹ năng tiếng Anh theo chuẩn CEFR: ngôn ngữ, đọc hiểu, nghe hiểu, viết và nói.',
  SIAIO: 'Kiến thức nền tảng về AI, dữ liệu và học máy, cùng cách dùng AI an toàn, có trách nhiệm.',
  SIBO: 'Tế bào, di truyền, tiến hóa và sinh thái, kèm phân tích dữ liệu thực nghiệm.',
  SICHO: 'Cấu tạo chất, phản ứng và các bài toán hóa học gắn với thực tế.',
  SIPHO: 'Cơ, nhiệt, sóng, quang, điện – từ và tư duy xử lý số liệu thực nghiệm.',
  SILSO: 'Kỹ năng giao tiếp, cảm xúc, an toàn số và phát triển bền vững (SDGs).',
  ...Object.fromEntries(scoCatalogue.map(item => [item.code, item.intro])),
};
export function pitchFor(code: string) {
  const key = code.trim().toUpperCase();
  return PITCH[key] || competitionIdentity(key).profile?.focus || '';
}
export function audienceFor(option: CompetitionOption) {
  const { min, max } = gradeRange(option);
  return min === 1 && max === 12 ? 'Lớp 1–12' : `Lớp ${min}–${max}`;
}
