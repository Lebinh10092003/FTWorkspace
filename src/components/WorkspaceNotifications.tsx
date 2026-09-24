import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Bell, CheckCheck, ExternalLink, X } from 'lucide-react';

type Notification = {
  id: number;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'urgent' | 'success';
  category: string;
  actionUrl?: string;
  createdAt: string;
  read: boolean;
};

type Filter = 'all' | 'unread' | 'read';

const categoryLabels: Record<string, string> = {
  personnel: 'Nhân sự',
  'digital-training': 'Đào tạo số',
  'work-schedule': 'Lịch làm việc',
  'social-dashboard': 'Truyền thông',
  attendance: 'Công ca',
  examination: 'Khảo thí',
  workspace: 'Workspace',
};

const sessionToken = () => {
  try { return JSON.parse(localStorage.getItem('ft_auth_session') || '{}')?.token || ''; }
  catch { return ''; }
};

export default function WorkspaceNotifications({ token: suppliedToken }: { token?: string | null }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const token = suppliedToken || sessionToken();
  const unread = items.filter(item => !item.read).length;
  const visibleItems = useMemo(() => items.filter(item => filter === 'all' || (filter === 'read' ? item.read : !item.read)), [filter, items]);

  const load = async () => {
    if (!token) return;
    const response = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) setItems((await response.json()).notifications || []);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [token]);

  const markAll = async () => {
    if (!token || unread === 0) return;
    const response = await fetch('/api/notifications/read-all', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) setItems(current => current.map(item => ({ ...item, read: true })));
  };

  const openItem = async (item: Notification) => {
    setItems(current => current.map(row => row.id === item.id ? { ...row, read: true } : row));
    if (!item.read && token) {
      await fetch(`/api/notifications/${item.id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    }
    if (item.actionUrl) {
      setOpen(false);
      window.location.assign(item.actionUrl);
    }
  };

  const drawer = open && typeof document !== 'undefined' ? createPortal(
    <div className="fixed inset-0 z-[1300] flex justify-end bg-slate-950/35" onMouseDown={() => setOpen(false)}>
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()} aria-label="Trung tâm thông báo">
        <header className="border-b bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Thông báo</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500">{unread > 0 ? `${unread} thông báo chưa đọc` : 'Bạn đã đọc tất cả thông báo'}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Đóng thông báo"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-4 flex items-center gap-2">
            {([['all', `Tất cả (${items.length})`], ['unread', `Chưa đọc (${unread})`], ['read', 'Đã đọc']] as Array<[Filter, string]>).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-3 py-1.5 text-xs font-extrabold transition ${filter === value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>
            ))}
          </div>
          <button type="button" disabled={unread === 0} onClick={() => void markAll()} className="mt-3 inline-flex items-center gap-2 text-xs font-extrabold text-blue-700 disabled:text-slate-400">
            <CheckCheck className="h-4 w-4" />Đánh dấu tất cả là đã đọc
          </button>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {visibleItems.length ? visibleItems.map(item => (
            <button key={item.id} type="button" onClick={() => void openItem(item)} className={`relative w-full rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${item.read ? 'border-slate-200 bg-white' : item.severity === 'urgent' ? 'border-rose-300 bg-rose-50' : item.severity === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
              {!item.read && <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-blue-600" aria-label="Chưa đọc" />}
              <span className="flex items-start gap-3 pr-4">
                <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${item.severity === 'urgent' ? 'bg-rose-100 text-rose-700' : item.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                  {item.severity === 'urgent' || item.severity === 'warning' ? <AlertTriangle className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{categoryLabels[item.category] || item.category}</span>
                  <b className="mt-0.5 block text-sm text-slate-900">{item.title}</b>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-600">{item.message}</span>
                  <small className="mt-2 block text-[11px] text-slate-400">{new Date(item.createdAt).toLocaleString('vi-VN')}</small>
                </span>
                {item.actionUrl && <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
              </span>
            </button>
          )) : <p className="py-12 text-center text-sm font-medium text-slate-500">Không có thông báo trong mục này.</p>}
        </div>
      </aside>
    </div>,
    document.body,
  ) : null;

  return <>
    <button type="button" onClick={() => setOpen(true)} className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700" aria-label={`Thông báo${unread ? `, ${unread} chưa đọc` : ''}`} title="Thông báo">
      <Bell className="h-5 w-5" />
      {unread > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-extrabold text-white ring-2 ring-white">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {drawer}
  </>;
}
