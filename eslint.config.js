// ESLint cho frontend (src/). Lỗi (error) chặn CI; cảnh báo (warn) là nợ kỹ thuật cần giảm dần.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'backend', 'apps-script', 'scripts', '**/*.cjs', '**/*.mjs'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Gọi hook sai chỗ (trong if/vòng lặp, sau return) là lỗi chạy thật: chặn.
      'react-hooks/rules-of-hooks': 'error',
      // Thiếu dependency trong useEffect/useMemo/useCallback dễ gây dữ liệu cũ: cảnh báo để sửa dần.
      'react-hooks/exhaustive-deps': 'warn',
      // Code cũ dùng `any` nhiều; cảnh báo để giảm dần thay vì chặn cả CI.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // `catch {}` rỗng có chủ đích (localStorage, audio...) vẫn hợp lệ; khối rỗng khác thì không.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Cho phép kiểu `cond && run()` / `a ? f() : g()` đang dùng rộng rãi.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // Không tự bỏ dấu \ trong regex: trong [...] bỏ nhầm có thể đổi nghĩa (vd thành một khoảng ký tự).
      'no-useless-escape': 'warn',
      // Một số regex cố ý lọc ký tự điều khiển (mã 0–31) khỏi tên file / văn bản.
      'no-control-regex': 'off',
      // TypeScript đã kiểm tra biến chưa khai báo.
      'no-undef': 'off',
    },
  },
);
