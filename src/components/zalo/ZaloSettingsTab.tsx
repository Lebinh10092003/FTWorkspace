import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Check,
  Clock,
  Copy,
  LoaderCircle,
  MessageSquare,
  Send,
  ShieldCheck,
  Unlink,
} from 'lucide-react';
import { appDialog } from '../AppDialog';

type ZaloStatus = {
  linked: boolean;
  chat_id_masked?: string;
  linked_at?: string;
  is_enabled?: boolean;
  detail_level?: 'title' | 'summary';
  notify_schedule?: boolean;
  notify_gmail?: boolean;
  notify_weekly_report?: boolean;
  notify_workspace?: boolean;
  quiet_hours_enabled?: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
  daily_cap?: number;
  monthly_system_usage?: {
    sent: number;
    cap: number;
  };
};

type Props = {
  idToken: string | null;
};

export default function ZaloSettingsTab({ idToken }: Props) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<ZaloStatus | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Link code states
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Settings form states
  const [isEnabled, setIsEnabled] = useState(true);
  const [detailLevel, setDetailLevel] = useState<'title' | 'summary'>('title');
  const [notifySchedule, setNotifySchedule] = useState(true);
  const [notifyGmail, setNotifyGmail] = useState(true);
  const [notifyWeeklyReport, setNotifyWeeklyReport] = useState(true);
  const [notifyWorkspace, setNotifyWorkspace] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [quietHoursStart, setQuietHoursStart] = useState('22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('07:00');
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingSend, setTestingSend] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const pollTimerRef = useRef<number | null>(null);

  const authHeaders = {
    'Content-Type': 'application/json',
    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
  };

  const fetchStatus = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/zalo-bot/status/', { headers: authHeaders });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setStatus(data);
        if (data.linked) {
          setIsEnabled(data.is_enabled ?? true);
          setDetailLevel(data.detail_level || 'title');
          setNotifySchedule(data.notify_schedule ?? true);
          setNotifyGmail(data.notify_gmail ?? true);
          setNotifyWeeklyReport(data.notify_weekly_report ?? true);
          setNotifyWorkspace(data.notify_workspace ?? true);
          setQuietHoursEnabled(data.quiet_hours_enabled ?? true);
          setQuietHoursStart(data.quiet_hours_start || '22:00');
          setQuietHoursEnd(data.quiet_hours_end || '07:00');
          setLinkCode(null);
        }
      }
    } catch {
      if (!silent) setNotice({ type: 'error', text: 'Không thể kết nối máy chủ.' });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [idToken]);

  // Countdown timer for link code
  useEffect(() => {
    if (!codeExpiresAt) return;
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.floor((codeExpiresAt - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        setLinkCode(null);
        setCodeExpiresAt(null);
        window.clearInterval(interval);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [codeExpiresAt]);

  // Polling check for link success while waiting
  useEffect(() => {
    if (!linkCode || status?.linked) {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      return;
    }
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const res = await fetch('/api/zalo-bot/status/', { headers: authHeaders });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success && data.linked) {
          setStatus(data);
          setLinkCode(null);
          setNotice({ type: 'success', text: 'Liên kết Zalo thành công!' });
          if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
        }
      } catch {}
    }, 2000);
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, [linkCode, status?.linked]);

  const handleGenerateCode = async () => {
    setGeneratingCode(true);
    setNotice(null);
    try {
      const res = await fetch('/api/zalo-bot/link-code/', {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setLinkCode(data.code);
        setCodeExpiresAt(Date.now() + (data.expires_in_seconds || 600) * 1000);
        setCountdown(data.expires_in_seconds || 600);
      } else {
        setNotice({ type: 'error', text: data.error || 'Không thể tạo mã liên kết.' });
      }
    } catch {
      setNotice({ type: 'error', text: 'Lỗi mạng khi tạo mã liên kết.' });
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleCopyCode = async () => {
    if (!linkCode) return;
    try {
      await navigator.clipboard.writeText(linkCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {}
  };

  const handleSavePreferences = async () => {
    setSavingSettings(true);
    setNotice(null);
    try {
      const res = await fetch('/api/zalo-bot/preferences/', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          is_enabled: isEnabled,
          detail_level: detailLevel,
          notify_schedule: notifySchedule,
          notify_gmail: notifyGmail,
          notify_weekly_report: notifyWeeklyReport,
          notify_workspace: notifyWorkspace,
          quiet_hours_enabled: quietHoursEnabled,
          quiet_hours_start: quietHoursStart,
          quiet_hours_end: quietHoursEnd,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setNotice({ type: 'success', text: 'Đã lưu cài đặt thông báo Zalo.' });
        fetchStatus(true);
      } else {
        setNotice({ type: 'error', text: data.error || 'Không thể lưu cài đặt.' });
      }
    } catch {
      setNotice({ type: 'error', text: 'Lỗi mạng khi lưu cài đặt.' });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestSend = async () => {
    setTestingSend(true);
    setNotice(null);
    try {
      const res = await fetch('/api/zalo-bot/test-send/', {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setNotice({ type: 'success', text: 'Đã gửi tin nhắn thử nghiệm! Vui lòng kiểm tra Zalo.' });
      } else {
        setNotice({ type: 'error', text: data.error || 'Không thể gửi tin nhắn thử.' });
      }
    } catch {
      setNotice({ type: 'error', text: 'Lỗi mạng khi gửi tin thử.' });
    } finally {
      setTestingSend(false);
    }
  };

  const handleUnlink = async () => {
    const confirmed = await appDialog.confirm(
      'Bạn có chắc chắn muốn hủy liên kết tài khoản Zalo này? Bạn sẽ không còn nhận được các thông báo nhắc việc và email qua Zalo.',
      {
        title: 'Hủy liên kết Zalo',
        confirmText: 'Hủy liên kết',
        cancelText: 'Đóng',
        tone: 'danger',
      }
    );
    if (!confirmed) return;

    setUnlinking(true);
    setNotice(null);
    try {
      const res = await fetch('/api/zalo-bot/unlink/', {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setNotice({ type: 'success', text: 'Đã hủy liên kết Zalo.' });
        fetchStatus();
      } else {
        setNotice({ type: 'error', text: data.error || 'Không thể hủy liên kết.' });
      }
    } catch {
      setNotice({ type: 'error', text: 'Lỗi mạng khi hủy liên kết.' });
    } finally {
      setUnlinking(false);
    }
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-[var(--ft-text-sub)]">
        <LoaderCircle className="h-6 w-6 animate-spin text-sky-600" />
        <span className="text-sm">Đang tải cấu hình Zalo Bot...</span>
      </div>
    );
  }

  const isLinked = !!status?.linked;

  return (
    <div className="space-y-6">
      {notice && (
        <div
          className={`p-3.5 rounded-xl text-sm font-medium border flex items-center justify-between ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800'
          }`}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs underline ml-2 opacity-80 hover:opacity-100"
          >
            Đóng
          </button>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-950/40 dark:to-blue-950/30 border border-sky-100 dark:border-sky-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <MessageSquare className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-[var(--ft-text-main)]">Zalo Bot Cá Nhân</h3>
              {isLinked ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200">
                  <Check className="h-3 w-3" /> Đã kết nối
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                  Chưa kết nối
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-[var(--ft-text-sub)] mt-0.5">
              Nhận thông báo lịch công tác, email cần phản hồi và báo cáo riêng tư trực tiếp qua Zalo.
            </p>
          </div>
        </div>

        {isLinked && (
          <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
            <button
              type="button"
              onClick={handleTestSend}
              disabled={testingSend}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white transition flex items-center gap-1.5 shadow-2xs disabled:opacity-50"
            >
              {testingSend ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Gửi thử
            </button>
            <button
              type="button"
              onClick={handleUnlink}
              disabled={unlinking}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 transition flex items-center gap-1.5 disabled:opacity-50"
            >
              {unlinking ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
              Hủy kết nối
            </button>
          </div>
        )}
      </div>

      {/* NOT LINKED STATE: CONNECT WORKFLOW */}
      {!isLinked && (
        <div className="p-5 sm:p-6 rounded-2xl bg-[var(--ft-surface-1)] border border-[var(--ft-border)] space-y-5">
          <div className="max-w-xl">
            <h4 className="text-sm font-bold text-[var(--ft-text-main)] mb-1">Quy tắc riêng tư số 1:</h4>
            <p className="text-xs text-[var(--ft-text-sub)] leading-relaxed">
              Mỗi tài khoản Zalo chỉ nhận và thấy dữ liệu của đúng một người. Mã liên kết bên dưới có hiệu lực trong 10 phút và chỉ dùng được 1 lần.
            </p>
          </div>

          {!linkCode ? (
            <div className="pt-2">
              <button
                type="button"
                onClick={handleGenerateCode}
                disabled={generatingCode}
                className="px-4 py-2.5 rounded-xl text-sm font-bold bg-sky-600 hover:bg-sky-700 text-white transition flex items-center gap-2 shadow-2xs disabled:opacity-50 min-h-[44px]"
              >
                {generatingCode ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                Lấy mã liên kết Zalo (10 phút)
              </button>
            </div>
          ) : (
            <div className="p-4 sm:p-5 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-semibold text-sky-800 dark:text-sky-300 uppercase tracking-wider">
                    Mã liên kết một lần
                  </span>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-3xl font-extrabold tracking-widest text-sky-700 dark:text-sky-200 font-mono">
                      {linkCode}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/60 hover:bg-sky-200 text-sky-700 dark:text-sky-200 transition"
                      title="Sao chép mã"
                    >
                      {copiedCode ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800/50 self-start sm:self-center">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Hết hạn sau: {formatCountdown(countdown)}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-sky-100 dark:border-sky-800/40 space-y-2 text-xs sm:text-sm text-[var(--ft-text-sub)]">
                <p className="font-semibold text-[var(--ft-text-main)]">Các bước tiếp theo:</p>
                <ol className="list-decimal list-inside space-y-1 pl-1">
                  <li>Mở ứng dụng Zalo trên điện thoại hoặc máy tính.</li>
                  <li>Tìm kiếm bot <strong>Fermat Workspace</strong> hoặc mở hộp chat với bot.</li>
                  <li>Nhắn mã <strong>{linkCode}</strong> vào cuộc trò chuyện.</li>
                  <li>Hệ thống sẽ tự động xác nhận và kích hoạt ngay lập tức.</li>
                </ol>
              </div>

              <div className="flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300 pt-1">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                <span>Đang đợi tin nhắn từ Zalo của bạn...</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* LINKED STATE: PREFERENCES & SETTINGS */}
      {isLinked && (
        <div className="space-y-6">
          {/* Linked info snippet */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[var(--ft-surface-2)] text-xs text-[var(--ft-text-sub)] border border-[var(--ft-border)]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>Zalo Chat ID: <strong className="text-[var(--ft-text-main)]">{status?.chat_id_masked || 'Đã liên kết'}</strong></span>
            </div>
            {status?.monthly_system_usage && (
              <div>
                Hạn mức hệ thống tháng: <strong className="text-[var(--ft-text-main)]">{status.monthly_system_usage.sent} / {status.monthly_system_usage.cap}</strong> tin
              </div>
            )}
          </div>

          <div className="p-5 sm:p-6 rounded-2xl bg-[var(--ft-surface-1)] border border-[var(--ft-border)] space-y-6">
            <h4 className="text-sm font-bold text-[var(--ft-text-main)] flex items-center gap-2">
              <Bell className="h-4 w-4 text-sky-600" />
              Cài đặt thông báo Zalo cá nhân
            </h4>

            {/* Master toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-[var(--ft-surface-2)] border border-[var(--ft-border)]">
              <div>
                <span className="text-sm font-bold text-[var(--ft-text-main)]">Bật nhận thông báo Zalo</span>
                <p className="text-xs text-[var(--ft-text-sub)]">Tạm tắt khi bạn muốn nghỉ ngơi hoặc không muốn nhận tin</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-600"></div>
              </label>
            </div>

            {/* Detail Level */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--ft-text-main)] uppercase tracking-wider">
                Mức độ chi tiết nội dung tin nhắn
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                    detailLevel === 'title'
                      ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800'
                      : 'bg-[var(--ft-surface-2)] border-[var(--ft-border)] opacity-75'
                  }`}
                >
                  <input
                    type="radio"
                    name="detail_level"
                    value="title"
                    checked={detailLevel === 'title'}
                    onChange={() => setDetailLevel('title')}
                    className="mt-0.5 text-sky-600 focus:ring-sky-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-[var(--ft-text-main)] block">Chỉ tiêu đề + Liên kết (Mặc định)</span>
                    <span className="text-[11px] text-[var(--ft-text-sub)] leading-tight block mt-0.5">
                      Bảo mật cao nhất: Không lộ nội dung chi tiết trên màn hình khóa điện thoại.
                    </span>
                  </div>
                </label>

                <label
                  className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                    detailLevel === 'summary'
                      ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800'
                      : 'bg-[var(--ft-surface-2)] border-[var(--ft-border)] opacity-75'
                  }`}
                >
                  <input
                    type="radio"
                    name="detail_level"
                    value="summary"
                    checked={detailLevel === 'summary'}
                    onChange={() => setDetailLevel('summary')}
                    className="mt-0.5 text-sky-600 focus:ring-sky-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-[var(--ft-text-main)] block">Kèm tóm tắt nội dung ngắn</span>
                    <span className="text-[11px] text-[var(--ft-text-sub)] leading-tight block mt-0.5">
                      Gửi kèm vài dòng tóm tắt công việc hoặc email để tiện theo dõi nhanh.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Notification Categories */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[var(--ft-text-main)] uppercase tracking-wider">
                Các loại thông báo muốn nhận
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="flex items-center gap-3 p-3 rounded-xl bg-[var(--ft-surface-2)] border border-[var(--ft-border)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifySchedule}
                    onChange={(e) => setNotifySchedule(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500 h-4 w-4"
                  />
                  <div>
                    <span className="text-xs font-bold text-[var(--ft-text-main)] block">Lịch công tác</span>
                    <span className="text-[11px] text-[var(--ft-text-sub)]">Nhắc việc chưa xong, thay đổi lịch</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-xl bg-[var(--ft-surface-2)] border border-[var(--ft-border)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyGmail}
                    onChange={(e) => setNotifyGmail(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500 h-4 w-4"
                  />
                  <div>
                    <span className="text-xs font-bold text-[var(--ft-text-main)] block">Gmail cá nhân</span>
                    <span className="text-[11px] text-[var(--ft-text-sub)]">Thư mới cần phản hồi, bản tin sáng</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-xl bg-[var(--ft-surface-2)] border border-[var(--ft-border)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyWeeklyReport}
                    onChange={(e) => setNotifyWeeklyReport(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500 h-4 w-4"
                  />
                  <div>
                    <span className="text-xs font-bold text-[var(--ft-text-main)] block">Báo cáo tuần</span>
                    <span className="text-[11px] text-[var(--ft-text-sub)]">Nhắc nộp báo cáo, tổng kết tuần</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-xl bg-[var(--ft-surface-2)] border border-[var(--ft-border)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyWorkspace}
                    onChange={(e) => setNotifyWorkspace(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500 h-4 w-4"
                  />
                  <div>
                    <span className="text-xs font-bold text-[var(--ft-text-main)] block">Thông báo chung</span>
                    <span className="text-[11px] text-[var(--ft-text-sub)]">Thông báo nội bộ từ ban quản trị</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Quiet Hours */}
            <div className="space-y-3 p-4 rounded-xl bg-[var(--ft-surface-2)] border border-[var(--ft-border)]">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-[var(--ft-text-main)] block">Khung giờ yên lặng (Không làm phiền)</span>
                  <span className="text-[11px] text-[var(--ft-text-sub)]">Không gửi tin tự động trong khung giờ nghỉ ngơi</span>
                </div>
                <input
                  type="checkbox"
                  checked={quietHoursEnabled}
                  onChange={(e) => setQuietHoursEnabled(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500 h-4 w-4 cursor-pointer"
                />
              </div>

              {quietHoursEnabled && (
                <div className="flex flex-wrap items-center gap-3 pt-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--ft-text-sub)]">Từ:</span>
                    <input
                      type="time"
                      value={quietHoursStart}
                      onChange={(e) => setQuietHoursStart(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--ft-border)] bg-[var(--ft-surface-1)] text-[var(--ft-text-main)] font-mono text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--ft-text-sub)]">Đến:</span>
                    <input
                      type="time"
                      value={quietHoursEnd}
                      onChange={(e) => setQuietHoursEnd(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--ft-border)] bg-[var(--ft-surface-1)] text-[var(--ft-text-main)] font-mono text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Save Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleSavePreferences}
                disabled={savingSettings}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-sm font-bold bg-sky-600 hover:bg-sky-700 text-white transition flex items-center justify-center gap-2 shadow-2xs disabled:opacity-50 min-h-[44px]"
              >
                {savingSettings ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Lưu cài đặt thông báo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
