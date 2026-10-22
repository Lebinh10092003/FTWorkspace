import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, Bell, Check, CheckCheck, ExternalLink, Inbox, Info, Sparkles, X } from 'lucide-react';

export type Notification = {
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

const STORAGE_KEY = 'ft_read_notifications';
const CONTENT_STORAGE_KEY = 'ft_read_notification_keys';

const getStoredReadIds = (): Set<number> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
};

const getStoredReadContentKeys = (): Set<string> => {
  try {
    const raw = localStorage.getItem(CONTENT_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
};

const addStoredReadRecords = (ids: number[], contentKeys: string[]) => {
  try {
    const currentIds = getStoredReadIds();
    ids.forEach(id => currentIds.add(id));
    const arrIds = Array.from(currentIds).slice(-500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arrIds));

    const currentKeys = getStoredReadContentKeys();
    contentKeys.forEach(k => { if (k) currentKeys.add(k); });
    const arrKeys = Array.from(currentKeys).slice(-500);
    localStorage.setItem(CONTENT_STORAGE_KEY, JSON.stringify(arrKeys));
  } catch {}
};

const categoryConfig: Record<string, { label: string; badgeClass: string }> = {
  personnel: { label: 'Nhân sự', badgeClass: 'bg-purple-50 text-purple-700 border-purple-200/60' },
  'digital-training': { label: 'Đào tạo số', badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200/60' },
  'work-schedule': { label: 'Lịch làm việc', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200/60' },
  'social-dashboard': { label: 'Truyền thông', badgeClass: 'bg-sky-50 text-sky-700 border-sky-200/60' },
  attendance: { label: 'Công ca', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' },
  examination: { label: 'Khảo thí', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200/60' },
  workspace: { label: 'Hệ thống', badgeClass: 'bg-slate-50 text-slate-700 border-slate-200/60' },
};

const formatTimeAgo = (dateStr: string): string => {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins} phút trước`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} giờ trước`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} ngày trước`;
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

const sessionToken = () => {
  try { return JSON.parse(localStorage.getItem('ft_auth_session') || '{}')?.token || ''; }
  catch { return ''; }
};

export default function WorkspaceNotifications({ token: suppliedToken }: { token?: string | null }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [markingAll, setMarkingAll] = useState(false);
  const token = suppliedToken || sessionToken();

  const unreadCount = useMemo(() => items.filter(item => !item.read).length, [items]);
  const readCount = useMemo(() => items.filter(item => item.read).length, [items]);

  const visibleItems = useMemo(() => {
    return items.filter(item => {
      if (filter === 'unread') return !item.read;
      if (filter === 'read') return item.read;
      return true;
    });
  }, [filter, items]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = await response.json();
      const rawList: Notification[] = Array.isArray(data.notifications) ? data.notifications : [];
      const storedReads = getStoredReadIds();
      const storedContentKeys = getStoredReadContentKeys();

      // Deduplicate by ID and content signature (category + title + message)
      const seenIds = new Set<number>();
      const seenContent = new Set<string>();
      const deduped: Notification[] = [];

      for (const item of rawList) {
        if (!item || seenIds.has(item.id)) continue;
        seenIds.add(item.id);

        const contentSignature = `${item.category || ''}:${(item.title || '').trim()}:${(item.message || '').trim()}`;
        if (seenContent.has(contentSignature)) continue;
        seenContent.add(contentSignature);

        const isRead = Boolean(item.read || storedReads.has(item.id) || storedContentKeys.has(contentSignature));
        deduped.push({
          ...item,
          read: isRead,
        });
      }

      setItems(deduped);
    } catch {}
  }, [token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const handleSyncEvent = () => void load();

    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('ft:notifications_read', handleSyncEvent);
    window.addEventListener('storage', handleSyncEvent);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('ft:notifications_read', handleSyncEvent);
      window.removeEventListener('storage', handleSyncEvent);
    };
  }, [load]);

  const markAll = async () => {
    if (!token || unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    const allIds = items.map(item => item.id);
    const allContentKeys = items.map(item => `${item.category || ''}:${(item.title || '').trim()}:${(item.message || '').trim()}`);

    // 1. Instantly mark read locally & save to localStorage so reloads/navigation never revert
    addStoredReadRecords(allIds, allContentKeys);
    setItems(current => current.map(item => ({ ...item, read: true })));
    window.dispatchEvent(new CustomEvent('ft:notifications_read', { detail: { all: true } }));

    // 2. Persist to backend
    try {
      await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: allIds }),
      });
    } catch {} finally {
      setMarkingAll(false);
    }
  };

  const openItem = async (item: Notification) => {
    const contentKey = `${item.category || ''}:${(item.title || '').trim()}:${(item.message || '').trim()}`;
    // 1. Mark item as read immediately in storage and state
    addStoredReadRecords([item.id], [contentKey]);
    setItems(current => current.map(row => (row.id === item.id || (row.category === item.category && row.title === item.title && row.message === item.message)) ? { ...row, read: true } : row));
    window.dispatchEvent(new CustomEvent('ft:notifications_read', { detail: { id: item.id } }));

    // 2. Synchronize with backend
    if (!item.read && token) {
      try {
        await fetch(`/api/notifications/${item.id}/read`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }

    // 3. Navigate if actionUrl is present
    if (item.actionUrl) {
      setOpen(false);
      if (item.actionUrl.startsWith('/')) {
        window.location.assign(item.actionUrl);
      } else {
        window.open(item.actionUrl, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const getSeverityIcon = (severity: Notification['severity']) => {
    switch (severity) {
      case 'urgent':
        return <AlertCircle className="h-4 w-4 text-rose-600" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-amber-600" />;
      case 'success':
        return <Check className="h-4 w-4 text-emerald-600" />;
      default:
        return <Info className="h-4 w-4 text-blue-600" />;
    }
  };

  const getSeverityStyle = (severity: Notification['severity'], read: boolean) => {
    if (read) return 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/70 text-slate-700';
    switch (severity) {
      case 'urgent':
        return 'border-rose-200 bg-rose-50/60 hover:bg-rose-50 hover:border-rose-300 text-rose-950 shadow-2xs';
      case 'warning':
        return 'border-amber-200 bg-amber-50/50 hover:bg-amber-50 hover:border-amber-300 text-amber-950 shadow-2xs';
      case 'success':
        return 'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50 hover:border-emerald-300 text-emerald-950 shadow-2xs';
      default:
        return 'border-blue-200 bg-blue-50/40 hover:bg-blue-50 hover:border-blue-300 text-blue-950 shadow-2xs';
    }
  };

  const drawer = open && typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed inset-0 z-[1300] flex justify-end bg-slate-950/40 backdrop-blur-xs transition-opacity duration-200 animate-in fade-in"
      onMouseDown={() => setOpen(false)}
    >
      <aside
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl border-l border-slate-200 transition-transform duration-200 animate-in slide-in-from-right"
        onMouseDown={e => e.stopPropagation()}
        aria-label="Trung tâm thông báo"
      >
        {/* Drawer Header */}
        <header className="border-b border-slate-200/80 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 border border-blue-200/60">
                <Bell className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  Thông báo
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                      {unreadCount} mới
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  {unreadCount > 0 ? `Bạn có ${unreadCount} thông báo chưa đọc` : 'Bạn đã đọc tất cả thông báo'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer"
              aria-label="Đóng thông báo"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Filter Pills */}
          <div className="mt-4 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                filter === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-800'
              }`}
            >
              Tất cả ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                filter === 'unread'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-800'
              }`}
            >
              Chưa đọc
              {unreadCount > 0 && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  filter === 'unread' ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'
                }`}>
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setFilter('read')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                filter === 'read'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-800'
              }`}
            >
              Đã đọc ({readCount})
            </button>
          </div>

          {/* Mark All Read Button */}
          <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={unreadCount === 0 || markingAll}
              onClick={() => void markAll()}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <CheckCheck className="h-4 w-4" />
              {markingAll ? 'Đang cập nhật...' : 'Đánh dấu tất cả là đã đọc'}
            </button>
            <span className="text-[11px] text-slate-400 font-medium">
              Tự động lưu
            </span>
          </div>
        </header>

        {/* Drawer Notification Items */}
        <div className="flex-1 space-y-2.5 overflow-y-auto p-4 bg-slate-50/50">
          {visibleItems.length > 0 ? (
            visibleItems.map(item => {
              const cfg = categoryConfig[item.category] || { label: item.category, badgeClass: 'bg-slate-50 text-slate-600 border-slate-200/60' };
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openItem(item)}
                  className={`group relative w-full rounded-xl border p-3.5 text-left transition-all duration-150 cursor-pointer ${getSeverityStyle(item.severity, item.read)}`}
                >
                  {!item.read && (
                    <span className="absolute right-3 top-3.5 h-2 w-2 rounded-full bg-blue-600 ring-4 ring-blue-100 animate-pulse" aria-label="Chưa đọc" />
                  )}
                  <div className="flex items-start gap-3 pr-4">
                    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white border border-slate-200/80 shadow-2xs group-hover:border-slate-300">
                      {getSeverityIcon(item.severity)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${cfg.badgeClass}`}>
                          {cfg.label}
                        </span>
                        <span className="text-[11px] text-slate-400 font-medium">
                          {formatTimeAgo(item.createdAt)}
                        </span>
                      </div>
                      <h3 className={`mt-1 text-xs font-bold leading-snug line-clamp-2 ${item.read ? 'text-slate-800' : 'text-slate-900'}`}>
                        {item.title}
                      </h3>
                      <p className={`mt-0.5 text-xs leading-relaxed line-clamp-3 ${item.read ? 'text-slate-500' : 'text-slate-700'}`}>
                        {item.message}
                      </p>
                      {item.actionUrl && (
                        <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 group-hover:text-blue-700 transition-colors">
                          <span>Xem chi tiết</span>
                          <ExternalLink className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white border border-slate-200/80 shadow-2xs text-slate-400 mb-3">
                {filter === 'unread' ? <Sparkles className="h-6 w-6 text-blue-500" /> : <Inbox className="h-6 w-6" />}
              </div>
              <h4 className="text-sm font-bold text-slate-800">
                {filter === 'unread' ? 'Không có thông báo chưa đọc' : filter === 'read' ? 'Chưa có thông báo đã đọc' : 'Không có thông báo'}
              </h4>
              <p className="mt-1 text-xs text-slate-500 max-w-[220px]">
                {filter === 'unread' ? 'Tuyệt vời! Bạn đã cập nhật hết mọi tin tức và nhiệm vụ mới.' : 'Mọi thông báo quan trọng sẽ hiển thị tại đây.'}
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200/80 bg-white text-slate-600 shadow-2xs transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
        aria-label={`Thông báo${unreadCount ? `, ${unreadCount} chưa đọc` : ''}`}
        title="Thông báo hệ thống"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white shadow-xs">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {drawer}
    </>
  );
}

