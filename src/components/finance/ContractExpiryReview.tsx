import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CircleCheck, PauseCircle, Search, TriangleAlert, XCircle } from 'lucide-react';

/**
 * Hạn hợp đồng — the accounting view of Đào tạo số product subscriptions.
 *
 * Accounting needs to chase renewals but should not have to open the training
 * module to do it. This reads the same `/api/digital-training/product-subscriptions`
 * collection the training module uses (authenticated read, no extra backend),
 * and presents it sorted by what expires soonest. It stays read-only: changing
 * a contract term remains the training team's call.
 */

export type ContractSubscription = {
  id: number;
  partner_name: string;
  partner_group: string;
  partner_province: string;
  product_name: string;
  product_code: string;
  quantity: number;
  starts_at?: string | null;
  expires_at?: string | null;
  status: 'active' | 'paused' | 'cancelled';
  effective_status: 'active' | 'expiring' | 'expired' | 'paused' | 'cancelled';
  days_remaining?: number | null;
  notes: string;
};

type StatusFilter = 'all' | ContractSubscription['effective_status'];

const STATUS_LABELS: Record<ContractSubscription['effective_status'], string> = {
  active: 'Còn hiệu lực',
  expiring: 'Sắp hết hạn',
  expired: 'Đã hết hạn',
  paused: 'Tạm dừng',
  cancelled: 'Đã hủy',
};

const STATUS_TONE: Record<ContractSubscription['effective_status'], string> = {
  active: 'bndc-chip-green',
  expiring: 'bndc-chip-amber',
  expired: 'bndc-chip-rose',
  paused: 'bndc-chip-slate',
  cancelled: 'bndc-chip-slate',
};

const showDate = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('vi-VN');
};

function remainingLabel(item: ContractSubscription) {
  const days = item.days_remaining;
  if (days === null || days === undefined) return '—';
  if (days < 0) return `Quá hạn ${Math.abs(days)} ngày`;
  if (days === 0) return 'Hết hạn hôm nay';
  return `Còn ${days} ngày`;
}

function remainingTone(item: ContractSubscription) {
  const days = item.days_remaining;
  if (days === null || days === undefined) return 'text-slate-400';
  if (days < 0) return 'text-rose-600';
  if (days <= 30) return 'text-amber-600';
  return 'text-slate-600';
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ElementType; tone: string }) {
  return (
    <div className="bndc-stat">
      <span className="bndc-stat-head">
        <span>{label}</span>
        <Icon className={tone} aria-hidden="true" />
      </span>
      <b>{value.toLocaleString('vi-VN')}</b>
    </div>
  );
}

export type ContractExpiryReviewProps = {
  idToken: string;
  onCountsChange?: (counts: { expiring: number; expired: number }) => void;
};

export default function ContractExpiryReview({ idToken, onCountsChange }: ContractExpiryReviewProps) {
  const [items, setItems] = useState<ContractSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch('/api/digital-training/product-subscriptions', { headers: { Authorization: `Bearer ${idToken}` } })
      .then(async response => {
        if (!response.ok) throw new Error('Không thể tải danh sách hợp đồng sản phẩm.');
        return response.json();
      })
      .then(rows => {
        if (!active) return;
        setItems(Array.isArray(rows) ? rows : []);
        setError('');
      })
      .catch(loadError => {
        if (active) setError(String(loadError?.message || loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [idToken]);

  const counts = useMemo(() => ({
    expiring: items.filter(item => item.effective_status === 'expiring').length,
    expired: items.filter(item => item.effective_status === 'expired').length,
    active: items.filter(item => item.effective_status === 'active').length,
    paused: items.filter(item => item.effective_status === 'paused' || item.effective_status === 'cancelled').length,
  }), [items]);

  useEffect(() => {
    onCountsChange?.({ expiring: counts.expiring, expired: counts.expired });
  }, [counts.expired, counts.expiring, onCountsChange]);

  const visibleItems = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    // Soonest expiry first; rows without a date sink to the bottom.
    const sortKey = (item: ContractSubscription) =>
      item.days_remaining === null || item.days_remaining === undefined ? Number.MAX_SAFE_INTEGER : item.days_remaining;
    return items
      .filter(item => {
        const matchesKeyword = !needle
          || [item.partner_name, item.product_name, item.product_code, item.partner_province, item.partner_group]
            .join(' ').toLowerCase().includes(needle);
        const matchesStatus = statusFilter === 'all' || item.effective_status === statusFilter;
        return matchesKeyword && matchesStatus;
      })
      .sort((a, b) => sortKey(a) - sortKey(b));
  }, [items, keyword, statusFilter]);

  if (loading) return <p className="py-16 text-center text-sm font-semibold text-slate-500">Đang tải danh sách hợp đồng...</p>;

  return (
    <section className="space-y-4">
      <header className="ft-page-header flex flex-wrap items-start justify-between gap-3 p-4 md:p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-sky-600">Kế toán · Đào tạo số</p>
          <h2 className="text-xl font-extrabold text-[#0b4275]">Hạn hợp đồng</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Theo dõi thời hạn sản phẩm và dịch vụ của khách hàng Đào tạo số để chuẩn bị thu phí gia hạn. Dữ liệu lấy trực tiếp từ mô-đun Đào tạo số.
          </p>
        </div>
      </header>

      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">{error}</p>}

      {(counts.expired > 0 || counts.expiring > 0) && (
        <p className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          <CalendarClock className="h-5 w-5 shrink-0 text-amber-600" />
          Có {counts.expired} hợp đồng đã hết hạn và {counts.expiring} hợp đồng sắp hết hạn cần liên hệ gia hạn.
        </p>
      )}

      <div className="bndc-stat-grid">
        <Stat label="Đã hết hạn" value={counts.expired} icon={XCircle} tone="text-rose-600" />
        <Stat label="Sắp hết hạn" value={counts.expiring} icon={TriangleAlert} tone="text-amber-600" />
        <Stat label="Còn hiệu lực" value={counts.active} icon={CircleCheck} tone="text-emerald-600" />
        <Stat label="Tạm dừng / đã hủy" value={counts.paused} icon={PauseCircle} tone="text-slate-500" />
      </div>

      <div className="ft-surface rounded-2xl border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="ft-input-wrap flex min-w-[16rem] flex-1 items-center gap-2 px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={keyword}
              onChange={event => setKeyword(event.currentTarget.value)}
              placeholder="Tìm theo khách hàng, sản phẩm hoặc địa bàn"
              className="w-full bg-transparent py-2 text-sm outline-none"
              aria-label="Tìm kiếm hợp đồng"
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            Trạng thái
            <select
              value={statusFilter}
              onChange={event => setStatusFilter(event.currentTarget.value as StatusFilter)}
              className="ws-input w-auto py-2 text-xs"
            >
              <option value="all">Tất cả</option>
              {(Object.keys(STATUS_LABELS) as ContractSubscription['effective_status'][]).map(status => (
                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="ft-table min-w-[940px]">
            <thead>
              <tr>
                <th>Khách hàng</th>
                <th>Sản phẩm / dịch vụ</th>
                <th>Số lượng</th>
                <th>Bắt đầu</th>
                <th>Hết hạn</th>
                <th>Thời gian còn lại</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map(item => (
                <tr key={item.id}>
                  <td>
                    <b className="text-[#0b4275]">{item.partner_name}</b>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[item.partner_group, item.partner_province].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </td>
                  <td>
                    <b className="text-xs">{item.product_name}</b>
                    {item.product_code && <p className="mt-0.5 text-xs text-slate-500">{item.product_code}</p>}
                    {item.notes && <p className="mt-0.5 text-[11px] text-slate-400">{item.notes}</p>}
                  </td>
                  <td className="text-center font-bold">{item.quantity}</td>
                  <td className="whitespace-nowrap text-xs">{showDate(item.starts_at)}</td>
                  <td className="whitespace-nowrap text-xs font-bold">{showDate(item.expires_at)}</td>
                  <td className={`whitespace-nowrap text-xs font-bold ${remainingTone(item)}`}>{remainingLabel(item)}</td>
                  <td><span className={`bndc-chip ${STATUS_TONE[item.effective_status]}`}>{STATUS_LABELS[item.effective_status]}</span></td>
                </tr>
              ))}
              {!visibleItems.length && (
                <tr><td colSpan={7} className="py-6 text-center text-sm font-semibold text-slate-500">Không có hợp đồng nào khớp bộ lọc.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Màn hình này chỉ để theo dõi. Việc điều chỉnh thời hạn hợp đồng vẫn thực hiện trong mô-đun Công nghệ &amp; đào tạo số.
        </p>
      </div>
    </section>
  );
}
