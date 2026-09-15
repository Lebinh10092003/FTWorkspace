import { createPortal } from "react-dom";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock, Edit3, FileText, Globe, Laptop, Loader2, MapPin, Moon, Plus, Save, Search, Trash2, TriangleAlert, UserCheck, Users, X } from 'lucide-react';
import Time24Input from './Time24Input';
import { appDialog } from './AppDialog';
import MonthlySheetLinkEditor from './MonthlySheetLinkEditor';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type TimesheetEntry = {
  id: number;
  workDate: string;
  shiftNumber: number;
  shiftStart: string;
  shiftEnd: string;
  crossesMidnight: boolean;
  workMode: 'direct' | 'online';
  isDayOff: boolean;
  notes: string;
  workedMinutes: number;
  employee?: { email: string; name: string; department: string };
};

type EditLog = {
  id: number;
  employeeEmail: string;
  employeeName: string;
  workDate: string;
  editedBy: string;
  editedByName: string;
  note: string;
  oldData: any;
  newData: any;
  createdAt: string;
};

type Employee = { email: string; name: string; department: string };

type TimesheetData = {
  serverTime: string;
  scope: string;
  month: string;
  isPrivileged: boolean;
  isAdmin: boolean;
  summaryCutoff: string;
  entries: TimesheetEntry[];
  summary: { totalMinutes: number; onlineMinutes: number; offlineMinutes: number };
  editLogs: EditLog[];
  employees: Employee[];
  trainingSummaryByEmployee: Record<string, { instructorSessions: number; supportSessions: number }>;
  requiredTimesheetDatesByEmployee: Record<string, string[]>;
};

type PrefillData = {
  targetDate: string;
  autoFill: boolean;
  shifts: { start: string; end: string; workMode: string; notes: string }[];
  yesterdayWarning: boolean;
  yesterdayDate: string;
  defaultWorkMode: string;
  defaultDayOff: boolean;
  existing: TimesheetEntry[];
  canEdit: boolean;
  isPrivileged: boolean;
  editLogs: EditLog[];
};

type ShiftRow = { start: string; end: string; workMode: 'direct' | 'online' };
type AttendanceProps = {
  onBackToWorkspace: () => void;
  idToken: string;
  userName: string;
  userEmail?: string;
  initialEditDate?: string;
  onInitialEditOpened?: () => void;
};

/* ------------------------------------------------------------------ */
/*  In-memory cache                                                    */
/* ------------------------------------------------------------------ */
const CACHE_TTL = 5 * 60 * 1000;
let cache: { owner: string; month: string; savedAt: number; data: TimesheetData } | null = null;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const fmtHours = (mins: number) => (mins / 60).toFixed(2).replace(/\.?0+$/, '') || '0';
const fmtDate = (v: string) => { const [y, m, d] = v.split('-'); return `${d}/${m}/${y}`; };
const fmtMonthLabel = (v: string) => { const [y, m] = v.split('-'); return `${m}/${y}`; };
const modeLabel = (m: string) => m === 'online' ? 'Online' : 'Trực tiếp';
const FIXED_HOLIDAYS = new Set(['01-01', '04-30', '05-01', '09-02']);

/** Format edit log old/new data into readable text */
const formatLogShifts = (data: any) => {
  if (!data?.shifts?.length) return 'Trống';
  const shifts = data.shifts as { shift: number; start: string; end: string; mode: string; dayOff: boolean; notes: string }[];
  if (shifts[0]?.dayOff) return 'Nghỉ';
  return shifts.map(s => `${s.mode === 'online' ? 'Online' : 'Trực tiếp'}: ${s.start} - ${s.end}`).join(', ');
};
const WEEKDAYS_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const WEEKDAYS_VI_LONG = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const weekdayName = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return WEEKDAYS_VI[d.getDay()]; };
const weekdayLongName = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return WEEKDAYS_VI_LONG[d.getDay()]; };
const todayIso = () => new Date().toISOString().slice(0, 10);
const yesterdayIso = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
/** Summaries cover completed days only: up to the end of yesterday, never past the shown month. */
const summaryCutoffFor = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const lastOfMonth = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const yesterday = yesterdayIso();
  return yesterday < lastOfMonth ? yesterday : lastOfMonth;
};
const isWeekend = (iso: string) => { const d = new Date(`${iso}T00:00:00`).getDay(); return d === 0 || d === 6; };
const isFixedHoliday = (iso: string) => FIXED_HOLIDAYS.has(iso.slice(5));
const isDefaultDayOff = (iso: string) => isWeekend(iso) || isFixedHoliday(iso);
const scheduleSignature = (data: any) => (data?.shifts || []).map((shift: any) =>
  shift.dayOff ? 'off' : `${shift.start || ''}-${shift.end || ''}`,
).join('|');
const hasScheduleChange = (log: EditLog) => scheduleSignature(log.oldData) !== scheduleSignature(log.newData);

/** Get all dates in a month as YYYY-MM-DD strings */
const monthDates = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

const editLogText = (log: EditLog) => {
  const change = `${formatLogShifts(log.oldData)} → ${formatLogShifts(log.newData)}`;
  const reason = log.note ? ` · ${log.note}` : '';
  return `${new Date(log.createdAt).toLocaleString('vi-VN')} · ${log.editedByName}: ${change}${reason}`;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function Attendance({ onBackToWorkspace, idToken, userName, userEmail, initialEditDate, onInitialEditOpened }: AttendanceProps) {
  const initialMonth = currentMonth();
  const cached = cache?.owner === idToken && cache.month === initialMonth && Date.now() - cache.savedAt < CACHE_TTL ? cache : null;

  const [data, setData] = useState<TimesheetData | null>(cached?.data ?? null);
  const [month, setMonth] = useState(initialMonth);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Employee sidebar (privileged)
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [empSearch, setEmpSearch] = useState('');

  // Popup
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupLoading, setPopupLoading] = useState(false);
  const popupLoadSeqRef = useRef(0);
  const popupOpenKeyRef = useRef<string | null>(null);
  const closePopup = () => { popupLoadSeqRef.current += 1; popupOpenKeyRef.current = null; setPopupOpen(false); };
  const [popupDate, setPopupDate] = useState('');
  const [isDayOff, setIsDayOff] = useState(false);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [prefill, setPrefill] = useState<PrefillData | null>(null);
  const [saving, setSaving] = useState(false);
  const [popupError, setPopupError] = useState('');
  const [isEdit, setIsEdit] = useState(false);

  /* ---------- Data loading ---------- */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // The API safely reduces non-privileged users back to their own scope. Asking
      // for the full scope up front lets admins/accounting receive the employee list
      // on the very first request, including employees without timesheet entries.
      const res = await fetch(`/api/attendance/timesheet?month=${month}&scope=all`, { headers: { Authorization: `Bearer ${idToken}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Không thể tải dữ liệu.');
      setData(body);
      cache = { owner: idToken, month, savedAt: Date.now(), data: body };
      setError('');
    } catch (e: any) {
      setError(e.message || 'Không thể tải dữ liệu.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [month, idToken]);

  useEffect(() => {
    const reusable = cache?.owner === idToken && cache.month === month && Date.now() - cache.savedAt < CACHE_TTL;
    if (reusable) setData(cache!.data);
    void load(Boolean(reusable));
  }, [month, idToken]);

  useEffect(() => {
    const refresh = window.setInterval(() => void load(true), 30_000);
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void load(true); };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [load]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(t); }, [notice]);

  /* ---------- Filtered employees ---------- */
  const filteredEmployees = useMemo(() => {
    if (!data?.employees?.length) return [];
    const q = empSearch.toLowerCase().trim();
    if (!q) return data.employees;
    return data.employees.filter(e => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q));
  }, [data?.employees, empSearch]);

  /* ---------- Entries for selected view ---------- */
  const viewEntries = useMemo(() => {
    if (!data) return [];
    if (data.scope === 'mine') return data.entries;
    const target = selectedEmployee || userEmail || '';
    if (!target) return data.entries;
    return data.entries.filter(e => e.employee?.email === target);
  }, [data, selectedEmployee, userEmail]);

  /* ---------- Map entries by date ---------- */
  const entriesByDate = useMemo(() => {
    const map = new Map<string, TimesheetEntry[]>();
    for (const e of viewEntries) {
      const list = map.get(e.workDate) || [];
      list.push(e);
      map.set(e.workDate, list);
    }
    return map;
  }, [viewEntries]);

  const requiredTimesheetDates = useMemo(() => {
    const target = selectedEmployee || userEmail || '';
    return new Set(data?.requiredTimesheetDatesByEmployee?.[target] || []);
  }, [data?.requiredTimesheetDatesByEmployee, selectedEmployee, userEmail]);
  const isEffectiveDayOff = (date: string) => isDefaultDayOff(date) && !requiredTimesheetDates.has(date);

  /* ---------- Summary cutoff: end of yesterday ---------- */
  const summaryCutoff = useMemo(() => summaryCutoffFor(month), [month]);

  /* ---------- Summary (completed days only) ---------- */
  const summary = useMemo(() => {
    const counted = viewEntries.filter(e => !e.isDayOff && e.workDate <= summaryCutoff);
    const total = counted.reduce((s, e) => s + e.workedMinutes, 0);
    const online = counted.reduce((s, e) => s + (e.workMode === 'online' ? e.workedMinutes : 0), 0);
    const offline = counted.reduce((s, e) => s + (e.workMode === 'direct' ? e.workedMinutes : 0), 0);
    return { totalMinutes: total, onlineMinutes: online, offlineMinutes: offline };
  }, [viewEntries, summaryCutoff]);

  /* ---------- All dates in the month ---------- */
  const allDates = useMemo(() => monthDates(month), [month]);

  /* ---------- Edit logs for selected person ---------- */
  const viewEditLogs = useMemo(() => {
    if (!data?.editLogs?.length) return [];
    if (data.scope === 'mine') return data.editLogs;
    const target = selectedEmployee || userEmail || '';
    if (!target) return data.editLogs;
    return data.editLogs.filter(log => log.employeeEmail === target);
  }, [data, selectedEmployee, userEmail]);

  const editLogsByDate = useMemo(() => {
    const map = new Map<string, EditLog[]>();
    for (const log of viewEditLogs.filter(hasScheduleChange)) map.set(log.workDate, [...(map.get(log.workDate) || []), log]);
    return map;
  }, [viewEditLogs]);

  /* ---------- Missing weekday dates (for warning) ---------- */
  const missingWeekdays = useMemo(() => {
    const today = todayIso();
    return allDates.filter(d => {
      if (d >= today) return false; // don't warn about future/today
      if (isEffectiveDayOff(d)) return false;
      return !entriesByDate.has(d);
    });
  }, [allDates, entriesByDate, requiredTimesheetDates]);

  /* ---------- Open popup ---------- */
  const openPopup = async (dateOverride?: string, dayOffOverride?: boolean) => {
    setPopupError('');
    const targetDate = dateOverride || todayIso();
    if (targetDate > todayIso()) {
      void appDialog.alert('Không thể cập nhật công ca cho ngày trong tương lai.', { title: 'Ngày chưa thể cập nhật', tone: 'warning' });
      return;
    }
    const openKey = `${selectedEmployee}|${targetDate}|${dayOffOverride ?? ""}`;
    if (popupOpenKeyRef.current === openKey) return;
    popupOpenKeyRef.current = openKey;
    const loadSeq = ++popupLoadSeqRef.current;
    setPopupLoading(true);
    setPopupDate(targetDate);
    setPopupOpen(true);
    setIsDayOff(false);
    setShifts([]);
    setPrefill(null);
    setIsEdit(false);

    try {
      const employee = selectedEmployee ? `&employee=${encodeURIComponent(selectedEmployee)}` : '';
      const res = await fetch(`/api/attendance/timesheet/prefill?date=${targetDate}${employee}`, { headers: { Authorization: `Bearer ${idToken}` } });
      const body: PrefillData = await res.json();
      if (!res.ok) throw new Error((body as any).error || 'Không thể tải công ca.');
      if (loadSeq !== popupLoadSeqRef.current) return;
      setPrefill(body);

      if (body.existing.length > 0) {
        setIsEdit(true);
        const first = body.existing[0];
        if (first.isDayOff && dayOffOverride === false) {
          const mode = (body.defaultWorkMode || 'direct') as 'direct' | 'online';
          setIsDayOff(false);
          setShifts([{ start: '08:00', end: '12:00', workMode: mode }]);
        } else if (first.isDayOff) {
          setIsDayOff(true);
          setShifts([]);
        } else {
          setIsDayOff(false);
          setShifts(body.existing.map(e => ({ start: e.shiftStart, end: e.shiftEnd, workMode: e.workMode })));
        }
      } else if (dayOffOverride ?? body.defaultDayOff ?? isDefaultDayOff(targetDate)) {
        setIsDayOff(true);
        setShifts([]);
      } else if (body.shifts.length > 0) {
        setShifts(body.shifts.map(s => ({ start: s.start, end: s.end, workMode: s.workMode as 'direct' | 'online' })));
      } else {
        const mode = (body.defaultWorkMode || 'direct') as 'direct' | 'online';
        setShifts([{ start: '08:00', end: '12:00', workMode: mode }]);
      }
    } catch (cause: any) {
      if (loadSeq === popupLoadSeqRef.current) setPopupError(cause.message || 'Không thể tải công ca. Vui lòng thử lại.');
    } finally {
      if (loadSeq === popupLoadSeqRef.current) setPopupLoading(false);
    }
  };

  useEffect(() => {
    if (!initialEditDate) return;
    setMonth(initialEditDate.slice(0, 7));
    void openPopup(initialEditDate).finally(() => onInitialEditOpened?.());
  }, [initialEditDate]);

  /* ---------- Quick mark day off ---------- */
  const quickDayOff = async (dateStr: string) => {
    if (dateStr > todayIso()) {
      void appDialog.alert('Không thể đánh dấu nghỉ cho ngày trong tương lai.', { title: 'Ngày chưa thể cập nhật', tone: 'warning' });
      return;
    }
    try {
      const existing = entriesByDate.get(dateStr);
      const payload: any = { workDate: dateStr, isDayOff: true };
      if (selectedEmployee) payload.employeeEmail = selectedEmployee;
      const res = await fetch('/api/attendance/timesheet/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Không thể ghi nhận ngày nghỉ.');
      setNotice(`Đã ghi nhận nghỉ làm ngày ${fmtDate(dateStr)}`);
      window.dispatchEvent(new CustomEvent('ft-timesheet-saved', { detail: { date: dateStr } }));
      await load(true);
    } catch (e: any) {
      setError(e.message || 'Không thể ghi nhận ngày nghỉ.');
    }
  };

  /* ---------- Delete a note (admin only) ---------- */
  const deleteNote = async (log: EditLog) => {
    const confirmed = await appDialog.confirm(
      `Xóa ghi chú ngày ${fmtDate(log.workDate)} của ${log.employeeName}?`,
      { title: 'Xóa ghi chú', tone: 'danger', confirmText: 'Xóa' },
    );
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/attendance/timesheet/log/${log.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Không thể xóa ghi chú.');
      setData(prev => (prev ? { ...prev, editLogs: prev.editLogs.filter(item => item.id !== log.id) } : prev));
      setNotice(body.message || 'Đã xóa ghi chú.');
      await load(true);
    } catch (e: any) {
      setError(e.message || 'Không thể xóa ghi chú.');
    }
  };

  /* ---------- Save ---------- */
  const saveTimesheet = async () => {
    if (popupLoading || !prefill || saving) return;
    if (popupDate > todayIso()) {
      setPopupError('Không thể cập nhật công ca cho ngày trong tương lai.');
      return;
    }
    setSaving(true);
    setPopupError('');
    try {
      const payload: any = { workDate: popupDate, isDayOff };
      if (selectedEmployee) payload.employeeEmail = selectedEmployee;
      if (!isDayOff) {
        payload.shifts = shifts.map(s => ({ start: s.start, end: s.end, workMode: s.workMode }));
      }
      const res = await fetch('/api/attendance/timesheet/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Không thể lưu.');
      setNotice(body.message || 'Đã lưu công ca.');
      closePopup();
      window.dispatchEvent(new CustomEvent('ft-timesheet-saved', { detail: { date: popupDate } }));
      await load(true);
    } catch (e: any) {
      setPopupError(e.message || 'Không thể lưu.');
    } finally {
      setSaving(false);
    }
  };

  /* ---------- Shift row helpers ---------- */
  const updateShift = (idx: number, field: keyof ShiftRow, value: string) => {
    setShifts(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };
  const removeShift = (idx: number) => setShifts(prev => prev.filter((_, i) => i !== idx));
  const addShift = () => {
    const mode = (prefill?.defaultWorkMode || 'direct') as 'direct' | 'online';
    setShifts(prev => [...prev, { start: '13:30', end: '17:30', workMode: mode }]);
  };

  const isPrivileged = data?.isPrivileged ?? false;
  const isAdmin = data?.isAdmin ?? false;
  const selectedEmpName = data?.employees?.find(e => e.email === selectedEmployee)?.name;
  const summaryEmployeeEmail = selectedEmployee || userEmail || '';
  const trainingSummary = data?.trainingSummaryByEmployee?.[summaryEmployeeEmail];

  return (
    <div className="workspace-module-canvas flex min-h-dvh items-start bg-slate-50 font-sans text-slate-900">
      {/* Employee sidebar (privileged only) */}
      {isPrivileged && (
        <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col overflow-hidden border-r bg-white lg:flex">
          <div className="border-b px-4 py-4">
            <button type="button" onClick={onBackToWorkspace} className="ft-btn ft-btn-secondary w-full justify-center"><ArrowLeft className="h-4 w-4" />Workspace</button>
          </div>
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-extrabold text-emerald-700"><Users className="h-4 w-4" />Nhân viên</div>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="text" value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="Tìm theo họ tên..." className="ft-input pl-8 text-sm" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <button type="button" onClick={() => setSelectedEmployee('')} className={`flex w-full items-center gap-2 border-b px-4 py-2.5 text-left text-sm transition ${!selectedEmployee ? 'bg-emerald-50 font-bold text-emerald-800' : 'text-slate-600 hover:bg-slate-50'}`}>
              <UserCheck className="h-4 w-4 shrink-0" />Bảng công của tôi
            </button>
            {filteredEmployees.map(emp => (
              <button key={emp.email} type="button" onClick={() => setSelectedEmployee(emp.email)} className={`flex w-full flex-col border-b px-4 py-2 text-left transition ${selectedEmployee === emp.email ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                <span className={`text-sm ${selectedEmployee === emp.email ? 'font-bold text-emerald-800' : 'font-medium text-slate-700'}`}>{emp.name}</span>
                {emp.department && <span className="text-[11px] text-slate-400">{emp.department}</span>}
              </button>
            ))}
            {filteredEmployees.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">Không tìm thấy.</p>}
          </div>
        </aside>
      )}

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 shrink-0 border-b bg-white/90 backdrop-blur-xl">
          <div className="mx-auto flex h-24 max-w-[1400px] items-center justify-between px-5 sm:px-8">
            {!isPrivileged && <button type="button" onClick={onBackToWorkspace} className="ft-btn ft-btn-secondary"><ArrowLeft className="h-4 w-4" />Workspace</button>}
            <div className="flex items-center gap-3"><div className="grid h-14 w-14 place-items-center rounded-xl bg-emerald-700 text-white"><UserCheck className="h-8 w-8" /></div><span className="text-xl font-extrabold">Công ca{selectedEmpName ? ` — ${selectedEmpName}` : ''}</span></div>
            <div className="hidden text-right sm:block"><p className="text-xl font-extrabold text-slate-600">{new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date())}</p></div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-8 sm:px-8 sm:py-10">
          {/* Title row */}
          <section className="mb-7">
            <p className="text-xl font-extrabold uppercase tracking-wide text-emerald-700 sm:text-2xl">Xin chào, {userName}</p>
          </section>

          {error && <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /><span>{error}</span></div>}

          {/* Missing weekday warnings (no buttons) */}
          {missingWeekdays.length > 0 && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-bold text-amber-900">Các ngày chưa có công ca trong tháng:</p>
                  <p className="mt-1 text-sm text-amber-800">{missingWeekdays.map(d => fmtDate(d)).join(', ')}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            {/* Monthly grid table */}
            <div className="min-w-0 rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-emerald-600">Bảng công{selectedEmpName ? ` — ${selectedEmpName}` : ''}</p>
                  <h2 className="mt-1 text-xl font-extrabold">Tháng {fmtMonthLabel(month)}</h2>
                </div>
                <label><span className="sr-only">Chọn tháng</span><input type="month" value={month} onChange={e => setMonth(e.target.value)} className="ft-input" /></label>
              </div>

              <div className="mt-5 overflow-x-auto rounded-xl border">
                <table className="ft-table min-w-[1160px] table-fixed text-sm">
                  <colgroup>
                    <col className="w-16" />
                    <col className="w-56" />
                    <col className="w-20" />
                    <col className="w-28" />
                    <col className="w-28" />
                    <col className="w-28" />
                    <col className="w-28" />
                    <col className="w-56" />
                  </colgroup>
                  <thead className="sticky top-0 z-10"><tr><th>Thứ</th><th>Ngày</th><th>Ca</th><th>Giờ bắt đầu</th><th>Giờ kết thúc</th><th>Số giờ làm</th><th>Hình thức</th><th>Ghi chú</th></tr></thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={8} className="px-5 py-14 text-center text-slate-400">Đang tải...</td></tr>
                    ) : allDates.map(dateStr => {
                      const originalEntries = entriesByDate.get(dateStr) || [];
                      const entries: Array<TimesheetEntry | null> = originalEntries.length ? originalEntries : [null];
                      const weekend = isWeekend(dateStr);
                      const hasDayOff = originalEntries.some(e => e.isDayOff);
                      const hasEntries = originalEntries.length > 0;
                      const defaultDayOff = isEffectiveDayOff(dateStr);
                      const markedDayOff = hasDayOff || (!hasEntries && defaultDayOff);
                      const dayTotal = originalEntries.reduce((total, entry) => total + (entry.isDayOff ? 0 : entry.workedMinutes), 0);
                      const isPast = dateStr < todayIso();
                      const isFuture = dateStr > todayIso();
                      const logs = editLogsByDate.get(dateStr) || [];
                      const showDailyTotal = !markedDayOff;
                      const rowSpan = entries.length + (showDailyTotal ? 1 : 0);

                      return (
                        <React.Fragment key={dateStr}>
                          {entries.map((entry, index) => (
                            <tr key={`${dateStr}-${entry?.id || 'empty'}`} className={`${defaultDayOff ? 'bg-slate-50' : ''} ${!hasEntries && isPast && !defaultDayOff ? 'bg-amber-50/40' : ''} hover:bg-blue-50/50`}>
                              {index === 0 && <td rowSpan={rowSpan} className={`align-top text-base font-extrabold ${weekend ? 'text-rose-500' : ''}`}>{weekdayName(dateStr)}</td>}
                              {index === 0 && <td rowSpan={rowSpan} className="align-top">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="whitespace-nowrap text-base font-bold tabular-nums">{fmtDate(dateStr)}</span>
                                  <button type="button" disabled={isFuture} onClick={() => void openPopup(dateStr)} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400" title={isFuture ? 'Không thể cập nhật công ca trong tương lai' : 'Chỉnh sửa công ca'}><Edit3 className="h-4 w-4" /></button>
                                </div>
                                <label className={`mt-2 flex items-start gap-2 text-xs font-semibold leading-4 text-amber-800 ${isFuture ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                                  <input
                                    type="checkbox"
                                    checked={markedDayOff}
                                    disabled={isFuture}
                                    onChange={event => event.target.checked ? void quickDayOff(dateStr) : void openPopup(dateStr, false)}
                                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
                                  />
                                  <span>Tích vào đây nếu là ngày nghỉ</span>
                                </label>
                              </td>}
                              <td className="font-bold text-slate-700">{entry ? (entry.isDayOff ? 'Ngày nghỉ' : `Ca ${entry.shiftNumber}`) : (markedDayOff ? 'Ngày nghỉ' : '—')}</td>
                              <td className="font-semibold tabular-nums">{entry && !entry.isDayOff ? entry.shiftStart : '—'}</td>
                              <td className="font-semibold tabular-nums">{entry && !entry.isDayOff ? entry.shiftEnd : '—'}</td>
                              <td className="font-bold tabular-nums">{entry && !entry.isDayOff ? `${fmtHours(entry.workedMinutes)} giờ` : '—'}</td>
                              <td>{entry && !entry.isDayOff ? <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${entry.workMode === 'online' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>{modeLabel(entry.workMode)}</span> : '—'}</td>
                              {index === 0 && <td rowSpan={rowSpan} className="align-top text-xs leading-5 text-slate-600">
                                {logs.map(log => (
                                  <p key={log.id} className="mb-1 flex items-start gap-1 rounded-lg bg-amber-50 px-2 py-1 text-amber-800">
                                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span className="min-w-0 flex-1">{editLogText(log)}</span>
                                    {isAdmin && <button type="button" onClick={() => void deleteNote(log)} title="Xóa ghi chú" className="shrink-0 rounded p-0.5 text-amber-500 transition hover:bg-rose-100 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>}
                                  </p>
                                ))}
                                {logs.length === 0 && <span className={!hasEntries && isPast && !defaultDayOff ? 'text-amber-500' : 'text-slate-300'}>{!hasEntries && isPast && !defaultDayOff ? 'Chưa có công ca' : '—'}</span>}
                              </td>}
                            </tr>
                          ))}
                          {showDailyTotal && <tr className="bg-emerald-50/40 font-bold">
                            <td colSpan={3} className="text-right text-xs uppercase tracking-wide text-slate-500">Tổng giờ trong ngày</td>
                            <td className="whitespace-nowrap tabular-nums text-emerald-800">{fmtHours(dayTotal)} giờ</td>
                            <td aria-hidden="true">—</td>
                          </tr>}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Fixed right rail: summary and monthly Sheet link stay together. */}
            <div className="space-y-4 xl:sticky xl:top-28 xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">
              <aside className="rounded-2xl border bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase text-emerald-600">Tổng quan{selectedEmpName ? ` — ${selectedEmpName}` : ''}</p>
                <h2 className="mt-1 text-xl font-extrabold">Tháng {fmtMonthLabel(month)}</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">Tính đến hết {weekdayLongName(summaryCutoff)}, ngày {fmtDate(summaryCutoff)}</p>
                <div className="mt-5 space-y-5">
                  <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><Clock className="h-5 w-5" /></div><div><p className="text-2xl font-extrabold">{fmtHours(summary.totalMinutes)} giờ</p><p className="text-xs text-slate-500">Tổng giờ làm</p></div></div>
                  <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-100 text-blue-700"><MapPin className="h-5 w-5" /></div><div><p className="text-2xl font-extrabold">{fmtHours(summary.offlineMinutes)} giờ</p><p className="text-xs text-slate-500">Trực tiếp</p></div></div>
                  <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-violet-100 text-violet-700"><Laptop className="h-5 w-5" /></div><div><p className="text-2xl font-extrabold">{fmtHours(summary.onlineMinutes)} giờ</p><p className="text-xs text-slate-500">Online</p></div></div>
                  {trainingSummary && <>
                    <div className="border-t border-slate-100 pt-5"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-100 text-cyan-700"><Users className="h-5 w-5" /></div><div><p className="text-2xl font-extrabold">{trainingSummary.instructorSessions}</p><p className="text-xs text-slate-500">Số buổi tập huấn (Giảng viên)</p></div></div></div>
                    <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700"><UserCheck className="h-5 w-5" /></div><div><p className="text-2xl font-extrabold">{trainingSummary.supportSessions}</p><p className="text-xs text-slate-500">Số buổi hỗ trợ tập huấn (Nhân viên hỗ trợ)</p></div></div>
                  </>}
                </div>
              </aside>
              {isAdmin && <MonthlySheetLinkEditor
                idToken={idToken}
                month={month}
                module="attendance"
                title="Trang tính Công ca"
                description="Liên kết theo từng tháng; chỉ Admin nhìn thấy và chỉnh sửa."
              />}
            </div>
          </div>
        </main>
      </div>{/* end flex-1 wrapper */}

      {/* ---------- Popup ---------- */}
      {popupOpen && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) closePopup(); }}>
          <div role="dialog" aria-modal="true" aria-label="Chỉnh sửa công ca" className="w-full min-w-0 max-w-3xl rounded-2xl border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <p className="text-xs font-bold uppercase text-emerald-600">{isEdit ? 'Chỉnh sửa' : 'Thêm mới'}</p>
                <h2 className="mt-0.5 text-lg font-extrabold">Công ca ngày {fmtDate(popupDate)}</h2>
              </div>
              <button type="button" onClick={() => setPopupOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
              {popupLoading ? <p role="status" className="py-8 text-center text-sm text-slate-500">Đang tải công ca…</p> : <>
              {/* Date picker + day off */}
              <div className="grid grid-cols-2 gap-4">
                <label className="block"><span className="mb-1 block text-sm font-bold">Ngày</span><input type="date" max={todayIso()} className="ft-input" value={popupDate} onChange={e => { setPopupDate(e.target.value); void openPopup(e.target.value); }} /></label>
                <div className="flex items-end pb-0.5">
                  <label className="flex items-center gap-2 text-sm font-bold">
                    <input type="checkbox" checked={isDayOff} onChange={e => {
                      const checked = e.target.checked;
                      setIsDayOff(checked);
                      if (!checked && shifts.length === 0) {
                        const mode = (prefill?.defaultWorkMode || 'direct') as 'direct' | 'online';
                        setShifts([{ start: '08:00', end: '12:00', workMode: mode }]);
                      }
                    }} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                    <Moon className="h-4 w-4 text-amber-600" /> Tích vào đây nếu là ngày nghỉ
                  </label>
                </div>
              </div>

              {/* Shift rows */}
              {!isDayOff && (
                <div className="mt-5 space-y-3">
                  <p className="text-xs font-bold uppercase text-slate-500">Các ca làm việc</p>
                  {shifts.map((shift, idx) => (
                    <div key={idx} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border bg-slate-50 px-4 py-3">
                      <div className="grid min-w-0 grid-cols-2 gap-3">
                        <label><span className="mb-1 block text-xs font-bold text-slate-500">Bắt đầu (24h)</span><Time24Input label="Bắt đầu" value={shift.start} onChange={value => updateShift(idx, 'start', value)} /></label>
                        <label><span className="mb-1 block text-xs font-bold text-slate-500">Kết thúc (24h)</span><Time24Input label="Kết thúc" value={shift.end} onChange={value => updateShift(idx, 'end', value)} /></label>
                      </div>
                      <div className="col-span-2 min-w-0 sm:col-span-1">
                        <span className="mb-1 block text-xs font-bold text-slate-500">Hình thức</span>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button type="button" onClick={() => updateShift(idx, 'workMode', 'direct')} className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-bold transition ${shift.workMode === 'direct' ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-slate-200 bg-white text-slate-500 hover:border-emerald-200'}`}><MapPin className="h-3 w-3" />Trực tiếp</button>
                          <button type="button" onClick={() => updateShift(idx, 'workMode', 'online')} className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-bold transition ${shift.workMode === 'online' ? 'border-blue-300 bg-blue-100 text-blue-800' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200'}`}><Globe className="h-3 w-3" />Online</button>
                        </div>
                      </div>
                      <div className="flex items-end pb-1">
                        {shifts.length > 1 && <button type="button" onClick={() => removeShift(idx)} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    </div>
                  ))}
                  {shifts.length < 10 && (
                    <button type="button" onClick={addShift} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-2.5 text-sm font-bold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-700"><Plus className="h-4 w-4" />Thêm ca</button>
                  )}
                </div>
              )}

              {/* Edit logs for this date */}
              {prefill?.editLogs && prefill.editLogs.filter(hasScheduleChange).length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-bold text-slate-500"><FileText className="mr-1 inline h-3.5 w-3.5" />Lịch sử chỉnh sửa ngày này</p>
                  <div className="mt-1.5 max-h-28 space-y-1 overflow-y-auto">
                    {prefill.editLogs.filter(hasScheduleChange).map(log => (
                      <div key={log.id} className="rounded-lg border bg-slate-50 px-3 py-1.5 text-xs">
                        <p className="text-slate-600">{editLogText(log)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {popupError && <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{popupError}{!prefill && <button type="button" onClick={() => { popupOpenKeyRef.current = null; void openPopup(popupDate); }} className="ml-3 underline">Thử tải lại</button>}</div>}
              </>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
              <button type="button" onClick={() => setPopupOpen(false)} className="ft-btn ft-btn-secondary">Hủy</button>
              <button type="button" onClick={() => void saveTimesheet()} disabled={saving || popupLoading || !prefill || popupDate > todayIso() || (!isDayOff && shifts.length === 0)} className="ft-btn ft-btn-primary">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Toast */}
      {notice && <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white shadow-2xl" role="status"><UserCheck className="h-4 w-4 text-emerald-300" />{notice}</div>}
    </div>
  );
}
