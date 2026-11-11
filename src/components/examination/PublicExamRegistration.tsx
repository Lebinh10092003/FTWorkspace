import React, { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, ClipboardCheck, FileImage, GraduationCap, Loader2, ShieldCheck, UploadCloud } from 'lucide-react';

import type { CompetitionOption, RegistrationContent, RegistrationField } from './registrationConfig';
import { todayVN } from '../../lib/vnDate';
import { competitionIdentity } from './competitionIdentity';

type Receipt = { registrationId: string; candidateCode: string; contestCodes: string[]; createdAt: string };
const input = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0055da] focus:ring-4 focus:ring-blue-100';
const label = 'block text-sm font-semibold text-slate-700';

function acceptProof(file: File | null, setProof: (file: File | null) => void, setError: (message: string) => void) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'application/pdf'].includes(file.type)) {
    setError('Chỉ nhận ảnh PNG, JPEG, WebP, GIF, BMP hoặc PDF.'); return;
  }
  if (file.size > 10 * 1024 * 1024) { setError('Chứng từ tối đa 10 MB.'); return; }
  setProof(file); setError('');
}

export default function PublicExamRegistration({ previewContent, previewCompetitions = [] }: { previewContent?: RegistrationContent; previewCompetitions?: CompetitionOption[] }) {
  const [competitions, setCompetitions] = useState<CompetitionOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [content, setContent] = useState<RegistrationContent | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState('');
  const [paymentDeclared, setPaymentDeclared] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [step, setStep] = useState(0);
  const [requestKey] = useState(() => crypto.randomUUID());
  const suggestedCode = useMemo(() => new URLSearchParams(window.location.search).get('cuoc-thi')?.toUpperCase() || '', []);
  useEffect(() => {
    if (!proof) { setProofPreview(''); return; }
    const url = URL.createObjectURL(proof);
    setProofPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [proof]);

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
      else if (suggestedCode) setError(`Cuộc thi ${suggestedCode} chưa mở đăng ký tại đây. Vui lòng xem thông báo của ban tổ chức.`);
    }).catch(cause => { if (active) setError(cause?.message || 'Không thể tải biểu mẫu.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [suggestedCode, previewContent]);

  const patch = (key: string, value: string) => { setFields(current => ({ ...current, [key]: value })); setConfirmed(false); };
  const toggle = (code: string) => { setSelected(current => current.includes(code) ? current.filter(item => item !== code) : [...current, code]); setConfirmed(false); };
  const goToStep = (next: number) => { setError(''); setStep(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  useEffect(() => {
    if (receipt || previewContent || !Object.values(fields).some(value => value.trim()) && !proof) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [fields, proof, receipt, previewContent]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    if (!selected.length) { setError('Vui lòng chọn ít nhất một cuộc thi.'); document.getElementById('chon-cuoc-thi')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (step === 1 && options.some(item => selected.includes(item.code) && item.proofRequired) && !proof) { setError('Vui lòng đính kèm ảnh hoặc PDF xác nhận nộp lệ phí theo yêu cầu cuộc thi.'); return; }
    if (step < 2) { goToStep(step + 1); return; }
    if (previewContent) return;
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
  const selectedOptions = options.filter(item => selected.includes(item.code));
  const requiredFields = new Set(selectedOptions.flatMap(item => item.requiredFields || []));
  const effectiveFields = (config?.fields || []).map(field => ({ ...field, label: field.key === 'identity' && requiredFields.has(field.key) ? field.label.replace(/\s*\(nếu có\)/i, '') : field.label, enabled: field.enabled || requiredFields.has(field.key), required: field.required || requiredFields.has(field.key) }));
  const proofRequired = selectedOptions.some(item => item.proofRequired);
  const fermatSelected = selected.some(code => code === 'FIMO' || code === 'FIEO');
  const minGrade = Math.max(1, ...selectedOptions.map(item => item.minGrade || 1));
  const maxGrade = Math.min(12, ...selectedOptions.map(item => item.maxGrade || 12));
  const knownTotal = selectedOptions.length > 0 && selectedOptions.every(item => item.fee != null);
  const total = selectedOptions.reduce((sum, item) => sum + (item.fee || 0), 0);
  if (loading && !previewContent) return <div className="flex min-h-dvh items-center justify-center gap-3 bg-slate-50"><Loader2 className="h-5 w-5 animate-spin" />Đang tải trang đăng ký…</div>;
  if (!config) return <div className="grid min-h-dvh place-items-center bg-slate-50 p-8"><div role="alert" className="max-w-xl rounded-2xl bg-white p-8 text-center"><h1 className="text-2xl font-bold">Trang đăng ký</h1><p className="mt-4">{error || 'Không thể tải biểu mẫu. Vui lòng tải lại trang.'}</p></div></div>;
  const groups: { key: RegistrationField['section']; title: string; description: string; icon: React.ReactNode }[] = [
    { key: 'candidate', title: config.candidateTitle, description: config.candidateDescription, icon: <ClipboardCheck className="h-5 w-5" /> },
    { key: 'contact', title: config.contactTitle, description: config.contactDescription, icon: <ShieldCheck className="h-5 w-5" /> },
    { key: 'extra', title: config.extraTitle, description: '', icon: <ClipboardCheck className="h-5 w-5" /> },
  ];
  const sectionClass = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
  return <div className="min-h-dvh bg-[#f3f7fc] text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4 sm:px-8"><a href="/cuoc-thi" aria-label="Về trang giới thiệu các cuộc thi"><img src="/logo.png" alt={config.brand} className="h-10 w-auto max-w-28 rounded-lg object-contain" /></a><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#0055da]">{config.brand}</p><p className="font-extrabold text-[#001e40]">{config.title}</p></div></div></header>
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      {receipt ? <div className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-white p-7 text-center shadow-sm sm:p-10">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" /><h1 className="mt-5 text-3xl font-extrabold text-[#001e40]">{config.successTitle}</h1>
        <p className="mt-3 whitespace-pre-line text-slate-600">{config.successMessage}</p>
        <div className="mt-7 rounded-2xl bg-slate-50 p-5 text-left text-sm"><p>Mã thí sinh: <b>{receipt.candidateCode}</b></p><p className="mt-2">Cuộc thi: <b>{receipt.contestCodes.join(', ')}</b></p><p className="mt-2 break-all">Mã đăng ký: <b>{receipt.registrationId}</b></p></div>
        <button type="button" onClick={() => window.print()} className="mt-5 rounded-xl border border-sky-200 bg-sky-50 px-5 py-3 text-sm font-bold text-sky-800 print:hidden">In / lưu phiếu đăng ký</button><p className="mt-6 text-sm text-slate-500">Vui lòng lưu mã đăng ký để trao đổi với ban tổ chức khi cần.</p><div className="mt-5 border-t border-slate-100 pt-5 text-sm leading-6 text-slate-600"><p>Ban Khảo thí FermatTech</p><a href="mailto:khaothi@fermat.vn" className="font-semibold text-sky-700">khaothi@fermat.vn</a><p><a href="tel:0969627162">0969 627 162</a> · 08:00–17:30, thứ Hai–thứ Sáu</p></div>
      </div> : <>
        <div className="mb-8 max-w-3xl">{config.academicYear && <span className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-[#0055da]"><GraduationCap className="h-4 w-4" />{config.academicYear}</span>}<h1 className="mt-4 text-3xl font-black tracking-tight text-[#001e40] sm:text-4xl">{config.title}</h1><p className="mt-3 whitespace-pre-line text-base leading-7 text-slate-600">{config.intro}</p></div>
        <div className="mb-6 space-y-4">{config.blocks.map((block, index) => <section key={index} className={sectionClass}>{block.title && <h2 className="text-lg font-bold text-[#001e40]">{block.title}</h2>}<p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-600">{block.body}</p></section>)}</div>
        {error && <div role="alert" className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}
        {!options.length ? <div className={sectionClass}>Hiện chưa có cuộc thi nhận đăng ký. Vui lòng quay lại sau.</div> : <form onSubmit={submit} className="space-y-6">
          <ol className="grid grid-cols-3 gap-2" aria-label="Tiến trình đăng ký">{['Thí sinh & cuộc thi', 'Liên hệ & thanh toán', 'Kiểm tra & gửi'].map((title, index) => <li key={title} aria-current={step === index ? 'step' : undefined} className={`rounded-xl border px-3 py-3 text-xs font-bold sm:text-sm ${step === index ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-slate-200 bg-white text-slate-500'}`}><span className="mr-2">{index + 1}.</span>{title}</li>)}</ol>
          {step === 0 && <div className="flex flex-wrap gap-x-5 gap-y-2 px-1 text-xs font-medium text-slate-500"><span>Một hồ sơ cho nhiều cuộc thi</span><span>Kiểm tra trước khi gửi</span><span>Nhận mã đăng ký để theo dõi</span></div>}

          {step === 0 && <section id="chon-cuoc-thi" className={sectionClass}><SectionTitle icon={<GraduationCap className="h-5 w-5" />} title={config.competitionTitle} description={config.competitionDescription} /><div className="mt-5 grid gap-3 sm:grid-cols-2">{options.map(item => {
            const identity = competitionIdentity(item.code, item.name);
            const logo = identity.logo || '/competition-logos/sco.png';
            const chosen = selected.includes(item.code);
            return <button key={item.code} type="button" aria-pressed={chosen} onClick={() => toggle(item.code)} className="flex min-w-0 items-start gap-4 rounded-2xl border bg-white p-4 text-left transition hover:shadow-sm" style={{ borderColor: chosen ? identity.accent : '#e2e8f0', background: chosen ? identity.tint : '#fff' }}>
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-white bg-white p-2"><img src={logo} alt={`Logo ${identity.logo ? identity.code : 'School Connect Olympiad'}`} width="72" height="72" className="max-h-full w-full object-contain" /></span>
              <span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-2"><b className="text-base" style={{ color: identity.accent }}>{item.displayCode || item.code}</b><span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-md border" style={{ borderColor: chosen ? identity.accent : '#cbd5e1', background: chosen ? identity.accent : '#fff', color: '#fff' }}>{chosen && <Check className="h-4 w-4" />}</span></span><span className="mt-1 block text-sm leading-5 text-slate-700">{identity.name}</span><span className="mt-2 block text-xs text-slate-500">{item.time}</span>{item.fee != null && <span className="mt-2 block text-sm font-bold text-sky-700">{item.fee === 0 ? 'Miễn phí' : `${item.fee.toLocaleString('vi-VN')}đ`}</span>}</span>
            </button>;
          })}</div></section>}
          {groups.map(group => {
            const groupFields = effectiveFields.filter(field => field.enabled && field.section === group.key);
            if (step === 2 || (group.key === 'candidate' ? step !== 0 : step !== 1)) return null;
            return groupFields.length ? <section key={group.key} className={sectionClass}><SectionTitle icon={group.icon} title={group.title} description={group.description} /><div className="mt-5 grid gap-4 sm:grid-cols-2">{groupFields.map(field => <label key={field.key} className={`${label} ${field.type === 'textarea' || field.key === 'name' || field.key === 'address' ? 'sm:col-span-2' : ''}`}>{field.label}{field.required ? ' *' : ''}{field.key === 'name' && <span className="mt-1 block text-xs font-normal text-slate-500">Viết tiếng Việt có dấu, đúng giấy tờ để cấp tài khoản thi và in chứng chỉ.</span>}{field.key === 'email' && <span className="mt-1 block text-xs font-normal text-slate-500">Email nhận thông tin giờ thi, đường dẫn thi và chứng chỉ.</span>}{field.key === 'identity' && <span className="mt-1 block text-xs font-normal text-slate-500">Điền đầy đủ CCCD/hộ chiếu để phục vụ hồ sơ và xuất hóa đơn VAT.</span>}{field.key === 'address' && <span className="mt-1 block text-xs font-normal text-slate-500">Địa chỉ theo đơn vị hành chính sau sáp nhập.</span>}{field.type === 'select' ? <select aria-label={`${field.label}${field.required ? ' *' : ''}`} className={input} value={fields[field.key] || ''} onChange={event => patch(field.key, event.target.value)} required={field.required}><option value="">Chọn {field.label.toLocaleLowerCase('vi-VN')}</option>{field.options.filter(option => field.key !== 'grade' || Number(option) >= minGrade && Number(option) <= maxGrade).map(option => <option key={option} value={option}>{field.key === 'grade' ? `Khối ${option}` : option}</option>)}</select> : field.type === 'textarea' ? <textarea className={input} rows={3} value={fields[field.key] || ''} onChange={event => patch(field.key, event.target.value)} required={field.required} maxLength={4000} /> : <input className={input} type={field.type} autoComplete={field.key === 'name' ? 'name' : field.key === 'birthDate' ? 'bday' : field.key === 'email' || field.key === 'submitterEmail' ? 'email' : field.key === 'phone' ? 'tel' : field.key === 'address' ? 'street-address' : 'off'} value={fields[field.key] || ''} onChange={event => patch(field.key, event.target.value)} required={field.required} maxLength={field.key === 'address' ? 1000 : field.key === 'className' ? 100 : field.key.startsWith('custom_') ? 4000 : 255} max={field.key === 'birthDate' ? todayVN() : undefined} />}{field.key === 'submitterEmail' && <button type="button" disabled={!fields.email} onClick={() => patch('submitterEmail', fields.email || '')} className="mt-2 text-xs font-semibold text-sky-700 underline disabled:opacity-40">Dùng email liên hệ</button>}</label>)}</div></section> : null;
          })}
          {step === 1 && (config.paymentEnabled || proofRequired) && <section className={sectionClass}><SectionTitle icon={<FileImage className="h-5 w-5" />} title={config.paymentTitle} description={config.paymentDescription} />{fermatSelected && <div className="mt-5 grid gap-5 rounded-xl border border-sky-100 bg-sky-50/50 p-4 sm:grid-cols-[minmax(0,1fr)_220px]"><div><h3 className="font-bold text-slate-900">Lệ phí & hướng dẫn FIMO/FIEO</h3><p className="mt-2 text-sm leading-6 text-slate-600">Vòng loại Quốc gia: 250.000đ/thí sinh/cuộc thi/lần dự thi. Nếu đăng ký cả FIMO và FIEO, lệ phí vòng loại là 500.000đ.</p><p className="mt-2 text-sm leading-6 text-slate-600">Vòng Chung kết Quốc gia: 450.000đ/cuộc thi, chỉ nộp khi có thông báo đủ điều kiện. Lệ phí vòng quốc tế được thông báo sau.</p><dl className="mt-4 space-y-2 text-sm"><div><dt className="text-xs text-slate-500">Ngân hàng</dt><dd className="font-semibold">VPBank</dd></div><div><dt className="text-xs text-slate-500">Tên tài khoản</dt><dd className="font-semibold">FERMAT TECH JSC</dd></div><div><dt className="text-xs text-slate-500">Số tài khoản</dt><dd className="select-all font-semibold tracking-wide">0111170303</dd></div></dl>{knownTotal && <p className="mt-4 text-base font-extrabold text-sky-900">Tổng lệ phí đăng ký: {total.toLocaleString('vi-VN')}đ</p>}</div><a href="/registration/fermat-payment-qr.jpg" target="_blank" rel="noreferrer" className="block"><img src="/registration/fermat-payment-qr.jpg" alt="Mã QR nộp lệ phí FermatTech tại VPBank, tài khoản 0111170303, FERMAT TECH JSC" width="220" height="376" className="mx-auto h-auto max-w-full rounded-lg" /><span className="mt-2 block text-center text-xs font-semibold text-sky-700">Mở ảnh QR đầy đủ</span></a></div>}
          <label className="mt-5 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={paymentDeclared} onChange={event => setPaymentDeclared(event.target.checked)} className="mt-1 h-4 w-4 accent-[#0055da]" /><span>{config.paymentDeclaration}</span></label><div className="mt-5"><label tabIndex={0} className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-6 text-center transition hover:border-[#0055da]" onPaste={event => acceptProof(Array.from(event.clipboardData.files).find(file => file.type.startsWith('image/')) || null, setProof, setError)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); acceptProof(event.dataTransfer.files[0], setProof, setError); }}><UploadCloud className="h-7 w-7 text-[#0055da]" /><b className="mt-2 text-sm text-[#001e40]">{proof ? proof.name : 'Chọn tệp, kéo thả hoặc dán ảnh bằng Ctrl+V'}</b><span className="mt-1 text-xs text-slate-500">Ảnh hoặc PDF · tối đa 10 MB · {proofRequired ? 'bắt buộc' : 'không bắt buộc'}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,application/pdf" aria-required={proofRequired} className="sr-only" onChange={event => acceptProof(event.target.files?.[0] || null, setProof, setError)} /></label>{proofPreview && <div className="mt-3 rounded-xl border border-slate-200 p-3">{proof?.type.startsWith('image/') && <img src={proofPreview} alt="Xem trước chứng từ đã chọn" className="mx-auto max-h-56 max-w-full object-contain" />}<a href={proofPreview} target="_blank" rel="noreferrer" className="mt-2 block text-center text-xs font-semibold text-sky-700">Xem tệp đã chọn</a></div>}{proof && <button type="button" onClick={() => setProof(null)} className="mt-2 text-xs font-semibold text-rose-700 underline">Bỏ tệp đã chọn</button>}</div></section>}
          {step === 2 && <section className={sectionClass}><h2 className="text-lg font-extrabold text-[#001e40]">{config.confirmationTitle}</h2><p className="mt-2 text-sm text-slate-600">Kiểm tra lại thông tin bên dưới trước khi gửi hồ sơ.</p><div className="mt-5 flex flex-wrap gap-3">{selectedOptions.map(item => { const identity = competitionIdentity(item.code, item.name); return <div key={item.code} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><img src={identity.logo || '/competition-logos/sco.png'} alt="" width="40" height="40" className="h-10 w-10 object-contain" /><strong className="text-sm">{item.displayCode || item.code}</strong></div>; })}</div><dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">{effectiveFields.filter(field => field.enabled && fields[field.key]?.trim()).map(field => <div key={field.key} className="min-w-0 border-b border-slate-100 pb-3"><dt className="text-xs text-slate-500">{field.label}</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-800">{field.type === 'date' ? fields[field.key].split('-').reverse().join('/') : fields[field.key]}</dd></div>)}</dl>{proof && <p className="mt-4 break-all text-sm text-slate-600">Chứng từ đính kèm: <strong>{proof.name}</strong></p>}{knownTotal && <p className="mt-4 rounded-xl bg-sky-50 p-4 text-sm text-sky-900">Tổng lệ phí theo thông báo: <strong>{total.toLocaleString('vi-VN')}đ</strong>. Khoản chuyển tiền sẽ được kế toán đối chiếu.</p>}<label className="mt-5 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-[#0055da]" /><span>{config.consent} *</span></label></section>}
          <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div>{step > 0 && <button type="button" onClick={() => goToStep(step - 1)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700">Quay lại chỉnh sửa</button>}</div><button type="submit" disabled={sending || step === 2 && (!confirmed || Boolean(previewContent))} className="inline-flex items-center justify-center rounded-xl bg-[#0055da] px-7 py-3.5 text-sm font-bold text-white transition hover:bg-[#0042ad] disabled:cursor-not-allowed disabled:opacity-50">{sending ? 'Đang gửi…' : step === 0 ? 'Tiếp tục: Liên hệ' : step === 1 ? 'Kiểm tra thông tin' : config.submitLabel}</button></div>
          {step === 2 && <><p className="whitespace-pre-line text-xs leading-5 text-slate-500">{config.submitNote}</p>{previewContent && <p className="text-xs font-semibold text-amber-700">Bản xem trước · không gửi hồ sơ.</p>}</>}

        </form>}
      </>}
    </main>
  </div>;
}

function SectionTitle({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-[#0055da]">{icon}</span><div><h2 className="text-lg font-extrabold text-[#001e40]">{title}</h2>{description && <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{description}</p>}</div></div>;
}
