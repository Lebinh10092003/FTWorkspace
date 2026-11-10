import React, { useState } from 'react';
import {
  Plus,
  Radio,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Edit3,
  Globe,
  MessageSquare,
  Mail,
  Share2,
  ShieldCheck,
  X,
  HelpCircle,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import type { PublishChannel, ChannelKind } from './publishingTypes';
import { CHANNEL_KIND_MAP } from './publishingTypes';
import { publishingService } from './publishingService';
import { appDialog } from '../AppDialog';

interface ChannelManagerProps {
  idToken: string;
  channels: PublishChannel[];
  onRefresh: () => void;
  userRole?: string;
}

export const ChannelManager: React.FC<ChannelManagerProps> = ({
  idToken,
  channels,
  onRefresh,
  userRole,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<PublishChannel | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; success: boolean; message: string } | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formKind, setFormKind] = useState<ChannelKind>('facebook_page');
  const [formIsShared, setFormIsShared] = useState(true);
  const [formIsActive, setFormIsActive] = useState(true);

  // Dynamic config fields
  const [cfgFbPageId, setCfgFbPageId] = useState('');
  const [cfgFbAccessToken, setCfgFbAccessToken] = useState('');
  const [cfgWebhookUrl, setCfgWebhookUrl] = useState('');
  const [cfgWebhookSecret, setCfgWebhookSecret] = useState('');
  const [cfgWpUrl, setCfgWpUrl] = React.useState('');
  const [cfgWpUsername, setCfgWpUsername] = React.useState('');
  const [cfgWpAppPassword, setCfgWpAppPassword] = React.useState('');
  const [cfgGroupUrl, setCfgGroupUrl] = React.useState('');
  const [cfgNote, setCfgNote] = React.useState('');

  // Email Newsletter fields
  const [cfgEmailMode, setCfgEmailMode] = React.useState<'smtp' | 'gmail_oauth'>('smtp');
  const [cfgEmailFromName, setCfgEmailFromName] = React.useState('');
  const [cfgEmailFromAddress, setCfgEmailFromAddress] = React.useState('');
  const [cfgEmailRecipients, setCfgEmailRecipients] = React.useState('');
  const [cfgEmailSmtpHost, setCfgEmailSmtpHost] = React.useState('smtp.gmail.com');
  const [cfgEmailSmtpPort, setCfgEmailSmtpPort] = React.useState('587');
  const [cfgEmailSmtpPassword, setCfgEmailSmtpPassword] = React.useState('');

  // Zalo QR Modal state
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrChannel, setQrChannel] = useState<PublishChannel | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrRefreshing, setQrRefreshing] = useState(false);
  const [qrData, setQrData] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState('');
  const [qrStatus, setQrStatus] = useState<'idle' | 'loading' | 'ready' | 'authenticated' | 'error'>('idle');

  const openZaloQrModal = async (channel: PublishChannel, refresh: boolean = false) => {
    setQrChannel(channel);
    setQrModalOpen(true);
    if (refresh) {
      setQrRefreshing(true);
    } else {
      setQrLoading(true);
      setQrData(null);
    }
    setQrStatus('loading');
    setQrMessage('Đang khởi tạo trình duyệt VPS và lấy mã QR Zalo...');

    try {
      const res = await publishingService.getZaloAutomationQr(idToken, channel.id, refresh);
      if (res.status === 'already_authenticated') {
        setQrStatus('authenticated');
        setQrMessage('Tài khoản Zalo đã được kết nối và xác thực trên VPS.');
      } else if (res.qr_data) {
        setQrData(res.qr_data);
        setQrStatus('ready');
        setQrMessage(res.message || 'Mở app Zalo trên điện thoại và quét mã QR này để đăng nhập.');
      } else {
        setQrStatus('error');
        setQrMessage(res.message || 'Không thể tạo mã QR lúc này. Vui lòng thử lại.');
      }
    } catch (err: any) {
      setQrStatus('error');
      setQrMessage(err?.message || 'Lỗi kết nối khi tải mã QR từ VPS.');
    } finally {
      setQrLoading(false);
      setQrRefreshing(false);
    }
  };

  React.useEffect(() => {
    if (!qrModalOpen || !qrChannel || qrStatus !== 'ready') return;

    const interval = setInterval(async () => {
      try {
        const res = await publishingService.getZaloAutomationStatus(idToken, qrChannel.id);
        if (res.is_authenticated) {
          setQrStatus('authenticated');
          setQrMessage('Đã liên kết tài khoản Zalo cá nhân thành công!');
          onRefresh();
          clearInterval(interval);
        }
      } catch {
        // Retry polling on next interval
      }
    }, 3500);

    return () => clearInterval(interval);
  }, [qrModalOpen, qrChannel, qrStatus, idToken, onRefresh]);

  const openAddModal = () => {
    setEditingChannel(null);
    setFormName('');
    setFormKind('facebook_page');
    setFormIsShared(true);
    setFormIsActive(true);
    setCfgFbPageId('');
    setCfgFbAccessToken('');
    setCfgWebhookUrl('');
    setCfgWebhookSecret('');
    setCfgWpUrl('');
    setCfgWpUsername('');
    setCfgWpAppPassword('');
    setCfgGroupUrl('');
    setCfgNote('');
    setCfgEmailMode('smtp');
    setCfgEmailFromName('');
    setCfgEmailFromAddress('');
    setCfgEmailRecipients('');
    setCfgEmailSmtpHost('smtp.gmail.com');
    setCfgEmailSmtpPort('587');
    setCfgEmailSmtpPassword('');
    setError('');
    setModalOpen(true);
  };

  const openEditModal = (c: PublishChannel) => {
    setEditingChannel(c);
    setFormName(c.name);
    setFormKind(c.kind);
    setFormIsShared(Boolean(c.is_shared ?? (c as any).isShared));
    setFormIsActive(Boolean(c.is_active ?? (c as any).isActive));

    const m = (c as any).config || c.masked_config || {};
    setCfgFbPageId(m.page_id || '');
    setCfgFbAccessToken(m.page_access_token || '');
    setCfgWebhookUrl(m.webhook_url || '');
    setCfgWebhookSecret(m.webhook_secret || '');
    setCfgWpUrl(m.site_url || '');
    setCfgWpUsername(m.username || '');
    setCfgWpAppPassword(m.app_password || '');
    setCfgGroupUrl(m.group_name || m.group_url || m.target_url || '');
    setCfgNote(m.note || '');
    setCfgEmailMode(m.mode === 'gmail_oauth' ? 'gmail_oauth' : 'smtp');
    setCfgEmailFromName(m.from_name || m.sender_name || '');
    setCfgEmailFromAddress(m.from_email || m.smtp_username || '');
    setCfgEmailRecipients(
      Array.isArray(m.recipients) ? m.recipients.join(', ') : (m.recipients || '')
    );
    setCfgEmailSmtpHost(m.smtp_host || 'smtp.gmail.com');
    setCfgEmailSmtpPort(String(m.smtp_port || 587));
    setCfgEmailSmtpPassword(m.smtp_password || m.app_password || '');
    setError('');
    setModalOpen(true);
  };

  const handleTestConnection = async (channelId: number) => {
    setTestingId(channelId);
    setTestResult(null);
    try {
      const res = await publishingService.testChannel(idToken, channelId);
      setTestResult({ id: channelId, success: res.success, message: res.message });
    } catch (err: any) {
      setTestResult({ id: channelId, success: false, message: err?.message || 'Kiểm tra thất bại.' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (channelId: number) => {
    const confirmed = await appDialog.confirm('Bạn có chắc chắn muốn xoá kênh này? Các bài đăng đã xuất bản sẽ không bị xoá khỏi nền tảng gốc.', {
      tone: 'danger',
      confirmText: 'Xoá kênh',
    });
    if (!confirmed) {
      return;
    }
    setDeletingId(channelId);
    try {
      await publishingService.deleteChannel(idToken, channelId);
      onRefresh();
    } catch (err: any) {
      await appDialog.alert(err?.message || 'Không thể xoá kênh.', { tone: 'danger' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setError('Vui lòng nhập tên kênh.');
      return;
    }

    setSaving(true);
    setError('');

    const config: Record<string, any> = {};
    if (formKind === 'facebook_page') {
      config.page_id = cfgFbPageId.trim();
      config.page_access_token = cfgFbAccessToken.trim();
      config.access_token = cfgFbAccessToken.trim();
    } else if (formKind === 'web_webhook') {
      config.webhook_url = cfgWebhookUrl.trim();
      config.webhook_secret = cfgWebhookSecret.trim();
    } else if (formKind === 'web_wordpress') {
      config.site_url = cfgWpUrl.trim();
      config.username = cfgWpUsername.trim();
      config.app_password = cfgWpAppPassword.trim();
    } else if (formKind === 'manual_facebook_group' || formKind === 'manual_zalo_group') {
      config.group_url = cfgGroupUrl.trim();
      config.note = cfgNote.trim();
    } else if (formKind === 'zalo_personal_group') {
      config.group_name = cfgGroupUrl.trim();
      config.note = cfgNote.trim();
    } else if (formKind === 'manual_other') {
      config.target_url = cfgGroupUrl.trim();
      config.note = cfgNote.trim();
    } else if (formKind === 'email_newsletter') {
      config.mode = cfgEmailMode;
      config.from_name = cfgEmailFromName.trim();
      config.from_email = cfgEmailFromAddress.trim();
      config.recipients = cfgEmailRecipients
        .split(/[,;\n]/)
        .map((e: string) => e.trim())
        .filter(Boolean);
      if (cfgEmailMode === 'smtp') {
        config.smtp_host = cfgEmailSmtpHost.trim();
        config.smtp_port = parseInt(cfgEmailSmtpPort, 10) || 587;
        config.smtp_username = cfgEmailFromAddress.trim();
        config.smtp_password = cfgEmailSmtpPassword.trim();
      }
    }

    try {
      if (editingChannel) {
        await publishingService.updateChannel(idToken, editingChannel.id, {
          name: formName.trim(),
          is_shared: formIsShared,
          is_active: formIsActive,
          config,
        });
      } else {
        await publishingService.createChannel(idToken, {
          name: formName.trim(),
          kind: formKind,
          is_shared: formIsShared,
          is_active: formIsActive,
          config,
        });
      }
      setModalOpen(false);
      onRefresh();
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu kênh xuất bản.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Radio className="w-5 h-5 text-[#0B72CE]" />
            Kênh xuất bản truyền thông
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Khai báo và liên kết các kênh truyền thông của đơn vị. Mật khẩu và Token được mã hoá lưu trữ an toàn (Fernet AES-128-CBC) và không bao giờ xuất hiện dạng thô ra bên ngoài.
          </p>
        </div>
        <button
          type="button"
          onClick={openAddModal}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#0B72CE] hover:bg-[#075CA8] text-white text-xs font-bold shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Khai báo kênh mới
        </button>
      </div>

      {/* Test feedback global alert if open */}
      {testResult && (
        <div
          className={`flex items-start justify-between gap-3 p-4 rounded-xl border text-xs font-medium ${
            testResult.success
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 text-rose-800 dark:text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{testResult.message}</span>
            {channels.find((c: PublishChannel) => c.id === testResult.id)?.kind === 'zalo_personal_group' && (
              <button
                type="button"
                onClick={() => {
                  const targetCh = channels.find((c: PublishChannel) => c.id === testResult.id);
                  if (targetCh) openZaloQrModal(targetCh);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shrink-0 cursor-pointer shadow-xs ml-2"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Quét mã QR ngay</span>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setTestResult(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Channel Cards Grid */}
      {channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center">
          <Globe className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
            Chưa có kênh xuất bản nào
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mb-4">
            Bấm "Khai báo kênh mới" ở góc trên để thêm Fanpage Facebook, Webhook website hoặc nhóm cộng đồng Zalo/Facebook.
          </p>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0B72CE] text-white text-xs font-bold hover:bg-[#075CA8] transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Khai báo kênh đầu tiên
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {channels.map(channel => {
            const kindInfo = CHANNEL_KIND_MAP[channel.kind] || {
              label: channel.kind,
              description: '',
              category: 'api',
              color: 'bg-slate-100 text-slate-700',
            };
            const isTesting = testingId === channel.id;
            const isDeleting = deletingId === channel.id;

            return (
              <div
                key={channel.id}
                className="flex flex-col justify-between bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-xs hover:border-slate-300 dark:hover:border-slate-600 transition"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${kindInfo.color}`}
                    >
                      {kindInfo.label}
                    </span>
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        ((channel as any).is_active ?? (channel as any).isActive)
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                      }`}
                    >
                      {((channel as any).is_active ?? (channel as any).isActive) ? 'Đang bật' : 'Đang tắt'}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                    {channel.name}
                  </h3>

                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    {kindInfo.description}
                  </p>

                  {/* Masked Config Summary */}
                  {(() => {
                    const cfg = (channel as any).config || channel.masked_config || {};
                    return (
                      <div className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-400 flex flex-col gap-1">
                        {channel.kind === 'facebook_page' && (
                          <>
                            <div>Page ID: {cfg.page_id || 'Chưa thiết lập'}</div>
                            <div>Token: {cfg.page_access_token || '••••••••'}</div>
                          </>
                        )}
                        {channel.kind === 'web_webhook' && (
                          <>
                            <div className="truncate">URL: {cfg.webhook_url || 'Chưa có'}</div>
                            <div>Secret: {cfg.webhook_secret ? '••••••••' : '(Không)'}</div>
                          </>
                        )}
                        {channel.kind === 'web_wordpress' && (
                          <>
                            <div className="truncate">Web: {cfg.site_url || 'Chưa có'}</div>
                            <div>User: {cfg.username || 'Chưa có'}</div>
                          </>
                        )}
                        {(channel.kind === 'manual_facebook_group' || channel.kind === 'manual_zalo_group' || channel.kind === 'manual_other' || channel.kind === 'zalo_personal_group') && (
                          <>
                            <div className="truncate">
                              {channel.kind === 'zalo_personal_group' ? 'Nhóm: ' : 'Link: '}
                              {cfg.group_name || cfg.group_url || cfg.target_url || '(Chưa có)'}
                            </div>
                            {cfg.note && <div className="truncate">Ghi chú: {cfg.note}</div>}
                          </>
                        )}
                        {channel.kind === 'email_newsletter' && (
                          <>
                            <div className="truncate">
                              Chế độ: {cfg.mode === 'gmail_oauth' ? 'Gmail OAuth' : `SMTP (${cfg.smtp_host || 'smtp.gmail.com'})`}
                            </div>
                            <div className="truncate">
                              Gửi từ: {cfg.from_name ? `${cfg.from_name} <${cfg.from_email || cfg.smtp_username || ''}>` : (cfg.from_email || cfg.smtp_username || 'Chưa đặt')}
                            </div>
                            {Array.isArray(cfg.recipients) && cfg.recipients.length > 0 && (
                              <div className="truncate text-slate-400">
                                {cfg.recipients.length} người nhận mặc định
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Card Actions */}
                <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleTestConnection(channel.id)}
                      disabled={isTesting}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B72CE] dark:text-blue-400 hover:underline cursor-pointer disabled:opacity-50"
                    >
                      {isTesting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Radio className="w-3.5 h-3.5" />
                      )}
                      <span>{isTesting ? 'Đang thử...' : 'Test kết nối'}</span>
                    </button>

                    {channel.kind === 'zalo_personal_group' && (
                      <button
                        type="button"
                        onClick={() => openZaloQrModal(channel)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                        title="Quét mã QR liên kết tài khoản Zalo cá nhân trên VPS"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>Quét mã QR</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditModal(channel)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                      title="Sửa cấu hình kênh"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(channel.id)}
                      disabled={isDeleting}
                      className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer disabled:opacity-50"
                      title="Xoá kênh"
                    >
                      {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Add / Edit */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Radio className="w-5 h-5 text-[#0B72CE]" />
                {editingChannel ? 'Chỉnh sửa kênh xuất bản' : 'Khai báo kênh xuất bản mới'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              {error && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Tên kênh */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tên kênh <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Fanpage Fermat Education, Nhóm Phụ huynh FIMO..."
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                />
              </div>

              {/* Loại kênh */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Loại kênh
                </label>
                <select
                  disabled={!!editingChannel}
                  value={formKind}
                  onChange={e => setFormKind(e.target.value as ChannelKind)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE] disabled:opacity-60"
                >
                  <option value="facebook_page">Facebook Fanpage (Meta Graph API)</option>
                  <option value="web_webhook">Website Webhook (Tự động nhận JSON)</option>
                  <option value="web_wordpress">Website WordPress (REST API)</option>
                  <option value="manual_facebook_group">Nhóm Facebook (Hỗ trợ đăng thủ công)</option>
                  <option value="manual_zalo_group">Nhóm Zalo (Hỗ trợ đăng thủ công)</option>
                  <option value="zalo_personal_group">Nhóm Zalo cá nhân (Tự động VPS)</option>
                  <option value="email_newsletter">Email Newsletter (Bản tin Email / Gmail)</option>
                  <option value="manual_other">Kênh khác (Thủ công)</option>
                </select>
                {editingChannel && (
                  <p className="text-[11px] text-slate-400 mt-1">Không thể thay đổi loại kênh sau khi tạo.</p>
                )}
              </div>

              {/* Dynamic inputs based on Kind */}
              {formKind === 'facebook_page' && (
                <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Facebook Page ID <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Ví dụ: 1029384756..."
                      value={cfgFbPageId}
                      onChange={e => setCfgFbPageId(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Page Access Token <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="password"
                      placeholder={editingChannel ? '••••••••' : 'Dán Page Access Token tại đây'}
                      value={cfgFbAccessToken}
                      onChange={e => setCfgFbAccessToken(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                      <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                      Token được mã hoá lưu trữ an toàn. Nếu không đổi token, bạn có thể để trống hoặc giữ nguyên giá trị đã che.
                    </p>
                  </div>
                </div>
              )}

              {formKind === 'web_webhook' && (
                <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Webhook Endpoint URL <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="url"
                      placeholder="https://example.com/api/webhooks/publish"
                      value={cfgWebhookUrl}
                      onChange={e => setCfgWebhookUrl(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Webhook Secret (HMAC-SHA256)
                    </label>
                    <input
                      type="password"
                      placeholder="Mã bí mật để xác thực webhook payload"
                      value={cfgWebhookSecret}
                      onChange={e => setCfgWebhookSecret(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                  </div>
                </div>
              )}

              {formKind === 'web_wordpress' && (
                <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      URL Trang WordPress <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="url"
                      placeholder="https://fermat.edu.vn"
                      value={cfgWpUrl}
                      onChange={e => setCfgWpUrl(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Tên đăng nhập
                      </label>
                      <input
                        type="text"
                        placeholder="admin"
                        value={cfgWpUsername}
                        onChange={e => setCfgWpUsername(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Mật khẩu ứng dụng (App Password)
                      </label>
                      <input
                        type="password"
                        placeholder="xxxx xxxx xxxx xxxx"
                        value={cfgWpAppPassword}
                        onChange={e => setCfgWpAppPassword(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {formKind === 'email_newsletter' && (
                <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900">
                  <div className="flex items-center gap-4 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <span>Phương thức gửi:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="email_mode"
                        value="smtp"
                        checked={cfgEmailMode === 'smtp'}
                        onChange={() => setCfgEmailMode('smtp')}
                        className="text-[#0B72CE]"
                      />
                      <span>Cấu hình SMTP / App Password</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="email_mode"
                        value="gmail_oauth"
                        checked={cfgEmailMode === 'gmail_oauth'}
                        onChange={() => setCfgEmailMode('gmail_oauth')}
                        className="text-[#0B72CE]"
                      />
                      <span>Tài khoản Gmail OAuth cá nhân</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Tên người gửi hiển thị (From Name)
                      </label>
                      <input
                        type="text"
                        placeholder="Ví dụ: FermatTech Newsletter"
                        value={cfgEmailFromName}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCfgEmailFromName(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Email người gửi (From Email / Tài khoản)
                      </label>
                      <input
                        type="email"
                        placeholder="newsletter@fermat.vn hoặc gmail của bạn"
                        value={cfgEmailFromAddress}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCfgEmailFromAddress(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                      />
                    </div>
                  </div>

                  {cfgEmailMode === 'smtp' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 border-t border-rose-200/60 dark:border-rose-900/40">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          SMTP Host
                        </label>
                        <input
                          type="text"
                          placeholder="smtp.gmail.com"
                          value={cfgEmailSmtpHost}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCfgEmailSmtpHost(e.target.value)}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          SMTP Port
                        </label>
                        <input
                          type="text"
                          placeholder="587 hoặc 465"
                          value={cfgEmailSmtpPort}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCfgEmailSmtpPort(e.target.value)}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Mật khẩu ứng dụng (App Password)
                        </label>
                        <input
                          type="password"
                          placeholder={editingChannel ? '•••••••• (giữ nguyên)' : 'Nhập mật khẩu SMTP'}
                          value={cfgEmailSmtpPassword}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCfgEmailSmtpPassword(e.target.value)}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                        />
                      </div>
                    </div>
                  )}

                  {cfgEmailMode === 'gmail_oauth' && (
                    <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-100/50 dark:bg-rose-950/40 p-2.5 rounded-lg">
                      Chế độ Gmail OAuth sẽ tự động tạo bản thảo (draft) hoặc gửi an toàn qua phiên kết nối Google đã đăng nhập trong mục <strong>Trợ lý Gmail</strong> của bạn.
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Danh sách email người nhận mặc định (cách nhau bởi dấu phẩy hoặc xuống dòng)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="customer1@gmail.com, partner@company.com"
                      value={cfgEmailRecipients}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCfgEmailRecipients(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                  </div>
                </div>
              )}

              {(formKind === 'manual_facebook_group' || formKind === 'manual_zalo_group' || formKind === 'manual_other' || formKind === 'zalo_personal_group') && (
                <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {formKind === 'zalo_personal_group' ? 'Tên nhóm Zalo chính xác (hoặc Link nhóm)' : 'Đường dẫn tới nhóm / kênh (URL)'}
                    </label>
                    <input
                      type={formKind === 'zalo_personal_group' ? 'text' : 'url'}
                      placeholder={formKind === 'zalo_personal_group' ? 'Ví dụ: Nội bộ Fermat' : 'https://facebook.com/groups/... hoặc https://zalo.me/g/...'}
                      value={cfgGroupUrl}
                      onChange={e => setCfgGroupUrl(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Ghi chú / Quy ước đăng
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Ví dụ: Đăng kèm ảnh bìa, nhớ tag admin nhóm..."
                      value={cfgNote}
                      onChange={e => setCfgNote(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                  </div>
                </div>
              )}

              {editingChannel && formKind === 'zalo_personal_group' && (
                <div className="p-3.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                      <QrCode className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      Kết nối phiên Zalo cá nhân (VPS)
                    </div>
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                      Quét mã QR bằng ứng dụng Zalo trên điện thoại để bot có quyền tự động gửi bài vào nhóm.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setModalOpen(false);
                      openZaloQrModal(editingChannel);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shrink-0 shadow-xs cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Quét mã QR</span>
                  </button>
                </div>
              )}

              {/* Tùy chọn quyền & trạng thái */}
              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={formIsShared}
                    onChange={e => setFormIsShared(e.target.checked)}
                    className="w-4 h-4 rounded text-[#0B72CE] focus:ring-0"
                  />
                  <span>Dùng chung cho toàn bộ đội ngũ</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={e => setFormIsActive(e.target.checked)}
                    className="w-4 h-4 rounded text-[#0B72CE] focus:ring-0"
                  />
                  <span>Kích hoạt kênh này</span>
                </label>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-700 mt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-[#0B72CE] hover:bg-[#075CA8] text-white shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingChannel ? 'Cập nhật kênh' : 'Lưu kênh mới'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Zalo QR Code Modal */}
      {qrModalOpen && qrChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col gap-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Quét mã QR đăng nhập Zalo
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Kênh: <span className="font-semibold text-slate-700 dark:text-slate-200">{qrChannel.name}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* QR Content Body */}
            <div className="flex flex-col items-center justify-center min-h-[260px] gap-4">
              {qrLoading ? (
                <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
                  <Loader2 className="w-10 h-10 text-[#0B72CE] animate-spin" />
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-300 max-w-xs">
                    Đang khởi tạo trình duyệt headless trên VPS và tải mã QR Zalo...
                  </p>
                  <span className="text-[11px] text-slate-400">(Có thể mất từ 3 đến 8 giây)</span>
                </div>
              ) : qrStatus === 'authenticated' ? (
                <div className="flex flex-col items-center justify-center py-6 text-center gap-3">
                  <div className="p-3 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-12 h-12" />
                  </div>
                  <h4 className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    Kết nối tài khoản Zalo thành công!
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 max-w-xs">
                    Phiên Zalo cá nhân đã được lưu an toàn trên máy chủ VPS. Hệ thống đã sẵn sàng tự động đăng bài vào nhóm Zalo.
                  </p>
                </div>
              ) : qrStatus === 'error' ? (
                <div className="flex flex-col items-center justify-center py-6 text-center gap-3">
                  <div className="p-3 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
                    <AlertCircle className="w-10 h-10" />
                  </div>
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 max-w-xs text-center">
                    {qrMessage}
                  </p>
                  <button
                    type="button"
                    onClick={() => openZaloQrModal(qrChannel, true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Thử lại</span>
                  </button>
                </div>
              ) : qrData ? (
                <div className="flex flex-col items-center gap-3 w-full">
                  <div className="p-2 rounded-2xl bg-white border border-slate-200 shadow-sm">
                    <img
                      src={qrData}
                      alt="Zalo Login QR Code"
                      className="w-56 h-56 object-contain rounded-xl"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 font-medium">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                    <span>Đang chờ bạn quét và xác nhận trên điện thoại...</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 w-full flex flex-col gap-1">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">Hướng dẫn quét mã:</div>
                    <ol className="list-decimal pl-4 space-y-0.5">
                      <li>Mở ứng dụng <strong>Zalo</strong> trên điện thoại.</li>
                      <li>Bấm vào biểu tượng <strong>Quét mã QR</strong> ở góc phải ô tìm kiếm.</li>
                      <li>Quét mã QR ở trên và bấm <strong>Đăng nhập</strong> xác nhận.</li>
                    </ol>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
              {qrStatus === 'ready' ? (
                <button
                  type="button"
                  onClick={() => openZaloQrModal(qrChannel, true)}
                  disabled={qrRefreshing}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${qrRefreshing ? 'animate-spin' : ''}`} />
                  <span>{qrRefreshing ? 'Đang tải lại...' : 'Làm mới mã QR'}</span>
                </button>
              ) : <div />}

              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                {qrStatus === 'authenticated' ? 'Hoàn tất' : 'Đóng'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
