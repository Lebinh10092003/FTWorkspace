const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./load-ts-module.cjs');

const { normalizeSearchText, slugify, matchesSearch } = loadTsModule('src/lib/searchText.ts');
const { formatDateVN, formatVND, bearerHeaders } = loadTsModule('src/lib/format.ts');

test('Bỏ dấu tiếng Việt, kể cả chữ Đ viết hoa', () => {
  assert.equal(normalizeSearchText('  Phòng   Đào Tạo  '), 'phong dao tao');
  assert.equal(normalizeSearchText('Kế toán'), 'ke toan');
  assert.ok(matchesSearch('Nguyễn Văn Đức', 'duc nguyen'));
});

test('slugify cho tên file / đường dẫn', () => {
  assert.equal(slugify('Đào tạo số 2026!'), 'dao-tao-so-2026');
  assert.equal(slugify('Mã QR — Đăng ký', 6), 'ma-qr-');
  assert.equal(slugify('***'), '');
});

test('Định dạng ngày và tiền', () => {
  assert.equal(formatDateVN('2026-10-29'), '29/10/2026');
  assert.equal(formatDateVN('2026-10-29T08:00:00Z'), '29/10/2026');
  assert.equal(formatDateVN(''), '—');
  assert.equal(formatDateVN('abc', 'Không giới hạn'), 'Không giới hạn');
  assert.equal(formatVND(1250000), '1.250.000đ');
  assert.equal(formatVND(null, 'Chưa nhập'), 'Chưa nhập');
});

test('Header gọi API', () => {
  assert.deepEqual(bearerHeaders('abc'), { Authorization: 'Bearer abc' });
  assert.deepEqual(bearerHeaders(null, true), { Authorization: 'Bearer ', 'Content-Type': 'application/json' });
});
