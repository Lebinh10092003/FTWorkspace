/**
 * Utilities for formatting, sanitizing, and normalizing news post content.
 */

/**
 * Tách dòng liên hệ theo dấu | hoặc ký tự xuống dòng thành các dòng riêng biệt.
 * Ví dụ: "🌐 www.fermat.vn | ✉ contact@fermat.vn | ☎ 0969 627 162"
 * -> ["🌐 www.fermat.vn", "✉ contact@fermat.vn", "☎ 0969 627 162"]
 */
export function splitContactInfo(contactInfo?: string): string[] {
  if (!contactInfo) return [];
  return contactInfo
    .split(/[|\n]/)
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * Chuẩn hóa danh sách hashtag thành 1 đoạn văn bản duy nhất,
 * các thẻ hashtag cách nhau đúng 1 dấu cách, không bị giãn cách đều.
 */
export function normalizeHashtags(hashtags?: string[] | string): string {
  if (!hashtags) return '';
  const rawList = Array.isArray(hashtags)
    ? hashtags
    : hashtags.split(/\s+/);

  const cleaned = rawList
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => (tag.startsWith('#') ? tag : `#${tag}`));

  return cleaned.join(' ');
}
