// Định dạng hiển thị dùng chung (ngày, tiền) và header gọi API.

/** Ngày "dd/mm/yyyy" từ chuỗi YYYY-MM-DD hoặc ISO datetime; rỗng / sai thì trả `fallback`. */
export const formatDateVN = (value?: string | null, fallback = '—'): string => {
  if (!value) return fallback;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toLocaleDateString('vi-VN');
};

/** Số tiền kiểu "1.250.000đ"; null / undefined thì trả `emptyLabel`. */
export const formatVND = (value: number | null | undefined, emptyLabel = '—'): string =>
  value == null ? emptyLabel : `${value.toLocaleString('vi-VN')}đ`;

/** Header Authorization (và Content-Type JSON khi `json`). */
export const bearerHeaders = (token?: string | null, json = false): Record<string, string> => ({
  Authorization: `Bearer ${token || ''}`,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});
