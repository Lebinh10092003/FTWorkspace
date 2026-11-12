import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { RegistrationReceipt } from './registrationReceipt';
import { competitionIdentity } from './competitionIdentity';
import RegistrationProgress from './RegistrationProgress';
import RegistrationCrossSell from './RegistrationCrossSell';

const panel = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
const money = (amount: number) => `${amount.toLocaleString('vi-VN')}đ`;

export default function RegistrationPaymentView({ receipt, onUpdate }: { receipt: RegistrationReceipt; onUpdate: (value: RegistrationReceipt) => void }) {
  const [qr, setQr] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const payment = receipt.payment;
  const presentation = receipt.presentation;
  useEffect(() => {
    const previous = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    const policy = previous || document.createElement('meta');
    const oldContent = previous?.content;
    policy.name = 'referrer'; policy.content = 'no-referrer';
    if (!previous) document.head.appendChild(policy);
    return () => { if (previous) previous.content = oldContent || ''; else policy.remove(); };
  }, []);
  useEffect(() => {
    let active = true;
    if (!payment.qrPayload) { setQr(''); return; }
    QRCode.toDataURL(payment.qrPayload, { width: 360, margin: 3, errorCorrectionLevel: 'M' })
      .then(value => { if (active) setQr(value); }).catch(() => { if (active) setError('Chưa tạo được QR. Có thể dùng thông tin chuyển khoản bên dưới.'); });
    return () => { active = false; };
  }, [payment.qrPayload]);
  useEffect(() => {
    if (!proof) { setPreview(''); return; }
    const url = URL.createObjectURL(proof); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [proof]);
  const chooseProof = (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'application/pdf'].includes(file.type)) { setError('Chọn ảnh PNG, JPEG, WebP, GIF, BMP hoặc PDF.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('Chứng từ tối đa 10 MB.'); return; }
    setProof(file); setError('');
  };
  const copy = async (value: string, note: string) => {
    try { await navigator.clipboard.writeText(value); setMessage(note); }
    catch { setMessage('Có thể nhấn giữ để sao chép thông tin đang hiển thị.'); }
  };
  const submitProof = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    if (!proof || !declared) { setError('Chọn chứng từ và xác nhận đã chuyển khoản.'); return; }
    const body = new FormData(); body.append('proof', proof); body.append('paymentDeclared', 'true');
    setSending(true); setError('');
    try {
      const response = await fetch(`/api/public/examination/registrations/${receipt.registrationId}/payment`, { method: 'POST', headers: { 'X-Registration-Token': receipt.paymentToken }, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chưa gửi được chứng từ.');
      onUpdate(data); setProof(null); setUploadOpen(false); setDeclared(false);
      setMessage('Đã nhận chứng từ. Kế toán sẽ kiểm tra tiền thực nhận.'); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không kết nối được. Hồ sơ đã lưu, bạn có thể gửi lại ảnh sau.'); }
    finally { setSending(false); }
  };

  return <div className="min-h-dvh bg-[#f3f7fc] text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-8"><a href="/cuoc-thi"><img src="/logo.png" alt="FermatTech" className="h-10 w-auto max-w-28 object-contain" /></a><p className="font-bold">Đăng ký dự thi</p></div></header>
    <main className="mx-auto max-w-5xl px-4 py-6 pb-16 sm:px-8 sm:py-10">
      <RegistrationProgress step={2} />
      <section className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">{presentation?.successTitle || 'Hồ sơ đã được lưu'}</p><h1 className="mt-2 text-2xl font-extrabold text-slate-900 sm:text-3xl">{receipt.candidateName}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Mã thí sinh: <strong className="select-all">{receipt.candidateCode}</strong>. {payment.paymentStatus === 'confirmed' ? 'Lệ phí đã được kế toán xác nhận. Bạn có thể lưu liên kết để xem lại hồ sơ.' : 'Bạn có thể thanh toán và gửi ảnh ngay, hoặc quay lại bằng liên kết của hồ sơ này.'}</p>
        {presentation?.successMessage && payment.paymentStatus !== 'confirmed' && <p className="mt-2 text-sm leading-6 text-slate-600">{presentation.successMessage}</p>}
        <button type="button" onClick={() => void copy(`${window.location.origin}${receipt.paymentUrl}`, 'Đã sao chép liên kết quay lại thanh toán.')} className="mt-3 min-h-12 rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-800">Lưu liên kết thanh toán</button>
      </section>
      {message && <p role="status" className="mb-4 rounded-xl bg-sky-50 p-4 text-sm text-sky-900">{message}</p>}
      {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
      {(payment.proofReceived || payment.paymentStatus === 'confirmed') && <section className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 p-5"><h2 className="font-bold text-sky-900">{payment.paymentStatus === 'confirmed' ? 'Kế toán đã xác nhận thanh toán' : 'Đã nhận chứng từ · Chờ kế toán đối chiếu'}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{payment.paymentStatus === 'confirmed' ? 'Khoản thu đã được đối chiếu trên hệ thống.' : 'Hồ sơ và ảnh đã được lưu. Việc gửi ảnh không tự xác nhận tiền đã vào tài khoản.'}</p></section>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className={panel}><h2 className="text-lg font-extrabold">Thông tin lệ phí</h2><div className="mt-4 space-y-3">{payment.items.map(item => { const identity = competitionIdentity(item.code); return <div key={item.code} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 p-3"><img src={identity.logo || '/competition-logos/sco.png'} alt={`Logo ${identity.code}`} width="48" height="48" className="h-12 w-12 shrink-0 object-contain" /><div className="min-w-0 flex-1"><strong className="text-sm">{identity.code}</strong><p className="mt-1 text-xs leading-5 text-slate-500">{identity.name}</p></div><span className="shrink-0 text-sm font-bold">{item.fee == null ? 'Chờ thông báo' : money(item.fee)}</span></div>; })}</div>
          <div className="mt-5 border-t border-slate-200 pt-4"><p className="text-sm text-slate-500">Tổng lệ phí đăng ký</p><p className="mt-1 text-3xl font-extrabold text-[#0055da]">{payment.total == null ? 'Chờ xác nhận lệ phí' : money(payment.total)}</p></div>
          <p className="mt-4 text-sm leading-6 text-slate-500">Lệ phí được lưu cùng hồ sơ. Các khoản của vòng sau chỉ nộp khi có thông báo đủ điều kiện từ Ban tổ chức.</p>
          <p className="mt-3 break-all text-xs text-slate-400">Mã hồ sơ: {receipt.registrationId}</p>
        </section>
        {presentation?.paymentEnabled !== false && <section className={`${panel} text-center`}><h2 className="text-lg font-extrabold">{presentation?.paymentTitle || 'Thanh toán lệ phí'}</h2>
          {presentation?.paymentDescription && <p className="mt-2 text-sm leading-6 text-slate-500">{presentation.paymentDescription}</p>}
          {qr && payment.bank ? <><img src={qr} alt={`QR thanh toán ${money(payment.total!)} cho hồ sơ ${receipt.candidateCode}`} width="300" height="300" className="mx-auto mt-4 h-auto w-full max-w-[300px] rounded-xl border border-slate-100" /><p className="mt-3 text-sm leading-6 text-slate-500">QR đã có số tiền và nội dung. Dùng ứng dụng ngân hàng để quét, hoặc lưu QR vào điện thoại.</p><a href={qr} download={`thanh-toan-${receipt.candidateCode}.png`} className="mt-3 inline-flex min-h-12 items-center rounded-xl border border-sky-200 bg-sky-50 px-5 py-2 text-sm font-bold text-sky-800">Tải mã QR</a></> : <p className="mt-5 text-sm leading-6 text-slate-600">Hồ sơ đã được lưu. Ban tổ chức sẽ hướng dẫn thanh toán khi xác nhận đủ lệ phí và thông tin tài khoản.</p>}
          {payment.bank && payment.total != null && <dl className="mt-5 space-y-3 text-left text-sm"><div><dt className="text-xs text-slate-500">Ngân hàng & chủ tài khoản</dt><dd className="mt-1 font-semibold">{payment.bank.name} · {payment.bank.accountName}</dd></div><div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3"><div><dt className="text-xs text-slate-500">Số tài khoản</dt><dd className="mt-1 select-all font-bold tracking-wide">{payment.bank.account}</dd></div><button type="button" onClick={() => void copy(payment.bank!.account, 'Đã sao chép số tài khoản.')} className="min-h-12 px-2 text-xs font-bold text-sky-700">Sao chép</button></div><div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3"><div><dt className="text-xs text-slate-500">Nội dung chuyển khoản</dt><dd className="mt-1 select-all font-bold">{payment.memo}</dd></div><button type="button" onClick={() => void copy(payment.memo, 'Đã sao chép nội dung chuyển khoản.')} className="min-h-12 px-2 text-xs font-bold text-sky-700">Sao chép</button></div></dl>}
          {!uploadOpen && <button type="button" onClick={() => setUploadOpen(true)} className="mt-6 min-h-12 w-full rounded-xl bg-[#0055da] px-4 py-3 text-base font-bold text-white">{payment.proofReceived || payment.paymentStatus === 'confirmed' ? 'Gửi bổ sung chứng từ' : 'Đã chuyển khoản · Gửi chứng từ'}</button>}
        </section>}
      </div>
      {uploadOpen && <form onSubmit={submitProof} className={`${panel} mt-5`}><h2 className="text-lg font-extrabold">Gửi ảnh xác nhận chuyển khoản</h2><p className="mt-2 text-sm leading-6 text-slate-500">Hồ sơ đã lưu trước đó. Nếu chưa có ảnh, bạn có thể quay lại gửi sau bằng liên kết này.</p>
        <label tabIndex={0} className="mt-5 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-sky-200 bg-sky-50 p-5 text-center" onPaste={event => chooseProof(Array.from(event.clipboardData.files).find(file => file.type.startsWith('image/')))} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseProof(event.dataTransfer.files[0]); }}><strong className="text-sm text-sky-900">{proof ? proof.name : 'Chọn ảnh chuyển khoản hoặc PDF'}</strong><span className="mt-2 text-xs text-slate-500">Tối đa 10 MB · có thể kéo thả hoặc dán ảnh</span><input aria-label="Ảnh xác nhận chuyển khoản" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,application/pdf" onChange={event => chooseProof(event.target.files?.[0])} className="sr-only" /></label>
        {preview && <div className="mt-4 rounded-xl border p-3">{proof?.type.startsWith('image/') && <img src={preview} alt="Xem trước chứng từ" className="mx-auto max-h-64 max-w-full object-contain" />}<a href={preview} target="_blank" rel="noreferrer" className="mt-2 block text-center text-sm font-semibold text-sky-700">Xem tệp đầy đủ</a></div>}
        <label className="mt-5 flex min-h-12 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={declared} onChange={event => setDeclared(event.target.checked)} className="mt-1.5 h-5 w-5 shrink-0 accent-[#0055da]" /><span>{presentation?.paymentDeclaration || 'Tôi đã chuyển khoản và gửi chứng từ để kế toán đối chiếu.'}</span></label>
        <div className="mt-5 flex flex-wrap gap-3"><button type="submit" disabled={!proof || !declared || sending} className="min-h-12 flex-1 rounded-xl bg-[#0055da] px-5 py-3 text-base font-bold text-white disabled:opacity-50">{sending ? 'Đang gửi…' : 'Gửi chứng từ'}</button><button type="button" onClick={() => setUploadOpen(false)} className="min-h-12 rounded-xl border px-5 py-3 text-sm font-semibold">Gửi sau</button></div>
      </form>}
      <RegistrationCrossSell registered={receipt.contestCodes} candidateName={receipt.candidateName} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500"><p>Hỗ trợ: <a href="tel:0969627162" className="font-semibold text-sky-700">0969 627 162</a> · <a href="mailto:khaothi@fermat.vn">khaothi@fermat.vn</a></p><button type="button" onClick={() => window.print()} className="min-h-12 px-3 font-semibold text-sky-700 print:hidden">In / lưu phiếu đăng ký</button></div>
    </main>
  </div>;
}
