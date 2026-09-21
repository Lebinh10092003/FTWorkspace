import React, { useMemo, useState } from 'react';
import { Download, Loader2, Plus, RotateCcw, Trash2, TriangleAlert, ZoomIn, ZoomOut } from 'lucide-react';
import ModuleShellHeader from '../layout/ModuleShellHeader';
import AccountMenu from '../AccountMenu';
import { COMMUNICATION_TOOLS_NAV } from '../../config/workspaceNavigation';
import FundingProposalPreview from './FundingProposalPreview';
import {
  ATTACHMENT_OPTIONS, DECISION_OPTIONS, FundingProposal, ProposalItem,
  blankProposal, lineAmount, money, newItem, toPayload, totalsOf,
} from './fundingProposal';

type Props = {
  idToken: string;
  userName: string;
  userRole?: string;
  photoURL?: string | null;
  onAccountClick: () => void;
  onLogout: () => void;
  onNavSelect: (id: string) => void;
};

const FIELD = 'ft-input';
const LABEL = 'mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500';

export default function FundingProposalBuilder({
  idToken, userName, userRole, photoURL, onAccountClick, onLogout, onNavSelect,
}: Props) {
  const [value, setValue] = useState<FundingProposal>(blankProposal);
  const [zoom, setZoom] = useState(0.72);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const totals = useMemo(() => totalsOf(value), [value]);
  const set = <K extends keyof FundingProposal>(key: K, next: FundingProposal[K]) =>
    setValue(current => ({ ...current, [key]: next }));

  const setItem = (id: string, patch: Partial<ProposalItem>) =>
    setValue(current => ({
      ...current,
      items: current.items.map(item => (item.id === id ? { ...item, ...patch } : item)),
    }));

  const toggleAttachment = (option: string, checked: boolean) =>
    setValue(current => ({
      ...current,
      attachments: checked
        ? [...current.attachments, option]
        : current.attachments.filter(item => item !== option),
    }));

  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      const response = await fetch('/api/documents/funding-proposal.docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(toPayload(value)),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Không tạo được file Word.');
      }
      const blob = await response.blob();
      const name = filenameFrom(response.headers.get('Content-Disposition'))
        || `Phieu-de-xuat-kinh-phi-${value.issuedOn}.docx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause: any) {
      setError(cause.message || 'Không tạo được file Word.');
    } finally {
      setDownloading(false);
    }
  };

  const adjusting = value.kind === 'adjustment';

  return (
    <div className="ft-module-shell flex min-h-dvh flex-col font-sans text-slate-900">
      <ModuleShellHeader
        eyebrow="Bộ công cụ FermatTech"
        title="Phiếu đề xuất kinh phí"
        items={COMMUNICATION_TOOLS_NAV}
        activeId="funding-proposal"
        onSelect={onNavSelect}
        ariaLabel="Điều hướng bộ công cụ FermatTech"
        actions={(
          <>
            <button type="button" onClick={() => setValue(blankProposal())}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <RotateCcw className="h-4 w-4" /><span className="hidden sm:inline">Làm lại</span>
            </button>
            <button type="button" onClick={() => void download()} disabled={downloading}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {downloading ? 'Đang tạo…' : 'Tải file Word'}
            </button>
          </>
        )}
        account={<AccountMenu userName={userName} userRole={userRole} photoURL={photoURL} isGuest={false} onAccountClick={onAccountClick} onLogout={onLogout} variant="avatar" />}
      />

      <main className="min-w-0 flex-1">
        <div className="ft-module-content mx-auto p-5 md:p-7">
          {error && (
            <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /><span>{error}</span>
            </div>
          )}

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* ---------- Form ---------- */}
            <div className="min-w-0 space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-blue-700">1. Thông tin đề xuất</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block"><span className={LABEL}>Số phiếu</span>
                    <input value={value.documentNumber} onChange={e => set('documentNumber', e.target.value)} placeholder="46/PĐXKP-FT" className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Ngày lập</span>
                    <input type="date" value={value.issuedOn} onChange={e => set('issuedOn', e.target.value)} className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Loại đề xuất</span>
                    <select value={value.kind} onChange={e => set('kind', e.target.value as FundingProposal['kind'])} className={FIELD}>
                      <option value="new">Mới</option>
                      <option value="adjustment">Điều chỉnh, bổ sung</option>
                    </select>
                  </label>
                  <label className="block"><span className={LABEL}>Lần trình</span>
                    <input value={value.submissionRound} onChange={e => set('submissionRound', e.target.value)} placeholder="1" className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Người đề xuất</span>
                    <input value={value.proposer} onChange={e => set('proposer', e.target.value)} className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Bộ phận</span>
                    <input value={value.department} onChange={e => set('department', e.target.value)} className={FIELD} />
                  </label>
                  <label className="block sm:col-span-2"><span className={LABEL}>Công việc / dự án</span>
                    <input value={value.project} onChange={e => set('project', e.target.value)} className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Trưởng bộ phận</span>
                    <input value={value.departmentHead} onChange={e => set('departmentHead', e.target.value)} className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Hạn cần duyệt</span>
                    <input type="date" value={value.approvalDeadline} onChange={e => set('approvalDeadline', e.target.value)} className={FIELD} />
                  </label>
                  <label className="block sm:col-span-2"><span className={LABEL}>Mục đích, kết quả cần đạt</span>
                    <textarea rows={2} value={value.purpose} onChange={e => set('purpose', e.target.value)} className={FIELD} />
                  </label>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-extrabold uppercase tracking-wide text-blue-700">2. Dự toán</h2>
                  <button type="button" onClick={() => setValue(c => ({ ...c, items: [...c.items, newItem()] }))}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <Plus className="h-3.5 w-3.5" />Thêm hạng mục
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {value.items.map((item, index) => (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-500">Hạng mục {index + 1}</span>
                        <div className="flex items-center gap-2">
                          <b className="text-xs font-extrabold text-slate-700">{money(lineAmount(item)) || '—'} đ</b>
                          {value.items.length > 1 && (
                            <button type="button" aria-label={`Xóa hạng mục ${index + 1}`}
                              onClick={() => setValue(c => ({ ...c, items: c.items.filter(row => row.id !== item.id) }))}
                              className="rounded-md p-1 text-rose-500 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button>
                          )}
                        </div>
                      </div>
                      <input value={item.description} onChange={e => setItem(item.id, { description: e.target.value })}
                        placeholder="Nội dung, quy cách" className={`${FIELD} mt-2`} />
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <input value={item.unit} onChange={e => setItem(item.id, { unit: e.target.value })} placeholder="ĐVT" className={FIELD} />
                        <input value={item.quantity} onChange={e => setItem(item.id, { quantity: e.target.value })} placeholder="Số lượng" inputMode="decimal" className={FIELD} />
                        <input value={item.unitPrice} onChange={e => setItem(item.id, { unitPrice: e.target.value })} placeholder="Đơn giá" inputMode="decimal" className={FIELD} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block"><span className={LABEL}>Thuế GTGT (%)</span>
                    <input value={value.vatRate} onChange={e => set('vatRate', e.target.value)} placeholder="10" inputMode="decimal" className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Chi phí khác</span>
                    <input value={value.otherCost} onChange={e => set('otherCost', e.target.value)} inputMode="decimal" className={FIELD} />
                  </label>
                </div>

                <dl className="mt-4 space-y-1 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm">
                  {[['Cộng', totals.subtotal], ['Thuế GTGT', totals.vat], ['Chi phí khác', totals.other]].map(([text, amount]) => (
                    <div key={text as string} className="flex justify-between"><dt className="text-slate-600">{text}</dt><dd className="font-semibold tabular-nums">{money(amount as number) || '0'} đ</dd></div>
                  ))}
                  <div className="flex justify-between border-t border-blue-200 pt-1.5"><dt className="font-extrabold text-blue-900">Tổng cộng</dt><dd className="font-extrabold tabular-nums text-blue-900">{money(totals.total) || '0'} đ</dd></div>
                </dl>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block sm:col-span-2"><span className={LABEL}>Thông tin nhà cung cấp</span>
                    <input value={value.supplier} onChange={e => set('supplier', e.target.value)} className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Hình thức thanh toán</span>
                    <select value={value.paymentMethod} onChange={e => set('paymentMethod', e.target.value as FundingProposal['paymentMethod'])} className={FIELD}>
                      <option value="transfer">Chuyển khoản</option>
                      <option value="cash">Tiền mặt</option>
                    </select>
                  </label>
                  <label className="block"><span className={LABEL}>Tạm ứng (nếu có)</span>
                    <input value={value.advanceAmount} onChange={e => set('advanceAmount', e.target.value)} inputMode="decimal" className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Tại phiếu số</span>
                    <input value={value.advanceDocument} onChange={e => set('advanceDocument', e.target.value)} className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Ngày phiếu tạm ứng</span>
                    <input type="date" value={value.advanceDate} onChange={e => set('advanceDate', e.target.value)} className={FIELD} />
                  </label>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-blue-700">3. Đối chiếu và hồ sơ</h2>
                {!adjusting && (
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Đề xuất mới thì phần đối chiếu ghi “Không áp dụng” — để trống là được.
                  </p>
                )}
                <div className="mt-4 grid gap-4">
                  <label className="block"><span className={LABEL}>Căn cứ lần duyệt trước</span>
                    <input value={value.previousApproval} onChange={e => set('previousApproval', e.target.value)} className={FIELD} />
                  </label>
                  {([['quantity', 'Số lượng / đơn giá'], ['total', 'Tổng kinh phí']] as const).map(([key, title]) => (
                    <fieldset key={key} className="rounded-xl border border-slate-200 p-3">
                      <legend className="px-1 text-xs font-bold text-slate-600">{title}</legend>
                      <div className="grid grid-cols-3 gap-2">
                        {([['previous', 'Đã duyệt'], ['current', 'Lần này'], ['delta', 'Tăng/giảm']] as const).map(([field, placeholder]) => (
                          <input key={field} placeholder={placeholder} value={value.comparison[key][field]}
                            onChange={e => setValue(c => ({ ...c, comparison: { ...c.comparison, [key]: { ...c.comparison[key], [field]: e.target.value } } }))}
                            className={FIELD} />
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <label className="block"><span className={LABEL}>Lý do thay đổi; tác động</span>
                    <textarea rows={2} value={value.changeReason} onChange={e => set('changeReason', e.target.value)} className={FIELD} />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block"><span className={LABEL}>Tổng sau điều chỉnh</span>
                      <input value={value.adjustedTotal} onChange={e => set('adjustedTotal', e.target.value)} inputMode="decimal" className={FIELD} /></label>
                    <label className="block"><span className={LABEL}>Đã chi / cam kết</span>
                      <input value={value.committedAmount} onChange={e => set('committedAmount', e.target.value)} inputMode="decimal" className={FIELD} /></label>
                    <label className="block"><span className={LABEL}>Còn phải bố trí</span>
                      <input value={value.remainingAmount} onChange={e => set('remainingAmount', e.target.value)} inputMode="decimal" className={FIELD} /></label>
                    <label className="block"><span className={LABEL}>Phần xin tăng</span>
                      <input value={value.increaseAmount} onChange={e => set('increaseAmount', e.target.value)} inputMode="decimal" className={FIELD} /></label>
                  </div>

                  <fieldset className="rounded-xl border border-slate-200 p-3">
                    <legend className="px-1 text-xs font-bold text-slate-600">Hồ sơ kèm theo</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {ATTACHMENT_OPTIONS.map(option => (
                        <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={value.attachments.includes(option.value)}
                            onChange={e => toggleAttachment(option.value, e.target.checked)} className="h-4 w-4" />
                          {option.label}
                        </label>
                      ))}
                    </div>
                    <input value={value.attachmentOther} onChange={e => set('attachmentOther', e.target.value)}
                      placeholder="Tài liệu khác…" className={`${FIELD} mt-2`} />
                  </fieldset>

                  <label className="block"><span className={LABEL}>Đường dẫn hồ sơ BNDC</span>
                    <input value={value.bndcLink} onChange={e => set('bndcLink', e.target.value)} className={FIELD} />
                  </label>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-blue-700">5. Phê duyệt</h2>
                <p className="mt-2 text-xs text-slate-500">Thường để trống khi trình; điền nếu cần in kèm kết luận.</p>
                <div className="mt-4 grid gap-4">
                  <label className="block"><span className={LABEL}>Ý kiến phê duyệt</span>
                    <select value={value.decision} onChange={e => set('decision', e.target.value)} className={FIELD}>
                      <option value="">— Chưa phê duyệt —</option>
                      {DECISION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="block"><span className={LABEL}>Tổng mức được duyệt</span>
                    <input value={value.approvedTotal} onChange={e => set('approvedTotal', e.target.value)} inputMode="decimal" className={FIELD} />
                  </label>
                  <label className="block"><span className={LABEL}>Điều kiện; người thực hiện; thời hạn</span>
                    <textarea rows={2} value={value.conditions} onChange={e => set('conditions', e.target.value)} className={FIELD} />
                  </label>
                </div>
              </section>
            </div>

            {/* ---------- Preview ---------- */}
            <div className="min-w-0 xl:sticky xl:top-28">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Xem trước bản in (A4)</p>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Thu nhỏ" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.08).toFixed(2)))}
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"><ZoomOut className="h-4 w-4" /></button>
                  <span className="w-12 text-center text-xs font-bold tabular-nums text-slate-600">{Math.round(zoom * 100)}%</span>
                  <button type="button" aria-label="Phóng to" onClick={() => setZoom(z => Math.min(1.4, +(z + 0.08).toFixed(2)))}
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"><ZoomIn className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="fp-viewport">
                <div className="fp-scale" style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%` }}>
                  <FundingProposalPreview value={value} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function filenameFrom(disposition: string | null) {
  if (!disposition) return '';
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try { return decodeURIComponent(utf8[1]); } catch { /* fall through */ }
  }
  const plain = disposition.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : '';
}
