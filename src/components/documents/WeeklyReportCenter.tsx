import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle2, FileText, Loader2, TriangleAlert, X } from 'lucide-react';

import AccountMenu from '../AccountMenu';
import ModuleShellHeader from '../layout/ModuleShellHeader';
import { COMMUNICATION_TOOLS_NAV } from '../../config/workspaceNavigation';

type Report = {
  id: number;
  employeeName: string;
  employeeEmail: string;
  completedWeek: number;
  plannedWeek: number;
  completedItems: string[];
  difficulties: string[];
  plannedItems: string[];
  status: 'snapshot' | 'published';
  documentSyncedAt: string | null;
  updatedAt: string;
};

type WeekOption = {
  weekStart: string;
  completedWeek: number;
  completedYear: number;
  plannedWeek: number;
  plannedYear: number;
  label: string;
  isDefault: boolean;
};

type Props = {
  idToken: string;
  userName: string;
  userRole?: string;
  photoURL?: string | null;
  onAccountClick: () => void;
  onLogout: () => void;
  onNavSelect: (id: string) => void;
};

const list = (items: string[], empty: string) => (
  items.length
    ? <ul className="mt-2 space-y-1.5 pl-5 text-[13px] leading-6 text-slate-800">{items.map((item, index) => <li key={`${index}-${item}`} className="list-disc pl-0.5">{item}</li>)}</ul>
    : <p className="mt-2 text-[13px] italic leading-6 text-slate-500">{empty}</p>
);

export default function WeeklyReportCenter({
  idToken, userName, userRole, photoURL, onAccountClick, onLogout, onNavSelect,
}: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [weekOptions, setWeekOptions] = useState<WeekOption[]>([]);
  const [weekStart, setWeekStart] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canCreate = Boolean(idToken);

  const selected = useMemo(
    () => reports.find(report => report.id === selectedId) || reports[0] || null,
    [reports, selectedId],
  );

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch('/api/documents/weekly-reports', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Không tải được báo cáo tuần.');
      const next = Array.isArray(payload.reports) ? payload.reports as Report[] : [];
      setReports(next);
      setSelectedId(current => next.some(report => report.id === current) ? current : (next[0]?.id || null));
    } catch (cause: any) {
      setError(cause.message || 'Không tải được báo cáo tuần.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  const openCreate = async () => {
    setCreateOpen(true);
    setError('');
    setOptionsLoading(true);
    try {
      const response = await fetch('/api/documents/weekly-reports/generation-options', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Không thể lấy danh sách tuần báo cáo.');
      const next = Array.isArray(payload.options) ? payload.options as WeekOption[] : [];
      setWeekOptions(next);
      setWeekStart(next.find(option => option.isDefault)?.weekStart || next[0]?.weekStart || '');
    } catch (cause: any) {
      setError(cause.message || 'Không thể lấy danh sách tuần báo cáo.');
    } finally {
      setOptionsLoading(false);
    }
  };

  const createReport = async () => {
    if (!weekStart) return;
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/documents/weekly-reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ weekStart }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Không thể tạo gói báo cáo tuần.');
      setNotice(`Đã chuyển dữ liệu tuần ${payload.completedWeek} và kế hoạch tuần ${payload.plannedWeek} vào ${payload.sheet?.updatedTabs || 0} sheet nhân viên.`);
      setCreateOpen(false);
      await load(true);
    } catch (cause: any) {
      setError(cause.message || 'Không thể tạo gói báo cáo tuần.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="ft-module-shell flex min-h-dvh flex-col bg-slate-50 font-sans text-slate-900">
      <ModuleShellHeader
        eyebrow="Bộ công cụ FermatTech"
        title="Báo cáo cuối tuần"
        items={COMMUNICATION_TOOLS_NAV}
        activeId="weekly-report"
        onSelect={onNavSelect}
        ariaLabel="Điều hướng bộ công cụ FermatTech"
        actions={(
          <>
            {canCreate && <button type="button" onClick={() => void openCreate()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"><CalendarPlus className="h-4 w-4" />Tạo báo cáo tuần</button>}
          </>
        )}
        account={<AccountMenu userName={userName} userRole={userRole} photoURL={photoURL} isGuest={false} onAccountClick={onAccountClick} onLogout={onLogout} variant="avatar" />}
      />

      <main className="min-w-0 flex-1">
        <div className="ft-module-content mx-auto p-5 md:p-7">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-blue-700">Gói dữ liệu từ Lịch công tác</p>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Chọn tuần cần tạo để web đồng bộ lịch công tác và chuyển dữ liệu của chính bạn vào sheet riêng. Timer 16:45 thứ Sáu vẫn tạo cho toàn bộ nhân viên. Các bước AI và Google Docs sẽ được bổ sung sau.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Đã lưu trên Sheet</span>
          </div>

          {error && <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />{error}</div>}
          {notice && <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">{notice}</div>}

          {loading ? <div className="grid min-h-72 place-items-center text-sm font-semibold text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div> : !reports.length ? (
            <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><FileText className="mx-auto h-9 w-9 text-slate-400" /><h2 className="mt-3 text-lg font-extrabold">Chưa có gói báo cáo tuần</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Bấm “Tạo báo cáo tuần” để chuyển dữ liệu của bạn vào Google Sheets.</p></section>
          ) : (
            <div className="grid items-start gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="px-2 pb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Gói lịch nhân viên</p>
                <div className="space-y-1.5">{reports.map(report => <button key={report.id} type="button" onClick={() => setSelectedId(report.id)} className={`w-full rounded-xl px-3 py-3 text-left transition ${selected?.id === report.id ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-slate-50'}`}><span className="block text-sm font-extrabold">{report.employeeName}</span><span className={`mt-1 block text-xs ${selected?.id === report.id ? 'text-blue-100' : 'text-slate-500'}`}>Tuần {report.completedWeek} → {report.plannedWeek} · Đã chuyển Sheet</span></button>)}</div>
              </aside>

              {selected && <article className="mx-auto w-full max-w-[794px] bg-white px-8 py-10 shadow-lg ring-1 ring-slate-200 sm:px-14" style={{ minHeight: '1040px' }}>
                <header className="text-center"><h1 className="text-lg font-extrabold leading-7">GÓI DỮ LIỆU BÁO CÁO</h1><p className="font-extrabold leading-6">Kết quả tuần {selected.completedWeek}, nhiệm vụ dự kiến tuần {selected.plannedWeek}</p><p className="font-extrabold leading-6">({selected.employeeName})</p></header>
                <section className="mt-7"><h2 className="font-extrabold">1. Công việc đã thực hiện tuần {selected.completedWeek}</h2>{list(selected.completedItems, 'Chưa có công việc được đánh dấu hoàn thành.')}</section>
                <section className="mt-6"><h2 className="font-extrabold">2. Tồn tại, khó khăn, vướng mắc</h2>{list(selected.difficulties, 'Không có nội dung được ghi nhận.')}</section>
                <section className="mt-6"><h2 className="font-extrabold">3. Nhiệm vụ tuần {selected.plannedWeek}</h2>{list(selected.plannedItems, 'Chưa có nhiệm vụ dự kiến.')}</section>
              </article>}
            </div>
          )}
        </div>
      </main>
      {createOpen && (
        <div className="fixed inset-0 z-[12000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !creating) setCreateOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="weekly-report-create-title" className="w-full max-w-md rounded-2xl border border-white/60 bg-white p-5 shadow-2xl">
            <header className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><CalendarPlus className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h2 id="weekly-report-create-title" className="text-base font-extrabold text-slate-900">Tạo báo cáo tuần của tôi</h2><p className="mt-1 text-sm leading-5 text-slate-600">Chọn tuần cần tổng hợp. Web chỉ tạo dữ liệu của chính bạn và chỉ cho phép tạo tuần hiện tại hoặc tối đa ba tuần trước.</p></div><button type="button" onClick={() => setCreateOpen(false)} disabled={creating} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"><X className="h-4 w-4" /></button></header>
            <div className="mt-5 space-y-2">{optionsLoading ? <div className="grid min-h-24 place-items-center text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div> : weekOptions.map(option => <label key={option.weekStart} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${weekStart === option.weekStart ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}><input type="radio" name="weekly-report-week" value={option.weekStart} checked={weekStart === option.weekStart} onChange={() => setWeekStart(option.weekStart)} className="mt-1 h-4 w-4" /><span><span className="block text-sm font-extrabold text-slate-800">{option.label}</span><span className="mt-0.5 block text-xs text-slate-500">Báo cáo tuần {option.completedWeek} · Kế hoạch tuần {option.plannedWeek}{option.isDefault ? ' · Mặc định' : ''}</span></span></label>)}</div>
            <footer className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCreateOpen(false)} disabled={creating} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Hủy</button><button type="button" onClick={() => void createReport()} disabled={!weekStart || optionsLoading || creating} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">{creating && <Loader2 className="h-4 w-4 animate-spin" />}{creating ? 'Đang chuyển…' : 'Tạo và chuyển Sheet'}</button></footer>
          </section>
        </div>
      )}
    </div>
  );
}
