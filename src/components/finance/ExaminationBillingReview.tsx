import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, CheckCheck, CircleDollarSign, Clock, ReceiptText, Search, TriangleAlert, UserPlus } from 'lucide-react';
import { appDialog } from '../AppDialog';
import examinationBillingService, {
  BILLING_INVOICE_LABELS,
  BILLING_TRANSFER_LABELS,
  type BillingInvoiceStatus,
  type BillingTransferStatus,
  type ExaminationBillingRecord,
  type ExaminationBillingStats,
} from './examinationBillingService';

const money = (value: number) => `${value.toLocaleString('vi-VN')}đ`;

const dateTime = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ElementType; tone: string }) {
  return (
    <div className="bndc-stat">
      <span className="bndc-stat-head">
        <span>{label}</span>
        <Icon className={tone} aria-hidden="true" />
      </span>
      <b>{value}</b>
    </div>
  );
}

function TransferChip({ status }: { status: BillingTransferStatus }) {
  const tone: Record<BillingTransferStatus, string> = {
    pending: 'bndc-chip-amber',
    confirmed: 'bndc-chip-green',
    mismatch: 'bndc-chip-rose',
  };
  return <span className={`bndc-chip ${tone[status]}`}>{BILLING_TRANSFER_LABELS[status]}</span>;
}

function InvoiceChip({ status }: { status: BillingInvoiceStatus }) {
  const tone: Record<BillingInvoiceStatus, string> = {
    pending: 'bndc-chip-amber',
    checked: 'bndc-chip-green',
    issue: 'bndc-chip-rose',
    not_required: 'bndc-chip-slate',
  };
  return <span className={`bndc-chip ${tone[status]}`}>{BILLING_INVOICE_LABELS[status]}</span>;
}

export type ExaminationBillingReviewProps = {
  idToken?: string;
  /** Recorded as the person who confirmed the transfer or checked the invoice. */
  actorName: string;
  canEdit: boolean;
  onStatsChange?: (stats: ExaminationBillingStats) => void;
};

/**
 * Đối soát khảo thí — accounting confirms the money arrived and the invoice was
 * checked for each candidate Khảo thí registers. New candidates surface as an
 * unread count so accounting does not have to poll the examination module.
 */
export default function ExaminationBillingReview({ idToken, actorName, canEdit, onStatsChange }: ExaminationBillingReviewProps) {
  const [records, setRecords] = useState<ExaminationBillingRecord[]>([]);
  const [stats, setStats] = useState<ExaminationBillingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [keyword, setKeyword] = useState('');
  const [transferFilter, setTransferFilter] = useState<'all' | BillingTransferStatus>('all');
  const [invoiceFilter, setInvoiceFilter] = useState<'all' | BillingInvoiceStatus>('all');

  const reload = useCallback(async () => {
    try {
      const [nextRecords, nextStats] = await Promise.all([
        examinationBillingService.listRecords({ idToken }),
        examinationBillingService.getStats({ idToken }),
      ]);
      setRecords(nextRecords);
      setStats(nextStats);
      onStatsChange?.(nextStats);
      setError('');
    } catch (loadError: any) {
      setError(loadError?.message || 'Không thể tải dữ liệu đối soát khảo thí.');
    } finally {
      setLoading(false);
    }
  }, [idToken, onStatsChange]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const newRecords = useMemo(() => records.filter(item => !item.seenByAccountant), [records]);

  const visibleRecords = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return records.filter(item => {
      const matchesKeyword = !needle
        || [item.candidateName, item.candidateCode, item.school, item.competitionCode, item.transferReference, item.invoiceNumber]
          .join(' ').toLowerCase().includes(needle);
      const matchesTransfer = transferFilter === 'all' || item.transferStatus === transferFilter;
      const matchesInvoice = invoiceFilter === 'all' || item.invoiceStatus === invoiceFilter;
      return matchesKeyword && matchesTransfer && matchesInvoice;
    });
  }, [invoiceFilter, keyword, records, transferFilter]);

  const acknowledgeNew = async () => {
    if (!newRecords.length) return;
    await examinationBillingService.markSeen(newRecords.map(item => item.id), { idToken });
    await reload();
    setNotice(`Đã đánh dấu ${newRecords.length} thí sinh mới là đã xem.`);
  };

  const confirmTransfer = async (record: ExaminationBillingRecord) => {
    const reference = await appDialog.prompt(
      `Nhập mã giao dịch / nội dung chuyển khoản của ${record.candidateName} (${money(record.amount)}).`,
      { title: 'Xác nhận đã chuyển khoản', placeholder: 'VCB 0918.221540', confirmText: 'Xác nhận' },
    );
    if (reference === null) return;
    await examinationBillingService.confirmTransfer(record.id, { reference: reference.trim(), actor: actorName }, { idToken });
    await reload();
    setNotice(`Đã xác nhận chuyển khoản cho ${record.candidateName}.`);
  };

  const flagTransfer = async (record: ExaminationBillingRecord) => {
    const note = await appDialog.prompt(`Mô tả sai lệch khoản thu của ${record.candidateName}.`, {
      title: 'Báo lệch số tiền',
      defaultValue: record.note,
      placeholder: 'Phụ huynh chuyển thiếu 80.000đ',
      tone: 'warning',
      confirmText: 'Ghi nhận',
    });
    if (note === null) return;
    await examinationBillingService.flagTransferMismatch(record.id, note.trim(), { idToken });
    await reload();
    setNotice(`Đã ghi nhận sai lệch khoản thu của ${record.candidateName}.`);
  };

  const checkInvoice = async (record: ExaminationBillingRecord) => {
    const invoiceNumber = await appDialog.prompt(`Nhập số hóa đơn đã kiểm của ${record.candidateName}.`, {
      title: 'Đã kiểm hóa đơn',
      defaultValue: record.invoiceNumber,
      placeholder: 'HD-2026-00871',
      confirmText: 'Xác nhận',
    });
    if (invoiceNumber === null) return;
    await examinationBillingService.checkInvoice(record.id, { invoiceNumber: invoiceNumber.trim(), actor: actorName }, { idToken });
    await reload();
    setNotice(`Đã kiểm hóa đơn của ${record.candidateName}.`);
  };

  const flagInvoice = async (record: ExaminationBillingRecord) => {
    const note = await appDialog.prompt(`Mô tả vấn đề hóa đơn của ${record.candidateName}.`, {
      title: 'Hóa đơn có vấn đề',
      defaultValue: record.note,
      placeholder: 'Sai mã số thuế đơn vị',
      tone: 'warning',
      confirmText: 'Ghi nhận',
    });
    if (note === null) return;
    await examinationBillingService.flagInvoiceIssue(record.id, note.trim(), { idToken });
    await reload();
    setNotice(`Đã ghi nhận vấn đề hóa đơn của ${record.candidateName}.`);
  };

  const skipInvoice = async (record: ExaminationBillingRecord) => {
    const confirmed = await appDialog.confirm(`Đánh dấu ${record.candidateName} không cần xuất hóa đơn?`, {
      title: 'Không cần hóa đơn',
      confirmText: 'Xác nhận',
    });
    if (!confirmed) return;
    await examinationBillingService.skipInvoice(record.id, { idToken });
    await reload();
    setNotice(`Đã đánh dấu ${record.candidateName} không cần hóa đơn.`);
  };

  if (loading) return <p className="py-16 text-center text-sm font-semibold text-slate-500">Đang tải dữ liệu đối soát...</p>;

  return (
    <section className="space-y-4">
      <header className="ft-page-header flex flex-wrap items-start justify-between gap-3 p-4 md:p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-sky-600">Kế toán · Khảo thí</p>
          <h2 className="text-xl font-extrabold text-[#0b4275]">Đối soát khảo thí</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Theo dõi thí sinh mới đăng ký từ mô-đun Khảo thí, xác nhận đã nhận chuyển khoản và đánh dấu đã kiểm hóa đơn.
          </p>
        </div>
      </header>

      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">{error}</p>}
      {notice && <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-800">{notice}</p>}

      {newRecords.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="flex min-w-[16rem] flex-1 items-center gap-2.5 text-sm font-bold text-amber-900">
            <BellRing className="h-5 w-5 shrink-0 text-amber-600" />
            Khảo thí vừa có {newRecords.length} thí sinh mới cần đối soát
            <span className="font-semibold text-amber-800">
              ({newRecords.slice(0, 3).map(item => item.candidateName).join(', ')}
              {newRecords.length > 3 ? `, +${newRecords.length - 3} thí sinh` : ''})
            </span>
          </p>
          <button type="button" onClick={() => void acknowledgeNew()} className="ft-btn ft-btn-secondary text-xs">
            <CheckCheck className="h-4 w-4" />Đánh dấu đã xem
          </button>
        </div>
      )}

      <div className="bndc-stat-grid">
        <Stat label="Thí sinh mới chưa xem" value={String(stats?.newCandidates ?? 0)} icon={UserPlus} tone="text-amber-600" />
        <Stat label="Chờ chuyển khoản" value={String(stats?.awaitingTransfer ?? 0)} icon={Clock} tone="text-sky-600" />
        <Stat label="Chờ kiểm hóa đơn" value={String(stats?.awaitingInvoice ?? 0)} icon={ReceiptText} tone="text-violet-600" />
        <Stat label="Đã hoàn tất" value={String(stats?.completed ?? 0)} icon={CheckCheck} tone="text-emerald-600" />
        <Stat label="Đã thu" value={money(stats?.collectedAmount ?? 0)} icon={CircleDollarSign} tone="text-emerald-600" />
        <Stat label="Tổng phải thu" value={money(stats?.totalAmount ?? 0)} icon={CircleDollarSign} tone="text-slate-500" />
      </div>

      <div className="ft-surface rounded-2xl border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="ft-input-wrap flex min-w-[16rem] flex-1 items-center gap-2 px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={keyword}
              onChange={event => setKeyword(event.currentTarget.value)}
              placeholder="Tìm theo thí sinh, mã số, trường, mã giao dịch hoặc số hóa đơn"
              className="w-full bg-transparent py-2 text-sm outline-none"
              aria-label="Tìm kiếm hồ sơ đối soát"
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            Chuyển khoản
            <select value={transferFilter} onChange={event => setTransferFilter(event.currentTarget.value as typeof transferFilter)} className="ws-input w-auto py-2 text-xs">
              <option value="all">Tất cả</option>
              {(Object.keys(BILLING_TRANSFER_LABELS) as BillingTransferStatus[]).map(status => (
                <option key={status} value={status}>{BILLING_TRANSFER_LABELS[status]}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            Hóa đơn
            <select value={invoiceFilter} onChange={event => setInvoiceFilter(event.currentTarget.value as typeof invoiceFilter)} className="ws-input w-auto py-2 text-xs">
              <option value="all">Tất cả</option>
              {(Object.keys(BILLING_INVOICE_LABELS) as BillingInvoiceStatus[]).map(status => (
                <option key={status} value={status}>{BILLING_INVOICE_LABELS[status]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="ft-table min-w-[1080px]">
            <thead>
              <tr>
                <th>Thí sinh</th>
                <th>Cuộc thi</th>
                <th>Đăng ký</th>
                <th>Số tiền</th>
                <th>Chuyển khoản</th>
                <th>Hóa đơn</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map(record => {
                const invoiceSettled = record.invoiceStatus === 'checked' || record.invoiceStatus === 'not_required';
                return (
                  <tr key={record.id} className={record.seenByAccountant ? undefined : 'bg-amber-50/60'}>
                    <td>
                      <b className="text-[#0b4275]">{record.candidateName}</b>
                      {!record.seenByAccountant && <span className="ml-2 bndc-chip bndc-chip-amber">Mới</span>}
                      <p className="mt-0.5 text-xs text-slate-500">{record.candidateCode} · {record.school}</p>
                    </td>
                    <td>
                      <b className="text-xs">{record.competitionCode}</b>
                      <p className="mt-0.5 text-xs text-slate-500">{record.sessionCode}</p>
                    </td>
                    <td className="text-xs">{dateTime(record.registeredAt)}</td>
                    <td className="whitespace-nowrap font-bold">{money(record.amount)}</td>
                    <td>
                      <TransferChip status={record.transferStatus} />
                      {record.transferReference && <p className="mt-1 text-[11px] text-slate-500">{record.transferReference}</p>}
                      {record.transferConfirmedAt && (
                        <p className="mt-0.5 text-[11px] text-slate-400">{record.transferConfirmedBy} · {dateTime(record.transferConfirmedAt)}</p>
                      )}
                    </td>
                    <td>
                      <InvoiceChip status={record.invoiceStatus} />
                      {record.invoiceNumber && <p className="mt-1 text-[11px] text-slate-500">{record.invoiceNumber}</p>}
                      {record.note && (
                        <p className="mt-0.5 flex items-start gap-1 text-[11px] text-rose-600">
                          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />{record.note}
                        </p>
                      )}
                    </td>
                    <td>
                      {canEdit ? (
                        <div className="flex flex-wrap gap-1.5">
                          {record.transferStatus !== 'confirmed' && (
                            <>
                              <button type="button" onClick={() => void confirmTransfer(record)} className="ws-bulk-btn text-emerald-700">Đã chuyển khoản</button>
                              <button type="button" onClick={() => void flagTransfer(record)} className="ws-bulk-btn text-amber-700">Lệch tiền</button>
                            </>
                          )}
                          {record.transferStatus === 'confirmed' && !invoiceSettled && (
                            <>
                              <button type="button" onClick={() => void checkInvoice(record)} className="ws-bulk-btn text-emerald-700">Đã kiểm hóa đơn</button>
                              <button type="button" onClick={() => void flagInvoice(record)} className="ws-bulk-btn text-rose-700">Hóa đơn lỗi</button>
                              <button type="button" onClick={() => void skipInvoice(record)} className="ws-bulk-btn">Không cần</button>
                            </>
                          )}
                          {record.invoiceStatus === 'issue' && (
                            <button type="button" onClick={() => void checkInvoice(record)} className="ws-bulk-btn text-emerald-700">Đã xử lý xong</button>
                          )}
                          {record.transferStatus === 'confirmed' && invoiceSettled && record.invoiceStatus !== 'issue' && (
                            <span className="text-xs font-semibold text-emerald-700">Hoàn tất</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Chỉ xem</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visibleRecords.length && (
                <tr><td colSpan={7} className="py-6 text-center text-sm font-semibold text-slate-500">Không có hồ sơ nào khớp bộ lọc.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
