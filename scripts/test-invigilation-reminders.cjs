const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('src/components/examination/invigilationTiming.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {}, Date, Intl, Number, Math };
vm.runInNewContext(code, context);
const { reminderDue, reminderKey, ServerClock, dutyTime, dutyDate } = context.exports;
const first = { id: 'first', startsAt: '2026-10-11T09:00:00+07:00', endsAt: '2026-10-11T10:00:00+07:00', enabled: true };
const second = { id: 'second', startsAt: '2026-10-11T10:30:00+07:00', endsAt: '2026-10-11T11:30:00+07:00', enabled: true };
const at = value => Date.parse(`2026-10-11T${value}+07:00`);

test('Reminder opens exactly at 08:45, not before the 15-minute boundary', () => {
  assert.equal(reminderDue(first, at('08:44:59')), false);
  assert.equal(reminderDue(first, at('08:45:00')), true);
});
test('Late entry gets its reminder during the shift; ended shifts disappear', () => {
  assert.equal(reminderDue(first, at('09:25:00')), true);
  assert.equal(reminderDue(first, at('09:59:59')), true);
  assert.equal(reminderDue(first, at('10:00:00')), false);
});
test('Dismissing the first shift cannot suppress the next shift at 10:15', () => {
  const seen = new Set([reminderKey('staff@example.com', first)]);
  assert.equal(reminderDue(second, at('10:14:59')), false);
  assert.equal(reminderDue(second, at('10:15:00')), true);
  assert.equal(seen.has(reminderKey('staff@example.com', second)), false);
});
test('Changed times and different employees have independent reminder identities', () => {
  assert.notEqual(reminderKey('a', first), reminderKey('b', first));
  assert.notEqual(reminderKey('a', first), reminderKey('a', { ...first, startsAt: second.startsAt }));
});
test('Disabled or invalid schedules never trigger popups', () => {
  assert.equal(reminderDue({ ...first, enabled: false }, at('08:45:00')), false);
  assert.equal(reminderDue({ ...first, endsAt: first.startsAt }, at('08:45:00')), false);
  assert.equal(reminderDue({ ...first, startsAt: 'invalid' }, at('08:45:00')), false);
});
test('Server clock compensates response latency and ignores a wrong computer clock', () => {
  const clock = new ServerClock();
  assert.equal(clock.now(1000), null);
  clock.sync('2026-10-11T08:44:59+07:00', 100, 300);
  assert.equal(clock.now(1200), at('08:45:00'));
  const original = Date.now;
  Date.now = () => 0;
  try { assert.equal(clock.now(2200), at('08:45:01')); } finally { Date.now = original; }
});
test('After a suspended page resumes, elapsed monotonic time catches up immediately', () => {
  const clock = new ServerClock();
  clock.sync('2026-10-11T08:40:00+07:00', 0, 0);
  assert.equal(reminderDue(first, clock.now(20*60_000)), true);
  assert.equal(reminderDue(first, clock.now(80*60_000)), false);
});
test('Dates and clock labels always use Vietnam time', () => {
  assert.equal(dutyTime('2026-10-11T02:00:00Z'), '09:00');
  assert.equal(dutyDate('2026-10-10T18:00:00Z'), '11/10/2026');
});
