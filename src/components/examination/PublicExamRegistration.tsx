import React, { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { CompetitionOption, RegistrationContent, RegistrationField } from './registrationConfig';
import type { RegistrationReceipt } from './registrationReceipt';
import { todayVN } from '../../lib/vnDate';
import { competitionIdentity } from './competitionIdentity';
import RegistrationProgress from './RegistrationProgress';
import RegistrationPaymentView from './RegistrationPaymentView';

const input = 'mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-[#0055da] focus:ring-4 focus:ring-blue-100 sm:text-sm';
const panel = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
const money = (amount: number) => `${amount.toLocaleString('vi-VN')}đ`;

export default function PublicExamRegistration({ previewContent, previewCompetitions = [] }: { previewContent?: RegistrationContent; previewCompetitions?: CompetitionOption[] }) {
  const [competitions, setCompetitions] = useState<CompetitionOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [content, setContent] = useState<RegistrationContent | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(!previewContent);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<RegistrationReceipt | null>(null);
  const [step, setStep] = useState(0);
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
        else if (initial.code) setError(`Cuộc thi ${initial.code} chưa mở đăng ký tại đây. Vui lòng xem thông báo của ban tổ chức.`);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không thể tải biểu mẫu.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [initial, previewContent]);
  useEffect(() => {
    if (receipt || previewContent || !Object.values(fields).some(value => value.trim())) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [fields, receipt, previewContent]);
  const patch = (key: string, value: string) => { setFields(current => ({ ...current, [key]: value })); setConfirmed(false); };
  const toggle = (code: string) => { setSelected(current => current.includes(code) ? current.filter(item => item !== code) : [...current, code]); setConfirmed(false); };
  const config = previewContent || content;
  const options = [...(previewContent ? previewCompetitions.filter(item => !previewContent.competitionCodes.length || previewContent.competitionCodes.includes(item.code)) : competitions)]
    .sort((a, b) => Number(b.code === initial.code) - Number(a.code === initial.code));
  const selectedOptions = options.filter(item => selected.includes(item.code));
  const required = new Set(selectedOptions.flatMap(item => item.requiredFields || []));
  const effectiveFields = (config?.fields || []).map(field => ({ ...field,
    label: field.key === 'identity' && required.has(field.key) ? field.label.replace(/\s*\(nếu có\)/i, '') : field.label,
    enabled: field.enabled || required.has(field.key), required: field.required || required.has(field.key),
  }));
  const minGrade = Math.max(1, ...selectedOptions.map(item => item.minGrade || 1));
  const maxGrade = Math.min(12, ...selectedOptions.map(item => item.maxGrade || 12));
  const knownTotal = selectedOptions.length > 0 && selectedOptions.every(item => item.fee != null);
  const total = selectedOptions.reduce((sum, item) => sum + (item.fee || 0), 0);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    if (!selected.length) { setError('Vui lòng chọn ít nhất một cuộc thi.'); document.getElementById('chon-cuoc-thi')?.scrollIntoView({ behavior: 'smooth' }); return; }
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
      showReceipt(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Mất kết nối. Bạn có thể bấm lưu lại để tiếp tục.'); }
    finally { setSending(false); }
  };
  if (loading && !previewContent) return <div className="grid min-h-dvh place-items-center bg-slate-50 p-6" role="status">Đang tải đăng ký…</div>;
  if (receipt) return <RegistrationPaymentView receipt={receipt} onUpdate={showReceipt} />;
  if (!config) return <div className="grid min-h-dvh place-items-center bg-slate-50 p-6"><section role="alert" className={`${panel} max-w-xl text-center`}><h1 className="text-2xl font-bold">Đăng ký dự thi</h1><p className="mt-4 text-sm leading-6">{error || 'Không thể tải biểu mẫu.'}</p>{initial.id && <p className="mt-3 text-sm text-slate-500">Thông tin đã lưu vẫn được giữ trên hệ thống. Vui lòng liên hệ khaothi@fermat.vn nếu cần hỗ trợ mở lại liên kết.</p>}<a href="/cuoc-thi" className="mt-4 inline-block min-h-11 p-3 font-semibold text-sky-700">Về trang giới thiệu cuộc thi</a></section></div>;
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
    {field.key === 'submitterEmail' && <button type="button" disabled={!fields.email} onClick={() => patch('submitterEmail', fields.email || '')} className="mt-1 min-h-11 px-1 text-xs font-semibold text-sky-700 underline disabled:opacity-40">Dùng email liên hệ</button>}
  </label>;

  return <div className="min-h-dvh bg-[#f3f7fc] text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-8"><a href="/cuoc-thi" aria-label="Về trang giới thiệu các cuộc thi"><img src="/logo.png" alt={config.brand} className="h-10 w-auto max-w-28 object-contain" /></a><p className="text-sm font-bold sm:text-base">{config.title}</p></div></header>
    <main className="mx-auto max-w-5xl px-4 py-6 pb-12 sm:px-8 sm:py-10">
      <RegistrationProgress step={step} />
      <div className="mb-6"><p className="text-xs font-bold uppercase tracking-wide text-sky-700">{config.academicYear}</p><h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">{step === 0 ? config.title : 'Liên hệ & lưu hồ sơ'}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{step === 0 ? config.intro : 'Hoàn tất thông tin liên hệ. Hồ sơ được lưu trước khi chuyển sang thanh toán; chứng từ có thể bổ sung sau.'}</p></div>
      {step === 0 && config.blocks.map((block, index) => <section key={index} className={`${panel} mb-4`}>{block.title && <h2 className="font-bold">{block.title}</h2>}<p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{block.body}</p></section>)}
      {error && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
      {!options.length ? <section className={panel}>Hiện chưa có cuộc thi nhận đăng ký.</section> : <form onSubmit={submit} className="space-y-5">
        {step === 0 && <section id="chon-cuoc-thi" className={panel}><h2 className="text-lg font-extrabold">{config.competitionTitle}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{config.competitionDescription}</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{options.map(item => {
          const identity = competitionIdentity(item.code, item.name); const chosen = selected.includes(item.code);
          return <button key={item.code} type="button" aria-pressed={chosen} onClick={() => toggle(item.code)} className="flex min-w-0 items-start gap-3 rounded-2xl border p-4 text-left transition" style={{ borderColor: chosen ? identity.accent : '#e2e8f0', background: chosen ? identity.tint : '#fff' }}>
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 sm:h-20 sm:w-20"><img src={identity.logo || '/competition-logos/sco.png'} alt={`Logo ${identity.logo ? identity.code : 'School Connect Olympiad'}`} width="72" height="72" className="max-h-full w-full object-contain" /></span>
            <span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-2"><b style={{ color: identity.accent }}>{item.displayCode || item.code}</b><span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-md border" style={{ borderColor: chosen ? identity.accent : '#cbd5e1', background: chosen ? identity.accent : '#fff', color: '#fff' }}>{chosen && <Check className="h-4 w-4" />}</span></span><span className="mt-1 block text-sm leading-5 text-slate-700">{identity.name}</span><span className="mt-2 block text-xs text-slate-500">{item.time}</span>{item.fee != null && <span className="mt-2 block text-sm font-bold text-sky-700">{money(item.fee)}</span>}</span>
          </button>;
        })}</div></section>}
        {groups.map(group => { const rows = effectiveFields.filter(field => field.enabled && field.section === group.key); return rows.length ? <section key={group.key} className={panel}><h2 className="text-lg font-extrabold">{group.title}</h2>{group.description && <p className="mt-2 text-sm leading-6 text-slate-500">{group.description}</p>}<div className="mt-5 grid gap-4 sm:grid-cols-2">{rows.map(renderField)}</div></section> : null; })}
        {step === 1 && <section className={panel}><h2 className="text-lg font-extrabold">{config.confirmationTitle}</h2><p className="mt-3 text-sm"><strong>{fields.name}</strong> · {fields.className || `Khối ${fields.grade || ''}`} · {fields.school}</p><div className="mt-4 flex flex-wrap gap-2">{selectedOptions.map(item => <span key={item.code} className="rounded-lg bg-sky-50 px-3 py-2 text-sm font-bold text-sky-900">{item.displayCode || item.code}</span>)}</div>{knownTotal && <p className="mt-4 text-sm text-slate-600">Tổng lệ phí: <strong className="text-base text-sky-900">{money(total)}</strong>. Thanh toán ở bước tiếp theo.</p>}<label className="mt-5 flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1.5 h-5 w-5 shrink-0 accent-[#0055da]" /><span>{config.consent} *</span></label><p className="mt-3 text-xs leading-5 text-slate-500">{config.submitNote} Bạn có thể nộp tiền và gửi ảnh sau.</p></section>}
        <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          {step > 0 && <button type="button" onClick={() => { setStep(0); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="min-h-12 rounded-xl border px-4 py-3 text-sm font-bold">Quay lại</button>}
          <button type="submit" disabled={sending || step === 1 && (!confirmed || Boolean(previewContent))} className="ml-auto min-h-12 flex-1 rounded-xl bg-[#0055da] px-5 py-3 text-base font-bold text-white disabled:opacity-50 sm:flex-none">{sending ? 'Đang lưu hồ sơ…' : step === 0 ? 'Tiếp tục: Thông tin liên hệ' : config.submitLabel}</button>
        </div>
        {previewContent && <p className="text-xs font-semibold text-amber-700">Bản xem trước · không lưu hồ sơ.</p>}
      </form>}
    </main>
  </div>;
}
