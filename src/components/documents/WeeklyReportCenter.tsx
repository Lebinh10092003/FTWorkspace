import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';

import AccountMenu from '../AccountMenu';
import ModuleShellHeader from '../layout/ModuleShellHeader';
import { COMMUNICATION_TOOLS_NAV } from '../../config/workspaceNavigation';

type ReportGroup = {
  name: string;
  items: string[];
};

type Report = {
  id: number;
  employeeName: string;
  employeeEmail: string;
  completedWeek: number;
  plannedWeek: number;
  completedItems: string[];
  difficulties: string[];
  plannedItems: string[];
  completedGroups: ReportGroup[];
  plannedGroups: ReportGroup[];
  includeBldTask: boolean;
  status: 'snapshot' | 'published' | 'edited';
  statusDisplay?: string;
  editedByName?: string;
  editedByEmail?: string;
  editedAt?: string | null;
  plannedWarning?: string | null;
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

type ReportSources = {
  sheetUrl: string;
  documentUrl: string;
};

type AiHealthStatus = {
  status: 'ready' | 'auth_error' | 'error';
  ready: boolean;
  statusDisplay: string;
  errorMessage: string;
  sessionDays: number;
  lastCheckedAt: string | null;
  lastReadyAt: string | null;
};

type Props = {
  idToken: string;
  userName: string;
  userEmail?: string;
  userRole?: string;
  photoURL?: string | null;
  onAccountClick: () => void;
  onLogout: () => void;
  onNavSelect: (id: string) => void;
};

const moveItemInArray = (list: string[], fromIndex: number, toIndex: number): string[] => {
  if (toIndex < 0 || toIndex >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};

export default function WeeklyReportCenter({
  idToken,
  userName,
  userEmail,
  userRole,
  photoURL,
  onAccountClick,
  onLogout,
  onNavSelect,
}: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<ReportSources | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [weekOptions, setWeekOptions] = useState<WeekOption[]>([]);
  const [weekStart, setWeekStart] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canCreate = Boolean(idToken);

  // AI Rewrite state
  const [aiHealth, setAiHealth] = useState<AiHealthStatus | null>(null);
  const [aiJobId, setAiJobId] = useState<number | null>(null);
  const [aiJobStatus, setAiJobStatus] = useState<'queued' | 'running' | 'done' | 'failed' | 'cancelled' | null>(null);
  const [aiQueuePosition, setAiQueuePosition] = useState<number | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNotice, setAiNotice] = useState('');
  const [suspiciousCompletedItems, setSuspiciousCompletedItems] = useState<string[]>([]);

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editCompletedGroups, setEditCompletedGroups] = useState<ReportGroup[]>([]);
  const [editDifficulties, setEditDifficulties] = useState<string[]>([]);
  const [editPlannedGroups, setEditPlannedGroups] = useState<ReportGroup[]>([]);
  const [editIncludeBldTask, setEditIncludeBldTask] = useState(true);

  const selected = useMemo(
    () => reports.find(report => report.id === selectedId) || reports[0] || null,
    [reports, selectedId],
  );

  const startEditing = () => {
    if (!selected) return;
    const cGroups =
      selected.completedGroups && selected.completedGroups.length
        ? selected.completedGroups.map(g => ({ name: g.name, items: [...(g.items || [])] }))
        : [{ name: 'Công việc', items: [...(selected.completedItems || [])] }];
    const pGroups =
      selected.plannedGroups && selected.plannedGroups.length
        ? selected.plannedGroups.map(g => ({ name: g.name, items: [...(g.items || [])] }))
        : [{ name: 'Công việc', items: [...(selected.plannedItems || [])] }];
    setEditCompletedGroups(cGroups);
    setEditDifficulties([...(selected.difficulties || [])]);
    setEditPlannedGroups(pGroups);
    setEditIncludeBldTask(selected.includeBldTask !== false);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveEditing = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/documents/weekly-reports/${selected.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          completedGroups: editCompletedGroups.filter(g => g.name.trim() || g.items.some(i => i.trim())),
          difficulties: editDifficulties.filter(d => d.trim()),
          plannedGroups: editPlannedGroups.filter(g => g.name.trim() || g.items.some(i => i.trim())),
          includeBldTask: editIncludeBldTask,
        }),
      });
      const updated = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(updated.error || 'Không thể lưu bản chỉnh sửa.');
      setReports(current => current.map(r => (r.id === updated.id ? (updated as Report) : r)));
      setIsEditing(false);
      setNotice('Đã lưu bản chỉnh sửa báo cáo tuần thành công.');
    } catch (cause: any) {
      setError(cause.message || 'Không thể lưu bản chỉnh sửa.');
    } finally {
      setSaving(false);
    }
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch('/api/documents/weekly-reports', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Không tải được báo cáo tuần.');
      const next = Array.isArray(payload.reports) ? (payload.reports as Report[]) : [];
      setReports(next);
      setSources(payload.sources || null);
      setSelectedId(current => (next.some(report => report.id === current) ? current : next[0]?.id || null));
    } catch (cause: any) {
      setError(cause.message || 'Không tải được báo cáo tuần.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchAiHealth = async () => {
    try {
      const response = await fetch('/api/documents/weekly-reports/ai-status', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setAiHealth(data);
      }
    } catch {
      // Ignore background health fetch error
    }
  };

  const requestAiRewrite = async () => {
    if (!selected || aiLoading) return;
    setError('');
    setAiNotice('');
    setSuspiciousCompletedItems([]);
    setAiLoading(true);

    try {
      const response = await fetch(`/api/documents/weekly-reports/${selected.id}/ai-rewrite`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Không thể yêu cầu AI viết lại.');
      }
      setAiJobId(data.jobId);
      setAiJobStatus(data.status);
      setAiQueuePosition(data.queuePosition || 1);
    } catch (cause: any) {
      setError(cause.message || 'Không thể yêu cầu AI viết lại.');
      setAiLoading(false);
    }
  };

  const cancelAiJob = async () => {
    if (!aiJobId) return;
    try {
      await fetch(`/api/documents/weekly-reports/ai-jobs/${aiJobId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      setAiLoading(false);
      setAiJobId(null);
      setAiJobStatus(null);
      setNotice('Đã hủy yêu cầu AI.');
    } catch (cause: any) {
      setError(cause.message || 'Không thể hủy yêu cầu AI.');
    }
  };

  useEffect(() => {
    if (!aiJobId || !aiLoading) return;

    let isSubscribed = true;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/documents/weekly-reports/ai-jobs/${aiJobId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Lỗi khi kiểm tra tiến độ AI.');
        }
        const data = await response.json();
        if (!isSubscribed) return;

        setAiJobStatus(data.status);
        if (data.status === 'queued') {
          setAiQueuePosition(data.queuePosition || 1);
        } else if (data.status === 'running') {
          setAiQueuePosition(null);
        } else if (data.status === 'done') {
          clearInterval(interval);
          setAiLoading(false);
          setAiJobId(null);
          setAiJobStatus(null);

          // Populate editor with AI result
          const result = data.result || {};
          const cGroups =
            Array.isArray(result.completedGroups) && result.completedGroups.length
              ? result.completedGroups.map((g: any) => ({
                  name: g.name || 'Công việc',
                  items: Array.isArray(g.items) ? [...g.items] : [],
                }))
              : [{ name: 'Công việc', items: [] }];
          const pGroups =
            Array.isArray(result.plannedGroups) && result.plannedGroups.length
              ? result.plannedGroups.map((g: any) => ({
                  name: g.name || 'Công việc',
                  items: Array.isArray(g.items) ? [...g.items] : [],
                }))
              : [{ name: 'Công việc', items: [] }];

          setEditCompletedGroups(cGroups);
          setEditDifficulties(Array.isArray(result.difficulties) ? [...result.difficulties] : []);
          setEditPlannedGroups(pGroups);
          setEditIncludeBldTask(selected?.includeBldTask !== false);
          setSuspiciousCompletedItems(
            Array.isArray(result.suspiciousCompletedItems) ? result.suspiciousCompletedItems : [],
          );

          setIsEditing(true);
          setAiNotice('Bản do AI viết lại từ dữ liệu công việc, hãy kiểm tra và chỉnh sửa trước khi lưu.');
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setAiLoading(false);
          setAiJobId(null);
          setAiJobStatus(null);
          setError(data.errorMessage || 'AI không thể tạo báo cáo. Vui lòng thử lại sau.');
        } else if (data.status === 'cancelled') {
          clearInterval(interval);
          setAiLoading(false);
          setAiJobId(null);
          setAiJobStatus(null);
          setNotice('Đã hủy yêu cầu AI.');
        }
      } catch (err: any) {
        if (!isSubscribed) return;
        clearInterval(interval);
        setAiLoading(false);
        setAiJobId(null);
        setAiJobStatus(null);
        setError(err.message || 'Lỗi kiểm tra tiến độ AI.');
      }
    }, 2000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [aiJobId, aiLoading, idToken, selected]);

  useEffect(() => {
    setSources(null);
    void load();
    void fetchAiHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  // When changing selected report, exit edit mode and clear AI notices
  useEffect(() => {
    setIsEditing(false);
    setAiNotice('');
    setSuspiciousCompletedItems([]);
  }, [selectedId]);

  const downloadReport = async () => {
    if (!selected || downloading) return;
    setDownloading(true);
    setError('');
    try {
      const response = await fetch(`/api/documents/weekly-reports/${selected.id}.docx`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Không tải được file Word. Vui lòng thử lại.');
      }
      const disposition = response.headers.get('Content-Disposition') || '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename = encodedName
        ? decodeURIComponent(encodedName)
        : disposition.match(/filename="([^"]+)"/i)?.[1] ||
          `BC KQ tuần ${selected.completedWeek}, NV tuần ${selected.plannedWeek} (${selected.employeeName}).docx`;
      const url = URL.createObjectURL(await response.blob());
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (cause: any) {
      setError(cause.message || 'Không tải được file Word. Vui lòng thử lại.');
    } finally {
      setDownloading(false);
    }
  };

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
      const next = Array.isArray(payload.options) ? (payload.options as WeekOption[]) : [];
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
      setNotice(
        `Đã tạo gói dữ liệu tuần ${payload.completedWeek} và kế hoạch tuần ${payload.plannedWeek}.`,
      );
      setCreateOpen(false);
      await load(true);
    } catch (cause: any) {
      setError(cause.message || 'Không thể tạo gói báo cáo tuần.');
    } finally {
      setCreating(false);
    }
  };

  const displayCompletedGroups = selected?.completedGroups?.length
    ? selected.completedGroups
    : [{ name: 'Công việc', items: selected?.completedItems || [] }];

  const displayPlannedGroups = selected?.plannedGroups?.length
    ? selected.plannedGroups
    : [{ name: 'Công việc', items: selected?.plannedItems || [] }];

  return (
    <div className="ft-module-shell flex min-h-dvh flex-col bg-slate-50 font-sans text-slate-900">
      <ModuleShellHeader
        eyebrow="Bộ công cụ FermatTech"
        title="Báo cáo cuối tuần"
        items={COMMUNICATION_TOOLS_NAV}
        activeId="weekly-report"
        onSelect={onNavSelect}
        ariaLabel="Điều hướng bộ công cụ FermatTech"
        actions={
          <>
            {canCreate && (
              <button
                type="button"
                onClick={() => void openCreate()}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-blue-700 active:scale-95 transition"
              >
                <CalendarPlus className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Tạo báo cáo tuần</span>
                <span className="sm:hidden">Tạo báo cáo</span>
              </button>
            )}
          </>
        }
        account={
          <AccountMenu
            userName={userName}
            userRole={userRole}
            photoURL={photoURL}
            isGuest={false}
            onAccountClick={onAccountClick}
            onLogout={onLogout}
            variant="avatar"
          />
        }
      />

      <main className="min-w-0 flex-1">
        <div className="ft-module-content mx-auto p-4 sm:p-6 md:p-8">
          <div className="mb-4 sm:mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-blue-700">Báo cáo tuần cá nhân · Mẫu chuẩn công ty</p>
              <p className="mt-1 max-w-2xl text-xs sm:text-sm leading-5 sm:leading-6 text-slate-500">
                Tổng hợp đầu việc từ Lịch công tác của bạn theo cấu trúc chuẩn. Xem, chỉnh sửa từng dòng và tải file Word để nộp chiều thứ Sáu.
              </p>
            </div>
            {selected && (
              <div className="flex flex-wrap items-center gap-2">
                {selected.status === 'edited' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Đã chỉnh sửa
                  </span>
                ) : selected.status === 'published' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700 border border-purple-200">
                    <FileText className="h-3.5 w-3.5" />
                    Đã cập nhật từ AI
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 border border-blue-200">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Từ lịch công tác
                  </span>
                )}
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"
            >
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="flex-1">{error}</div>
              <button
                type="button"
                onClick={() => setError('')}
                className="text-rose-600 hover:text-rose-800 p-0.5"
                aria-label="Đóng lỗi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {notice && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
              <div>{notice}</div>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="text-blue-600 hover:text-blue-800 p-0.5"
                aria-label="Đóng thông báo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {sources && userRole === 'ADMIN' && (
            <section
              aria-labelledby="weekly-report-sources-title"
              className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h2 id="weekly-report-sources-title" className="text-sm font-extrabold text-slate-800">
                Tài liệu nguồn · Quản trị viên
              </h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <a
                  href={sources.sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 p-3 hover:border-emerald-300 hover:bg-emerald-50 transition"
                >
                  <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">Xem Google Sheet</span>
                    <span className="mt-1 block break-all text-xs leading-5 text-slate-500">
                      {sources.sheetUrl}
                    </span>
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
                </a>
                <a
                  href={sources.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 p-3 hover:border-blue-300 hover:bg-blue-50 transition"
                >
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">Xem Google Docs</span>
                    <span className="mt-1 block break-all text-xs leading-5 text-slate-500">
                      {sources.documentUrl}
                    </span>
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
                </a>
              </div>
            </section>
          )}

          {loading ? (
            <div className="grid min-h-72 place-items-center text-sm font-semibold text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : !reports.length ? (
            <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 sm:p-12 text-center">
              <FileText className="mx-auto h-10 w-10 text-slate-400" />
              <h2 className="mt-3 text-lg font-extrabold text-slate-800">Chưa có báo cáo tuần</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                Bấm “Tạo báo cáo tuần” để tạo báo cáo cá nhân từ Lịch công tác của bạn.
              </p>
            </section>
          ) : (
            <div>
              {/* Mobile selector for multiple reports */}
              {reports.length > 1 && (
                <div className="mb-4 xl:hidden">
                  <label htmlFor="mobile-report-select" className="block text-xs font-bold text-slate-600 mb-1">
                    Chọn nhân viên / tuần báo cáo:
                  </label>
                  <select
                    id="mobile-report-select"
                    value={selected?.id || ''}
                    onChange={e => setSelectedId(Number(e.target.value))}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
                  >
                    {reports.map(report => (
                      <option key={report.id} value={report.id}>
                        {report.employeeName} — Tuần {report.completedWeek} → {report.plannedWeek}
                        {report.status === 'edited' ? ' (Đã sửa)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid items-start gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
                {/* Desktop sidebar */}
                <aside className="hidden xl:block rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <p className="px-2 pb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                    Báo cáo cá nhân
                  </p>
                  <div className="space-y-1.5">
                    {reports.map(report => (
                      <button
                        key={report.id}
                        type="button"
                        onClick={() => setSelectedId(report.id)}
                        className={`w-full rounded-xl px-3 py-3 text-left transition ${
                          selected?.id === report.id
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="block text-sm font-extrabold truncate">{report.employeeName}</span>
                          {report.status === 'edited' && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                selected?.id === report.id ? 'bg-blue-700 text-white' : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              Đã sửa
                            </span>
                          )}
                        </div>
                        <span
                          className={`mt-1 block text-xs ${
                            selected?.id === report.id ? 'text-blue-100' : 'text-slate-500'
                          }`}
                        >
                          Tuần {report.completedWeek} → {report.plannedWeek}
                        </span>
                      </button>
                    ))}
                  </div>
                </aside>

                {/* Main Content Area */}
                {selected && (
                  <div className="mx-auto w-full min-w-0 max-w-[794px]">
                    {/* Top Action Bar */}
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {selected.employeeName} · Tuần {selected.completedWeek} → {selected.plannedWeek}
                        </p>
                        {selected.status === 'edited' && selected.editedByName && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            Sửa bởi <span className="font-semibold text-slate-700">{selected.editedByName}</span>
                            {selected.editedAt && (
                              <span> lúc {new Date(selected.editedAt).toLocaleString('vi-VN')}</span>
                            )}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {aiLoading ? (
                          <div className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs sm:text-sm font-bold text-indigo-700 shadow-sm">
                            <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                            <span>
                              {aiJobStatus === 'queued'
                                ? `Đang chờ AI (vị trí ${aiQueuePosition || 1})…`
                                : 'AI đang viết lại…'}
                            </span>
                            <button
                              type="button"
                              onClick={() => void cancelAiJob()}
                              className="ml-1 text-xs text-rose-600 hover:text-rose-800 underline font-semibold"
                            >
                              Hủy
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void requestAiRewrite()}
                            disabled={
                              saving ||
                              (!userEmail || !selected.employeeEmail
                                ? false
                                : userEmail.toLowerCase() !== selected.employeeEmail.toLowerCase()) ||
                              aiHealth?.status === 'auth_error' ||
                              aiHealth?.status === 'error'
                            }
                            title={
                              userEmail &&
                              selected.employeeEmail &&
                              userEmail.toLowerCase() !== selected.employeeEmail.toLowerCase()
                                ? 'Chỉ chủ báo cáo mới có thể yêu cầu AI viết lại.'
                                : aiHealth?.status === 'auth_error'
                                ? 'AI tạm ngừng, quản trị viên cần đăng nhập lại.'
                                : aiHealth?.status === 'error'
                                ? 'Dịch vụ AI đang gặp lỗi hệ thống.'
                                : 'Gemini tự động viết lại bản nháp theo mẫu chuẩn từ dữ liệu lịch công tác'
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/90 px-3 py-2 text-xs sm:text-sm font-bold text-indigo-700 shadow-sm hover:bg-indigo-100 disabled:opacity-50 transition min-h-[44px]"
                          >
                            <Sparkles className="h-4 w-4 text-indigo-600" />
                            <span>AI viết lại</span>
                          </button>
                        )}

                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={cancelEditing}
                              disabled={saving}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition min-h-[44px]"
                            >
                              <RotateCcw className="h-4 w-4" />
                              Hủy
                            </button>
                            <button
                              type="button"
                              onClick={() => void saveEditing()}
                              disabled={saving}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition min-h-[44px]"
                            >
                              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                              {saving ? 'Đang lưu…' : 'Lưu bản sửa'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={startEditing}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition min-h-[44px]"
                            >
                              <Edit3 className="h-4 w-4 text-blue-600" />
                              Chỉnh sửa
                            </button>
                            <button
                              type="button"
                              onClick={() => void downloadReport()}
                              disabled={downloading}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition min-h-[44px]"
                            >
                              {downloading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                              {downloading ? 'Đang tải…' : 'Tải Word (.docx)'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* AI Service Health warning banner if auth error */}
                    {aiHealth?.status === 'auth_error' && (
                      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 sm:p-4 text-amber-900 shadow-sm">
                        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                        <div className="text-xs sm:text-sm leading-5">
                          <span className="font-bold">AI tạm ngừng: </span>
                          <span>
                            Quản trị viên cần đăng nhập lại tài khoản agy/Gemini trên VPS để tiếp tục sử dụng nút “AI
                            viết lại”. Báo cáo bằng quy tắc và tải file Word vẫn dùng bình thường.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* AI Output Notice */}
                    {aiNotice && (
                      <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-3.5 sm:p-4 text-indigo-950 shadow-sm">
                        <div className="flex items-start gap-2.5">
                          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                          <div className="flex-1 text-xs sm:text-sm leading-5">
                            <span className="font-bold text-indigo-900">{aiNotice}</span>
                            <span className="block text-indigo-700 mt-0.5">
                              Dữ liệu do AI tạo ra đã được nạp vào các ô bên dưới. AI không bao giờ tự lưu. Bạn hãy
                              kiểm tra, chỉnh sửa câu chữ và bấm “Lưu bản sửa” ở góc trên để xác nhận.
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAiNotice('')}
                            className="text-indigo-500 hover:text-indigo-800 p-0.5 shrink-0"
                            aria-label="Đóng thông báo AI"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Anti-fabrication suspicious tasks warning */}
                    {suspiciousCompletedItems.length > 0 && (
                      <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 sm:p-4 text-rose-950 shadow-sm">
                        <div className="flex items-start gap-2.5">
                          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                          <div className="flex-1 text-xs sm:text-sm leading-5">
                            <span className="font-bold text-rose-900">
                              Cảnh báo đối chiếu công việc (chống bịa việc):
                            </span>
                            <span className="block text-rose-800 mt-0.5">
                              Các dòng sau không tìm thấy từ khóa trùng khớp trong lịch công tác tuần kết thúc. Vui lòng
                              kiểm tra lại kỹ xem có đúng công việc bạn đã làm:
                            </span>
                            <ul className="mt-1 list-disc pl-5 space-y-0.5 text-rose-900 font-medium">
                              {suspiciousCompletedItems.map((item, idx) => (
                                <li key={`suspicious-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Insufficient planned tasks warning */}
                    {selected.plannedWarning && (
                      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 sm:p-4 text-amber-900 shadow-sm">
                        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                        <div className="text-xs sm:text-sm leading-5">
                          <span className="font-bold">Lưu ý lịch công tác tuần tới: </span>
                          <span>{selected.plannedWarning}. Hãy đăng ký thêm công việc trên Lịch công tác để đảm bảo đầy đủ cả tuần.</span>
                        </div>
                      </div>
                    )}

                    {/* Document Paper Container */}
                    <article
                      className="w-full rounded-2xl border border-slate-200 bg-white p-5 sm:p-10 md:p-14 shadow-lg ring-1 ring-slate-100"
                      style={{ minHeight: '800px', fontFamily: '"Times New Roman", Times, serif' }}
                    >
                      {isEditing ? (
                        /* EDIT MODE */
                        <div className="space-y-6 text-slate-800" style={{ fontFamily: 'inherit' }}>
                          <header className="text-center border-b pb-4">
                            <h1 className="text-base sm:text-lg font-bold uppercase leading-tight text-slate-900">
                              BÁO CÁO
                            </h1>
                            <p className="font-bold text-sm sm:text-base mt-1">
                              Kết quả tuần {selected.completedWeek}, nhiệm vụ dự kiến tuần {selected.plannedWeek}
                            </p>
                            <p className="font-bold text-sm sm:text-base">({selected.employeeName})</p>
                            <p className="text-xs text-blue-700 font-sans mt-2 italic">
                              Đang ở chế độ chỉnh sửa. Bạn có thể sửa tên nhóm, thêm/xóa dòng, đổi thứ tự việc và lưu lại.
                            </p>
                          </header>

                          {/* SECTION I EDIT */}
                          <div>
                            <div className="flex items-center justify-between pb-2 border-b">
                              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                                I. KẾT QUẢ TUẦN {selected.completedWeek}
                              </h2>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditCompletedGroups(prev => [
                                    ...prev,
                                    { name: `Nhóm việc ${prev.length + 1}`, items: [''] },
                                  ])
                                }
                                className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 font-sans"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Thêm nhóm
                              </button>
                            </div>

                            <div className="mt-3 space-y-4">
                              {editCompletedGroups.map((group, gIdx) => (
                                <div
                                  key={`c-group-${gIdx}`}
                                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                                >
                                  <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                      <span className="font-bold text-sm shrink-0">{gIdx + 1}.</span>
                                      <input
                                        type="text"
                                        value={group.name}
                                        onChange={e =>
                                          setEditCompletedGroups(prev =>
                                            prev.map((g, i) => (i === gIdx ? { ...g, name: e.target.value } : g)),
                                          )
                                        }
                                        placeholder="Tên nhóm công việc..."
                                        className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
                                      />
                                    </div>
                                    {editCompletedGroups.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditCompletedGroups(prev => prev.filter((_, i) => i !== gIdx))
                                        }
                                        className="p-1 text-slate-400 hover:text-rose-600 rounded"
                                        title="Xóa nhóm"
                                        aria-label="Xóa nhóm"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    )}
                                  </div>

                                  <div className="space-y-2 pl-4">
                                    {group.items.map((item, iIdx) => (
                                      <div key={`c-item-${gIdx}-${iIdx}`} className="flex items-start gap-1.5">
                                        <span className="mt-1 text-slate-500 shrink-0 font-bold">-</span>
                                        <textarea
                                          value={item}
                                          rows={1}
                                          onChange={e =>
                                            setEditCompletedGroups(prev =>
                                              prev.map((g, i) =>
                                                i === gIdx
                                                  ? {
                                                      ...g,
                                                      items: g.items.map((it, j) => (j === iIdx ? e.target.value : it)),
                                                    }
                                                  : g,
                                              ),
                                            )
                                          }
                                          placeholder="Nội dung công việc đã làm..."
                                          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm leading-5 text-slate-800 focus:border-blue-500 focus:outline-none resize-y"
                                        />
                                        <div className="flex items-center shrink-0">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setEditCompletedGroups(prev =>
                                                prev.map((g, i) =>
                                                  i === gIdx
                                                    ? { ...g, items: moveItemInArray(g.items, iIdx, iIdx - 1) }
                                                    : g,
                                                ),
                                              )
                                            }
                                            disabled={iIdx === 0}
                                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                            title="Chuyển lên"
                                            aria-label="Chuyển lên"
                                          >
                                            <ArrowUp className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setEditCompletedGroups(prev =>
                                                prev.map((g, i) =>
                                                  i === gIdx
                                                    ? { ...g, items: moveItemInArray(g.items, iIdx, iIdx + 1) }
                                                    : g,
                                                ),
                                              )
                                            }
                                            disabled={iIdx === group.items.length - 1}
                                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                            title="Chuyển xuống"
                                            aria-label="Chuyển xuống"
                                          >
                                            <ArrowDown className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setEditCompletedGroups(prev =>
                                                prev.map((g, i) =>
                                                  i === gIdx
                                                    ? { ...g, items: g.items.filter((_, j) => j !== iIdx) }
                                                    : g,
                                                ),
                                              )
                                            }
                                            className="p-1 text-slate-400 hover:text-rose-600"
                                            title="Xóa dòng"
                                            aria-label="Xóa dòng"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditCompletedGroups(prev =>
                                          prev.map((g, i) => (i === gIdx ? { ...g, items: [...g.items, ''] } : g)),
                                        )
                                      }
                                      className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 pt-1 font-sans"
                                    >
                                      <Plus className="h-3 w-3" /> Thêm dòng việc
                                    </button>
                                  </div>
                                </div>
                              ))}

                              {/* Difficulties in section I */}
                              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <h3 className="font-bold text-sm text-slate-900">
                                    {editCompletedGroups.length + 1}. Khó khăn, vướng mắc
                                  </h3>
                                </div>
                                <div className="space-y-2 pl-4">
                                  {editDifficulties.map((diff, dIdx) => (
                                    <div key={`diff-${dIdx}`} className="flex items-start gap-1.5">
                                      <span className="mt-1 text-slate-500 shrink-0 font-bold">-</span>
                                      <textarea
                                        value={diff}
                                        rows={1}
                                        onChange={e =>
                                          setEditDifficulties(prev =>
                                            prev.map((it, j) => (j === dIdx ? e.target.value : it)),
                                          )
                                        }
                                        placeholder="Nội dung tồn tại, khó khăn, vướng mắc..."
                                        className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm leading-5 text-slate-800 focus:border-blue-500 focus:outline-none resize-y"
                                      />
                                      <div className="flex items-center shrink-0">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setEditDifficulties(prev => moveItemInArray(prev, dIdx, dIdx - 1))
                                          }
                                          disabled={dIdx === 0}
                                          className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                          title="Chuyển lên"
                                          aria-label="Chuyển lên"
                                        >
                                          <ArrowUp className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setEditDifficulties(prev => moveItemInArray(prev, dIdx, dIdx + 1))
                                          }
                                          disabled={dIdx === editDifficulties.length - 1}
                                          className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                          title="Chuyển xuống"
                                          aria-label="Chuyển xuống"
                                        >
                                          <ArrowDown className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setEditDifficulties(prev => prev.filter((_, j) => j !== dIdx))
                                          }
                                          className="p-1 text-slate-400 hover:text-rose-600"
                                          title="Xóa dòng"
                                          aria-label="Xóa dòng"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => setEditDifficulties(prev => [...prev, ''])}
                                    className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-900 pt-1 font-sans"
                                  >
                                    <Plus className="h-3 w-3" /> Thêm khó khăn, vướng mắc
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* SECTION II EDIT */}
                          <div className="pt-4">
                            <div className="flex items-center justify-between pb-2 border-b">
                              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                                II. NHIỆM VỤ TUẦN {selected.plannedWeek}
                              </h2>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditPlannedGroups(prev => [
                                    ...prev,
                                    { name: `Nhóm việc ${prev.length + 1}`, items: [''] },
                                  ])
                                }
                                className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 font-sans"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Thêm nhóm
                              </button>
                            </div>

                            <div className="mt-3 space-y-4">
                              {editPlannedGroups.map((group, gIdx) => (
                                <div
                                  key={`p-group-${gIdx}`}
                                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                                >
                                  <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                      <span className="font-bold text-sm shrink-0">{gIdx + 1}.</span>
                                      <input
                                        type="text"
                                        value={group.name}
                                        onChange={e =>
                                          setEditPlannedGroups(prev =>
                                            prev.map((g, i) => (i === gIdx ? { ...g, name: e.target.value } : g)),
                                          )
                                        }
                                        placeholder="Tên nhóm nhiệm vụ..."
                                        className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
                                      />
                                    </div>
                                    {editPlannedGroups.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditPlannedGroups(prev => prev.filter((_, i) => i !== gIdx))
                                        }
                                        className="p-1 text-slate-400 hover:text-rose-600 rounded"
                                        title="Xóa nhóm"
                                        aria-label="Xóa nhóm"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    )}
                                  </div>

                                  <div className="space-y-2 pl-4">
                                    {group.items.map((item, iIdx) => (
                                      <div key={`p-item-${gIdx}-${iIdx}`} className="flex items-start gap-1.5">
                                        <span className="mt-1 text-slate-500 shrink-0 font-bold">-</span>
                                        <textarea
                                          value={item}
                                          rows={1}
                                          onChange={e =>
                                            setEditPlannedGroups(prev =>
                                              prev.map((g, i) =>
                                                i === gIdx
                                                  ? {
                                                      ...g,
                                                      items: g.items.map((it, j) => (j === iIdx ? e.target.value : it)),
                                                    }
                                                  : g,
                                              ),
                                            )
                                          }
                                          placeholder="Ví dụ: Hoàn tất tài liệu, xong trong ngày 30/10."
                                          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm leading-5 text-slate-800 focus:border-blue-500 focus:outline-none resize-y"
                                        />
                                        <div className="flex items-center shrink-0">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setEditPlannedGroups(prev =>
                                                prev.map((g, i) =>
                                                  i === gIdx
                                                    ? { ...g, items: moveItemInArray(g.items, iIdx, iIdx - 1) }
                                                    : g,
                                                ),
                                              )
                                            }
                                            disabled={iIdx === 0}
                                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                            title="Chuyển lên"
                                            aria-label="Chuyển lên"
                                          >
                                            <ArrowUp className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setEditPlannedGroups(prev =>
                                                prev.map((g, i) =>
                                                  i === gIdx
                                                    ? { ...g, items: moveItemInArray(g.items, iIdx, iIdx + 1) }
                                                    : g,
                                                ),
                                              )
                                            }
                                            disabled={iIdx === group.items.length - 1}
                                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                            title="Chuyển xuống"
                                            aria-label="Chuyển xuống"
                                          >
                                            <ArrowDown className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setEditPlannedGroups(prev =>
                                                prev.map((g, i) =>
                                                  i === gIdx
                                                    ? { ...g, items: g.items.filter((_, j) => j !== iIdx) }
                                                    : g,
                                                ),
                                              )
                                            }
                                            className="p-1 text-slate-400 hover:text-rose-600"
                                            title="Xóa dòng"
                                            aria-label="Xóa dòng"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditPlannedGroups(prev =>
                                          prev.map((g, i) => (i === gIdx ? { ...g, items: [...g.items, ''] } : g)),
                                        )
                                      }
                                      className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 pt-1 font-sans"
                                    >
                                      <Plus className="h-3 w-3" /> Thêm dòng nhiệm vụ
                                    </button>
                                  </div>
                                </div>
                              ))}

                              {/* BLD task toggle */}
                              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <label className="flex items-center gap-2 cursor-pointer font-sans text-xs sm:text-sm font-semibold text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={editIncludeBldTask}
                                    onChange={e => setEditIncludeBldTask(e.target.checked)}
                                    className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                                  />
                                  <span>Thêm dòng: “Thực hiện các nhiệm vụ khác theo chỉ đạo của BLĐ.”</span>
                                </label>
                              </div>
                            </div>
                          </div>

                          <div className="pt-4 flex justify-end gap-2 border-t font-sans">
                            <button
                              type="button"
                              onClick={cancelEditing}
                              disabled={saving}
                              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Hủy
                            </button>
                            <button
                              type="button"
                              onClick={() => void saveEditing()}
                              disabled={saving}
                              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
                            >
                              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                              {saving ? 'Đang lưu…' : 'Lưu bản sửa'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* VIEW MODE (PREVIEW ACCORDING TO STANDARD DRIVE TEMPLATE) */
                        <div className="text-slate-900 leading-normal" style={{ fontSize: '13pt', lineHeight: 1.25 }}>
                          {/* Centered Bold Title */}
                          <header className="text-center mb-6">
                            <h1 className="font-bold text-[14pt] leading-tight tracking-wide">
                              BÁO CÁO
                            </h1>
                            <p className="font-bold text-[14pt] leading-snug mt-0.5">
                              Kết quả tuần {selected.completedWeek}, nhiệm vụ dự kiến tuần {selected.plannedWeek}
                            </p>
                            <p className="font-bold text-[14pt] leading-snug">
                              ({selected.employeeName})
                            </p>
                          </header>

                          {/* SECTION I */}
                          <section className="mb-6">
                            <h2 className="font-bold text-[13pt] mb-2 uppercase">
                              I. KẾT QUẢ TUẦN {selected.completedWeek}
                            </h2>

                            <div className="space-y-3">
                              {displayCompletedGroups.map((group, gIdx) => (
                                <div key={`view-c-group-${gIdx}`}>
                                  <h3 className="font-bold text-[13pt] mb-1">
                                    {gIdx + 1}. {group.name || 'Công việc'}
                                  </h3>
                                  {group.items && group.items.length ? (
                                    <div className="space-y-1">
                                      {group.items.map((item, iIdx) => (
                                        <p key={`view-c-item-${gIdx}-${iIdx}`} className="leading-snug">
                                          - {item}
                                        </p>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="italic text-slate-500 leading-snug">
                                      - Không có nội dung được ghi nhận.
                                    </p>
                                  )}
                                </div>
                              ))}

                              {/* Difficulties */}
                              <div>
                                <h3 className="font-bold text-[13pt] mb-1">
                                  {displayCompletedGroups.length + 1}. Khó khăn, vướng mắc
                                </h3>
                                {selected.difficulties && selected.difficulties.length ? (
                                  <div className="space-y-1">
                                    {selected.difficulties.map((diff, dIdx) => (
                                      <p key={`view-diff-${dIdx}`} className="leading-snug">
                                        - {diff}
                                      </p>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="leading-snug">- Không có.</p>
                                )}
                              </div>
                            </div>
                          </section>

                          {/* SECTION II */}
                          <section>
                            <h2 className="font-bold text-[13pt] mb-2 uppercase">
                              II. NHIỆM VỤ TUẦN {selected.plannedWeek}
                            </h2>

                            <div className="space-y-3">
                              {displayPlannedGroups.map((group, gIdx) => (
                                <div key={`view-p-group-${gIdx}`}>
                                  <h3 className="font-bold text-[13pt] mb-1">
                                    {gIdx + 1}. {group.name || 'Công việc'}
                                  </h3>
                                  {group.items && group.items.length ? (
                                    <div className="space-y-1">
                                      {group.items.map((item, iIdx) => (
                                        <p key={`view-p-item-${gIdx}-${iIdx}`} className="leading-snug">
                                          - {item}
                                        </p>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="italic text-slate-500 leading-snug">
                                      - Chưa có nhiệm vụ dự kiến.
                                    </p>
                                  )}
                                </div>
                              ))}

                              {selected.includeBldTask !== false && (
                                <p className="leading-snug pt-1">
                                  - Thực hiện các nhiệm vụ khác theo chỉ đạo của BLĐ.
                                </p>
                              )}
                            </div>
                          </section>
                        </div>
                      )}
                    </article>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Manual Creation Dialog */}
      {createOpen && (
        <div
          className="fixed inset-0 z-[12000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm"
          onMouseDown={event => {
            if (event.target === event.currentTarget && !creating) setCreateOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="weekly-report-create-title"
            className="w-full max-w-md rounded-2xl border border-white/60 bg-white p-5 shadow-2xl"
          >
            <header className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <CalendarPlus className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="weekly-report-create-title" className="text-base font-extrabold text-slate-900">
                  Tạo báo cáo tuần của tôi
                </h2>
                <p className="mt-1 text-sm leading-5 text-slate-600">
                  Chọn tuần cần tổng hợp. Hệ thống sẽ lấy các công việc trong Lịch công tác của bạn để dựng bản báo cáo chuẩn.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                aria-label="Đóng"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="mt-5 space-y-2">
              {optionsLoading ? (
                <div className="grid min-h-24 place-items-center text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                weekOptions.map(option => (
                  <label
                    key={option.weekStart}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                      weekStart === option.weekStart
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="weekly-report-week"
                      value={option.weekStart}
                      checked={weekStart === option.weekStart}
                      onChange={() => setWeekStart(option.weekStart)}
                      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    <span>
                      <span className="block text-sm font-extrabold text-slate-800">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        Báo cáo tuần {option.completedWeek} · Kế hoạch tuần {option.plannedWeek}
                        {option.isDefault ? ' · Mặc định' : ''}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <footer className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void createReport()}
                disabled={!weekStart || optionsLoading || creating}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                {creating ? 'Đang tạo…' : 'Tạo báo cáo'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
