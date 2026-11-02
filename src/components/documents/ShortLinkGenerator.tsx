import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Dices,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  MousePointerClick,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { appDialog } from '../AppDialog';
import ModuleShellHeader from '../layout/ModuleShellHeader';
import { COMMUNICATION_TOOLS_NAV } from '../../config/workspaceNavigation';
import { slugify } from '../../lib/searchText';

export type ShortLinkItem = {
  id: number;
  code: string;
  shortPath: string;
  shortUrl: string;
  targetUrl: string;
  title: string;
  note: string;
  isCustom: boolean;
  isActive: boolean;
  isExpired: boolean;
  clicks: number;
  lastClickedAt: string | null;
  expiresAt: string | null;
  createdByEmail: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

type SummaryStats = {
  totalLinks: number;
  activeLinks: number;
  totalClicks: number;
};

type Props = {
  idToken: string;
  userEmail: string;
  userRole?: string;
  onNavSelect: (id: string) => void;
};

const RANDOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function localRandomCode(length = 6): string {
  const bytes = new Uint8Array(length);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => RANDOM_ALPHABET[b % RANDOM_ALPHABET.length]).join('');
  }
  return Array.from({ length }, () => RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)]).join('');
}

function formatDateTimeVN(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function ShortLinkGenerator({
  idToken,
  userEmail,
  userRole,
  onNavSelect,
}: Props) {
  const [links, setLinks] = useState<ShortLinkItem[]>([]);
  const [summary, setSummary] = useState<SummaryStats>({ totalLinks: 0, activeLinks: 0, totalClicks: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Form states
  const [targetUrl, setTargetUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'custom' | 'random'>('custom');
  const [customCode, setCustomCode] = useState('');
  const [randomLength, setRandomLength] = useState<number>(6);
  const [previewRandomCode, setPreviewRandomCode] = useState<string>(() => localRandomCode(6));
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Code availability check
  const [codeCheck, setCodeCheck] = useState<{
    status: 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
    message: string;
  }>({ status: 'idle', message: '' });

  // Newly created / selected link for highlight & QR modal
  const [createdLink, setCreatedLink] = useState<ShortLinkItem | null>(null);
  const [qrModalLink, setQrModalLink] = useState<ShortLinkItem | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  // Edit modal state
  const [editingLink, setEditingLink] = useState<ShortLinkItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTargetUrl, setEditTargetUrl] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Filter & search
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const originPrefix = useMemo(() => {
    if (typeof window === 'undefined') return 'https://workspace.fermat.vn/s/';
    return `${window.location.origin}/s/`;
  }, []);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (scope === 'mine') params.set('scope', 'mine');
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      const res = await fetch(`/api/documents/short-links?${params.toString()}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Không thể tải danh sách liên kết rút gọn.');
      setLinks(Array.isArray(payload.links) ? payload.links : []);
      if (payload.summary) {
        setSummary(payload.summary);
      }
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách liên kết rút gọn.');
    } finally {
      setLoading(false);
    }
  }, [idToken, scope, searchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLinks();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadLinks]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Real-time check for custom code
  useEffect(() => {
    if (mode !== 'custom') {
      setCodeCheck({ status: 'idle', message: '' });
      return;
    }
    const trimmed = customCode.trim();
    if (!trimmed) {
      setCodeCheck({ status: 'idle', message: 'Để trống hoặc chuyển sang Ngẫu nhiên nếu muốn hệ thống tự sinh mã.' });
      return;
    }
    if (trimmed.length < 2) {
      setCodeCheck({ status: 'invalid', message: 'Tên rút gọn cần tối thiểu 2 ký tự.' });
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,78}[A-Za-z0-9]$/.test(trimmed)) {
      setCodeCheck({
        status: 'invalid',
        message: 'Chỉ dùng chữ không dấu, số, gạch ngang (-), gạch dưới (_) hoặc chấm (.).',
      });
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCodeCheck({ status: 'checking', message: 'Đang kiểm tra tên rút gọn...' });
      try {
        const res = await fetch(`/api/documents/short-links/check-code?code=${encodeURIComponent(trimmed)}`, {
          headers: { Authorization: `Bearer ${idToken}` },
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (data.available) {
          setCodeCheck({ status: 'available', message: `Có thể sử dụng: /s/${data.code || trimmed}` });
        } else {
          setCodeCheck({ status: 'taken', message: data.error || 'Tên này đã được sử dụng.' });
        }
      } catch {
        if (!controller.signal.aborted) {
          setCodeCheck({ status: 'idle', message: '' });
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [customCode, idToken, mode]);

  // Roll a fresh random code from server or client fallback
  const rollRandomCode = async (len = randomLength) => {
    const fallback = localRandomCode(len);
    setPreviewRandomCode(fallback);
    try {
      const res = await fetch('/api/documents/short-links/random-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ length: len }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.code) setPreviewRandomCode(data.code);
      }
    } catch {
      /* keep local random code */
    }
  };

  const handleSuggestSlugFromTitle = () => {
    const source = title.trim() || targetUrl.trim();
    if (!source) {
      setNotice('Hãy nhập Tiêu đề gợi nhớ trước để tự tạo slug.');
      return;
    }
    const slug = slugify(source, 45);
    if (slug) {
      setMode('custom');
      setCustomCode(slug);
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!targetUrl.trim()) {
      setError('Vui lòng nhập đường dẫn gốc cần rút gọn.');
      return;
    }
    const effectiveMode = mode === 'custom' && customCode.trim() ? 'custom' : 'random';
    const codeToSend = effectiveMode === 'custom' ? customCode.trim() : previewRandomCode.trim();

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/documents/short-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          targetUrl: targetUrl.trim(),
          title: title.trim(),
          note: note.trim(),
          mode: 'custom', // send exact chosen or previewed code so user gets what they see
          customCode: codeToSend,
          randomLength,
          expiresAt: expiresAt || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        // If random preview collided, fallback to server random
        if (effectiveMode === 'random' && res.status === 409) {
          const retryRes = await fetch('/api/documents/short-links', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              targetUrl: targetUrl.trim(),
              title: title.trim(),
              note: note.trim(),
              mode: 'random',
              randomLength,
              expiresAt: expiresAt || null,
            }),
          });
          const retryPayload = await retryRes.json().catch(() => ({}));
          if (!retryRes.ok) throw new Error(retryPayload.error || 'Không thể tạo liên kết rút gọn.');
          setCreatedLink(retryPayload);
          setNotice('Đã tạo liên kết rút gọn thành công!');
        } else {
          throw new Error(payload.error || 'Không thể tạo liên kết rút gọn.');
        }
      } else {
        setCreatedLink(payload);
        setNotice('Đã tạo liên kết rút gọn thành công!');
      }

      setTargetUrl('');
      setTitle('');
      setNote('');
      setCustomCode('');
      setExpiresAt('');
      void rollRandomCode(randomLength);
      await loadLinks();
    } catch (err: any) {
      setError(err.message || 'Không thể tạo liên kết rút gọn.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyText = async (text: string, key: string, label = 'Đã sao chép liên kết rút gọn.') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      setNotice(label);
      window.setTimeout(() => {
        setCopiedId(prev => (prev === key ? null : prev));
      }, 1800);
    } catch {
      setNotice('Trình duyệt chặn sao chép tự động, vui lòng bôi đen để chép.');
    }
  };

  const toggleActive = async (item: ShortLinkItem) => {
    try {
      const res = await fetch(`/api/documents/short-links/${item.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Không thể cập nhật trạng thái.');
      setLinks(prev => prev.map(row => (row.id === item.id ? payload : row)));
      setNotice(payload.isActive ? `Đã bật lại /s/${payload.code}` : `Đã tạm khóa /s/${payload.code}`);
    } catch (err: any) {
      setError(err.message || 'Không thể cập nhật trạng thái.');
    }
  };

  const handleDelete = async (item: ShortLinkItem) => {
    const confirmed = await appDialog.confirm(
      `Bạn có chắc muốn xóa vĩnh viễn liên kết rút gọn "/s/${item.code}"? Người dùng truy cập đường dẫn này sẽ không còn chuyển hướng được nữa.`,
      {
        title: 'Xóa liên kết rút gọn',
        confirmText: 'Xóa liên kết',
        cancelText: 'Hủy',
        tone: 'danger',
      }
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/documents/short-links/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Không thể xóa liên kết.');
      setLinks(prev => prev.filter(row => row.id !== item.id));
      if (createdLink?.id === item.id) setCreatedLink(null);
      setNotice(`Đã xóa liên kết /s/${item.code}`);
    } catch (err: any) {
      setError(err.message || 'Không thể xóa liên kết.');
    }
  };

  const openEditModal = (item: ShortLinkItem) => {
    setEditingLink(item);
    setEditTitle(item.title);
    setEditTargetUrl(item.targetUrl);
    setEditCode(item.code);
    setEditNote(item.note);
    setEditExpiresAt(item.expiresAt ? item.expiresAt.slice(0, 10) : '');
  };

  const handleSaveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingLink) return;
    setSavingEdit(true);
    setError('');
    try {
      const res = await fetch(`/api/documents/short-links/${editingLink.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          title: editTitle.trim(),
          targetUrl: editTargetUrl.trim(),
          customCode: editCode.trim(),
          note: editNote.trim(),
          expiresAt: editExpiresAt || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Không thể lưu chỉnh sửa.');
      setLinks(prev => prev.map(row => (row.id === editingLink.id ? payload : row)));
      if (createdLink?.id === editingLink.id) setCreatedLink(payload);
      setEditingLink(null);
      setNotice('Đã cập nhật liên kết rút gọn.');
    } catch (err: any) {
      setError(err.message || 'Không thể lưu chỉnh sửa.');
    } finally {
      setSavingEdit(false);
    }
  };

  // Render QR code when qrModalLink changes
  useEffect(() => {
    if (!qrModalLink) {
      setQrDataUrl('');
      return;
    }
    const fullUrl = `${originPrefix}${qrModalLink.code}`;
    QRCode.toDataURL(fullUrl, {
      width: 640,
      margin: 3,
      errorCorrectionLevel: 'H',
      color: { dark: '#0F1F33', light: '#FFFFFF' },
    })
      .then(url => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [originPrefix, qrModalLink]);

  const canModify = (item: ShortLinkItem) => {
    const role = (userRole || '').toUpperCase();
    if (role === 'ADMIN' || role === 'MANAGER') return true;
    return Boolean(userEmail && item.createdByEmail && item.createdByEmail.toLowerCase() === userEmail.toLowerCase());
  };

  const activeCodePreview = mode === 'custom'
    ? (customCode.trim() || previewRandomCode)
    : previewRandomCode;

  return (
    <div className="ft-module-shell flex min-h-dvh flex-col bg-slate-50 font-sans text-slate-900">
      <ModuleShellHeader
        eyebrow="Bộ công cụ FermatTech"
        title="Rút gọn liên kết"
        items={COMMUNICATION_TOOLS_NAV}
        activeId="short-link"
        onSelect={onNavSelect}
        ariaLabel="Điều hướng bộ công cụ FermatTech"
        actions={(
          <button
            type="button"
            onClick={() => void loadLinks()}
            disabled={loading}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Làm mới</span>
          </button>
        )}
      />

      <main className="min-w-0 flex-1">
        <div className="ft-module-content mx-auto max-w-7xl p-5 md:p-7 space-y-6">
          {/* Status / Toast Banner */}
          {notice && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 shadow-2xs"
            >
              <div className="flex items-center gap-2.5">
                <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{notice}</span>
              </div>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                aria-label="Đóng thông báo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"
            >
              <div className="flex items-start gap-2.5">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setError('')}
                className="rounded-lg p-1 text-rose-700 hover:bg-rose-100 cursor-pointer"
                aria-label="Đóng cảnh báo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Top Stats Strip */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tổng số liên kết</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">{summary.totalLinks}</p>
              </div>
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <Link2 className="h-5 w-5" />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Đang hoạt động</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-emerald-600">{summary.activeLinks}</p>
              </div>
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                <Sparkles className="h-5 w-5" />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tổng lượt truy cập</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-indigo-600">{summary.totalClicks}</p>
              </div>
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                <MousePointerClick className="h-5 w-5" />
              </div>
            </div>
          </div>

          {/* Main Grid: Creator Form + Live Preview / History */}
          <div className="grid items-start gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
            {/* Left Column: Create Short Link Card */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-white shadow-xs">
                  <Link2 className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">Tạo link rút gọn mới</h2>
                  <p className="text-xs text-slate-500">Đặt tên tùy chỉnh theo chiến dịch hoặc sinh mã ngẫu nhiên</p>
                </div>
              </div>

              <form onSubmit={e => void handleCreate(e)} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="shortlink-target-url" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                    Đường dẫn gốc (URL đích) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="shortlink-target-url"
                    type="text"
                    required
                    value={targetUrl}
                    onChange={e => setTargetUrl(e.target.value)}
                    placeholder="https://docs.google.com/forms/d/e/..."
                    className="ft-input w-full"
                  />
                </div>

                <div>
                  <label htmlFor="shortlink-title" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                    Tiêu đề gợi nhớ
                  </label>
                  <input
                    id="shortlink-title"
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="VD: Đăng ký thi FIMO Vòng Quốc gia 2026"
                    className="ft-input w-full"
                  />
                </div>

                {/* Mode Switcher: Custom Name vs Random Link */}
                <div>
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                    Kiểu tạo đường dẫn rút gọn
                  </span>
                  <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setMode('custom')}
                      className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                        mode === 'custom'
                          ? 'bg-white text-blue-700 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      <span>Tùy chỉnh tên</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('random');
                        void rollRandomCode(randomLength);
                      }}
                      className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                        mode === 'random'
                          ? 'bg-white text-blue-700 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Dices className="h-3.5 w-3.5" />
                      <span>Ngẫu nhiên (Random)</span>
                    </button>
                  </div>
                </div>

                {mode === 'custom' ? (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label htmlFor="shortlink-custom-code" className="text-xs font-bold uppercase tracking-wide text-slate-600">
                        Tên đường dẫn tùy chỉnh
                      </label>
                      <button
                        type="button"
                        onClick={handleSuggestSlugFromTitle}
                        className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                        title="Tự tạo tên không dấu từ tiêu đề"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Gợi ý từ tiêu đề</span>
                      </button>
                    </div>
                    <div className="flex items-stretch rounded-xl border border-slate-200 bg-slate-50 focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/20">
                      <span className="flex items-center pl-3 pr-1 text-xs font-mono font-semibold text-slate-400 select-none">
                        /s/
                      </span>
                      <input
                        id="shortlink-custom-code"
                        type="text"
                        value={customCode}
                        onChange={e => setCustomCode(e.target.value.replace(/\s+/g, '-'))}
                        placeholder="dang-ky-fimo-2026"
                        className="w-full rounded-r-xl bg-transparent py-2.5 pr-3 text-sm font-mono font-semibold text-slate-900 focus:outline-none"
                      />
                    </div>
                    {codeCheck.message && (
                      <p
                        className={`mt-1.5 text-xs font-semibold ${
                          codeCheck.status === 'available'
                            ? 'text-emerald-600'
                            : codeCheck.status === 'taken' || codeCheck.status === 'invalid'
                            ? 'text-rose-600'
                            : 'text-slate-500'
                        }`}
                      >
                        {codeCheck.message}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-600">Độ dài mã ngẫu nhiên</span>
                      <div className="flex items-center gap-1.5">
                        {[5, 6, 8, 10].map(len => (
                          <button
                            key={len}
                            type="button"
                            onClick={() => {
                              setRandomLength(len);
                              void rollRandomCode(len);
                            }}
                            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer ${
                              randomLength === len
                                ? 'bg-blue-600 text-white'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {len} ký tự
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="min-w-0">
                        <span className="text-[11px] font-semibold text-slate-400">Mã ngẫu nhiên dự kiến:</span>
                        <p className="truncate font-mono text-sm font-extrabold text-blue-700">
                          /s/{previewRandomCode}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void rollRandomCode(randomLength)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
                        title="Đổi mã ngẫu nhiên khác"
                      >
                        <Dices className="h-3.5 w-3.5 text-blue-600" />
                        <span>Đổi mã</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="shortlink-expires" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                      Ngày hết hạn (Tùy chọn)
                    </label>
                    <input
                      id="shortlink-expires"
                      type="date"
                      value={expiresAt}
                      onChange={e => setExpiresAt(e.target.value)}
                      className="ft-input w-full"
                    />
                  </div>
                  <div>
                    <label htmlFor="shortlink-note" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                      Ghi chú nội bộ
                    </label>
                    <input
                      id="shortlink-note"
                      type="text"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="VD: Gửi nhóm Zalo trường..."
                      className="ft-input w-full"
                    />
                  </div>
                </div>

                {/* Live URL Preview Box */}
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
                    Xem trước liên kết rút gọn
                  </p>
                  <p className="mt-1 break-all font-mono text-xs font-bold text-slate-800">
                    {originPrefix}
                    <span className="text-blue-600 underline">{activeCodePreview}</span>
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={
                    submitting
                    || !targetUrl.trim()
                    || (mode === 'custom' && customCode.trim() !== '' && (codeCheck.status === 'taken' || codeCheck.status === 'invalid'))
                  }
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  <span>{submitting ? 'Đang tạo liên kết...' : 'Tạo link rút gọn'}</span>
                </button>
              </form>

              {/* Newly Created Link Highlight Box */}
              {createdLink && (
                <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/90 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-800">
                      Link vừa tạo sẵn sàng
                    </span>
                    <span className="rounded-full bg-emerald-200/80 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                      {createdLink.isCustom ? 'Tùy chỉnh' : 'Ngẫu nhiên'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2">
                    <a
                      href={`${originPrefix}${createdLink.code}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-mono text-sm font-extrabold text-emerald-900 hover:underline"
                    >
                      {originPrefix}{createdLink.code}
                    </a>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void copyText(`${originPrefix}${createdLink.code}`, `created-${createdLink.id}`)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                      >
                        {copiedId === `created-${createdLink.id}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        <span>{copiedId === `created-${createdLink.id}` ? 'Đã chép' : 'Sao chép'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setQrModalLink(createdLink)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                        title="Tải mã QR cho link rút gọn này"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        <span>QR</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Right Column: Managed Links List */}
            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">Danh sách liên kết rút gọn</h2>
                  <p className="text-xs text-slate-500">
                    Quản lý, theo dõi số lượt nhấp (clicks), lấy mã QR hoặc đổi đường dẫn đích bất kỳ lúc nào.
                  </p>
                </div>

                {/* Scope Filter: All vs Mine */}
                <div className="inline-flex rounded-xl bg-slate-100 p-1 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                      scope === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tất cả
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope('mine')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                      scope === 'mine' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Của tôi
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo mã rút gọn, tiêu đề, đường dẫn gốc hoặc người tạo..."
                  className="ft-input w-full pl-10"
                />
              </div>

              {/* List Content */}
              {loading ? (
                <div className="py-16 text-center text-sm font-semibold text-slate-500 flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                  <span>Đang tải danh sách liên kết...</span>
                </div>
              ) : links.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-14 px-4 text-center">
                  <Link2 className="mx-auto h-10 w-10 text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-700">Chưa có liên kết rút gọn nào</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Hãy nhập đường dẫn bên trái để tạo link rút gọn tùy chỉnh tên hoặc ngẫu nhiên đầu tiên.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {links.map(item => {
                    const fullShortUrl = `${originPrefix}${item.code}`;
                    const editable = canModify(item);
                    const statusBadge = !item.isActive
                      ? { label: 'Tạm khóa', cls: 'bg-slate-100 text-slate-600' }
                      : item.isExpired
                      ? { label: 'Hết hạn', cls: 'bg-rose-50 text-rose-700' }
                      : { label: 'Hoạt động', cls: 'bg-emerald-50 text-emerald-700' };

                    return (
                      <div
                        key={item.id}
                        className="py-4 first:pt-0 last:pb-0 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/60 -mx-3 px-3 rounded-xl transition"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={fullShortUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-sm font-extrabold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                            >
                              <span>/s/{item.code}</span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>

                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusBadge.cls}`}>
                              {statusBadge.label}
                            </span>

                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                              {item.isCustom ? 'Tùy chỉnh' : 'Ngẫu nhiên'}
                            </span>

                            {item.title && (
                              <span className="text-sm font-bold text-slate-900 truncate max-w-md">
                                · {item.title}
                              </span>
                            )}
                          </div>

                          <p className="truncate text-xs text-slate-500" title={item.targetUrl}>
                            Đích: <a href={item.targetUrl} target="_blank" rel="noreferrer" className="hover:underline text-slate-600">{item.targetUrl}</a>
                          </p>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                            <span>Tạo bởi: <strong className="font-semibold text-slate-600">{item.createdByName || 'Thành viên'}</strong></span>
                            <span>Ngày tạo: {formatDateTimeVN(item.createdAt)}</span>
                            {item.expiresAt && (
                              <span className={item.isExpired ? 'text-rose-600 font-semibold' : ''}>
                                Hết hạn: {formatDateTimeVN(item.expiresAt)}
                              </span>
                            )}
                            {item.note && (
                              <span className="italic text-slate-500">Ghi chú: {item.note}</span>
                            )}
                          </div>
                        </div>

                        {/* Right Actions & Click Counter */}
                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <div
                            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700"
                            title={item.lastClickedAt ? `Truy cập gần nhất: ${formatDateTimeVN(item.lastClickedAt)}` : 'Chưa có lượt nhấp'}
                          >
                            <MousePointerClick className="h-3.5 w-3.5 text-indigo-600" />
                            <span className="tabular-nums">{item.clicks}</span>
                            <span className="hidden md:inline text-slate-400 font-normal">lượt</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => void copyText(fullShortUrl, `row-${item.id}`)}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-blue-700 transition cursor-pointer"
                            title="Sao chép liên kết rút gọn"
                          >
                            {copiedId === `row-${item.id}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            <span>{copiedId === `row-${item.id}` ? 'Đã chép' : 'Chép link'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setQrModalLink(item)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                            title="Mã QR của liên kết này"
                            aria-label="Mã QR"
                          >
                            <QrCode className="h-4 w-4" />
                          </button>

                          {editable && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(item)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                                title="Chỉnh sửa liên kết"
                                aria-label="Chỉnh sửa"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>

                              <button
                                type="button"
                                onClick={() => void toggleActive(item)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                                title={item.isActive ? 'Tạm khóa chuyển hướng' : 'Kích hoạt lại chuyển hướng'}
                                aria-label={item.isActive ? 'Tạm khóa' : 'Kích hoạt'}
                              >
                                {item.isActive ? <Eye className="h-4 w-4 text-emerald-600" /> : <EyeOff className="h-4 w-4 text-slate-400" />}
                              </button>

                              <button
                                type="button"
                                onClick={() => void handleDelete(item)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-rose-50/60 text-rose-600 hover:bg-rose-100 transition cursor-pointer"
                                title="Xóa liên kết"
                                aria-label="Xóa"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {/* QR Code Modal */}
      {qrModalLink && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 backdrop-blur-xs"
          onClick={() => setQrModalLink(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortlink-qr-title"
            className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Mã QR liên kết rút gọn</p>
                <h3 id="shortlink-qr-title" className="mt-0.5 text-lg font-extrabold text-slate-900">
                  {qrModalLink.title || `/s/${qrModalLink.code}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQrModalLink(null)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                aria-label="Đóng"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid place-items-center rounded-2xl border border-slate-200 bg-slate-50 p-5">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={`QR /s/${qrModalLink.code}`} className="h-56 w-56 rounded-xl bg-white p-2 shadow-xs" />
              ) : (
                <div className="h-56 w-56 grid place-items-center text-xs text-slate-400">Đang tạo QR...</div>
              )}
              <canvas ref={qrCanvasRef} className="hidden" />
            </div>

            <div className="rounded-xl bg-slate-100 px-3.5 py-2.5 text-center font-mono text-xs font-bold text-slate-800 break-all">
              {originPrefix}{qrModalLink.code}
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => void copyText(`${originPrefix}${qrModalLink.code}`, `qr-${qrModalLink.id}`)}
                className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Copy className="h-4 w-4" />
                <span>Sao chép link</span>
              </button>
              <button
                type="button"
                disabled={!qrDataUrl}
                onClick={() => {
                  if (!qrDataUrl) return;
                  const a = document.createElement('a');
                  a.href = qrDataUrl;
                  a.download = `qr-${slugify(qrModalLink.code, 40) || 'shortlink'}.png`;
                  a.click();
                }}
                className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                <Download className="h-4 w-4" />
                <span>Tải ảnh QR</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Link Modal */}
      {editingLink && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 backdrop-blur-xs"
          onClick={() => setEditingLink(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortlink-edit-title"
            className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Chỉnh sửa liên kết</p>
                <h3 id="shortlink-edit-title" className="mt-0.5 text-lg font-extrabold text-slate-900">
                  /s/{editingLink.code}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingLink(null)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                aria-label="Đóng"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={e => void handleSaveEdit(e)} className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                  Tên rút gọn (/s/...)
                </label>
                <input
                  type="text"
                  required
                  value={editCode}
                  onChange={e => setEditCode(e.target.value.replace(/\s+/g, '-'))}
                  className="ft-input w-full font-mono"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                  Đường dẫn gốc (URL đích)
                </label>
                <input
                  type="text"
                  required
                  value={editTargetUrl}
                  onChange={e => setEditTargetUrl(e.target.value)}
                  className="ft-input w-full"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                  Tiêu đề gợi nhớ
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="ft-input w-full"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                    Ngày hết hạn
                  </label>
                  <input
                    type="date"
                    value={editExpiresAt}
                    onChange={e => setEditExpiresAt(e.target.value)}
                    className="ft-input w-full"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                    Ghi chú
                  </label>
                  <input
                    type="text"
                    value={editNote}
                    onChange={e => setEditNote(e.target.value)}
                    className="ft-input w-full"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingLink(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {savingEdit && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Lưu thay đổi</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

