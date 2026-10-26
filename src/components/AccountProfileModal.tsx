import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Camera,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { appDialog } from './AppDialog';

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
  const [activeTab, setActiveTab] = useState<'profile' | 'ai'>('profile');

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
  const mcpUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp';

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
    <div className="ft-dialog-backdrop fixed inset-0 z-[100] overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto my-4 w-full max-w-4xl ft-dialog-panel bg-white p-6 sm:p-8 rounded-2xl shadow-2xl border border-slate-100">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-sky-700">Tài khoản Workspace</p>
            <h2 className="mt-1 text-2xl font-extrabold text-slate-900">Thiết lập tài khoản</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Quản lý hồ sơ cá nhân, bảo mật và kết nối Trợ lý AI (ChatGPT / MCP).
            </p>
          </div>
          <button
            type="button"
            aria-label="Đóng trang tài khoản"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="mt-6 flex border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`flex items-center gap-2 pb-3.5 px-4 text-sm font-bold border-b-2 transition ${
              activeTab === 'profile'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <UserRound className="h-4 w-4" />
            Hồ sơ & Mật khẩu
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ai')}
            className={`flex items-center gap-2 pb-3.5 px-4 text-sm font-bold border-b-2 transition ${
              activeTab === 'ai'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Bot className="h-4 w-4" />
            Trợ lý AI & MCP (ChatGPT)
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-sky-100 text-sky-800">
              26 Tools
            </span>
          </button>
        </div>

        {/* TAB 1: Profile & Password */}
        {activeTab === 'profile' && (
          <div className="mt-6 grid gap-8 lg:grid-cols-2">
            <form onSubmit={save} className="rounded-2xl border border-slate-200 p-5 bg-slate-50/50">
              <h3 className="font-extrabold text-slate-900">Hồ sơ cơ bản</h3>
              <div className="mt-5 flex items-center gap-4">
                <button
                  type="button"
                  aria-label="Đổi ảnh đại diện"
                  onClick={() => fileRef.current?.click()}
                  className="group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 text-sky-700"
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
                  <span className="absolute inset-x-0 bottom-0 flex h-7 items-center justify-center bg-slate-950/60 text-white opacity-0 transition group-hover:opacity-100">
                    <Camera className="h-4 w-4" />
                  </span>
                </button>
                <p className="text-xs leading-5 text-slate-500">
                  Nhấn ảnh để thay đổi. Dùng JPG, PNG, GIF hoặc WebP, tối đa 5 MB.
                </p>
              </div>

              <label className="mt-5 block">
                <span className="mb-1.5 block text-sm font-bold text-slate-700">Tên hiển thị</span>
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  required
                  maxLength={255}
                  className="ft-input w-full"
                  placeholder="Nhập tên hiển thị"
                />
              </label>

              <label className="mt-4 block">
                <span className="mb-1.5 block text-sm font-bold text-slate-700">Email đăng nhập</span>
                <input value={user.email} disabled className="ft-input w-full bg-slate-100 text-slate-500" />
                <span className="mt-1 block text-xs text-slate-400">
                  Email đăng nhập do quản trị viên quản lý.
                </span>
              </label>

              {notice && (
                <p
                  className={`mt-4 rounded-lg border px-3 py-2 text-sm font-semibold ${
                    notice.startsWith('Đã')
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  }`}
                >
                  {notice}
                </p>
              )}

              <button
                disabled={busy || !name.trim()}
                className="ft-primary mt-5 inline-flex items-center gap-2 disabled:opacity-60"
              >
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Lưu thông tin
              </button>
            </form>

            <form onSubmit={changePassword} className="rounded-2xl border border-slate-200 p-5 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-sky-700" />
                <h3 className="font-extrabold text-slate-900">Đổi mật khẩu</h3>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Sau khi đổi, các phiên đã lưu trên thiết bị khác sẽ bị đăng xuất.
              </p>

              <label className="mt-5 block">
                <span className="mb-1.5 block text-sm font-bold text-slate-700">Mật khẩu hiện tại</span>
                <input
                  value={currentPassword}
                  onChange={event => setCurrentPassword(event.target.value)}
                  type={passwordType}
                  autoComplete="current-password"
                  required
                  className="ft-input w-full"
                />
              </label>

              <label className="mt-4 block">
                <span className="mb-1.5 block text-sm font-bold text-slate-700">Mật khẩu mới</span>
                <input
                  value={newPassword}
                  onChange={event => setNewPassword(event.target.value)}
                  type={passwordType}
                  autoComplete="new-password"
                  required
                  className="ft-input w-full"
                />
                <span className="mt-1 block text-xs text-slate-400">
                  Tối thiểu 8 ký tự; không dùng mật khẩu phổ biến hoặc quá dễ đoán.
                </span>
              </label>

              <label className="mt-4 block">
                <span className="mb-1.5 block text-sm font-bold text-slate-700">Xác nhận mật khẩu mới</span>
                <input
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  type={passwordType}
                  autoComplete="new-password"
                  required
                  className="ft-input w-full"
                />
              </label>

              <button
                type="button"
                onClick={() => setShowPasswords(value => !value)}
                className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-sky-700 hover:text-sky-900"
              >
                {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showPasswords ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              </button>

              {passwordNotice && (
                <p
                  className={`mt-4 rounded-lg border px-3 py-2 text-sm font-semibold ${
                    passwordNotice.startsWith('Đổi')
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  }`}
                >
                  {passwordNotice}
                </p>
              )}

              <button
                disabled={busy || !currentPassword || !newPassword || !confirmPassword}
                className="ft-primary mt-5 inline-flex items-center gap-2 disabled:opacity-60"
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
            <div className="rounded-2xl border border-sky-200 bg-sky-50/50 p-5">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-sky-600 text-white shadow-sm shrink-0">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="font-extrabold text-slate-900 text-base">
                    Kết nối FTWorkspace với ChatGPT Web Actions
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                    Bạn có thể tạo Custom GPT trên ChatGPT bản Web và gắn hệ thống FTWorkspace vào làm công cụ (Actions).
                    Hệ thống sẽ chỉ cho phép AI thực thi các nghiệp vụ nằm trong quyền hạn tài khoản của bạn (RBAC),
                    bảo vệ tuyệt đối số liệu tài chính và tự động ghi nhật ký kiểm toán.
                  </p>
                </div>
              </div>

              {/* Native MCP remote endpoint for Cursor, Claude and other MCP clients. */}
              <div className="mt-4 pt-4 border-t border-sky-100">
                <div className="text-xs font-bold text-slate-700 mb-1.5">
                  URL MCP Streamable HTTP (cho Cursor, Claude và MCP client):
                </div>
                <div className="flex gap-2 items-center">
                  <input type="text" readOnly value={mcpUrl}
                    className="ft-input w-full bg-white font-mono text-xs text-slate-700" />
                  <button type="button"
                    onClick={() => navigator.clipboard?.writeText(mcpUrl)}
                    className="ft-primary whitespace-nowrap text-xs px-4 py-2.5">
                    Sao chép MCP URL
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Sử dụng HTTP Bearer với mã ft_ai_... ở bên dưới. ChatGPT GPT Actions sử dụng
                  OpenAPI riêng; kết nối MCP native trong ChatGPT có thể cần OAuth.
                </p>
              </div>

              {/* OpenAPI URL bar */}
              <div className="mt-4 pt-4 border-t border-sky-100">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1.5">
                  <span>URL Lược đồ OpenAPI 3.1 (Dán vào mục Actions của GPTs):</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={openApiUrl}
                    className="ft-input w-full bg-white font-mono text-xs text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={handleCopyOpenApi}
                    className="ft-primary inline-flex items-center gap-1.5 text-xs whitespace-nowrap shrink-0 py-2.5 px-4"
                  >
                    {copiedOpenApi ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                    {copiedOpenApi ? 'Đã sao chép' : 'Sao chép URL'}
                  </button>
                </div>

                {/* Auth Choice explanation */}
                <div className="mt-3.5 grid gap-2 sm:grid-cols-2 text-xs text-slate-600">
                  <div className="rounded-xl bg-white p-3 border border-sky-100">
                    <span className="font-bold text-slate-800 block mb-1">
                      Cách 1: Đăng nhập tài khoản (Basic Auth)
                    </span>
                    Trong cấu hình Action trên ChatGPT, chọn <strong>Authentication: Basic</strong>, nhập Email và Mật khẩu đăng nhập hệ thống của bạn.
                  </div>
                  <div className="rounded-xl bg-white p-3 border border-sky-100">
                    <span className="font-bold text-slate-800 block mb-1">
                      Cách 2: Dùng Mã kết nối AI (API Key)
                    </span>
                    Tạo mã kết nối AI Access Key bên dưới, trong ChatGPT chọn <strong>Authentication: API Key (Bearer)</strong> và dán mã vào.
                  </div>
                </div>
              </div>
            </div>

            {/* AI Key Management Box */}
            <div className="rounded-2xl border border-slate-200 p-5 bg-white">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  <h3 className="font-extrabold text-slate-900">Mã kết nối AI Access Key</h3>
                </div>
                <button
                  type="button"
                  onClick={loadAiKeys}
                  disabled={loadingKeys}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-700 hover:text-sky-900"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingKeys ? 'animate-spin' : ''}`} />
                  Làm mới
                </button>
              </div>

              {/* Form create new key */}
              <form onSubmit={createAiKey} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  placeholder="Tên trợ lý (vd: ChatGPT Web, Claude Desktop...)"
                  maxLength={100}
                  required
                  className="ft-input flex-1 text-sm"
                />
                <button
                  type="submit"
                  disabled={creatingKey || !newKeyName.trim()}
                  className="ft-primary inline-flex items-center justify-center gap-2 whitespace-nowrap text-xs font-bold py-2.5 px-4 disabled:opacity-60"
                >
                  {creatingKey ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Tạo mã kết nối mới
                </button>
              </form>

              {/* Notice Banner */}
              {aiNotice && (
                <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {aiNotice}
                </p>
              )}

              {/* Newly Created Key Alert Box */}
              {newlyCreatedKey && (
                <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                    <Check className="h-4 w-4 text-emerald-600" />
                    Mã kết nối AI mới đã được tạo thành công!
                  </div>
                  <p className="mt-1 text-[11px] text-emerald-700">
                    Vui lòng sao chép và lưu mã ngay bây giờ. Vì lý do an toàn, mã sẽ <strong>không được hiển thị lại</strong> sau khi bạn đóng bảng này.
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={newlyCreatedKey}
                      className="ft-input w-full bg-white font-mono text-xs font-bold text-slate-800 select-all border-emerald-300"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopySecretKey(newlyCreatedKey)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-bold transition shrink-0"
                    >
                      {copiedKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copiedKey ? 'Đã sao chép' : 'Sao chép'}
                    </button>
                  </div>
                </div>
              )}

              {/* Keys Table */}
              <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Tên gợi nhớ</th>
                      <th className="py-2.5 px-3">Tiền tố mã</th>
                      <th className="py-2.5 px-3">Ngày tạo</th>
                      <th className="py-2.5 px-3">Sử dụng gần nhất</th>
                      <th className="py-2.5 px-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingKeys ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          <LoaderCircle className="h-5 w-5 animate-spin mx-auto text-sky-600 mb-1" />
                          Đang tải danh sách mã kết nối...
                        </td>
                      </tr>
                    ) : aiKeys.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-400">
                          Chưa có mã kết nối AI nào được tạo. Bạn có thể dùng trực tiếp tài khoản hoặc tạo mã mới ở trên.
                        </td>
                      </tr>
                    ) : (
                      aiKeys.map(k => (
                        <tr key={k.id} className="hover:bg-slate-50 transition">
                          <td className="py-2.5 px-3 font-bold text-slate-800">{k.name}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-600">{k.key_prefix}</td>
                          <td className="py-2.5 px-3 text-slate-500">
                            {new Date(k.created_at).toLocaleDateString('vi-VN')}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500">
                            {k.last_used_at
                              ? new Date(k.last_used_at).toLocaleString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  day: '2-digit',
                                  month: '2-digit',
                                })
                              : 'Chưa dùng'}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => revokeAiKey(k.id)}
                              className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-800 font-bold hover:bg-rose-50 px-2 py-1 rounded transition"
                              title="Thu hồi mã này"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
          </div>
        )}
      </div>
    </div>
  );
}