import React, { useEffect, useState } from 'react';
import type { DraftDate, ExaminationSession } from './types';
import { roundDates, sessionRounds } from './rounds';

/** Local calendar date, avoiding UTC shifts in countdown labels. */
export const todayIso = (value = new Date()) => {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
};
export const emptyDate = (): DraftDate => ({ day: '', month: '', year: '', planned: false, unknown: false });
export function normaliseBirthDate(value?: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}$/.test(raw)) return raw;
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const parts = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  let year = '', month = '', day = '';
  if (iso) [, year, month, day] = iso;
  else if (parts) {
    const [, first, second, last] = parts;
    year = last.length === 2 ? `20${last}` : last;
    if (Number(first) > 12) [day, month] = [first, second];
    else if (Number(second) > 12) [month, day] = [first, second];
    else [day, month] = [first, second];
  } else return raw;
  const candidate = new Date(Number(year), Number(month) - 1, Number(day));
  if (!Number.isInteger(Number(year)) || candidate.getFullYear() !== Number(year) || candidate.getMonth() !== Number(month) - 1 || candidate.getDate() !== Number(day)) return raw;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
export function BirthDateControl({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const normalized = normaliseBirthDate(value);
  const yearOnly = /^\d{4}$/.test(normalized);
  const years = Array.from({ length: new Date().getFullYear() - 1899 }, (_, index) => String(new Date().getFullYear() - index));
  const changeYearOnly = (checked: boolean) => {
    if (checked) onChange(/^\d{4}-/.test(normalized) ? normalized.slice(0, 4) : (/^\d{4}$/.test(normalized) ? normalized : ''));
    else onChange(/^\d{4}$/.test(normalized) ? '' : normalized);
  };
  return <div className="mt-1"><label className="mb-2 inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={yearOnly} onChange={event => changeYearOnly(event.currentTarget.checked)}/><span>Chỉ năm sinh</span></label>{yearOnly ? <select value={normalized} onChange={event => onChange(event.currentTarget.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="">Chọn năm sinh</option>{years.map(year => <option key={year} value={year}>{year}</option>)}</select> : <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : ''} onChange={event => onChange(event.currentTarget.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/>}</div>;
}
export function formatGrade(value?: string) { return String(value || '').trim().replace(/^khối\s*/i, ''); }
export function formatPersonName(value?: string) {
  return String(value || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
    .map(word => word.split('-').filter(Boolean).map(part => `${part.charAt(0).toLocaleUpperCase('vi-VN')}${part.slice(1).toLocaleLowerCase('vi-VN')}`).join('-'))
    .join(' ');
}
export function formatBirthDate(value?: string) {
  const normalized = normaliseBirthDate(value);
  if (/^\d{4}$/.test(normalized)) return normalized;
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (normalized || '—');
}
export function dateValue(value: DraftDate) {
  if (value.unknown) return { label: 'Ch\u01b0a c\u00f3 th\u00f4ng tin', date: '' };
  const hasMonthYear = Boolean(value.month && value.year);
  const hasFullDate = Boolean(value.day && hasMonthYear);
  if (!hasMonthYear) return { label: value.planned ? 'D\u1ef1 ki\u1ebfn' : '', date: '' };
  const raw = hasFullDate ? `${value.day}/${value.month}/${value.year}` : `Th\u00e1ng ${value.month}/${value.year}`;
  return { label: value.planned ? `D\u1ef1 ki\u1ebfn ${raw}` : raw, date: hasFullDate ? `${value.year}-${value.month.padStart(2, '0')}-${value.day.padStart(2, '0')}` : '' };
}
export function DateBadge({ label, date }: { label: string; date?: string }) {
  // Refresh just after local midnight, even when the module stays open overnight.
  const [today, setToday] = useState(() => todayIso());
  useEffect(() => {
    const refresh = () => setToday(todayIso());
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 2, 0);
    const timer = window.setTimeout(refresh, nextMidnight.getTime() - now.getTime());
    return () => window.clearTimeout(timer);
  }, [today]);
  const normalizedDate = String(date || '').trim();
  const labelText = String(label || '').trim() || 'Ch\u01b0a c\u00f3 th\u00f4ng tin';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return <span className="text-xs font-semibold text-slate-500">{labelText}</span>;
  const target = new Date(`${normalizedDate}T00:00:00`).getTime();
  const days = Math.round((target - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  if (!Number.isFinite(days)) return <span className="text-xs font-semibold text-slate-500">{labelText}</span>;
  const style = days < 0 ? 'border-blue-200 bg-blue-50 text-blue-700' : days <= 7 ? 'border-red-600 bg-red-600 text-white' : days <= 15 ? 'border-red-300 bg-white text-red-600' : days <= 31 ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return <span className={`inline-flex whitespace-nowrap rounded-lg border px-2.5 py-1 text-[11px] font-bold ${style}`}>{labelText} · {days < 0 ? '\u0110\u00e3 qua' : days === 0 ? 'H\u00f4m nay' : `C\u00f2n ${days} ng\u00e0y`}</span>;
}export function Metric({ label, value, icon: Icon, onClick }: { label: string; value: string; icon: React.ElementType; onClick?: () => void }) {
  const body = <><div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span><Icon className="h-5 w-5 text-[#001e40]" /></div><p className="mt-4 text-4xl font-extrabold text-[#001e40]">{value}</p></>;
  return onClick ? <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-[#001e40] hover:shadow-sm">{body}</button> : <div className="rounded-xl border border-slate-200 bg-white p-5">{body}</div>;
}
export function DeadlineLegend() { return <div className="flex flex-wrap gap-2 text-[10px] font-semibold"><span className="text-blue-700">Đã qua</span><span className="text-emerald-700">›1 tháng</span><span className="text-orange-700">≤1 tháng</span><span className="text-red-600">≤15 ngày</span><span className="rounded bg-red-600 px-1 text-white">≤7 ngày</span></div>; }
export function TimeField({ label, value, onChange }: { label: string; value: DraftDate; onChange: (value: DraftDate) => void }) {
  // Keep the selected value locally while the session editor serializes it to
  // label/date fields. This prevents a native select from snapping back before
  // the parent state has finished updating.
  const valueKey = [value.day, value.month, value.year, value.planned, value.unknown].join('|');
  const [draftValue, setDraftValue] = useState<DraftDate>(value);
  useEffect(() => setDraftValue(value), [valueKey]);

  const update = (key: keyof DraftDate, next: string | boolean) => {
    const nextValue = { ...draftValue, [key]: next };
    setDraftValue(nextValue);
    onChange(nextValue);
  };
  const setUnknown = (unknown: boolean) => {
    const nextValue = { ...draftValue, unknown, planned: unknown ? false : draftValue.planned };
    setDraftValue(nextValue);
    onChange(nextValue);
  };
  const plannedText = 'Thời gian dự kiến';
  const unknownText = 'Chưa có thông tin';
  return <fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-bold">{label}</legend><div className="mb-3 flex gap-4 text-xs font-semibold"><label className="inline-flex cursor-pointer items-center gap-1"><input className="cursor-pointer" type="checkbox" checked={Boolean(draftValue.planned)} disabled={Boolean(draftValue.unknown)} onChange={event => update('planned', event.currentTarget.checked)} /><span>{plannedText}</span></label><label className="inline-flex cursor-pointer items-center gap-1"><input className="cursor-pointer" type="checkbox" checked={Boolean(draftValue.unknown)} onChange={event => setUnknown(event.currentTarget.checked)} /><span>{unknownText}</span></label></div>{draftValue.unknown ? <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-500">{'Chưa có thông tin về thời gian.'}</p> : <><div className="grid grid-cols-3 gap-2">{(['day', 'month', 'year'] as const).map((part, index) => <select key={part} value={draftValue[part] || ''} onChange={event => update(part, event.currentTarget.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"><option value="">{index === 0 ? 'Ngày' : index === 1 ? 'Tháng' : 'Năm'}{index === 0 && draftValue.planned ? ' (tuỳ chọn)' : ''}</option>{Array.from({ length: index === 0 ? 31 : index === 1 ? 12 : 31 }, (_, itemIndex) => { const option = index === 2 ? new Date().getFullYear() - 10 + itemIndex : itemIndex + 1; return <option key={option} value={String(option)}>{option}</option>; })}</select>)}</div><p className="mt-2 text-[11px] text-slate-500">{draftValue.planned ? 'Dự kiến: bắt buộc tháng và năm; ngày có thể để trống.' : 'Chính thức: bắt buộc đủ ngày, tháng và năm.'}</p></>}</fieldset>;
}
type RoundMonthYear = { month: number; year: string };
const UNKNOWN_SESSION_TIME = 'Ch\u01b0a c\u00f3 th\u00f4ng tin';

function roundMonthYear(round: Pick<import('./types').SessionRound, 'date' | 'label'>): RoundMonthYear | null {
  const iso = String(round.date || '').trim().match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return { year: iso[1], month: Number(iso[2]) };
  const label = String(round.label || '').trim();
  const monthYear = label.match(/(?:th\u00e1ng\s*)?(\d{1,2})\s*\/\s*(\d{4})/i);
  if (monthYear && Number(monthYear[1]) >= 1 && Number(monthYear[1]) <= 12) return { year: monthYear[2], month: Number(monthYear[1]) };
  return null;
}

function monthYearText(value: RoundMonthYear) { return `T${value.month}/${value.year}`; }

export function sessionTimelineLabel(session: ExaminationSession) {
  const rounds = sessionRounds(session);
  const timings = rounds.map(roundMonthYear);
  if (timings.length && timings.every((timing): timing is RoundMonthYear => Boolean(timing))) {
    const first = timings[0];
    const last = timings[timings.length - 1];
    const firstText = monthYearText(first), lastText = monthYearText(last);
    return firstText === lastText ? firstText : `${firstText} - ${lastText}`;
  }
  const fallback = [
    ...timings,
    roundMonthYear({ date: session.nationalDate, label: session.national }),
    roundMonthYear({ date: session.internationalDate, label: session.international }),
  ].find((timing): timing is RoundMonthYear => Boolean(timing));
  return fallback?.year || UNKNOWN_SESSION_TIME;
}

export function sessionRecencyKey(session: ExaminationSession) {
  const keyOf = (round: Pick<import('./types').SessionRound, 'date' | 'label'>) => {
    const date = String(round.date || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const timing = roundMonthYear(round);
    return timing ? `${timing.year}-${String(timing.month).padStart(2, '0')}-01` : '';
  };
  const keys = [
    ...sessionRounds(session).map(keyOf),
    keyOf({ date: session.nationalDate, label: session.national }),
    keyOf({ date: session.internationalDate, label: session.international }),
  ].filter(Boolean).sort();
  return keys[keys.length - 1] || '0000-00-00';
}

export function sessionDisplayName(session: ExaminationSession) {
  return `${session.code}: ${sessionTimelineLabel(session)}`;
}
// A full page should remain easy to scan while avoiding the unbounded long lists.
// that made roster and import screens difficult to use.
export const LIST_PAGE_SIZE = 50;
export function TablePagination({ total, page, onPageChange, pageSize = LIST_PAGE_SIZE, label = 'mục' }: { total: number; page: number; onPageChange: (page: number) => void; pageSize?: number; label?: string }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = total ? (current - 1) * pageSize + 1 : 0;
  const end = Math.min(total, current * pageSize);
  if (total <= pageSize) return total ? <p className="border-t px-4 py-3 text-xs font-semibold text-slate-500">Hiển thị {start}–{end} / {total} {label}</p> : null;
  const pages = Array.from(new Set([1, current - 1, current, current + 1, pageCount].filter(item => item >= 1 && item <= pageCount))).sort((a, b) => a - b);
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"><p className="text-xs font-semibold text-slate-500">Hiển thị {start}–{end} / {total} {label}</p><div className="flex items-center gap-1"><button type="button" disabled={current === 1} onClick={() => onPageChange(current - 1)} className="rounded border px-2.5 py-1 text-xs font-bold text-[#001e40] disabled:cursor-not-allowed disabled:opacity-40">Trước</button>{pages.map((item, index) => <React.Fragment key={item}>{index > 0 && item - pages[index - 1] > 1 && <span className="px-1 text-xs text-slate-400">…</span>}<button type="button" onClick={() => onPageChange(item)} className={item === current ? 'rounded bg-[#001e40] px-2.5 py-1 text-xs font-bold text-white' : 'rounded border px-2.5 py-1 text-xs font-bold text-[#001e40]'}>{item}</button></React.Fragment>)}<button type="button" disabled={current === pageCount} onClick={() => onPageChange(current + 1)} className="rounded border px-2.5 py-1 text-xs font-bold text-[#001e40] disabled:cursor-not-allowed disabled:opacity-40">Sau</button></div></div>;
}
export function SessionsTable({ items, onSelect, showNearestRoundOnly = false }: { items: ExaminationSession[]; onSelect: (session: ExaminationSession) => void; showNearestRoundOnly?: boolean }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / LIST_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleItems = items.slice((currentPage - 1) * LIST_PAGE_SIZE, currentPage * LIST_PAGE_SIZE);
  useEffect(() => setPage(1), [items]);
  const rounds = (session: ExaminationSession) => sessionRounds(session).sort((a, b) => ((roundDates(a)[0] || a.date || '9999')).localeCompare(roundDates(b)[0] || b.date || '9999'));
  const closestRound = (session: ExaminationSession) => {
    const all = rounds(session);
    const today = todayIso();
    return all.find(round => roundDates(round).some(date => date >= today)) || all[all.length - 1];
  };
  return <><div className="overflow-x-auto"><table className="ft-table min-w-[1180px]"><thead><tr><th>Kỳ tổ chức</th><th>Cuộc thi mẹ</th><th>BTC quốc tế</th><th>Thời gian</th><th>Số thí sinh</th><th>{showNearestRoundOnly ? 'Vòng gần nhất' : 'Các vòng thi'}</th><th>Giai đoạn hiện tại</th><th>Ghi chú</th></tr></thead><tbody>{visibleItems.map(session => { const shownRounds = showNearestRoundOnly ? [closestRound(session)].filter(Boolean) : rounds(session); return <tr key={session.id} onClick={() => onSelect(session)} className="cursor-pointer hover:bg-blue-50/50"><td><b className="text-[#001e40]">{sessionDisplayName(session)}</b><p className="mt-1 max-w-52 text-xs text-slate-500">{session.name}</p></td><td>{session.competitionName || session.parent}</td><td>{session.organizer}</td><td>{sessionTimelineLabel(session)}</td><td className="text-center font-bold">{session.candidates.toLocaleString('vi-VN')}</td><td><div className="flex min-w-48 flex-col gap-1.5">{shownRounds.map(round => <div key={round.id}><p className="mb-0.5 text-[10px] font-bold text-slate-500">{round.name}</p><div className="flex flex-col gap-1">{roundDates(round).length ? roundDates(round).map(date => <DateBadge key={date} label={date.split('-').reverse().join('/')} date={date} />) : <DateBadge label={round.label} date={round.date} />}</div></div>)}</div></td><td><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold">{session.phase}</span></td><td className="max-w-60 text-sm text-slate-600">{session.note}</td></tr>})}</tbody></table></div><TablePagination total={items.length} page={currentPage} onPageChange={setPage} label="kỳ tổ chức"/></>;
}
