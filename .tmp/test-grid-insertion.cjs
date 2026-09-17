const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const source = fs.readFileSync('src/components/WorkSchedule.tsx', 'utf8');
const helpers = source.slice(source.indexOf('const splitNumberedCell ='), source.indexOf('const timePrefixedGridLine ='));
const updater = source.slice(source.indexOf('  const updateCell = (key:'), source.indexOf('  const saveTable = async'));
const compiled = ts.transpileModule(helpers + updater, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
for (const position of [0, 2, 5]) {
  const original = Array.from({length:5}, (_,i)=>({id:i+10,title:'Việc cũ '+i,dailyOrder:i+1,status:'reviewed'}));
  const entries = original.map(t=>t.title);
  entries.splice(position,0,'Việc mới');
  const content = entries.map((t,i)=>`${i+1}. ${t}`).join('\n');
  const draftsRef = {current:{day:{content:original.map(t=>`${t.dailyOrder}. ${t.title}`).join('\n'),selfAssessment:'Hoàn thành',leaderAssessment:'Hoàn thành'}}};
  const dirtyRowsRef = {current:[]};
  const fn = new Function('draftsRef','dirtyRowsRef','failedSaveRef','setTableSaveError','gridRows','rowsFor','setDrafts','setDirtyRows', compiled+'\nconst content='+JSON.stringify(content)+'; updateCell("day",{content}); return {draft:draftsRef.current.day,entries:splitNumberedCell(content),matches:matchGridTasks(splitNumberedCell(content),rowsFor())};');
  const result = fn(draftsRef,dirtyRowsRef,{current:null},()=>{},[{key:'day'}],()=>original,()=>{},()=>{});
  assert.equal(result.matches[position],undefined);
  assert.deepEqual(result.matches.filter(Boolean).map(t=>t.id),original.map(t=>t.id));
  const parse = new Function(compiled.split('const updateCell')[0]+'\nreturn splitNumberedCell;')();
  const notes = parse(result.draft.selfAssessment);
  assert.equal(notes.find(n=>n.number===position+1).text,'');
  assert.equal(notes.filter(n=>n.text==='Hoàn thành').length,5);
  assert.equal(parse(result.draft.leaderAssessment).some(n=>n.number===position+1),false);
  assert.equal(parse(result.draft.leaderAssessment).length,5);
}
console.log('Insertion at beginning, middle and end preserves 5 existing identities/completions; new task is not completed/reviewed.');
