import React, { useCallback, useEffect, useState } from 'react';
import examinationBillingService, { type UnmatchedTransfer } from './examinationBillingService';
import PaymentImagesInput from './PaymentImagesInput';

const formatMoney = (value: number) => `${value.toLocaleString('vi-VN')}đ`;

export default function UnmatchedTransfers({ idToken, mode, canCreate = true }: { idToken?: string | null; mode: 'finance' | 'examination'; canCreate?: boolean }) {
  const [rows, setRows] = useState<UnmatchedTransfer[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState<UnmatchedTransfer | null>(null);
  const [candidateCode, setCandidateCode] = useState('');
  const [competitionCode, setCompetitionCode] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const reload = useCallback(async () => {
    try { setRows(await examinationBillingService.listUnmatched({ idToken: idToken || undefined })); setError(''); }
    catch (cause: any) { setError(cause?.message || 'Không thể tải danh sách khoản thu.'); }
  }, [idToken]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await examinationBillingService.createUnmatched({ amount: Number(amount), reference, note, images }, { idToken: idToken || undefined });
      setAmount(''); setReference(''); setNote(''); setImages([]);
      setNotice('Đã báo khoản chuyển khoản chưa xác định cho khảo thí.');
      await reload();
    } catch (cause: any) { setError(cause?.message || 'Không thể lưu khoản thu.'); }
    finally { setBusy(false); }
  };

  const resolve = async (event: React.FormEvent) => {
    event.preventDefault(); if (!resolving) return; setBusy(true);
    try {
      await examinationBillingService.resolveUnmatched(resolving.id, { candidateCode, competitionCode, resolutionNote }, { idToken: idToken || undefined });
      setResolving(null); setCandidateCode(''); setCompetitionCode(''); setResolutionNote('');
      setNotice('Đã gửi kết quả kiểm tra cho kế toán.'); await reload();
    } catch (cause: any) { setError(cause?.message || 'Không thể lưu kết quả kiểm tra.'); }
    finally { setBusy(false); }
  };

  const viewImage = async (id: string, isProof = false) => {
    try { setImageUrl(await (isProof ? examinationBillingService.proofImage(id, { idToken: idToken || undefined }) : examinationBillingService.unmatchedImage(id, { idToken: idToken || undefined }))); }
    catch (cause: any) { setError(cause?.message || 'Không thể tải ảnh.'); }
  };

  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
    <div><h3 className="text-lg font-extrabold text-[#0b4275]">Chuyển khoản chưa xác định</h3><p className="mt-1 text-sm text-slate-500">Kế toán báo khoản thu chưa tìm thấy thí sinh; khảo thí kiểm tra và phản hồi tại đây.</p></div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    {mode === 'finance' && canCreate && <form onSubmit={create} className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 sm:grid-cols-2">
      <label className="text-sm font-bold">Số tiền chuyển khoản *<input className="ft-input mt-1 w-full" type="number" min="1" step="1" required value={amount} onChange={event => setAmount(event.target.value)} /></label>
      <label className="text-sm font-bold">Mã hoặc nội dung giao dịch<input className="ft-input mt-1 w-full" value={reference} onChange={event => setReference(event.target.value)} /></label>
      <label className="text-sm font-bold sm:col-span-2">Ghi chú cho khảo thí<textarea className="ft-input mt-1 w-full" rows={2} value={note} onChange={event => setNote(event.target.value)} /></label>
      <div className="sm:col-span-2">
        <PaymentImagesInput files={images} onChange={setImages} onError={setError} disabled={busy} />
      </div>
      <button disabled={busy} className="ft-btn ft-btn-primary w-fit disabled:opacity-50">{busy ? 'Đang lưu...' : 'Báo khảo thí kiểm tra'}</button>
    </form>}
    <div className="overflow-x-auto"><table className="ft-table min-w-[780px]"><thead><tr><th>Số tiền</th><th>Giao dịch / ghi chú</th><th>Trạng thái</th><th>Phản hồi khảo thí</th><th>Ảnh / thao tác</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}><td className="font-bold">{formatMoney(row.amount)}</td><td><b>{row.reference || 'Chưa có mã giao dịch'}</b><p className="mt-1 text-xs text-slate-500">{row.note || '—'}</p><p className="text-xs text-slate-400">{new Date(row.createdAt).toLocaleString('vi-VN')}</p></td><td>{row.status === 'open' ? 'Chờ khảo thí' : row.status === 'matched' ? 'Đã tìm thấy thí sinh' : 'Đã kiểm tra'}</td><td><p>{row.resolutionNote || '—'}</p>{row.candidateCode && <p className="text-xs font-semibold text-emerald-700">{row.candidateCode} · {row.competitionCode}</p>}</td><td><div className="flex flex-wrap gap-2">{row.proofs?.length ? row.proofs.map((proof, index) => <button key={proof.id} type="button" className="ws-bulk-btn" onClick={() => void viewImage(proof.id, true)}>Ảnh {index + 1}</button>) : row.hasImage && <button type="button" className="ws-bulk-btn" onClick={() => void viewImage(row.id)}>Xem ảnh</button>}{mode === 'examination' && <button type="button" className="ws-bulk-btn text-sky-700" onClick={() => { setResolving(row); setCandidateCode(row.candidateCode); setCompetitionCode(row.competitionCode); setResolutionNote(row.resolutionNote); }}>Phản hồi</button>}</div></td></tr>)}
      {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-sm text-slate-500">Chưa có khoản thu chưa xác định.</td></tr>}
    </tbody></table></div>
    {resolving && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><form onSubmit={resolve} className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-6 shadow-xl"><h4 className="text-lg font-bold">Phản hồi khoản {formatMoney(resolving.amount)}</h4><p className="text-sm text-slate-500">Nếu tìm thấy thí sinh, nhập cả mã thí sinh và mã cuộc thi. Nếu chưa tìm thấy, để trống hai ô và ghi rõ kết quả kiểm tra.</p><label className="block text-sm font-bold">Mã thí sinh<input className="ft-input mt-1 w-full" value={candidateCode} onChange={e => setCandidateCode(e.target.value)} /></label><label className="block text-sm font-bold">Mã cuộc thi<input className="ft-input mt-1 w-full" value={competitionCode} onChange={e => setCompetitionCode(e.target.value)} /></label><label className="block text-sm font-bold">Kết quả kiểm tra *<textarea required className="ft-input mt-1 w-full" rows={3} value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} /></label><div className="flex justify-end gap-2"><button type="button" className="ft-btn ft-btn-secondary" onClick={() => setResolving(null)}>Hủy</button><button disabled={busy} className="ft-btn ft-btn-primary">Gửi kế toán</button></div></form></div>}
    {imageUrl && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" onClick={() => setImageUrl('')}><button className="absolute right-5 top-5 rounded-lg bg-white px-3 py-2 text-sm font-bold">Đóng</button><img src={imageUrl} alt="Ảnh chuyển khoản" className="max-h-[85vh] max-w-[95vw] object-contain" /></div>}
  </section>;
}
