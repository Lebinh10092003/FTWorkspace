import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, ClipboardCheck, FileImage, GraduationCap, Loader2, ShieldCheck, UploadCloud } from 'lucide-react';

import type { CompetitionOption, RegistrationContent, RegistrationField } from './registrationConfig';

type Receipt = { registrationId: string; candidateCode: string; contestCodes: string[]; createdAt: string };
const input = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0055da] focus:ring-4 focus:ring-blue-100';
const label = 'block text-sm font-semibold text-slate-700';

function acceptProof(file: File | null, setProof: (file: File | null) => void, setError: (message: string) => void) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)) {
    setError('Chỉ nhận ảnh PNG, JPEG, WebP hoặc PDF.'); return;
  }
  if (file.size > 5 * 1024 * 1024) { setError('Chứng từ tối đa 5 MB.'); return; }
  setProof(file); setError('');
}

export default function PublicExamRegistration({ previewContent, previewCompetitions = [] }: { previewContent?: RegistrationContent; previewCompetitions?: CompetitionOption[] }) {
  const [competitions, setCompetitions] = useState<CompetitionOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [content, setContent] = useState<RegistrationContent | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [paymentDeclared, setPaymentDeclared] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [requestKey] = useState(() => crypto.randomUUID());
  const suggestedCode = useMemo(() => new URLSearchParams(window.location.search).get('cuoc-thi')?.toUpperCase() || '', []);

  useEffect(() => {
    if (previewContent) { setLoading(false); return; }
    let active = true;
    fetch('/api/public/examination/registration').then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Không thể tải danh sách cuộc thi.');
      if (!active) return;
      const rows = (result.competitions || []) as CompetitionOption[];
      setCompetitions(rows);
      setContent(result.content);
      if (suggestedCode && rows.some(row => row.code === suggestedCode)) setSelected([suggestedCode]);
    }).catch(cause => { if (active) setError(cause?.message || 'Không thể tải biểu mẫu.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [suggestedCode, previewContent]);

  const patch = (key: string, value: string) => setFields(current => ({ ...current, [key]: value }));
  const toggle = (code: string) => setSelected(current => current.includes(code) ? current.filter(item => item !== code) : [...current, code]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewContent) return;
    if (!selected.length) { setError('Vui lòng chọn ít nhất một cuộc thi.'); document.getElementById('chon-cuoc-thi')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (!confirmed) { setError('Vui lòng xác nhận thông tin trước khi gửi.'); return; }
    const body = new FormData();
    body.append('requestKey', requestKey);
    body.append('contestCodes', JSON.stringify(selected));
    body.append('website', (event.currentTarget.elements.namedItem('website') as HTMLInputElement | null)?.value || '');
    Object.entries(fields).forEach(([key, value]) => body.append(key, value.trim()));
    body.append('customAnswers', JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([key]) => key.startsWith('custom_')))));
    body.append('paymentDeclared', String(paymentDeclared));
    if (proof) body.append('proof', proof);
    setSending(true); setError('');
    try {
      const response = await fetch('/api/public/examination/registration', { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Không thể gửi đăng ký. Vui lòng thử lại.');
      setReceipt(result as Receipt);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause: any) { setError(cause?.message || 'Không thể gửi đăng ký. Vui lòng thử lại.'); }
    finally { setSending(false); }
  };

  const config = previewContent || content;
  const options = previewContent ? previewCompetitions.filter(item => !previewContent.competitionCodes.length || previewContent.competitionCodes.includes(item.code)) : competitions;
  if (loading && !previewContent) return <div className="flex min-h-dvh items-center justify-center gap-3 bg-slate-50"><Loader2 className="h-5 w-5 animate-spin" />Đang tải trang đăng ký…</div>;
  if (!config) return <div className="grid min-h-dvh place-items-center bg-slate-50 p-8"><div role="alert" className="max-w-xl rounded-2xl bg-white p-8 text-center"><h1 className="text-2xl font-bold">Trang đăng ký</h1><p className="mt-4">{error || 'Không thể tải biểu mẫu. Vui lòng tải lại trang.'}</p></div></div>;
  const groups: { key: RegistrationField['section']; title: string; description: string; icon: React.ReactNode }[] = [
    { key: 'candidate', title: config.candidateTitle, description: config.candidateDescription, icon: <ClipboardCheck className="h-5 w-5" /> },
    { key: 'contact', title: config.contactTitle, description: config.contactDescription, icon: <ShieldCheck className="h-5 w-5" /> },
    { key: 'extra', title: config.extraTitle, description: '', icon: <ClipboardCheck className="h-5 w-5" /> },
  ];
  const sectionClass = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
  return <div className="min-h-dvh bg-[#f3f7fc] text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4 sm:px-8"><img src="/logo.png" alt={config.brand} className="h-10 w-10 rounded-lg object-contain" /><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#0055da]">{config.brand}</p><p className="font-extrabold text-[#001e40]">{config.title}</p></div></div></header>
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      {receipt ? <div className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-white p-7 text-center shadow-sm sm:p-10">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" /><h1 className="mt-5 text-3xl font-extrabold text-[#001e40]">{config.successTitle}</h1>
        <p className="mt-3 whitespace-pre-line text-slate-600">{config.successMessage}</p>
        <div className="mt-7 rounded-2xl bg-slate-50 p-5 text-left text-sm"><p>Mã thí sinh: <b>{receipt.candidateCode}</b></p><p className="mt-2">Cuộc thi: <b>{receipt.contestCodes.join(', ')}</b></p><p className="mt-2 break-all">Mã đăng ký: <b>{receipt.registrationId}</b></p></div>
        <p className="mt-6 text-sm text-slate-500">Vui lòng lưu mã đăng ký để trao đổi với ban tổ chức khi cần.</p>
      </div> : <>
        <div className="mb-8 max-w-3xl">{config.academicYear && <span className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-[#0055da]"><GraduationCap className="h-4 w-4" />{config.academicYear}</span>}<h1 className="mt-4 text-3xl font-black tracking-tight text-[#001e40] sm:text-4xl">{config.title}</h1><p className="mt-3 whitespace-pre-line text-base leading-7 text-slate-600">{config.intro}</p></div>
        <div className="mb-6 space-y-4">{config.blocks.map((block, index) => <section key={index} className={sectionClass}>{block.title && <h2 className="text-lg font-bold text-[#001e40]">{block.title}</h2>}<p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-600">{block.body}</p></section>)}</div>
        {error && <div role="alert" className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}
        {!options.length ? <div className={sectionClass}>Hiện chưa có cuộc thi nhận đăng ký. Vui lòng quay lại sau.</div> : <form onSubmit={submit} className="space-y-6">
          <section id="chon-cuoc-thi" className={sectionClass}><SectionTitle icon={<GraduationCap className="h-5 w-5" />} title={config.competitionTitle} description={config.competitionDescription} /><div className="mt-5 grid gap-3 sm:grid-cols-2">{options.map(item => <button key={item.code} type="button" aria-pressed={selected.includes(item.code)} onClick={() => toggle(item.code)} className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${selected.includes(item.code) ? 'border-[#0055da] bg-blue-50 shadow-sm' : 'border-slate-200 hover:border-blue-300'}`}><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${selected.includes(item.code) ? 'border-[#0055da] bg-[#0055da] text-white' : 'border-slate-300'}`}>{selected.includes(item.code) && <Check className="h-4 w-4" />}</span><span><b className="block text-[#001e40]">{item.displayCode || item.code}</b><span className="mt-1 block text-sm text-slate-600">{item.name}</span></span></button>)}</div></section>
          {groups.map(group => {
            const groupFields = config.fields.filter(field => field.enabled && field.section === group.key);
            return groupFields.length ? <section key={group.key} className={sectionClass}><SectionTitle icon={group.icon} title={group.title} description={group.description} /><div className="mt-5 grid gap-4 sm:grid-cols-2">{groupFields.map(field => <label key={field.key} className={`${label} ${field.type === 'textarea' || field.key === 'name' || field.key === 'address' ? 'sm:col-span-2' : ''}`}>{field.label}{field.required ? ' *' : ''}{field.type === 'select' ? <select aria-label={`${field.label}${field.required ? ' *' : ''}`} className={input} value={fields[field.key] || ''} onChange={event => patch(field.key, event.target.value)} required={field.required}><option value="">Chọn {field.label.toLocaleLowerCase('vi-VN')}</option>{field.options.map(option => <option key={option} value={option}>{field.key === 'grade' ? `Khối ${option}` : option}</option>)}</select> : field.type === 'textarea' ? <textarea className={input} rows={3} value={fields[field.key] || ''} onChange={event => patch(field.key, event.target.value)} required={field.required} maxLength={4000} /> : <input className={input} type={field.type} value={fields[field.key] || ''} onChange={event => patch(field.key, event.target.value)} required={field.required} maxLength={field.key === 'address' ? 1000 : field.key.startsWith('custom_') ? 4000 : 255} max={field.key === 'birthDate' ? new Date().toISOString().slice(0, 10) : undefined} />}</label>)}</div></section> : null;
          })}
          {config.paymentEnabled && <section className={sectionClass}><SectionTitle icon={<FileImage className="h-5 w-5" />} title={config.paymentTitle} description={config.paymentDescription} /><label className="mt-5 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={paymentDeclared} onChange={event => setPaymentDeclared(event.target.checked)} className="mt-1 h-4 w-4 accent-[#0055da]" /><span>{config.paymentDeclaration}</span></label><div className="mt-5"><label tabIndex={0} className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-6 text-center transition hover:border-[#0055da]" onPaste={event => acceptProof(Array.from(event.clipboardData.files).find(file => file.type.startsWith('image/')) || null, setProof, setError)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); acceptProof(event.dataTransfer.files[0], setProof, setError); }}><UploadCloud className="h-7 w-7 text-[#0055da]" /><b className="mt-2 text-sm text-[#001e40]">{proof ? proof.name : 'Chọn tệp, kéo thả hoặc dán ảnh bằng Ctrl+V'}</b><span className="mt-1 text-xs text-slate-500">PNG, JPEG, WebP hoặc PDF · tối đa 5 MB · không bắt buộc</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" onChange={event => acceptProof(event.target.files?.[0] || null, setProof, setError)} /></label>{proof && <button type="button" onClick={() => setProof(null)} className="mt-2 text-xs font-semibold text-rose-700 underline">Bỏ tệp đã chọn</button>}</div></section>}
          <section className={sectionClass}><h2 className="text-lg font-extrabold text-[#001e40]">{config.confirmationTitle}</h2><p className="mt-2 text-sm text-slate-600">Cuộc thi đã chọn: <b>{selected.join(', ') || 'Chưa chọn'}</b>.</p><label className="mt-5 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-[#0055da]" /><span>{config.consent} *</span></label><input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" /><button type="submit" disabled={sending || !confirmed || Boolean(previewContent)} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0055da] px-7 py-3.5 font-bold text-white transition hover:bg-[#0042ad] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{sending ? <><Loader2 className="h-5 w-5 animate-spin" />Đang gửi...</> : <>{config.submitLabel}<ArrowRight className="h-5 w-5" /></>}</button>{previewContent && <p className="mt-2 text-xs font-semibold text-amber-700">Bản xem trước · không gửi hồ sơ.</p>}<p className="mt-3 whitespace-pre-line text-xs text-slate-500">{config.submitNote}</p></section>
        </form>}
      </>}
    </main>
  </div>;
}

function SectionTitle({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-[#0055da]">{icon}</span><div><h2 className="text-lg font-extrabold text-[#001e40]">{title}</h2>{description && <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{description}</p>}</div></div>;
}
