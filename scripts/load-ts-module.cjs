// Nạp một file .ts thật của src để test bằng node --test, không chép lại logic vào file test.
// File được dịch sang CommonJS bằng typescript; import tương đối tới .ts khác cũng được nạp theo cách này.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const cache = new Map();

function loadTsModule(file) {
  const fullPath = path.resolve(__dirname, '..', file);
  if (cache.has(fullPath)) return cache.get(fullPath).exports;

  const source = fs.readFileSync(fullPath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: fullPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const mod = new Module(fullPath, module);
  mod.filename = fullPath;
  mod.paths = Module._nodeModulePaths(path.dirname(fullPath));
  cache.set(fullPath, mod);

  const baseRequire = Module.createRequire(fullPath);
  mod.require = request => {
    if (request.startsWith('.')) {
      const base = path.resolve(path.dirname(fullPath), request);
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (/\.tsx?$/.test(candidate) && fs.existsSync(candidate)) {
          return loadTsModule(path.relative(path.resolve(__dirname, '..'), candidate));
        }
      }
    }
    return baseRequire(request);
  };
  mod._compile(outputText, fullPath);
  return mod.exports;
}

module.exports = { loadTsModule };
