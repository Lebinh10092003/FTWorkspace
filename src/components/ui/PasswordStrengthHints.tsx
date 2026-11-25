import { Check, Circle } from 'lucide-react';

/** Advisory checks only: an administrator may still set any password. */
export const passwordChecks = (password: string) => [
  { label: 'Tối thiểu 8 ký tự', passed: password.length >= 8 },
  { label: 'Có chữ hoa (A–Z)', passed: /[A-Z]/.test(password) },
  { label: 'Có chữ thường (a–z)', passed: /[a-z]/.test(password) },
  { label: 'Có chữ số (0–9)', passed: /\d/.test(password) },
  { label: 'Có ký tự đặc biệt (!@#$…)', passed: /[^A-Za-z0-9\s]/.test(password) },
];

const LEVELS = [
  { label: 'Rất yếu', bar: 'bg-rose-500', text: 'text-rose-700' },
  { label: 'Yếu', bar: 'bg-rose-500', text: 'text-rose-700' },
  { label: 'Trung bình', bar: 'bg-amber-500', text: 'text-amber-700' },
  { label: 'Khá', bar: 'bg-amber-500', text: 'text-amber-700' },
  { label: 'Mạnh', bar: 'bg-emerald-500', text: 'text-emerald-700' },
  { label: 'Rất mạnh', bar: 'bg-emerald-600', text: 'text-emerald-700' },
];

/** Generate a random strong password with the browser's secure random source. */
export function generateStrongPassword(length = 14) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%^&*'];
  const all = sets.join('');
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (value, index) => (index < sets.length ? sets[index] : all)[value % (index < sets.length ? sets[index] : all).length]);
  // Shuffle so the guaranteed character of each set is not always first.
  const order = new Uint32Array(length);
  crypto.getRandomValues(order);
  return chars.map((char, index) => [order[index], char] as const).sort((a, b) => a[0] - b[0]).map(([, char]) => char).join('');
}

export default function PasswordStrengthHints({ password, id }: { password: string; id?: string }) {
  const checks = passwordChecks(password);
  const score = password ? checks.filter(check => check.passed).length : 0;
  const level = LEVELS[score];
  return (
    <div id={id} className="space-y-2" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {checks.map((_, index) => (
            <span key={index} className={`h-1.5 flex-1 rounded-full transition-colors motion-reduce:transition-none ${index < score ? level.bar : 'bg-slate-200'}`} />
          ))}
        </div>
        {password && <span className={`text-xs font-bold ${level.text}`}>Độ mạnh: {level.label}</span>}
      </div>
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        {checks.map(check => (
          <li key={check.label} className={`flex items-center gap-1.5 ${check.passed ? 'text-emerald-700' : 'text-slate-500'}`}>
            {check.passed ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Circle className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span>{check.label}<span className="sr-only">{check.passed ? ': đạt' : ': chưa đạt'}</span></span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">Đây là gợi ý để mật khẩu an toàn hơn; vẫn có thể đặt mật khẩu bất kỳ.</p>
    </div>
  );
}
