/** Accent-insensitive comparison for Vietnamese search inputs. */
export const normalizeSearchText = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[\u0111\u0110]/g, character => character === '\u0110' ? 'D' : 'd')
  .toLocaleLowerCase('vi-VN')
  .replace(/\s+/g, ' ')
  .trim();

/** Chuỗi an toàn cho URL / tên file: "Đào tạo số" → "dao-tao-so". */
export const slugify = (value: unknown, maxLength?: number) => {
  const slug = normalizeSearchText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return maxLength ? slug.slice(0, maxLength) : slug;
};

export const matchesSearch = (value: unknown, query: unknown) => {
  const needle = normalizeSearchText(query);
  const haystack = normalizeSearchText(value);
  return !needle || haystack.includes(needle) || needle.split(' ').every(token => haystack.includes(token));
};