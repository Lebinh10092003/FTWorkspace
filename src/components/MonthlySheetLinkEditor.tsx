import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileSpreadsheet, Loader2, Pencil, Save, Trash2, X } from 'lucide-react';
import { appDialog } from './AppDialog';

type ModuleKey = 'attendance' | 'work_schedule';

type Props = {
  idToken: string;
  month: string;
  module: ModuleKey;
  title: string;
  description?: string;
  accent?: 'emerald' | 'blue';
  onLinkChange?: (url: string) => void;
};

const compactLink = (value: string) => {
  try {
    const parsed = new URL(value);
    const id = parsed.pathname.match(/\/(?:d|file\/d)\/([^/]+)/)?.[1] || '';
    return id ? `${parsed.hostname}/…/${id.slice(0, 6)}…${id.slice(-4)}` : parsed.hostname;
  } catch {
    return 'Liên kết Google Sheets đã lưu';
  }
};

export default function MonthlySheetLinkEditor({ idToken, month, module, title, description, accent = 'emerald', onLinkChange }: Props) {
  const [savedUrl, setSavedUrl] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotice('');
    fetch(`/api/monthly-sheet-links?month=${encodeURIComponent(month)}`, { headers: { Authorization: `Bearer ${idToken}` } })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Không thể tải liên kết trang tính.');
        return body;
      })
      .then(body => {
        if (!active) return;
        const next = String(body.links?.[module] || '');
        setSavedUrl(next);
        setDraftUrl(next);
        setEditing(!next);
        onLinkChange?.(next);
      })
      .catch(error => active && setNotice(error.message || 'Không thể tải liên kết trang tính.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [idToken, module, month, onLinkChange]);

  const persist = async (nextUrl: string, successMessage: string) => {
    setSaving(true);
    setNotice('');
    try {
      const response = await fetch(`/api/monthly-sheet-links?month=${encodeURIComponent(month)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, module, url: nextUrl.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Không thể lưu liên kết trang tính.');
      const next = String(body.links?.[module] || '');
      setSavedUrl(next);
      setDraftUrl(next);
      setEditing(!next);
      onLinkChange?.(next);
      setNotice(successMessage);
      return true;
    } catch (error: any) {
      setNotice(error.message || 'Không thể lưu liên kết trang tính.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const confirmed = await appDialog.confirm(
      `Xóa liên kết ${title} của tháng ${month.slice(5)}/${month.slice(0, 4)}? Hệ thống sẽ ngừng đồng bộ tháng này cho đến khi có liên kết mới.`,
      { title: 'Xóa liên kết trang tính', confirmText: 'Xóa liên kết', cancelText: 'Giữ lại', tone: 'danger' },
    );
    if (confirmed) await persist('', 'Đã xóa liên kết của tháng này.');
  };

  const color = accent === 'blue' ? 'text-blue-700' : 'text-emerald-700';
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 ${color}`}><FileSpreadsheet className="h-5 w-5" /></div>
        <div>
          <p className="font-extrabold text-slate-900">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description || 'Chỉ Admin có thể xem và chỉnh sửa liên kết này.'}</p>
        </div>
      </div>

      {loading ? <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Đang kiểm tra liên kết tháng này...</div> : savedUrl && !editing ? <>
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-800"><CheckCircle2 className="h-4 w-4" />Đã lưu cho tháng {month.slice(5)}/{month.slice(0, 4)}</div>
          <p className="mt-2 truncate font-mono text-[11px] text-emerald-700" title="Liên kết được ẩn để tránh chỉnh sửa nhầm">{compactLink(savedUrl)}</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={savedUrl} target="_blank" rel="noreferrer" className="ft-btn ft-btn-secondary text-xs"><ExternalLink className="h-4 w-4" />Mở trang tính</a>
          <button type="button" onClick={() => { setDraftUrl(savedUrl); setEditing(true); setNotice(''); }} className="ft-btn ft-btn-secondary text-xs"><Pencil className="h-4 w-4" />Thay đổi</button>
          <button type="button" onClick={() => void remove()} disabled={saving} className="ft-btn border border-rose-200 bg-white text-xs text-rose-700 hover:bg-rose-50"><Trash2 className="h-4 w-4" />Xóa</button>
        </div>
      </> : <>
        <label className="mt-4 block text-xs font-bold text-slate-600">Liên kết tháng {month.slice(5)}/{month.slice(0, 4)}</label>
        <textarea value={draftUrl} onChange={event => setDraftUrl(event.target.value)} disabled={saving} rows={3} placeholder="https://docs.google.com/spreadsheets/d/..." className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs leading-5 outline-none focus:border-blue-400 disabled:bg-slate-50" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void persist(draftUrl, 'Đã lưu liên kết dành cho tháng này.')} disabled={saving || !draftUrl.trim()} className="ft-btn ft-btn-primary text-xs">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Đang lưu...' : 'Lưu liên kết'}</button>
          {savedUrl && <button type="button" onClick={() => { setDraftUrl(savedUrl); setEditing(false); setNotice(''); }} disabled={saving} className="ft-btn ft-btn-secondary text-xs"><X className="h-4 w-4" />Hủy</button>}
        </div>
      </>}
      {notice && <p className={`mt-3 text-xs font-semibold ${notice.startsWith('Đã') ? 'text-emerald-700' : 'text-rose-700'}`}>{notice}</p>}
    </section>
  );
}
