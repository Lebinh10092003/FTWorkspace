import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, ClipboardCheck, FileImage, GraduationCap, Loader2, ShieldCheck, UploadCloud } from 'lucide-react';

type CompetitionOption = { code: string; displayCode?: string; name: string; sessionId: string; time: string };
type Receipt = { registrationId: string; candidateCode: string; contestCodes: string[]; createdAt: string };

const input = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0055da] focus:ring-4 focus:ring-blue-100';
const label = 'block text-sm font-semibold text-slate-700';
const initial = { name: '', birthDate: '', identity: '', email: '', phone: '', school: '', grade: '', city: '', ward: '', address: '' };
type FormFields = typeof initial;

function acceptProof(file: File | null, setProof: (file: File | null) => void, setError: (message: string) => void) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)) {
    setError('Chỉ nhận ảnh PNG, JPEG, WebP hoặc PDF.'); return;
  }
  if (file.size > 5 * 1024 * 1024) { setError('Chứng từ tối đa 5 MB.'); return; }
  setProof(file); setError('');
}

export default function PublicExamRegistration() {
  const [competitions, setCompetitions] = useState<CompetitionOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [fields, setFields] = useState<FormFields>(initial);
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
    let active = true;
    fetch('/api/public/examination/registration').then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Không thể tải danh sách cuộc thi.');
      if (!active) return;
      const rows = (result.competitions || []) as CompetitionOption[];
      setCompetitions(rows);
      if (suggestedCode && rows.some(row => row.code === suggestedCode)) setSelected([suggestedCode]);
    }).catch(cause => { if (active) setError(cause?.message || 'Không thể tải biểu mẫu.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [suggestedCode]);

  const patch = (key: keyof FormFields, value: string) => setFields(current => ({ ...current, [key]: value }));
  const toggle = (code: string) => setSelected(current => current.includes(code) ? current.filter(item => item !== code) : [...current, code]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected.length) { setError('Vui lòng chọn ít nhất một cuộc thi.'); document.getElementById('chon-cuoc-thi')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (!confirmed) { setError('Vui lòng xác nhận thông tin trước khi gửi.'); return; }
    const body = new FormData();
    body.append('requestKey', requestKey);
    body.append('contestCodes', JSON.stringify(selected));
    body.append('website', (event.currentTarget.elements.namedItem('website') as HTMLInputElement | null)?.value || '');
    Object.entries(fields).forEach(([key, value]) => body.append(key, value.trim()));
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

  return <div className="min-h-dvh bg-[#f3f7fc] text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4 sm:px-8"><img src="/logo.png" alt="Fermat Tech" className="h-10 w-10 rounded-lg object-contain" /><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#0055da]">Fermat Tech</p><p className="font-extrabold text-[#001e40]">Đăng ký dự thi</p></div></div></header>
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      {receipt ? <div className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-white p-7 text-center shadow-sm sm:p-10">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" /><h1 className="mt-5 text-3xl font-extrabold text-[#001e40]">Đã tiếp nhận đăng ký</h1>
        <p className="mt-3 text-slate-600">Khảo thí đã nhận thông tin. Kế toán sẽ kiểm tra khoản chuyển tiền trước khi xác nhận hoàn tất.</p>
        <div className="mt-7 rounded-2xl bg-slate-50 p-5 text-left text-sm"><p>Mã thí sinh: <b>{receipt.candidateCode}</b></p><p className="mt-2">Cuộc thi: <b>{receipt.contestCodes.join(', ')}</b></p><p className="mt-2 break-all">Mã đăng ký: <b>{receipt.registrationId}</b></p></div>
        <p className="mt-6 text-sm text-slate-500">Vui lòng lưu mã đăng ký để trao đổi với ban tổ chức khi cần.</p>
      </div> : <>
        <div className="mb-8 max-w-3xl"><span className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-[#0055da]"><GraduationCap className="h-4 w-4" /> Năm học 2026–2027</span><h1 className="mt-4 text-3xl font-black tracking-tight text-[#001e40] sm:text-4xl">Đăng ký tham dự cuộc thi</h1><p className="mt-3 text-base leading-7 text-slate-600">Điền thông tin một lần và chọn các cuộc thi muốn tham gia. Những mục có dấu * là bắt buộc.</p></div>
        {error && <div role="alert" className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}
        {loading ? <div className="flex items-center gap-3 rounded-2xl bg-white p-8 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Đang tải cuộc thi...</div> : !competitions.length ? <div className="rounded-2xl bg-white p-8 text-slate-600">Hiện chưa có cuộc thi nhận đăng ký. Vui lòng quay lại sau.</div> : <form onSubmit={submit} className="space-y-6">
          <section id="chon-cuoc-thi" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><SectionTitle number="01" icon={<GraduationCap className="h-5 w-5" />} title="Chọn cuộc thi" description="Có thể chọn nhiều cuộc thi cho cùng một thí sinh." /><div className="mt-5 grid gap-3 sm:grid-cols-2">{competitions.map(item => <button key={item.code} type="button" aria-pressed={selected.includes(item.code)} onClick={() => toggle(item.code)} className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${selected.includes(item.code) ? 'border-[#0055da] bg-blue-50 shadow-sm' : 'border-slate-200 hover:border-blue-300'}`}><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${selected.includes(item.code) ? 'border-[#0055da] bg-[#0055da] text-white' : 'border-slate-300'}`}>{selected.includes(item.code) && <Check className="h-4 w-4" />}</span><span><b className="block text-[#001e40]">{item.displayCode || item.code}</b><span className="mt-1 block text-sm text-slate-600">{item.name}</span></span></button>)}</div></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><SectionTitle number="02" icon={<ClipboardCheck className="h-5 w-5" />} title="Thông tin thí sinh" description="Vui lòng nhập đúng theo giấy tờ và thông tin nhà trường." /><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className={`${label} sm:col-span-2`}>Họ và tên thí sinh *<input className={input} value={fields.name} onChange={e => patch('name', e.target.value)} required maxLength={255} autoComplete="name" placeholder="Nguyễn Văn An" /></label><label className={label}>Ngày sinh *<input className={input} type="date" value={fields.birthDate} onChange={e => patch('birthDate', e.target.value)} required max={new Date().toISOString().slice(0, 10)} /></label><label className={label}>CCCD/Hộ chiếu (nếu có)<input className={input} value={fields.identity} onChange={e => patch('identity', e.target.value)} maxLength={100} placeholder="Số giấy tờ của thí sinh" /></label><label className={label}>Trường *<input className={input} value={fields.school} onChange={e => patch('school', e.target.value)} required maxLength={255} placeholder="Tên trường đang theo học" /></label><label className={label}>Khối lớp *<select className={input} value={fields.grade} onChange={e => patch('grade', e.target.value)} required><option value="">Chọn khối lớp</option>{Array.from({ length: 12 }, (_, index) => String(index + 1)).map(grade => <option key={grade} value={grade}>Khối {grade}</option>)}</select></label></div></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><SectionTitle number="03" icon={<ShieldCheck className="h-5 w-5" />} title="Liên hệ và địa chỉ" description="Ban tổ chức dùng thông tin này để liên hệ về hồ sơ dự thi." /><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className={label}>Email liên hệ *<input className={input} type="email" value={fields.email} onChange={e => patch('email', e.target.value)} required maxLength={255} autoComplete="email" placeholder="email@example.com" /></label><label className={label}>Số điện thoại PHHS/thí sinh *<input className={input} type="tel" inputMode="tel" value={fields.phone} onChange={e => patch('phone', e.target.value)} required maxLength={32} autoComplete="tel" placeholder="09..." /></label><label className={label}>Tỉnh/thành phố *<input className={input} value={fields.city} onChange={e => patch('city', e.target.value)} required maxLength={100} /></label><label className={label}>Xã/phường *<input className={input} value={fields.ward} onChange={e => patch('ward', e.target.value)} required maxLength={255} /></label><label className={`${label} sm:col-span-2`}>Địa chỉ hiện tại *<input className={input} value={fields.address} onChange={e => patch('address', e.target.value)} required maxLength={1000} autoComplete="street-address" /></label></div></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><SectionTitle number="04" icon={<FileImage className="h-5 w-5" />} title="Thanh toán và chứng từ" description="Kế toán sẽ đối chiếu tiền thực nhận. Bạn có thể bổ sung ảnh xác nhận chuyển khoản tại đây." /><label className="mt-5 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={paymentDeclared} onChange={e => setPaymentDeclared(e.target.checked)} className="mt-1 h-4 w-4 accent-[#0055da]" /><span>Tôi đã chuyển khoản lệ phí dự thi theo hướng dẫn của ban tổ chức.</span></label><div className="mt-5"><label tabIndex={0} className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-6 text-center transition hover:border-[#0055da]" onPaste={event => acceptProof(Array.from(event.clipboardData.files).find(file => file.type.startsWith('image/')) || null, setProof, setError)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); acceptProof(event.dataTransfer.files[0], setProof, setError); }}><UploadCloud className="h-7 w-7 text-[#0055da]" /><b className="mt-2 text-sm text-[#001e40]">{proof ? proof.name : 'Chọn tệp, kéo thả hoặc dán ảnh bằng Ctrl+V'}</b><span className="mt-1 text-xs text-slate-500">PNG, JPEG, WebP hoặc PDF · tối đa 5 MB · không bắt buộc</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" onChange={event => acceptProof(event.target.files?.[0] || null, setProof, setError)} /></label>{proof && <button type="button" onClick={() => setProof(null)} className="mt-2 text-xs font-semibold text-rose-700 underline">Bỏ tệp đã chọn</button>}</div></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><h2 className="text-lg font-extrabold text-[#001e40]">Xác nhận và gửi</h2><p className="mt-2 text-sm text-slate-600">Cuộc thi đã chọn: <b>{selected.join(', ') || 'Chưa chọn'}</b>. Sau khi gửi, bạn sẽ nhận mã đăng ký để lưu lại.</p><label className="mt-5 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-[#0055da]" /><span>Tôi xác nhận thông tin đã nhập là chính xác và đồng ý để ban tổ chức dùng thông tin này xử lý đăng ký dự thi. *</span></label><input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" /><button type="submit" disabled={sending || !confirmed} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0055da] px-7 py-3.5 font-bold text-white transition hover:bg-[#0042ad] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{sending ? <><Loader2 className="h-5 w-5 animate-spin" /> Đang gửi...</> : <>Gửi đăng ký <ArrowRight className="h-5 w-5" /></>}</button><p className="mt-3 text-xs text-slate-500">Việc gửi form chưa có nghĩa là đã xác nhận thanh toán. Kế toán sẽ kiểm tra riêng.</p></section>
        </form>}
      </>}
    </main>
  </div>;
}

function SectionTitle({ number, icon, title, description }: { number: string; icon: React.ReactNode; title: string; description: string }) {
  return <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-[#0055da]">{icon}</span><div><p className="text-[11px] font-extrabold uppercase tracking-widest text-[#0055da]">Bước {number}</p><h2 className="mt-0.5 text-lg font-extrabold text-[#001e40]">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div></div>;
}
