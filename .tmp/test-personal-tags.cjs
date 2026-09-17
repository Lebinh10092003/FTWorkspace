const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { Tag } = require('lucide-react');
const source = fs.readFileSync('src/components/WorkSchedule.tsx', 'utf8');
const start = source.indexOf('const timePrefixedGridLine =');
const end = source.indexOf('\nfunction ImportantWorkContentEditor', start);
const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText;
const { taskTags, WorkTitle, timePrefixedGridLine } = new Function('React', 'Tag', js + '\nreturn {taskTags, WorkTitle, timePrefixedGridLine};')(React, Tag);
const cases = [
  ['[Lịch cá nhân] 17h00: Đón con', true, false, '17h00: Đón con', true],
  ['17h00: Sắp xếp lịch cá nhân tuần tới', true, false, '17h00: Sắp xếp lịch cá nhân tuần tới', true],
  ['Hẹn theo LỊCH RIÊNG ngày mai', true, false, 'Hẹn theo LỊCH RIÊNG ngày mai', false],
  ['[Hỗ trợ] [Lịch cá nhân] 8h00 - 10h30: Việc riêng', true, true, '8h00 - 10h30: Việc riêng', true],
  ['[Lịch cá nhân] [Hỗ trợ] 8h00: Việc riêng', true, true, '8h00: Việc riêng', true],
  ['[Lịch cá nhân] [Lịch cá nhân] Đón con', true, false, 'Đón con', false],
  ['[Lịch cá nhân] Đón con', true, false, 'Đón con', false],
  ['[Hỗ trợ] 17h00: Tập huấn', false, true, '17h00: Tập huấn', true],
  ['Lịch công tác chung', false, false, 'Lịch công tác chung', false],
];
for (const [title, personal, support, content, timed] of cases) {
  const tags = taskTags(title);
  assert.deepEqual(tags, { personal, support, content });
  assert.equal(timePrefixedGridLine.test('1. ' + title), timed);
  const html = renderToStaticMarkup(React.createElement(WorkTitle, { task: { title, displayTitle: '1. ' + title } }));
  assert.equal(html.includes('text-fuchsia-700'), personal);
  assert.equal(html.includes('text-orange-700'), support);
  assert.equal(html.includes('[Lịch cá nhân]'), false);
  assert.equal((html.match(/text-fuchsia-700/g) || []).length, personal ? 1 : 0);
  assert.ok(html.includes(content));
}
console.log('Personal task tags: 9 recognition, rendering and time cases passed.');
