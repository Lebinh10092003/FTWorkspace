import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import type { CompetitionOption, RegistrationContent, RegistrationField } from './registrationConfig';
import type { RegistrationReceipt } from './registrationReceipt';
import { todayVN } from '../../lib/vnDate';
import { competitionIdentity } from './competitionIdentity';
import RegistrationProgress from './RegistrationProgress';
import RegistrationPaymentView from './RegistrationPaymentView';
import { GROUPS, daysLeft, deadlineText, feeLabel, fitsGrade, groupOf, loadPrefill, money, savePrefill, shortDate, suggestions } from './registrationOffers';

const input = 'mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-[#0055da] focus:ring-4 focus:ring-blue-100 sm:text-sm';
const panel = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
const feeText = (item: CompetitionOption) => feeLabel(item.fee);

function Logo({ code, name, size = 56 }: { code: string; name: string; size?: number }) {
  const identity = competitionIdentity(code, name);
  return <span className="flex shrink-0 items-center justify-center rounded-xl bg-white p-1.5 ring-1 ring-slate-100" style={{ width: size, height: size }}>
    <img src={identity.logo || '/competition-logos/sco.png'} alt="" width={size - 12} height={size - 12} className="max-h-full w-full object-contain" />
  </span>;
}

function DeadlineBadge({ deadline }: { deadline?: string }) {
  const days = daysLeft(deadline);
  if (days === null) return null;
  const urgent = days <= 14;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${urgent ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${urgent ? 'animate-pulse bg-rose-500' : 'bg-amber-500'}`} />{deadlineText(deadline)}
  </span>;
}

function CompetitionCard({ item, chosen, onToggle }: { item: CompetitionOption; chosen: boolean; onToggle: () => void }) {
  const identity = competitionIdentity(item.code, item.name);
  return <button type="button" aria-pressed={chosen} onClick={onToggle} className="flex w-full min-w-0 items-start gap-3 rounded-2xl border p-3.5 text-left transition hover:shadow-sm sm:p-4" style={{ borderColor: chosen ? identity.accent : '#e2e8f0', background: chosen ? identity.tint : '#fff' }}>
    <Logo code={item.code} name={item.name} />
    <span className="min-w-0 flex-1">
      <span className="flex items-start justify-between gap-2"><b style={{ color: identity.accent }}>{item.displayCode || item.code}</b><span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-md border" style={{ borderColor: chosen ? identity.accent : '#cbd5e1', background: chosen ? identity.accent : '#fff', color: '#fff' }}>{chosen && <Check className="h-4 w-4" />}</span></span>
      <span className="mt-0.5 block text-sm leading-5 text-slate-700">{identity.name}</span>
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5"><span className={`text-sm font-bold ${item.fee != null ? 'text-sky-800' : 'text-slate-500'}`}>{feeText(item)}</span><DeadlineBadge deadline={item.deadline} /></span>
    </span>
  </button>;
}

export default function PublicExamRegistration({ previewContent, previewCompetitions = [] }: { previewContent?: RegistrationContent; previewCompetitions?: CompetitionOption[] }) {
  const [competitions, setCompetitions] = useState<CompetitionOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [prefilled, setPrefilled] = useState(false);
  const [content, setContent] = useState<RegistrationContent | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(!previewContent);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<RegistrationReceipt | null>(null);
  const [step, setStep] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [requestKey] = useState(() => crypto.randomUUID());
  const initial = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return { code: params.get('cuoc-thi')?.toUpperCase() || '', id: params.get('ho-so') || '', token: params.get('xac-thuc') || '' };
  }, []);
  const showReceipt = (value: RegistrationReceipt) => {
    setReceipt(value); setError('');
    window.history.replaceState(null, '', value.paymentUrl);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  useEffect(() => {
    if (previewContent) return;
    const controller = new AbortController();
    (async () => {
      try {
        if (initial.id && initial.token) {
          const response = await fetch(`/api/public/examination/registrations/${encodeURIComponent(initial.id)}/payment`, { headers: { 'X-Registration-Token': initial.token }, signal: controller.signal });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Không mở được liên kết hồ sơ.');
          if (!controller.signal.aborted) showReceipt(data);
          return;
        }
        const response = await fetch('/api/public/examination/registration', { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Không thể tải trang đăng ký.');
        if (controller.signal.aborted) return;
        const rows = (result.competitions || []) as CompetitionOption[];
        setCompetitions(rows); setContent(result.content);
        if (initial.code && rows.some(row => row.code === initial.code)) setSelected([initial.code]);
        else if (initial.code) setError(`Cuộc thi ${initial.code} hiện chưa mở hoặc đã hết hạn đăng ký. Bạn có thể chọn cuộc thi khác bên dưới.`);
        const saved = loadPrefill();
        if (saved) { setFields(saved.fields); setPrefilled(true); }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không thể tải biểu mẫu.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [initial, previewContent]);
  useEffect(() => {
    if (receipt || previewContent || prefilled || !Object.values(fields).some(value => value.trim())) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [fields, receipt, previewContent, prefilled]);
  const patch = (key: string, value: string) => { setFields(current => ({ ...current, [key]: value })); setConfirmed(false); };
  const toggle = (code: string) => { setSelected(current => current.includes(code) ? current.filter(item => item !== code) : [...current, code]); setConfirmed(false); };
  const config = previewContent || content;
  const options = previewContent ? previewCompetitions : competitions;
  const primary = options.find(item => item.code === initial.code) || null;
  const grade = fields.grade || '';
  const selectedOptions = options.filter(item => selected.includes(item.code));
  const required = new Set(selectedOptions.flatMap(item => item.requiredFields || []));
  const effectiveFields = (config?.fields || []).map(field => ({ ...field,
    label: field.key === 'identity' && required.has(field.key) ? field.label.replace(/\s*\(nếu có\)/i, '') : field.label,
    enabled: field.enabled || required.has(field.key), required: field.required || required.has(field.key),
  }));
  const gradeField = effectiveFields.find(field => field.key === 'grade' && field.enabled);
  const minGrade = Math.max(1, ...selectedOptions.map(item => item.minGrade || 1));
  const maxGrade = Math.min(12, ...selectedOptions.map(item => item.maxGrade || 12));
  const knownTotal = selectedOptions.length > 0 && selectedOptions.every(item => item.fee != null);
  const total = selectedOptions.reduce((sum, item) => sum + (item.fee || 0), 0);
  const extra = suggestions(options, selected, grade);
  const needle = query.trim().toLocaleLowerCase('vi-VN');
  const visible = options.filter(item => selected.includes(item.code) || (fitsGrade(item, grade) && (!needle || `${item.code} ${item.displayCode || ''} ${competitionIdentity(item.code, item.name).name}`.toLocaleLowerCase('vi-VN').includes(needle))));
  const grouped = GROUPS.map(group => ({ ...group, items: visible.filter(item => groupOf(item.code) === group.key) })).filter(group => group.items.length);
  const groupOpen = (key: string) => needle !== '' || visible.length <= 8 || openGroups.includes(key);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    if (!selected.length) { setError('Vui lòng chọn ít nhất một cuộc thi.'); document.getElementById('chon-cuoc-thi')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (step === 0 && gradeField?.required && !grade) { setError('Vui lòng chọn lớp của học sinh.'); document.getElementById('chon-cuoc-thi')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (step === 0) { setStep(1); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (!confirmed) { setError('Vui lòng xác nhận thông tin trước khi lưu hồ sơ.'); return; }
    if (previewContent) return;
    const body = new FormData();
    body.append('requestKey', requestKey); body.append('contestCodes', JSON.stringify(selected));
    body.append('website', (event.currentTarget.elements.namedItem('website') as HTMLInputElement | null)?.value || '');
    for (const [key, value] of Object.entries(fields)) body.append(key, value.trim());
    body.append('customAnswers', JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([key]) => key.startsWith('custom_')))));
    setSending(true); setError('');
    try {
      const response = await fetch('/api/public/examination/registration', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chưa lưu được hồ sơ. Vui lòng thử lại.');
      savePrefill(fields, selected);
      showReceipt(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mất kết nối. Bạn có thể bấm lưu lại để tiếp tục.'); }
    finally { setSending(false); }
  };
  if (loading && !previewContent) return <div className="grid min-h-dvh place-items-center bg-slate-50 p-6" role="status">Đang tải đăng ký…</div>;
  if (receipt) return <RegistrationPaymentView receipt={receipt} onUpdate={showReceipt} />;
  if (!config) return <div className="grid min-h-dvh place-items-center bg-slate-50 p-6"><section role="alert" className={`${panel} max-w-xl text-center`}><h1 className="text-2xl font-bold">Đăng ký dự thi</h1><p className="mt-4 text-sm leading-6">{error || 'Không thể tải biểu mẫu.'}</p>{initial.id && <p className="mt-3 text-sm text-slate-500">Thông tin đã lưu vẫn được giữ trên hệ thống. Vui lòng liên hệ khaothi@fermat.vn nếu cần hỗ trợ mở lại liên kết.</p>}<a href="/cuoc-thi" className="mt-4 inline-block min-h-12 p-3 font-semibold text-sky-700">Về trang giới thiệu cuộc thi</a></section></div>;
  const groups = step === 0 ? [{ key: 'candidate', title: config.candidateTitle, description: config.candidateDescription }] : [
    { key: 'contact', title: config.contactTitle, description: config.contactDescription },
    { key: 'extra', title: config.extraTitle, description: '' },
  ];
  const renderField = (field: RegistrationField) => <label key={field.key} className={`block min-w-0 text-sm font-semibold text-slate-700 ${field.type === 'textarea' || field.key === 'name' || field.key === 'address' ? 'sm:col-span-2' : ''}`}>
    {field.label}{field.required ? ' *' : ''}
    {field.key === 'name' && <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Viết tiếng Việt có dấu, đúng giấy tờ để cấp tài khoản thi và in chứng chỉ.</span>}
    {field.key === 'identity' && <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Dùng thông tin CCCD/hộ chiếu của thí sinh để phục vụ hồ sơ và xuất hóa đơn VAT.</span>}
    {field.key === 'address' && <span className="mt-1 block text-xs font-normal text-slate-500">Địa chỉ theo đơn vị hành chính sau sáp nhập.</span>}
    {field.type === 'select' ? <select aria-label={`${field.label}${field.required ? ' *' : ''}`} className={input} value={fields[field.key] || ''} onChange={event => patch(field.key, event.target.value)} required={field.required}><option value="">Chọn {field.label.toLocaleLowerCase('vi-VN')}</option>{field.options.filter(option => field.key !== 'grade' || Number(option) >= minGrade && Number(option) <= maxGrade).map(option => <option key={option} value={option}>{field.key === 'grade' ? `Khối ${option}` : option}</option>)}</select>
      : field.type === 'textarea' ? <textarea className={input} rows={3} value={fields[field.key] || ''} onChange={event => patch(field.key, event.target.value)} required={field.required} maxLength={4000} />
      : <input className={input} type={field.type} autoComplete={field.key === 'name' ? 'name' : field.key === 'birthDate' ? 'bday' : field.key === 'email' || field.key === 'submitterEmail' ? 'email' : field.key === 'phone' ? 'tel' : field.key === 'address' ? 'street-address' : 'off'} value={fields[field.key] || ''} onChange={event => patch(field.key, event.target.value)} required={field.required} maxLength={field.key === 'address' ? 1000 : field.key === 'className' ? 100 : field.key.startsWith('custom_') ? 4000 : 255} max={field.key === 'birthDate' ? todayVN() : undefined} />}
    {field.key === 'submitterEmail' && <button type="button" disabled={!fields.email} onClick={() => patch('submitterEmail', fields.email || '')} className="mt-1 min-h-12 px-1 text-xs font-semibold text-sky-700 underline disabled:opacity-40">Dùng email liên hệ</button>}
  </label>;
  const primaryIdentity = primary ? competitionIdentity(primary.code, primary.name) : null;
  // Khối lớp chọn bằng nút ở đầu form, dùng luôn để lọc cuộc thi; ô khối lớp bên dưới được ẩn để không hỏi hai lần.
  const gradeChips = gradeField && <div><p className="text-sm font-bold text-slate-700">Học sinh đang học lớp{gradeField.required ? ' *' : ''}</p><div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Chọn khối lớp">{gradeField.options.filter(value => Number(value) >= minGrade && Number(value) <= maxGrade).map(value => <button key={value} type="button" aria-pressed={grade === value} onClick={() => patch('grade', grade === value ? '' : value)} className={`min-h-11 min-w-11 rounded-xl border px-3 text-sm font-bold transition ${grade === value ? 'border-[#0055da] bg-[#0055da] text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-sky-400'}`}>{value}</button>)}</div><p className="mt-2 text-xs text-slate-500">Chọn lớp để chỉ hiện cuộc thi phù hợp.</p></div>;
  const allList = <div className="space-y-3">
    {options.length > 8 && <label className="relative block"><span className="sr-only">Tìm cuộc thi</span><Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm theo tên hoặc mã cuộc thi" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-base outline-none focus:border-[#0055da] sm:text-sm" /></label>}
    {grouped.map(group => { const open = groupOpen(group.key); const picked = group.items.filter(item => selected.includes(item.code)).length; return <div key={group.key} className="rounded-2xl border border-slate-200">
      <button type="button" aria-expanded={open} onClick={() => setOpenGroups(current => current.includes(group.key) ? current.filter(key => key !== group.key) : [...current, group.key])} className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1"><b className="text-sm">{group.title}</b><span className="ml-2 text-xs text-slate-500">{group.items.length} cuộc thi{picked ? ` · đã chọn ${picked}` : ''}</span>{!open && <span className="mt-0.5 block truncate text-xs text-slate-500">{group.items.map(item => item.displayCode || item.code).join(' · ')}</span>}</span>
        <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2">{group.items.map(item => <CompetitionCard key={item.code} item={item} chosen={selected.includes(item.code)} onToggle={() => toggle(item.code)} />)}</div>}
    </div>; })}
    {!grouped.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Không có cuộc thi phù hợp{grade ? ` với lớp ${grade}` : ''}{needle ? ' và từ khóa đã nhập' : ''}.</p>}
  </div>;

  return <div className="min-h-dvh bg-[#f3f7fc] text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-8"><a href="/cuoc-thi" aria-label="Về trang giới thiệu các cuộc thi"><img src="/logo.png" alt={config.brand} className="h-10 w-auto max-w-28 object-contain" /></a><p className="text-sm font-bold sm:text-base">{primary ? `Đăng ký ${primary.displayCode || primary.code}` : config.title}</p></div></header>
    <main className="mx-auto max-w-5xl px-4 py-6 pb-12 sm:px-8 sm:py-10">
      <RegistrationProgress step={step} />
      {step === 0 && primary && primaryIdentity ? <section className="mb-6 overflow-hidden rounded-3xl border p-5 sm:p-7" style={{ borderColor: `${primaryIdentity.accent}33`, background: `linear-gradient(135deg, ${primaryIdentity.tint}, #ffffff 70%)` }}>
        <div className="flex flex-wrap items-center gap-4"><Logo code={primary.code} name={primary.name} size={84} /><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wide" style={{ color: primaryIdentity.accent }}>{config.academicYear}{primaryIdentity.family ? ` · ${primaryIdentity.family}` : ''}</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{primaryIdentity.name}</h1><div className="mt-3 flex flex-wrap items-center gap-2"><DeadlineBadge deadline={primary.deadline} />{primary.entryRound && <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">Đăng ký {primary.entryRound}</span>}</div></div></div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3"><div className="rounded-2xl bg-white/80 p-4 ring-1 ring-slate-100"><dt className="text-xs text-slate-500">Lệ phí {primary.entryRound ? primary.entryRound.toLocaleLowerCase('vi-VN') : 'đăng ký'}</dt><dd className="mt-1 text-lg font-extrabold" style={{ color: primaryIdentity.accent }}>{feeText(primary)}</dd></div>{primary.deadline && <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-slate-100"><dt className="text-xs text-slate-500">Hạn đăng ký</dt><dd className="mt-1 text-lg font-extrabold">{shortDate(primary.deadline)}</dd></div>}{!!primary.laterRounds?.length && <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-slate-100"><dt className="text-xs text-slate-500">Vòng sau (khi đủ điều kiện)</dt><dd className="mt-1 space-y-0.5 text-sm font-semibold text-slate-700">{primary.laterRounds.map(round => <span key={round.name} className="block">{round.name} · {feeLabel(round.fee, 'thông báo sau')}</span>)}</dd></div>}</dl>
      </section> : <div className="mb-6"><p className="text-xs font-bold uppercase tracking-wide text-sky-700">{config.academicYear}</p><h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">{step === 0 ? config.title : 'Liên hệ & lưu hồ sơ'}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{step === 0 ? config.intro : 'Hoàn tất thông tin liên hệ. Hồ sơ được lưu trước khi chuyển sang thanh toán; chứng từ có thể bổ sung sau.'}</p></div>}
      {step === 0 && config.blocks.map((block, index) => <section key={index} className={`${panel} mb-4`}>{block.title && <h2 className="font-bold">{block.title}</h2>}<p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{block.body}</p></section>)}
      {prefilled && step === 0 && <p role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">Đã điền sẵn thông tin từ hồ sơ vừa lưu. Vui lòng kiểm tra lại trước khi gửi.<button type="button" onClick={() => { setFields({}); setPrefilled(false); }} className="font-bold underline">Nhập thí sinh khác</button></p>}
      {error && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
      {!options.length ? <section className={panel}>Hiện chưa có cuộc thi nhận đăng ký.</section> : <form onSubmit={submit} className="space-y-5">
        {step === 0 && <section id="chon-cuoc-thi" className={`${panel} space-y-5`}>
          {primary ? <>
            <div><h2 className="text-lg font-extrabold">Cuộc thi đăng ký</h2><div className="mt-3"><CompetitionCard item={primary} chosen={selected.includes(primary.code)} onToggle={() => toggle(primary.code)} /></div></div>
            {gradeChips}
            {extra.length > 0 && <div className="rounded-2xl bg-slate-50 p-4"><h3 className="font-extrabold">Đăng ký thêm cho tiện</h3><p className="mt-1 text-sm text-slate-500">Dùng chung hồ sơ và một lần chuyển khoản{grade ? `, phù hợp lớp ${grade}` : ''}.</p><ul className="mt-3 space-y-2">{extra.map(item => { const identity = competitionIdentity(item.code, item.name); return <li key={item.code} className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-100"><Logo code={item.code} name={item.name} size={44} /><span className="min-w-0 flex-1"><b className="block text-sm" style={{ color: identity.accent }}>{item.displayCode || item.code}</b><span className="block truncate text-xs text-slate-600">{identity.name}</span><span className="mt-0.5 block text-xs font-semibold text-slate-500">{feeText(item)}{item.deadline ? ` · hạn ${shortDate(item.deadline)}` : ''}</span></span><button type="button" onClick={() => toggle(item.code)} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl border border-sky-200 px-3 text-sm font-bold text-sky-800 hover:bg-sky-50"><Plus className="h-4 w-4" />Thêm</button></li>; })}</ul></div>}
            {selected.some(code => code !== primary.code) && <div><p className="text-sm font-bold text-slate-700">Đã thêm</p><div className="mt-2 grid gap-3 sm:grid-cols-2">{selectedOptions.filter(item => item.code !== primary.code).map(item => <CompetitionCard key={item.code} item={item} chosen onToggle={() => toggle(item.code)} />)}</div></div>}
            {options.length > 1 && <div><button type="button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-sky-800">{showAll ? 'Thu gọn' : `Xem tất cả ${options.length} cuộc thi đang mở`}<ChevronDown aria-hidden="true" className={`h-4 w-4 transition ${showAll ? 'rotate-180' : ''}`} /></button>{showAll && <div className="mt-3">{allList}</div>}</div>}
          </> : <>
            <div><h2 className="text-lg font-extrabold">{config.competitionTitle}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{config.competitionDescription}</p></div>
            {gradeChips}
            {allList}
          </>}
        </section>}
        {groups.map(group => { const rows = effectiveFields.filter(field => field.enabled && field.section === group.key && field.key !== 'grade'); return rows.length ? <section key={group.key} className={panel}><h2 className="text-lg font-extrabold">{group.title}</h2>{group.description && <p className="mt-2 text-sm leading-6 text-slate-500">{group.description}</p>}<div className="mt-5 grid gap-4 sm:grid-cols-2">{rows.map(renderField)}</div></section> : null; })}
        {step === 1 && <section className={panel}><h2 className="text-lg font-extrabold">{config.confirmationTitle}</h2><p className="mt-3 text-sm"><strong>{fields.name}</strong> · {fields.className || `Khối ${fields.grade || ''}`} · {fields.school}</p><ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">{selectedOptions.map(item => <li key={item.code} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span><b>{item.displayCode || item.code}</b>{item.entryRound && <span className="text-slate-500"> · {item.entryRound}</span>}</span><span className="font-bold text-sky-900">{feeText(item)}</span></li>)}</ul>{knownTotal && <p className="mt-4 text-sm text-slate-600">Tổng lệ phí: <strong className="text-base text-sky-900">{money(total)}</strong>. Thanh toán ở bước tiếp theo.</p>}<label className="mt-5 flex min-h-12 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1.5 h-5 w-5 shrink-0 accent-[#0055da]" /><span>{config.consent} *</span></label><p className="mt-3 text-xs leading-5 text-slate-500">{config.submitNote} Bạn có thể nộp tiền và gửi ảnh sau.</p></section>}
        <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          {selectedOptions.length > 0 && <p className="min-w-0 text-sm leading-5 text-slate-600" aria-live="polite"><span className="block">{selectedOptions.map(item => item.displayCode || item.code).join(' + ')}</span><strong className="text-base text-sky-900">{knownTotal ? money(total) : total > 0 ? `${money(total)} + lệ phí chưa công bố` : 'Lệ phí thông báo sau'}</strong></p>}
          {step > 0 && <button type="button" onClick={() => { setStep(0); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="min-h-12 rounded-xl border px-4 py-3 text-sm font-bold">Quay lại</button>}
          <button type="submit" disabled={sending || step === 1 && (!confirmed || Boolean(previewContent))} className="ml-auto min-h-12 flex-1 rounded-xl bg-[#0055da] px-5 py-3 text-base font-bold text-white disabled:opacity-50 sm:flex-none">{sending ? 'Đang lưu hồ sơ…' : step === 0 ? 'Tiếp tục: Thông tin liên hệ' : config.submitLabel}</button>
        </div>
        {previewContent && <p className="text-xs font-semibold text-amber-700">Bản xem trước · không lưu hồ sơ.</p>}
      </form>}
    </main>
  </div>;
}
