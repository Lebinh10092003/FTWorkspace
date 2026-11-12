import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { CompetitionOption } from './registrationConfig';
import { competitionIdentity } from './competitionIdentity';
import { loadPrefill, money, shortDate, suggestions } from './registrationOffers';

/** Gợi ý đăng ký thêm sau khi hồ sơ đã lưu. Thông tin vừa nhập được điền sẵn ở lượt sau. */
export default function RegistrationCrossSell({ registered, candidateName }: { registered: string[]; candidateName: string }) {
  const [options, setOptions] = useState<CompetitionOption[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/public/examination/registration', { signal: controller.signal })
      .then(response => response.ok ? response.json() : { competitions: [] })
      .then(data => setOptions(data.competitions || []))
      .catch(() => setOptions([]));
    return () => controller.abort();
  }, []);
  const prefill = loadPrefill();
  const picks = suggestions(options, registered, prefill?.fields.grade || '', 3);
  if (!picks.length) return null;
  return <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <h2 className="text-lg font-extrabold">Đăng ký thêm cho {candidateName || 'thí sinh'}</h2>
    <p className="mt-1 text-sm leading-6 text-slate-500">{prefill ? 'Thông tin vừa nhập được điền sẵn, chỉ cần kiểm tra và lưu.' : 'Các cuộc thi khác đang mở đăng ký.'}</p>
    <ul className="mt-4 grid gap-3 sm:grid-cols-3">{picks.map(item => { const identity = competitionIdentity(item.code, item.name); return <li key={item.code}>
      <a href={`/dang-ky-du-thi?cuoc-thi=${encodeURIComponent(item.code)}`} className="flex h-full flex-col rounded-2xl border p-4 transition hover:shadow-md" style={{ borderColor: `${identity.accent}40`, background: identity.tint }}>
        <span className="flex items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white p-1"><img src={identity.logo || '/competition-logos/sco.png'} alt="" width="40" height="40" className="max-h-full w-full object-contain" /></span><b style={{ color: identity.accent }}>{item.displayCode || item.code}</b></span>
        <span className="mt-2 block text-sm leading-5 text-slate-700">{identity.name}</span>
        <span className="mt-auto pt-3 text-xs font-semibold text-slate-600">{item.fee != null ? money(item.fee) : 'Lệ phí thông báo sau'}{item.deadline ? ` · hạn ${shortDate(item.deadline)}` : ''}</span>
        <span className="mt-2 inline-flex items-center gap-1 text-sm font-bold" style={{ color: identity.accent }}>Đăng ký {item.displayCode || item.code}<ArrowRight className="h-4 w-4" /></span>
      </a>
    </li>; })}</ul>
  </section>;
}
