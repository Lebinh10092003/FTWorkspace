const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const {Tag} = require('lucide-react');
const {renderToStaticMarkup} = require('react-dom/server');
const source = fs.readFileSync('src/components/WorkSchedule.tsx','utf8');
const code = source.slice(source.indexOf('const splitNumberedCell ='), source.indexOf('function SpreadsheetScheduleTable'));
const compiled = ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020}}).outputText;
const Editor = new Function('React','useState','Tag',compiled+';return ImportantWorkContentEditor;')(React,React.useState,Tag);
for(const [title,italic] of [['[Lịch cá nhân] 7h00 - 9h30: Vắng mặt do có lịch học',false],['7h00: lịch riêng đi học',false],['[Hỗ trợ] [Lịch cá nhân] 8h00: Việc riêng',false],['Lịch cá nhân không giờ',false],['[Hỗ trợ] 8h00: Tập huấn',true],['8h00: Họp công ty',true]]) {
  const html=renderToStaticMarkup(React.createElement(Editor,{value:'1. '+title,tasks:[{dailyOrder:1,priority:'high',timePrefixInTitle:true}],className:'',onInput:()=>{},onChange:()=>{},onBlur:()=>{}}));
  assert.equal(html.includes('font-bold italic text-black'),italic,title);
}
console.log('6 rendered task styles passed: personal never italic; timed work/support stays italic.');
