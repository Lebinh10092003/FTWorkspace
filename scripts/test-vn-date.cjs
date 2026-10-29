const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./load-ts-module.cjs');

const { dateKeyVN, shiftDateKey, shiftDateKeyMonths } = loadTsModule('src/lib/vnDate.ts');

test('01:30 sáng giờ Việt Nam vẫn là hôm nay, không phải hôm qua (UTC)', () => {
  // 2026-10-28T18:30Z = 2026-10-29 01:30 tại Việt Nam
  assert.equal(dateKeyVN(new Date('2026-10-28T18:30:00Z')), '2026-10-29');
  assert.equal(dateKeyVN(new Date('2026-10-28T16:59:59Z')), '2026-10-28');
  assert.equal(dateKeyVN(new Date('2026-10-28T17:00:00Z')), '2026-10-29');
});

test('Cộng trừ ngày qua đầu tháng, đầu năm', () => {
  assert.equal(shiftDateKey('2026-11-01', -1), '2026-10-31');
  assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDateKey('2026-10-29', 365), '2027-10-29');
});

test('Cộng trừ tháng giống Date.setMonth', () => {
  assert.equal(shiftDateKeyMonths('2026-10-29', -3), '2026-07-29');
  assert.equal(shiftDateKeyMonths('2026-10-29', -12), '2025-10-29');
});
