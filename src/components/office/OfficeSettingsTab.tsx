import React, { useEffect, useState } from 'react';
import { Box, Check, Eye, EyeOff, LoaderCircle } from 'lucide-react';

export type OfficeSettingsTabProps = {
  idToken: string | null;
  onOpenOffice?: () => void;
};

export default function OfficeSettingsTab({ idToken, onOpenOffice }: OfficeSettingsTabProps) {
  const [showPresence, setShowPresence] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!idToken) return;

    let active = true;
    setLoading(true);

    fetch('/api/office/me/avatar/', {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(res => res.json())
      .then(data => {
        if (!active) return;
        if (typeof data.show_presence === 'boolean') {
          setShowPresence(data.show_presence);
        }
      })
      .catch(() => {
        // Giữ mặc định true
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [idToken]);

  const handleToggle = async (nextValue: boolean) => {
    if (!idToken || saving) return;

    setShowPresence(nextValue);
    setSaving(true);
    setNotice(null);

    try {
      const response = await fetch('/api/office/me/avatar/', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ show_presence: nextValue }),
      });

      if (!response.ok) {
        throw new Error('Không thể lưu cài đặt.');
      }

      setNotice({
        type: 'success',
        text: nextValue
          ? 'Đã bật hiển thị online trong Văn phòng 3D.'
          : 'Đã tắt hiện diện. Người khác sẽ luôn thấy bạn ngoại tuyến.',
      });
    } catch {
      // Revert lại nếu lỗi
      setShowPresence(!nextValue);
      setNotice({ type: 'error', text: 'Lỗi khi cập nhật cài đặt hiện diện.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-[var(--ft-text-sub)]">
        <LoaderCircle className="h-5 w-5 animate-spin mr-2 text-sky-600" />
        <span>Đang nạp cài đặt văn phòng...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--ft-border)] bg-[var(--ft-surface-2)]/50 dark:bg-[var(--ft-surface-2)]/30 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Box className="h-5 w-5 text-sky-600 dark:text-sky-400" />
              <h3 className="text-base font-bold text-[var(--ft-text-main)]">
                Hiện diện trong Văn phòng 3D
              </h3>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-[var(--ft-text-sub)] leading-relaxed">
              Cài đặt quyền riêng tư và hiển thị trạng thái làm việc trực tuyến của bạn trong không gian văn phòng ảo.
            </p>
          </div>

          {onOpenOffice && (
            <button
              type="button"
              onClick={onOpenOffice}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-3.5 py-2 text-xs font-bold text-sky-700 dark:text-sky-300 hover:bg-sky-100 transition cursor-pointer"
            >
              <span>Mở Văn phòng 3D</span>
            </button>
          )}
        </div>

        <div className="mt-6 border-t border-[var(--ft-border)] pt-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 rounded-lg p-2 ${showPresence ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                {showPresence ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </div>
              <div>
                <label htmlFor="presence-toggle" className="text-sm font-bold text-[var(--ft-text-main)] cursor-pointer">
                  Hiện tôi đang online trong văn phòng
                </label>
                <p className="mt-0.5 text-xs text-[var(--ft-text-sub)] leading-relaxed">
                  {showPresence
                    ? 'Đồng nghiệp sẽ thấy nhân vật của bạn tại chỗ ngồi khi bạn đang mở Workspace.'
                    : 'Bạn luôn hiển thị ở trạng thái ngoại tuyến đối với người khác.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {saving && <LoaderCircle className="h-4 w-4 animate-spin text-sky-600" />}
              <button
                id="presence-toggle"
                type="button"
                role="switch"
                aria-checked={showPresence}
                disabled={saving}
                onClick={() => handleToggle(!showPresence)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-50 ${
                  showPresence ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    showPresence ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <div
            className={`mt-4 rounded-xl p-3 text-xs font-semibold flex items-center gap-2 ${
              notice.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
            }`}
          >
            {notice.type === 'success' && <Check className="h-4 w-4 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}
