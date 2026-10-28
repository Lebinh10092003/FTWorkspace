import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Copy,
  Edit3,
  ExternalLink,
  History,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserX,
  Wallet,
  Wand2,
  X,
} from 'lucide-react';
import { appDialog } from '../AppDialog';

interface CompanyAccountsProps {
  idToken: string;
}

type Category = 'email' | 'ai' | 'design' | 'social' | 'cloud' | 'domain' | 'software' | 'finance' | 'government' | 'other';
type Status = 'active' | 'suspended' | 'cancelled';
type BillingCycle = 'free' | 'monthly' | 'quarterly' | 'yearly' | 'one_time';

interface CompanyAccount {
  id: number;
  name: string;
  category: Category;
  categoryLabel: string;
  provider: string;
  loginUrl: string;
  username: string;
  /** Mật khẩu dạng văn bản thường (API chỉ Admin trả về; trong DB vẫn mã hóa). */
  password?: string;
  passwordError?: string;
  hasPassword: boolean;
  passwordChangedAt: string | null;
  twoFactor: string;
  recoveryEmail: string;
  recoveryPhone: string;
  ownerEmail: string;
  department: string;
  users: string[];
  plan: string;
  cost: number | null;
  currency: string;
  billingCycle: BillingCycle;
  billingCycleLabel: string;
  monthlyCost: number;
  renewalDate: string | null;
  daysUntilRenewal: number | null;
  autoRenew: boolean;
  paymentMethod: string;
  status: Status;
  statusLabel: string;
  tags: string[];
  notes: string;
  updatedBy: string;
  updatedAt: string | null;
}

interface Summary {
  total: number;
  active: number;
  monthlyCost: number;
  renewalDueCount: number;
  overdueCount: number;
  withoutOwner: number;
  stalePasswords: number;
}

interface LogEntry {
  id: number;
  accountId: number | null;
  accountName: string;
  action: string;
  actionLabel: string;
  actorEmail: string;
  channel: string;
  detail: string;
  createdAt: string;
}

type Draft = {
  name: string;
  category: Category;
  provider: string;
  loginUrl: string;
  username: string;
  password: string;
  twoFactor: string;
  recoveryEmail: string;
  recoveryPhone: string;
  ownerEmail: string;
  department: string;
  users: string;
  plan: string;
  cost: string;
  billingCycle: BillingCycle;
  renewalDate: string;
  autoRenew: boolean;
  paymentMethod: string;
  status: Status;
  tags: string;
  notes: string;
};

const CATEGORIES: Record<Category, string> = {
  email: 'Email & Văn phòng',
  ai: 'Công cụ AI',
  design: 'Thiết kế & Media',
  social: 'Mạng xã hội',
  cloud: 'Cloud & Lưu trữ',
  domain: 'Tên miền & Hosting',
  software: 'Phần mềm & Bản quyền',
  finance: 'Ngân hàng & Thanh toán',
  government: 'Dịch vụ công (Thuế, BHXH...)',
  other: 'Khác',
};
const STATUSES: Record<Status, string> = { active: 'Đang dùng', suspended: 'Tạm ngưng', cancelled: 'Đã hủy' };
const CYCLES: Record<BillingCycle, string> = {
  free: 'Miễn phí',
  monthly: 'Hàng tháng',
  quarterly: 'Hàng quý',
  yearly: 'Hàng năm',
  one_time: 'Một lần',
};
const STATUS_TONE: Record<Status, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  suspended: 'bg-amber-50 text-amber-700 ring-amber-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const blankDraft = (): Draft => ({
  name: '', category: 'other', provider: '', loginUrl: '', username: '', password: '', twoFactor: '',
  recoveryEmail: '', recoveryPhone: '', ownerEmail: '', department: '', users: '', plan: '', cost: '',
  billingCycle: 'free', renewalDate: '', autoRenew: false, paymentMethod: '', status: 'active', tags: '', notes: '',
});

const draftFrom = (a: CompanyAccount): Draft => ({
  name: a.name, category: a.category, provider: a.provider, loginUrl: a.loginUrl, username: a.username, password: a.password || '',
  twoFactor: a.twoFactor, recoveryEmail: a.recoveryEmail, recoveryPhone: a.recoveryPhone, ownerEmail: a.ownerEmail,
  department: a.department, users: a.users.join(', '), plan: a.plan, cost: a.cost == null ? '' : String(a.cost),
  billingCycle: a.billingCycle, renewalDate: a.renewalDate || '', autoRenew: a.autoRenew, paymentMethod: a.paymentMethod,
  status: a.status, tags: a.tags.join(', '), notes: a.notes,
});

const money = (value: number | null | undefined) =>
  value == null ? '—' : `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
const dateVN = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('vi-VN') : '—');
const dateTimeVN = (iso: string) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

function generatePassword(length = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function renewalBadge(a: CompanyAccount) {
  if (!a.renewalDate || a.daysUntilRenewal == null) return <span className="text-slate-400">—</span>;
  const days = a.daysUntilRenewal;
  const tone = a.status !== 'active'
    ? 'text-slate-500'
    : days < 0 ? 'text-rose-700 font-bold' : days <= 7 ? 'text-rose-600 font-semibold' : days <= 30 ? 'text-amber-700 font-semibold' : 'text-slate-700';
  const hint = a.status !== 'active' ? '' : days < 0 ? `Quá hạn ${-days} ngày` : days === 0 ? 'Hôm nay' : `Còn ${days} ngày`;
  return (
    <div className={tone}>
      <div>{dateVN(a.renewalDate)}</div>
      {hint && <div className="text-xs">{hint}{a.autoRenew ? ' · tự gia hạn' : ''}</div>}
    </div>
  );
}

function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block text-sm font-semibold text-slate-700 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  );
}

function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <button aria-label="Đóng" onClick={onClose} className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" className={`relative max-h-[92vh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
          <h3 className="text-lg font-extrabold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, tone = 'text-slate-900', sub }: { icon: React.ElementType; label: string; value: React.ReactNode; tone?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><Icon className="h-4 w-4" />{label}</div>
      <div className={`mt-2 text-2xl font-extrabold ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function CompanyAccounts({ idToken }: CompanyAccountsProps) {
  const [accounts, setAccounts] = useState<CompanyAccount[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | Category>('all');
  const [status, setStatus] = useState<'all' | Status>('active');
  const [dueOnly, setDueOnly] = useState(false);
  const [editing, setEditing] = useState<CompanyAccount | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [logsFor, setLogsFor] = useState<CompanyAccount | 'all' | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const headers = useMemo(() => ({ Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }), [idToken]);

  const request = async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error: any = new Error(data.error || 'Có lỗi xảy ra.');
      error.errors = data.errors;
      throw error;
    }
    return data;
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (category !== 'all') params.set('category', category);
      if (status !== 'all') params.set('status', status);
      if (dueOnly) params.set('renewalWithin', '30');
      const [rows, stats] = await Promise.all([
        request(`/api/company-accounts?${params}`),
        request('/api/company-accounts/summary'),
      ]);
      setAccounts(rows || []);
      setSummary(stats);
    } catch (error: any) {
      setNotice({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [search, category, status, dueOnly, idToken]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ type: 'success', text: `Đã sao chép ${label}.` });
    } catch {
      setNotice({ type: 'error', text: 'Trình duyệt không cho sao chép.' });
    }
  };

  const openCreate = () => { setEditing(null); setDraft(blankDraft()); setFormErrors({}); setFormOpen(true); };
  const openEdit = (account: CompanyAccount) => { setEditing(account); setDraft(draftFrom(account)); setFormErrors({}); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditing(null); setDraft(blankDraft()); };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormErrors({});
    const payload: Record<string, unknown> = { ...draft, users: draft.users, tags: draft.tags };
    // Mật khẩu là văn bản thường: xóa trắng ô khi sửa nghĩa là bỏ mật khẩu đã lưu.
    if (!draft.password) {
      delete payload.password;
      if (editing?.hasPassword) payload.clearPassword = true;
    }
    try {
      await request(editing ? `/api/company-accounts/${editing.id}` : '/api/company-accounts', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      setNotice({ type: 'success', text: editing ? `Đã cập nhật “${draft.name}”.` : `Đã thêm “${draft.name}”.` });
      closeForm();
      void load();
    } catch (error: any) {
      setFormErrors(error.errors || { _: error.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (account: CompanyAccount) => {
    const ok = await appDialog.confirm(
      `Xóa hẳn “${account.name}”? Nếu chỉ ngừng dùng, hãy sửa trạng thái thành “Đã hủy” để giữ lịch sử.`,
      { title: 'Xóa tài khoản công ty', confirmText: 'Xóa hẳn', tone: 'danger' },
    );
    if (!ok) return;
    try {
      await request(`/api/company-accounts/${account.id}`, { method: 'DELETE' });
      setNotice({ type: 'success', text: `Đã xóa “${account.name}”.` });
      void load();
    } catch (error: any) {
      setNotice({ type: 'error', text: error.message });
    }
  };

  const openLogs = async (target: CompanyAccount | 'all') => {
    setLogsFor(target);
    setLogs([]);
    try {
      const query = target === 'all' ? '' : `?account=${target.id}`;
      setLogs(await request(`/api/company-accounts/logs${query}`) || []);
    } catch (error: any) {
      setNotice({ type: 'error', text: error.message });
    }
  };

  const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
  const err = (key: string) => formErrors[key] ? <span className="mt-1 block text-xs font-semibold text-rose-600">{formErrors[key]}</span> : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.14em] text-blue-600">FT Workspace</p>
          <h2 className="mt-1 text-2xl font-extrabold text-slate-900">Tài khoản công ty</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Tài khoản dịch vụ do công ty sở hữu: email, AI, thiết kế, mạng xã hội, tên miền, cổng thuế... Chỉ Admin xem được trang này;
            mật khẩu được mã hóa khi lưu trên máy chủ.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void openLogs('all')} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <History className="h-4 w-4" />Nhật ký
          </button>
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" />Thêm tài khoản
          </button>
        </div>
      </div>

      {notice && (
        <div className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-semibold ${notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Đóng thông báo"><X className="h-4 w-4" /></button>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile icon={ShieldCheck} label="Đang dùng" value={summary.active} sub={`Tổng ${summary.total} tài khoản`} />
          <StatTile icon={Wallet} label="Chi phí / tháng" value={money(summary.monthlyCost)} sub="Quy đổi từ các gói trả phí" />
          <StatTile
            icon={CalendarClock}
            label="Gia hạn 30 ngày"
            value={summary.renewalDueCount}
            tone={summary.overdueCount ? 'text-rose-600' : summary.renewalDueCount ? 'text-amber-600' : 'text-slate-900'}
            sub={summary.overdueCount ? `${summary.overdueCount} đã quá hạn` : 'Chưa có tài khoản quá hạn'}
          />
          <StatTile icon={UserX} label="Chưa có người phụ trách" value={summary.withoutOwner} tone={summary.withoutOwner ? 'text-amber-600' : 'text-slate-900'} />
          <StatTile icon={AlertTriangle} label="Mật khẩu > 180 ngày" value={summary.stalePasswords} tone={summary.stalePasswords ? 'text-amber-600' : 'text-slate-900'} sub="Nên đổi định kỳ" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm tên, nhà cung cấp, tên đăng nhập, người phụ trách..." className={`${inputClass} pl-9`} />
        </div>
        <select value={category} onChange={e => setCategory(e.target.value as any)} className={`${inputClass} w-auto`}>
          <option value="all">Tất cả nhóm</option>
          {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value as any)} className={`${inputClass} w-auto`}>
          <option value="all">Mọi trạng thái</option>
          {Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 px-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={dueOnly} onChange={e => setDueOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Cần gia hạn trong 30 ngày
        </label>
        <button onClick={() => void load()} className="rounded-lg p-2.5 text-slate-500 hover:bg-slate-100" aria-label="Tải lại"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Tài khoản</th>
              <th className="px-4 py-3">Đăng nhập</th>
              <th className="px-4 py-3">Phụ trách</th>
              <th className="px-4 py-3">Gói & chi phí</th>
              <th className="px-4 py-3">Gia hạn</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!loading && accounts.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-14 text-center text-slate-500">
                <KeyRound className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                Chưa có tài khoản nào khớp bộ lọc. Bấm “Thêm tài khoản” để bắt đầu.
              </td></tr>
            )}
            {accounts.map(account => (
              <tr key={account.id} className="align-top hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <div className="font-bold text-slate-900">{account.name}</div>
                  <div className="text-xs text-slate-500">{account.categoryLabel}{account.provider ? ` · ${account.provider}` : ''}</div>
                  {account.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">{account.tags.map(tag => <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{tag}</span>)}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {account.username ? (
                    <button onClick={() => void copy(account.username, 'tên đăng nhập')} className="group inline-flex items-center gap-1 font-medium text-slate-800 hover:text-blue-700" title="Sao chép">
                      {account.username}<Copy className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                    </button>
                  ) : <span className="text-slate-400">—</span>}
                  {account.password ? (
                    <button onClick={() => void copy(account.password || '', `mật khẩu ${account.name}`)} className="group mt-1 inline-flex items-center gap-1 text-left" title="Sao chép mật khẩu">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 break-all">{account.password}</code>
                      <Copy className="h-3.5 w-3.5 shrink-0 text-slate-400 opacity-0 group-hover:opacity-100" />
                    </button>
                  ) : account.passwordError ? (
                    <div className="mt-1 text-xs font-semibold text-rose-600">{account.passwordError}</div>
                  ) : null}
                  {account.loginUrl && (
                    <a href={account.loginUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                      Mở trang đăng nhập<ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {account.twoFactor && <div className="mt-1 text-xs text-slate-500">2FA: {account.twoFactor}</div>}
                </td>
                <td className="px-4 py-3">
                  {account.ownerEmail ? <div className="font-medium text-slate-800">{account.ownerEmail}</div> : <span className="text-xs font-semibold text-amber-600">Chưa có người phụ trách</span>}
                  {account.department && <div className="text-xs text-slate-500">{account.department}</div>}
                  {account.users.length > 0 && <div className="mt-0.5 text-xs text-slate-500">Dùng chung: {account.users.join(', ')}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{account.plan || '—'}</div>
                  <div className="text-xs text-slate-500">
                    {account.billingCycle === 'free' ? 'Miễn phí' : `${money(account.cost)} · ${account.billingCycleLabel}`}
                  </div>
                </td>
                <td className="px-4 py-3">{renewalBadge(account)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${STATUS_TONE[account.status]}`}>{account.statusLabel}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => void openLogs(account)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Nhật ký"><History className="h-4 w-4" /></button>
                    <button onClick={() => openEdit(account)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Sửa"><Edit3 className="h-4 w-4" /></button>
                    <button onClick={() => void remove(account)} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50" title="Xóa"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="py-10 text-center text-sm text-slate-500">Đang tải...</div>}
      </div>

      {formOpen && (
        <Dialog title={editing ? `Sửa “${editing.name}”` : 'Thêm tài khoản công ty'} onClose={closeForm} wide>
          <form onSubmit={submit} className="space-y-6 p-6">
            {formErrors._ && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{formErrors._}</div>}
            <section className="grid gap-4 sm:grid-cols-2">
              <Field label="Tên tài khoản / dịch vụ *">
                <input required value={draft.name} onChange={e => set('name', e.target.value)} placeholder="vd: Google Workspace – admin" className={inputClass} />{err('name')}
              </Field>
              <Field label="Nhóm">
                <select value={draft.category} onChange={e => set('category', e.target.value as Category)} className={inputClass}>
                  {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Nhà cung cấp"><input value={draft.provider} onChange={e => set('provider', e.target.value)} placeholder="Google, OpenAI, Canva, PA Vietnam..." className={inputClass} /></Field>
              <Field label="Trang đăng nhập"><input value={draft.loginUrl} onChange={e => set('loginUrl', e.target.value)} placeholder="https://..." className={inputClass} /></Field>
            </section>

            <section className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2">
              <Field label="Tên đăng nhập / email"><input value={draft.username} onChange={e => set('username', e.target.value)} autoComplete="off" className={inputClass} /></Field>
              <Field label="Mật khẩu" hint={editing?.hasPassword ? 'Xóa trắng ô này để bỏ mật khẩu đã lưu.' : undefined}>
                <div className="flex gap-2">
                  <input type="text" value={draft.password} onChange={e => set('password', e.target.value)} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" className={inputClass} />
                  <button type="button" onClick={() => set('password', generatePassword())} className="rounded-lg border border-slate-200 bg-white px-2.5 text-slate-500 hover:bg-slate-50" title="Tạo mật khẩu mạnh">
                    <Wand2 className="h-4 w-4" />
                  </button>
                </div>
              </Field>
              <Field label="Xác thực 2 lớp (2FA)" hint="Nơi nhận mã: SĐT, thiết bị, app. Không ghi mã khôi phục ở đây."><input value={draft.twoFactor} onChange={e => set('twoFactor', e.target.value)} className={inputClass} /></Field>
              <Field label="Email / SĐT khôi phục">
                <div className="grid grid-cols-2 gap-2">
                  <input value={draft.recoveryEmail} onChange={e => set('recoveryEmail', e.target.value)} placeholder="Email" className={inputClass} />
                  <input value={draft.recoveryPhone} onChange={e => set('recoveryPhone', e.target.value)} placeholder="SĐT" className={inputClass} />
                </div>
                {err('recovery_email')}
              </Field>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <Field label="Email người phụ trách"><input value={draft.ownerEmail} onChange={e => set('ownerEmail', e.target.value)} placeholder="ten@fermat.vn" className={inputClass} />{err('owner_email')}</Field>
              <Field label="Bộ phận"><input value={draft.department} onChange={e => set('department', e.target.value)} className={inputClass} /></Field>
              <Field label="Người / nhóm dùng chung" hint="Cách nhau bằng dấu phẩy" wide><input value={draft.users} onChange={e => set('users', e.target.value)} className={inputClass} /></Field>
            </section>

            <section className="grid gap-4 sm:grid-cols-3">
              <Field label="Gói dịch vụ"><input value={draft.plan} onChange={e => set('plan', e.target.value)} placeholder="Business Standard, Team..." className={inputClass} /></Field>
              <Field label="Chu kỳ thanh toán">
                <select value={draft.billingCycle} onChange={e => set('billingCycle', e.target.value as BillingCycle)} className={inputClass}>
                  {Object.entries(CYCLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Chi phí mỗi kỳ (VND)"><input inputMode="numeric" value={draft.cost} onChange={e => set('cost', e.target.value.replace(/[^\d]/g, ''))} disabled={draft.billingCycle === 'free'} className={inputClass} />{err('cost')}</Field>
              <Field label="Ngày gia hạn tiếp theo"><input type="date" value={draft.renewalDate} onChange={e => set('renewalDate', e.target.value)} className={inputClass} />{err('renewal_date')}</Field>
              <Field label="Phương thức thanh toán" hint="Không ghi đủ số thẻ"><input value={draft.paymentMethod} onChange={e => set('paymentMethod', e.target.value)} placeholder="Visa ••1234, chuyển khoản..." className={inputClass} /></Field>
              <Field label="Trạng thái">
                <select value={draft.status} onChange={e => set('status', e.target.value as Status)} className={inputClass}>
                  {Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
            </section>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={draft.autoRenew} onChange={e => set('autoRenew', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Tự động gia hạn
            </label>

            <section className="grid gap-4 sm:grid-cols-2">
              <Field label="Nhãn" hint="Cách nhau bằng dấu phẩy" wide><input value={draft.tags} onChange={e => set('tags', e.target.value)} className={inputClass} /></Field>
              <Field label="Ghi chú" wide><textarea rows={3} value={draft.notes} onChange={e => set('notes', e.target.value)} className={inputClass} /></Field>
            </section>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={closeForm} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">Hủy</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu'}</button>
            </div>
          </form>
        </Dialog>
      )}

      {logsFor && (
        <Dialog title={logsFor === 'all' ? 'Nhật ký tài khoản công ty' : `Nhật ký “${logsFor.name}”`} onClose={() => setLogsFor(null)}>
          <div className="divide-y divide-slate-100 p-2">
            {logs.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">Chưa có nhật ký.</p>}
            {logs.map(item => (
              <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="font-semibold text-slate-800">
                    <span className={item.action === 'reveal' ? 'text-amber-700' : item.action === 'delete' ? 'text-rose-700' : ''}>{item.actionLabel}</span>
                    {logsFor === 'all' && <span className="text-slate-500"> · {item.accountName}</span>}
                  </div>
                  <div className="text-xs text-slate-500">{item.actorEmail || 'Không rõ'}{item.channel === 'mcp' ? ' · qua Trợ lý AI' : ''}{item.detail ? ` · ${item.detail}` : ''}</div>
                </div>
                <div className="shrink-0 text-xs text-slate-500">{dateTimeVN(item.createdAt)}</div>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
