// The document-number tool keeps its type->code table twice: the backend issues
// the number, and the frontend previews it before the register loads. They
// drifted once already ("Công văn" has no code, but initials alone make "CV"),
// so this check fails the build when the two lists stop agreeing.
import { readFileSync } from 'node:fs';

const BACKEND = 'backend/documents/numbering.py';
const FRONTEND = 'src/components/documents/DocumentNumberGenerator.tsx';

const backendPairs = () => {
  const source = readFileSync(BACKEND, 'utf8');
  const block = source.match(/DOCUMENT_TYPES\s*=\s*\[(.*?)\n\]/s);
  if (!block) throw new Error(`Không tìm thấy DOCUMENT_TYPES trong ${BACKEND}`);
  return [...block[1].matchAll(/\{\s*"label":\s*"([^"]*)",\s*"code":\s*"([^"]*)"\s*\}/g)]
    .map(match => [match[1], match[2]]);
};

const frontendPairs = () => {
  const source = readFileSync(FRONTEND, 'utf8');
  const block = source.match(/FALLBACK_TYPES:\s*DocumentType\[\]\s*=\s*\[(.*?)\n\];/s);
  if (!block) throw new Error(`Không tìm thấy FALLBACK_TYPES trong ${FRONTEND}`);
  return [...block[1].matchAll(/\{\s*label:\s*'([^']*)',\s*code:\s*'([^']*)'\s*\}/g)]
    .map(match => [match[1], match[2]]);
};

const backend = backendPairs();
const frontend = frontendPairs();
const problems = [];

if (!backend.length) problems.push(`${BACKEND}: không đọc được mục nào.`);
if (!frontend.length) problems.push(`${FRONTEND}: không đọc được mục nào.`);

const backendMap = new Map(backend);
const frontendMap = new Map(frontend);

for (const [label, code] of backendMap) {
  if (!frontendMap.has(label)) {
    problems.push(`Thiếu ở frontend: "${label}" (mã "${code}").`);
  } else if (frontendMap.get(label) !== code) {
    problems.push(`Lệch mã "${label}": backend "${code}" ≠ frontend "${frontendMap.get(label)}".`);
  }
}
for (const [label] of frontendMap) {
  if (!backendMap.has(label)) problems.push(`Thừa ở frontend: "${label}" không có trong backend.`);
}

// The rule that started all this: a công văn number is "46/FT", not "46/CV-FT".
if (backendMap.get('Công văn') !== '') problems.push('“Công văn” phải có mã rỗng ở backend.');
if (frontendMap.get('Công văn') !== '') problems.push('“Công văn” phải có mã rỗng ở frontend.');

if (problems.length) {
  console.error('[document-type-codes] Bảng mã loại văn bản không khớp:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`[document-type-codes] OK: ${backend.length} loại văn bản khớp giữa backend và frontend.`);
