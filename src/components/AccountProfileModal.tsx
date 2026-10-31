import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Camera,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X
} from 'lucide-react';
import { appDialog } from './AppDialog';
import McpConnectGuide from './McpConnectGuide';
import ZaloSettingsTab from './zalo/ZaloSettingsTab';

type AccountUser = { email: string; displayName: string; photoURL?: string | null };

type AIKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at?: string | null;
  is_active: boolean;
};

type Props = {
  open: boolean;
  user: AccountUser;
  idToken: string | null;
  onClose: () => void;
  onSaved: (user: AccountUser) => void;
  onTokenChanged: (token: string, user: AccountUser) => void;
};

export default function AccountProfileModal({
  open,
  user,
  idToken,
  onClose,
  onSaved,
  onTokenChanged,
}: Props) {
  const [activeTab, setActiveTab] = useState<'profile' | 'ai' | 'zalo'>('profile');

  // Profile states
  const [name, setName] = useState(user.displayName || '');
  const [photoURL, setPhotoURL] = useState(user.photoURL || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // Password states
  const [passwordNotice, setPasswordNotice] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // AI & MCP states
  const [aiKeys, setAiKeys] = useState<AIKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [newKeyName, setNewKeyName] = useState('ChatGPT Web');
  const [creatingKey, setCreatingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedOpenApi, setCopiedOpenApi] = useState(false);
  const [aiNotice, setAiNotice] = useState('');

  const openApiUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp/openapi.json` : '/api/mcp/openapi.json';
  const mcpUrl = typeof window !== 'undefined' ? `${window.location.origin}/mcp` : '/mcp';

  useEffect(() => {
    if (open && activeTab === 'ai' && idToken) {
      loadAiKeys();
    }
  }, [open, activeTab, idToken]);

  if (!open) return null;

  const loadAiKeys = async () => {
    if (!idToken) return;
    setLoadingKeys(true);
    setAiNotice('');
    try {
      const response = await fetch('/api/mcp/keys', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setAiKeys(data.keys || []);
      } else {
        setAiNotice(data.error || 'Không thể tải danh sách mã kết nối AI.');
      }
    } catch (err: any) {
      setAiNotice(err.message || 'Lỗi kết nối khi tải mã AI.');
    } finally {
      setLoadingKeys(false);
    }
  };

  const createAiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || !newKeyName.trim()) return;
    setCreatingKey(true);
    setAiNotice('');
    try {
      const response = await fetch('/api/mcp/keys/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success && data.key) {
        setNewlyCreatedKey(data.key.raw_key);
        setNewKeyName('ChatGPT Web');
        await loadAiKeys();
      } else {
        setAiNotice(data.error || 'Không thể tạo mã kết nối AI.');
      }
    } catch (err: any) {
      setAiNotice(err.message || 'Lỗi tạo mã kết nối AI.');
    } finally {
      setCreatingKey(false);
    }
  };

  const revokeAiKey = async (keyId: string) => {
    if (!idToken) return;
    const confirmed = await appDialog.confirm(
      'Bạn có chắc chắn muốn thu hồi mã kết nối AI này? Trợ lý AI đang dùng mã này sẽ không thể truy cập được nữa.',
      {
        title: 'Thu hồi mã kết nối AI',
        confirmText: 'Thu hồi mã',
        tone: 'danger',
      }
    );
    if (!confirmed) return;
    setAiNotice('');
    try {
      const response = await fetch(`/api/mcp/keys/${keyId}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setAiKeys(prev => prev.filter(k => k.id !== keyId));
        if (newlyCreatedKey) setNewlyCreatedKey(null);
      } else {
        setAiNotice(data.error || 'Không thể thu hồi mã kết nối.');
      }
    } catch (err: any) {
      setAiNotice(err.message || 'Lỗi kết nối khi thu hồi mã.');
    }
  };

  const handleCopyOpenApi = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(openApiUrl);
      setCopiedOpenApi(true);
      setTimeout(() => setCopiedOpenApi(false), 2000);
    }
  };

  const handleCopySecretKey = (secret: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(secret);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const upload = async (file?: File) => {
    if (!file || !idToken) return;
    if (!file.type.startsWith('image/')) {
      setNotice('Vui lòng chọn tệp ảnh.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setNotice('Ảnh tối đa 5 MB.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ filename: file.name, base64 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể tải ảnh lên.');
      setPhotoURL(data.url || '');
    } catch (error: any) {
      setNotice(error.message || 'Không thể tải ảnh lên.');
    } finally {
      setBusy(false);
    }
  };

  const toUser = (data: any): AccountUser => ({
    email: data.email || user.email,
    displayName: data.displayName || data.name || name.trim() || user.displayName,
    photoURL: data.photoURL || data.picture || photoURL,
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!idToken || !name.trim()) return;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ displayName: name.trim(), photoURL }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể lưu hồ sơ.');
      onSaved(toUser(data));
      setNotice('Đã lưu thông tin tài khoản.');
    } catch (error: any) {
      setNotice(error.message || 'Không thể lưu hồ sơ.');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!idToken) return;
    if (newPassword !== confirmPassword) {
      setPasswordNotice('Xác nhận mật khẩu mới chưa khớp.');
      return;
    }
    setBusy(true);
    setPasswordNotice('');
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể đổi mật khẩu.');
      const nextToken = String(data.token || '');
      if (!nextToken) throw new Error('Máy chủ không trả về phiên đăng nhập mới.');
      const nextUser = toUser(data.user || {});
      onTokenChanged(nextToken, nextUser);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordNotice('Đổi mật khẩu thành công. Các phiên đăng nhập cũ đã được đăng xuất.');
    } catch (error: any) {
      setPasswordNotice(error.message || 'Không thể đổi mật khẩu.');
    } finally {
      setBusy(false);
    }
  };

  const passwordType = showPasswords ? 'text' : 'password';

  return (
    <div className="ft-dialog-backdrop fixed inset-0 z-[100] overflow-y-auto p-3 sm:p-6 md:p-8">
      <div
        className="mx-auto my-2 sm:my-4 w-full max-w-4xl ft-dialog-panel rounded-2xl shadow-2xl border border-[var(--ft-border)] bg-[var(--ft-card-bg)] p-4 sm:p-6 md:p-8 text-[var(--ft-text-main)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">Tài khoản Workspace</p>
            <h2 id="account-modal-title" className="mt-1 text-xl sm:text-2xl font-extrabold text-[var(--ft-text-main)]">
              Thiết lập tài khoản
            </h2>
            <p className="mt-1 text-[13px] sm:text-sm text-[var(--ft-text-sub)] leading-relaxed">
              Quản lý hồ sơ cá nhân, bảo mật và kết nối Trợ lý AI (ChatGPT / MCP).
            </p>
          </div>
          <button
            type="button"
            aria-label="Đóng trang tài khoản"
            onClick={onClose}
            className="rounded-xl p-2.5 text-[var(--ft-text-sub)] hover:bg-[var(--ft-surface-2)] hover:text-[var(--ft-text-main)] transition min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          role="tablist"
          aria-label="Phân mục tài khoản"
          className="mt-5 flex flex-col sm:flex-row gap-2 border-b border-[var(--ft-border)] pb-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'profile'}
            onClick={() => setActiveTab('profile')}
            className={`flex items-center justify-between sm:justify-center gap-2.5 px-4 min-h-[44px] rounded-xl text-[13px] sm:text-sm font-bold transition cursor-pointer ${
              activeTab === 'profile'
                ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 shadow-2xs'
                : 'text-[var(--ft-text-sub)] hover:text-[var(--ft-text-main)] hover:bg-[var(--ft-surface-2)] border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <UserRound className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
              <span>
                <span className="sm:hidden">Hồ sơ</span>
                <span className="hidden sm:inline">Hồ sơ & Mật khẩu</span>
              </span>
            </div>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ai'}
            onClick={() => setActiveTab('ai')}
            className={`flex items-center justify-between sm:justify-center gap-2.5 px-4 min-h-[44px] rounded-xl text-[13px] sm:text-sm font-bold transition cursor-pointer ${
              activeTab === 'ai'
                ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 shadow-2xs'
                : 'text-[var(--ft-text-sub)] hover:text-[var(--ft-text-main)] hover:bg-[var(--ft-surface-2)] border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Bot className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
              <span>
                <span className="sm:hidden">Trợ lý AI</span>
                <span className="hidden sm:inline">Trợ lý AI & MCP (ChatGPT)</span>
              </span>
            </div>
            <span className="shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-extrabold bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200 border border-sky-200 dark:border-sky-700/50">
              26 Tools
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'zalo'}
            onClick={() => setActiveTab('zalo')}
            className={`flex items-center justify-between sm:justify-center gap-2.5 px-4 min-h-[44px] rounded-xl text-[13px] sm:text-sm font-bold transition cursor-pointer ${
              activeTab === 'zalo'
                ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 shadow-2xs'
                : 'text-[var(--ft-text-sub)] hover:text-[var(--ft-text-main)] hover:bg-[var(--ft-surface-2)] border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <MessageSquare className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
              <span>
                <span className="sm:hidden">Zalo Bot</span>
                <span className="hidden sm:inline">Bot Zalo Cá Nhân</span>
              </span>
            </div>
          </button>
        </div>

        {/* TAB 1: Profile & Password */}
        {activeTab === 'profile' && (
          <div className="mt-6 grid gap-6 lg:gap-8 lg:grid-cols-2">
            <form onSubmit={save} className="rounded-2xl border border-[var(--ft-border)] p-4 sm:p-5 bg-[var(--ft-surface-2)]/50 dark:bg-[var(--ft-surface-2)]/30 flex flex-col justify-between">
              <div>
                <h3 className="font-extrabold text-[var(--ft-text-main)] text-base">Hồ sơ cơ bản</h3>
                <div className="mt-4 flex items-center gap-4">
                  <button
                    type="button"
                    aria-label="Đổi ảnh đại diện"
                    onClick={() => fileRef.current?.click()}
                    className="group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 cursor-pointer shadow-2xs"
                  >
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      onChange={event => upload(event.target.files?.[0])}
                    />
                    {photoURL ? (
                      <img src={photoURL} alt={name} className="h-full w-full object-cover" />
                    ) : (
                      <UserRound className="h-8 w-8" />
                    )}
                    <span className="absolute inset-x-0 bottom-0 flex h-7 items-center justify-center bg-slate-950/70 text-white opacity-0 transition group-hover:opacity-100">
                      <Camera className="h-4 w-4" />
                    </span>
                  </button>
                  <p className="text-[12px] leading-relaxed text-[var(--ft-text-sub)]">
                    Nhấn ảnh để thay đổi. Dùng JPG, PNG, GIF hoặc WebP, tối đa 5 MB.
                  </p>
                </div>

                <label className="mt-5 block">
                  <span className="mb-1.5 block text-[13px] sm:text-sm font-bold text-[var(--ft-text-main)]">Tên hiển thị</span>
                  <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    required
                    maxLength={255}
                    className="ft-input w-full min-h-[44px] px-3.5 text-[13px] sm:text-sm bg-[var(--ft-card-bg)] text-[var(--ft-text-main)] border border-[var(--ft-border)] rounded-xl"
                    placeholder="Nhập tên hiển thị"
                  />
                </label>

                <label className="mt-4 block">
                  <span className="mb-1.5 block text-[13px] sm:text-sm font-bold text-[var(--ft-text-main)]">Email đăng nhập</span>
                  <input
                    value={user.email}
                    disabled
                    className="ft-input w-full min-h-[44px] px-3.5 text-[13px] sm:text-sm bg-[var(--ft-surface-3)]/60 text-[var(--ft-text-sub)] border border-[var(--ft-border)] rounded-xl cursor-not-allowed"
                  />
                  <span className="mt-1.5 block text-[12px] text-[var(--ft-text-sub)]">
                    Email đăng nhập do quản trị viên quản lý.
                  </span>
                </label>

                {notice && (
                  <p
                    className={`mt-4 rounded-xl border px-3.5 py-2.5 text-[12px] font-semibold ${
                      notice.startsWith('Đã')
                        ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                        : 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300'
                    }`}
                  >
                    {notice}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="ft-primary mt-6 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl font-bold text-[13px] sm:text-sm disabled:opacity-60 cursor-pointer w-full sm:w-auto"
              >
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Lưu thông tin
              </button>
            </form>

            <form onSubmit={changePassword} className="rounded-2xl border border-[var(--ft-border)] p-4 sm:p-5 bg-[var(--ft-surface-2)]/50 dark:bg-[var(--ft-surface-2)]/30 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                  <h3 className="font-extrabold text-[var(--ft-text-main)] text-base">Đổi mật khẩu</h3>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--ft-text-sub)]">
                  Sau khi đổi, các phiên đã lưu trên thiết bị khác sẽ bị đăng xuất.
                </p>

                <label className="mt-4 block">
                  <span className="mb-1.5 block text-[13px] sm:text-sm font-bold text-[var(--ft-text-main)]">Mật khẩu hiện tại</span>
                  <input
                    value={currentPassword}
                    onChange={event => setCurrentPassword(event.target.value)}
                    type={passwordType}
                    autoComplete="current-password"
                    required
                    className="ft-input w-full min-h-[44px] px-3.5 text-[13px] sm:text-sm bg-[var(--ft-card-bg)] text-[var(--ft-text-main)] border border-[var(--ft-border)] rounded-xl"
                  />
                </label>

                <label className="mt-4 block">
                  <span className="mb-1.5 block text-[13px] sm:text-sm font-bold text-[var(--ft-text-main)]">Mật khẩu mới</span>
                  <input
                    value={newPassword}
                    onChange={event => setNewPassword(event.target.value)}
                    type={passwordType}
                    autoComplete="new-password"
                    required
                    className="ft-input w-full min-h-[44px] px-3.5 text-[13px] sm:text-sm bg-[var(--ft-card-bg)] text-[var(--ft-text-main)] border border-[var(--ft-border)] rounded-xl"
                  />
                  <span className="mt-1.5 block text-[12px] text-[var(--ft-text-sub)]">
                    Tối thiểu 8 ký tự; không dùng mật khẩu phổ biến hoặc quá dễ đoán.
                  </span>
                </label>

                <label className="mt-4 block">
                  <span className="mb-1.5 block text-[13px] sm:text-sm font-bold text-[var(--ft-text-main)]">Xác nhận mật khẩu mới</span>
                  <input
                    value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)}
                    type={passwordType}
                    autoComplete="new-password"
                    required
                    className="ft-input w-full min-h-[44px] px-3.5 text-[13px] sm:text-sm bg-[var(--ft-card-bg)] text-[var(--ft-text-main)] border border-[var(--ft-border)] rounded-xl"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setShowPasswords(value => !value)}
                  className="mt-3 inline-flex items-center gap-2 text-[12px] font-bold text-sky-700 dark:text-sky-400 hover:text-sky-900 dark:hover:text-sky-300 min-h-[44px] py-2 cursor-pointer"
                >
                  {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showPasswords ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                </button>

                {passwordNotice && (
                  <p
                    className={`mt-4 rounded-xl border px-3.5 py-2.5 text-[12px] font-semibold ${
                      passwordNotice.startsWith('Đổi')
                        ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                        : 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300'
                    }`}
                  >
                    {passwordNotice}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={busy || !currentPassword || !newPassword || !confirmPassword}
                className="ft-primary mt-6 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl font-bold text-[13px] sm:text-sm disabled:opacity-60 cursor-pointer w-full sm:w-auto"
              >
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Đổi mật khẩu
              </button>
            </form>
          </div>
        )}

        {/* TAB 2: AI & MCP Plugin Integration */}
        {activeTab === 'ai' && (
          <div className="mt-6 space-y-6">
            {/* Guide Card */}
            <div className="rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/70 dark:bg-sky-950/30 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-sky-600 dark:bg-sky-500 text-white shadow-xs shrink-0">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-extrabold text-[var(--ft-text-main)] text-base">
                    Kết nối FTWorkspace với ChatGPT Web Actions
                  </h3>
                  <p className="mt-1 text-[13px] sm:text-sm text-[var(--ft-text-sub)] leading-relaxed">
                    Bạn có thể tạo Custom GPT trên ChatGPT bản Web và gắn hệ thống FTWorkspace vào làm công cụ (Actions).
                    Hệ thống sẽ chỉ cho phép AI thực thi các nghiệp vụ nằm trong quyền hạn tài khoản của bạn (RBAC),
                    bảo vệ tuyệt đối số liệu tài chính và tự động ghi nhật ký kiểm toán.
                  </p>
                </div>
              </div>

              {/* OpenAPI URL bar */}
              <div className="mt-4 pt-4 border-t border-sky-200/80 dark:border-sky-900/50">
                <label className="block text-[13px] font-bold text-[var(--ft-text-main)] mb-1.5">
                  URL Lược đồ OpenAPI 3.1 (Dán vào mục Actions của GPTs):
                </label>
                <div className="flex flex-col gap-2">
                  <div className="relative w-full">
                    <textarea
                      readOnly
                      rows={2}
                      value={openApiUrl}
                      aria-label="URL Lược đồ OpenAPI 3.1"
                      className="ft-input w-full bg-[var(--ft-card-bg)] font-mono text-[12px] sm:text-[13px] text-[var(--ft-text-main)] select-all resize-none py-2.5 px-3.5 leading-relaxed break-all rounded-xl border border-[var(--ft-border)] focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyOpenApi}
                    className="ft-primary inline-flex items-center justify-center gap-2 text-[13px] font-bold w-full min-h-[44px] px-4 rounded-xl shadow-xs transition cursor-pointer"
                  >
                    {copiedOpenApi ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                    {copiedOpenApi ? 'Đã sao chép URL' : 'Sao chép URL'}
                  </button>
                </div>

                {/* Auth Choice explanation: Cách 1 & Cách 2 */}
                <div className="mt-4 grid gap-3 sm:gap-4 sm:grid-cols-2">
                  <div className="rounded-xl bg-[var(--ft-card-bg)] p-4 border border-sky-200/80 dark:border-sky-900/60 shadow-2xs">
                    <span className="font-bold text-[var(--ft-text-main)] block mb-1.5 text-[13px] sm:text-sm">
                      Cách 1: Đăng nhập tài khoản (Basic Auth)
                    </span>
                    <p className="text-[12.5px] sm:text-[13px] text-[var(--ft-text-sub)] leading-relaxed">
                      Trong cấu hình Action trên ChatGPT, chọn <strong className="font-bold text-[var(--ft-text-main)]">Authentication: Basic</strong>, nhập Email và Mật khẩu đăng nhập hệ thống của bạn.
                    </p>
                  </div>
                  <div className="rounded-xl bg-[var(--ft-card-bg)] p-4 border border-sky-200/80 dark:border-sky-900/60 shadow-2xs">
                    <span className="font-bold text-[var(--ft-text-main)] block mb-1.5 text-[13px] sm:text-sm">
                      Cách 2: Dùng Mã kết nối AI (API Key)
                    </span>
                    <p className="text-[12.5px] sm:text-[13px] text-[var(--ft-text-sub)] leading-relaxed">
                      Tạo mã kết nối AI Access Key bên dưới, trong ChatGPT chọn <strong className="font-bold text-[var(--ft-text-main)]">Authentication: API Key (Bearer)</strong> và dán mã vào.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Key Management Box */}
            <div className="rounded-2xl border border-[var(--ft-border)] p-4 sm:p-5 bg-[var(--ft-card-bg)]">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h3 className="font-extrabold text-[var(--ft-text-main)] text-base truncate">
                    Mã kết nối AI Access Key
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={loadAiKeys}
                  disabled={loadingKeys}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-sky-700 dark:text-sky-400 hover:text-sky-900 dark:hover:text-sky-300 min-h-[44px] px-2.5 rounded-lg cursor-pointer shrink-0"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingKeys ? 'animate-spin' : ''}`} />
                  Làm mới
                </button>
              </div>

              {/* Form create new key */}
              <form onSubmit={createAiKey} className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  placeholder="Tên trợ lý (vd: ChatGPT Web, Claude Desktop...)"
                  maxLength={100}
                  required
                  className="ft-input flex-1 min-h-[44px] px-3.5 text-[13px] sm:text-sm bg-[var(--ft-card-bg)] text-[var(--ft-text-main)] border border-[var(--ft-border)] rounded-xl"
                />
                <button
                  type="submit"
                  disabled={creatingKey || !newKeyName.trim()}
                  className="ft-primary inline-flex items-center justify-center gap-2 whitespace-nowrap text-[13px] font-bold min-h-[44px] px-5 rounded-xl disabled:opacity-60 cursor-pointer w-full sm:w-auto"
                >
                  {creatingKey ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Tạo mã kết nối mới
                </button>
              </form>

              {/* Notice Banner */}
              {aiNotice && (
                <p className="mt-3 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-[12px] font-semibold text-rose-800 dark:text-rose-300">
                  {aiNotice}
                </p>
              )}

              {/* Newly Created Key Alert Box */}
              {newlyCreatedKey && (
                <div className="mt-4 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/40 p-4">
                  <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-300 font-bold text-[13px] sm:text-sm">
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    Mã kết nối AI mới đã được tạo thành công!
                  </div>
                  <p className="mt-1 text-[12px] text-emerald-800 dark:text-emerald-300 leading-relaxed">
                    Vui lòng sao chép và lưu mã ngay bây giờ. Vì lý do an toàn, mã sẽ <strong className="font-bold">không được hiển thị lại</strong> sau khi bạn đóng bảng này.
                  </p>
                  <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={newlyCreatedKey}
                      className="ft-input w-full bg-[var(--ft-card-bg)] font-mono text-[12px] font-bold text-[var(--ft-text-main)] select-all border-emerald-300 dark:border-emerald-700 min-h-[44px] px-3.5 rounded-xl"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopySecretKey(newlyCreatedKey)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 min-h-[44px] text-[12.5px] font-bold transition shrink-0 cursor-pointer w-full sm:w-auto"
                    >
                      {copiedKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copiedKey ? 'Đã sao chép' : 'Sao chép mã'}
                    </button>
                  </div>
                </div>
              )}

              {/* Keys Table */}
              <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--ft-border)]">
                <table className="w-full text-left min-w-[540px]">
                  <thead className="bg-[var(--ft-surface-2)] border-b border-[var(--ft-border)] text-[var(--ft-text-sub)] font-bold uppercase tracking-wider text-[12px]">
                    <tr>
                      <th className="py-3 px-3.5">Tên gợi nhớ</th>
                      <th className="py-3 px-3.5">Tiền tố mã</th>
                      <th className="py-3 px-3.5">Ngày tạo</th>
                      <th className="py-3 px-3.5">Sử dụng gần nhất</th>
                      <th className="py-3 px-3.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ft-border)]/60 text-[12.5px]">
                    {loadingKeys ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-[var(--ft-text-sub)]">
                          <LoaderCircle className="h-5 w-5 animate-spin mx-auto text-sky-600 dark:text-sky-400 mb-1.5" />
                          Đang tải danh sách mã kết nối...
                        </td>
                      </tr>
                    ) : aiKeys.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 px-4 text-center text-[12.5px] text-[var(--ft-text-sub)] leading-relaxed">
                          Chưa có mã kết nối AI nào được tạo. Bạn có thể dùng trực tiếp tài khoản hoặc tạo mã mới ở trên.
                        </td>
                      </tr>
                    ) : (
                      aiKeys.map(k => (
                        <tr key={k.id} className="hover:bg-[var(--ft-surface-2)]/60 transition">
                          <td className="py-3 px-3.5 font-bold text-[var(--ft-text-main)]">{k.name}</td>
                          <td className="py-3 px-3.5 font-mono text-[var(--ft-text-sub)]">{k.key_prefix}</td>
                          <td className="py-3 px-3.5 text-[var(--ft-text-sub)]">
                            {new Date(k.created_at).toLocaleDateString('vi-VN')}
                          </td>
                          <td className="py-3 px-3.5 text-[var(--ft-text-sub)]">
                            {k.last_used_at
                              ? new Date(k.last_used_at).toLocaleString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  day: '2-digit',
                                  month: '2-digit',
                                })
                              : 'Chưa dùng'}
                          </td>
                          <td className="py-3 px-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => revokeAiKey(k.id)}
                              className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 px-2.5 py-1.5 rounded-lg transition min-h-[44px] cursor-pointer text-[12px]"
                              title="Thu hồi mã này"
                            >
                              <Trash2 className="h-4 w-4" />
                              Thu hồi
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <McpConnectGuide mcpUrl={mcpUrl} apiKey={newlyCreatedKey} idToken={idToken} />
          </div>
        )}

        {/* TAB 3: Zalo Bot Integration */}
        {activeTab === 'zalo' && (
          <div className="mt-6">
            <ZaloSettingsTab idToken={idToken} />
          </div>
        )}
      </div>
    </div>
  );
}