import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BellRing, CheckCircle2, Copy, DoorOpen, ExternalLink, Link2, Loader2, Mail, Phone, Plus, RefreshCw, Search, Settings2, X } from 'lucide-react';
import type { Duty } from './InvigilationReminders';
import { dutyDate, dutyTime } from './invigilationTiming';

export type Entry = { code: string; sbd?: string; name: string; school: string; grade: string; className?: string; birthDate?: string; email?: string; phone?: string; parent?: string; attendance: string; score: string; note: string; revision: string; updatedBy?: string; updatedAt?: string; autoAbsent?: boolean };
export type Shift = Duty & { roster: Entry[]; pendingSheetCount: number; sheetError: boolean; revision: string; occurrenceId: string; sheetTab?: string; examRoomId?: string; guestUrl?: string; guestName?: string; guestEmail?: string };
type Room = { id: string; label: string; roomNumber: string; roundName: string; occurrenceId: string; link: string; candidateCount: number };
type Employee = { email: string; name: string; employeeCode: string };
type Form = { id?: string; revision?: string; examRoomId: string; label: string; roundName: string; occurrenceId: string; roomNumber: string; startsAt: string; endsAt: string; roomLink: string; invigilatorEmails: string[]; enabled: boolean; guestName: string; guestEmail: string };
type PlanRoom = { key: string; link: string; label: string; roomNumber: string; existingRoomId: string; candidates: number; moving: number; alreadySeated: number; missingDate: number; firstSbd: string };
type RoomPlan = { roundId: string; roundName: string; occurrenceId: string; occurrenceLabel: string; date: string; time: string; startsAt: string; endsAt: string; rooms: PlanRoom[]; unresolved: number };
type SessionOption = { id: string; code: string; name: string };

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#001e40] focus:outline-none';
const ATTENDANCE = [
  { value: 'Có mặt', short: 'Có mặt', active: 'bg-emerald-600 text-white border-emerald-600' },
  { value: 'Đến muộn', short: 'Muộn', active: 'bg-amber-500 text-white border-amber-500' },
  { value: 'Vắng', short: 'Vắng', active: 'bg-rose-600 text-white border-rose-600' },
];
const localInput = (iso: string) => {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const p = (type: string) => parts.find(i => i.type === type)?.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
};
const birth = (value?: string) => { const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : value || '—'; };
const present = (e: Entry) => e.attendance === 'Có mặt' || e.attendance === 'Đến muộn';

type Field = 'attendance' | 'score' | 'note';

/** Saves one candidate. Each save sends the value the screen last confirmed for the
 *  fields it changes, so the server only refuses when that same cell was changed by
 *  someone else. Clicks made while a save is running are sent right after it. */
export type RosterApi = { url: (code: string) => string; headers: Record<string, string> };

export async function saveRosterEntry(api: RosterApi, code: string, patch: Partial<Record<Field, string>>, confirmed: Entry) {
  const base = Object.fromEntries(Object.keys(patch).map(key => [key, confirmed[key as Field] ?? '']));
  const response = await fetch(api.url(code), {
    method: 'PATCH', headers: { ...api.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...patch, base, revision: confirmed.revision }),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, entry: data.entry as Entry | undefined, error: String(data.error || '') };
}

function RosterRow({ index, entry, api, onBegin, onEnd, onSaved }: { index: number; entry: Entry; api: RosterApi; onBegin: () => void; onEnd: () => void; onSaved: (entry: Entry) => void }) {
  const [draft, setDraft] = useState(entry);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const confirmed = useRef(entry);
  const queued = useRef<Partial<Record<Field, string>> | null>(null);
  const busy = useRef(false);
  const typing = useRef(false);
  useEffect(() => {
    // A refresh from the server replaces the row unless the invigilator is mid-edit.
    if (busy.current || typing.current) return;
    confirmed.current = entry; setDraft(entry);
  }, [entry]);

  const flush = async () => {
    if (busy.current || !queued.current) return;
    const patch = queued.current; queued.current = null;
    busy.current = true; setSaving(true); setError(''); setNotice(''); onBegin();
    let failed = false;
    try {
      const result = await saveRosterEntry(api, entry.code, patch, confirmed.current);
      if (result.entry) { confirmed.current = result.entry; onSaved(result.entry); }
      if (result.status === 409 && result.entry) {
        queued.current = null;
        setDraft(result.entry);
        setNotice(result.error || 'Giám thị khác vừa cập nhật thí sinh này. Đã hiện giá trị mới.');
      } else if (!result.ok) {
        queued.current = { ...patch, ...(queued.current || {}) }; failed = true;
        setError(result.error || 'Chưa lưu được. Bấm "Lưu lại" để thử lại.');
      } else if (!queued.current) {
        setDraft(current => ({ ...current, ...result.entry }));
      }
    } catch {
      queued.current = { ...patch, ...(queued.current || {}) }; failed = true;
      setError('Mất kết nối, chưa lưu được. Bấm "Lưu lại" để thử lại.');
    } finally {
      busy.current = false; setSaving(false); onEnd();
      if (queued.current && !failed) void flush();
    }
  };
  const change = (patch: Partial<Record<Field, string>>, now = true) => {
    setDraft(current => ({ ...current, ...patch }));
    queued.current = { ...(queued.current || {}), ...patch };
    if (now) void flush();
  };
  const commitText = (key: 'score' | 'note') => {
    typing.current = false;
    if ((draft[key] ?? '') !== (confirmed.current[key] ?? '')) change({ [key]: draft[key] ?? '' });
  };

  const tone = draft.attendance === 'Vắng' ? 'border-rose-200 bg-rose-50/50' : present(draft) ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white';
  const status = saving ? <span className="flex items-center gap-1 text-blue-700"><Loader2 size={13} className="animate-spin" />Đang lưu</span>
    : error ? <button type="button" onClick={() => { setError(''); void flush(); }} className="rounded-md bg-blue-600 px-2 py-1 font-bold text-white">Lưu lại</button>
    : entry.updatedAt ? <span title={entry.updatedBy} className={`flex items-center gap-1 ${entry.autoAbsent ? 'text-rose-700' : 'text-emerald-700'}`}><CheckCircle2 size={13} />{entry.autoAbsent ? 'Tự động đánh vắng' : 'Đã lưu'} {new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(entry.updatedAt))}</span> : null;
  return <li className={`rounded-xl border p-3 transition-colors md:grid md:grid-cols-[2.25rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-start md:gap-3 ${tone}`}>
    <span className="hidden pt-1 text-xs text-slate-400 md:block">{index}</span>
    <div className="min-w-0">
      <p className="font-semibold text-slate-900"><span className="mr-2 font-mono text-sm font-bold text-[#001e40]">{entry.sbd || '—'}</span>{entry.name}</p>
      <p className="mt-0.5 text-xs text-slate-500"><span className="font-mono">{entry.code}</span> · {birth(entry.birthDate)} · {entry.className || (entry.grade ? `Khối ${entry.grade}` : '—')}<span className="md:hidden"> · {entry.school || '—'}</span></p>
    </div>
    <p className="hidden min-w-0 text-sm md:block"><span className="block truncate text-xs text-slate-500">{entry.school || '—'}</span></p>
    <div className="mt-1 min-w-0 text-sm md:mt-0">
      {entry.phone ? <a href={`tel:${entry.phone.split(/[ /]/)[0]}`} className="inline-flex items-center gap-1 font-semibold text-[#001e40] hover:underline"><Phone size={13} />{entry.phone}</a> : <span className="text-xs text-rose-600">Chưa có SĐT</span>}
      {entry.email && <a href={`mailto:${entry.email}`} className="mt-0.5 hidden items-center gap-1 break-all text-xs text-slate-600 hover:underline md:flex"><Mail size={12} className="shrink-0" />{entry.email}</a>}
      {entry.parent && <span className="ml-2 text-xs text-slate-500 md:ml-0 md:block">PH: {entry.parent}</span>}
    </div>
    <div className="mt-3 md:mt-0 md:w-[19rem]">
      <div role="group" aria-label={`Điểm danh ${entry.name}`} className="grid grid-cols-3 gap-1.5">{ATTENDANCE.map(option => {
        const active = draft.attendance === option.value;
        return <button key={option.value} type="button" aria-pressed={active} onClick={() => change({ attendance: active ? 'Chưa điểm danh' : option.value })} className={`min-h-11 whitespace-nowrap rounded-lg border px-2 text-sm font-bold transition active:scale-95 ${active ? option.active : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}>{option.short}</button>;
      })}</div>
      <div className="mt-2 grid grid-cols-[5rem_minmax(0,1fr)] gap-1.5">
        <input aria-label={`Điểm ${entry.name}`} inputMode="decimal" className={inputClass} value={draft.score ?? ''} placeholder="Điểm" onFocus={() => { typing.current = true; }} onChange={e => setDraft({ ...draft, score: e.target.value })} onBlur={() => commitText('score')} />
        <input aria-label={`Ghi chú ${entry.name}`} className={inputClass} value={draft.note ?? ''} placeholder="Ghi chú sự cố" onFocus={() => { typing.current = true; }} onChange={e => setDraft({ ...draft, note: e.target.value })} onBlur={() => commitText('note')} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </div>
      <div className="mt-1 min-h-4 text-xs">{status}</div>
      {error && <p role="alert" className="mt-1 text-xs text-rose-700">{error}</p>}
      {notice && <p role="status" className="mt-1 text-xs text-amber-800">{notice}</p>}
    </div>
  </li>;
}

/** The room's candidates with counters, search and "everyone not yet marked is present".
 *  Used by staff in Workspace and by guest invigilators on their link. */
export function RosterBoard({ shift, api, onEntrySaved, onBegin, onEnd, onBulkEnd }: { shift: Shift; api: RosterApi; onEntrySaved: (entry: Entry) => void; onBegin: () => void; onEnd: () => void; onBulkEnd?: () => void }) {
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all');
  const [bulkArmed, setBulkArmed] = useState(false), [bulk, setBulk] = useState<{ done: number; total: number; failed: number } | null>(null);
  const roster = shift.roster || [];
  const counts = { total: roster.length, present: roster.filter(e => e.attendance === 'Có mặt').length, late: roster.filter(e => e.attendance === 'Đến muộn').length, absent: roster.filter(e => e.attendance === 'Vắng').length };
  const waiting = counts.total - counts.present - counts.late - counts.absent;
  const query = search.trim().toLocaleLowerCase('vi-VN');
  const filtered = roster.filter(e => (!query || [e.sbd, e.code, e.name, e.school, e.className, e.phone, e.email].join(' ').toLocaleLowerCase('vi-VN').includes(query))
    && (filter === 'all' || (filter === 'waiting' ? !['Có mặt', 'Đến muộn', 'Vắng'].includes(e.attendance) : e.attendance === filter)));
  const markRestPresent = async () => {
    if (!bulkArmed) { setBulkArmed(true); window.setTimeout(() => setBulkArmed(false), 4000); return; }
    setBulkArmed(false);
    const targets = roster.filter(e => !['Có mặt', 'Đến muộn', 'Vắng'].includes(e.attendance));
    let done = 0, failed = 0;
    setBulk({ done, total: targets.length, failed });
    onBegin();
    for (let i = 0; i < targets.length; i += 4) {
      await Promise.all(targets.slice(i, i + 4).map(async target => {
        try {
          const result = await saveRosterEntry(api, target.code, { attendance: 'Có mặt' }, target);
          if (result.entry) onEntrySaved(result.entry);
          if (!result.ok) failed++;
        } catch { failed++; }
        done++; setBulk({ done, total: targets.length, failed });
      }));
    }
    onEnd();
    window.setTimeout(() => setBulk(null), failed ? 8000 : 3000);
    onBulkEnd?.();
  };
  const chip = (key: string, label: string, value: number, tone: string) => <button key={key} type="button" onClick={() => setFilter(filter === key ? 'all' : key)} className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${filter === key ? 'border-[#001e40] ring-1 ring-[#001e40]' : 'border-slate-200'} ${tone}`}>{label} <span className="ml-1">{value}</span></button>;
  return <>
    <p className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">Đến {dutyTime(new Date(new Date(shift.startsAt).getTime() + 15 * 60_000).toISOString())}, thí sinh chưa được điểm danh sẽ tự chuyển sang <b>Vắng</b>. Em vào muộn sau đó: bấm <b>Muộn</b> để sửa lại.</p>
    <div className="flex flex-wrap items-center gap-2 border-b p-4">
      {chip('all', 'Tất cả', counts.total, 'bg-white text-slate-700')}
      {chip('Có mặt', 'Có mặt', counts.present, 'bg-emerald-50 text-emerald-800')}
      {chip('Đến muộn', 'Muộn', counts.late, 'bg-amber-50 text-amber-800')}
      {chip('Vắng', 'Vắng', counts.absent, 'bg-rose-50 text-rose-800')}
      {chip('waiting', 'Chưa điểm danh', waiting, 'bg-slate-50 text-slate-700')}
      {waiting > 0 && <button type="button" disabled={Boolean(bulk)} onClick={() => void markRestPresent()} className={`rounded-lg border px-3 py-1.5 text-sm font-bold transition ${bulkArmed ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50'}`}>{bulkArmed ? `Bấm lần nữa để đánh Có mặt ${waiting} em` : `Có mặt tất cả ${waiting} em chưa điểm danh`}</button>}
      {bulk && <span role="status" className="text-sm font-semibold text-slate-600">{bulk.done < bulk.total ? 'Đang lưu' : 'Đã lưu'} {bulk.done - bulk.failed}/{bulk.total}{bulk.failed ? ` · ${bulk.failed} em chưa lưu được, hãy bấm lại ở từng dòng` : ''}</span>}
      <label className="ml-auto flex w-full max-w-sm items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 sm:w-auto"><Search size={15} className="text-slate-400" /><input aria-label="Tìm thí sinh trong phòng" className="w-full text-sm outline-none" value={search} onChange={e => setSearch(e.target.value)} placeholder="SBD, tên, SĐT, email…" /></label>
    </div>
    <div className="p-3 sm:p-4">
      <div className="mb-2 hidden grid-cols-[2.25rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_19rem] gap-3 px-3 text-xs font-bold uppercase text-slate-500 md:grid"><span>#</span><span>SBD · Thí sinh</span><span>Trường</span><span>Liên hệ</span><span>Điểm danh · Điểm · Ghi chú</span></div>
      <ol className="space-y-2">{filtered.map((e, i) => <RosterRow key={`${shift.id}:${e.code}`} index={i + 1} entry={e} api={api} onBegin={onBegin} onEnd={onEnd} onSaved={onEntrySaved} />)}</ol>
      {!filtered.length && <p className="p-8 text-center text-sm text-slate-500">Không có thí sinh phù hợp.</p>}
    </div>
  </>;
}

/** Turns the Meet links Khảo thí typed in the session tab into rooms and duties. Preview first. */
function RoomsFromLinksDialog({ token, sessionId, onClose, onDone }: { token: string; sessionId: string; onClose: () => void; onDone: () => void }) {
  const [plans, setPlans] = useState<RoomPlan[] | null>(null), [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [summary, setSummary] = useState('');
  const url = `/api/examination/sessions/${encodeURIComponent(sessionId)}/rooms-from-links`;
  useEffect(() => {
    let active = true;
    fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Chưa đọc được phân phòng.'); return data; })
      .then(data => { if (!active) return; setPlans(data.plans); setChosen(data.plans.filter((plan: RoomPlan) => plan.rooms.some(room => !room.existingRoomId || room.moving)).map((plan: RoomPlan) => `${plan.roundId}|${plan.occurrenceId}`)); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Chưa đọc được phân phòng.'); });
    return () => { active = false; };
  }, [url, token]);
  const apply = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ plans: chosen.map(key => { const [roundId, occurrenceId] = key.split('|'); return { roundId, occurrenceId }; }) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chưa tạo được phòng.');
      setPlans(data.plans);
      setSummary(`Đã tạo ${data.roomsCreated} phòng, xếp ${data.seated} thí sinh, mở ${data.shiftsCreated} ca coi thi.${data.backup ? ' Dữ liệu đã được sao lưu trước khi ghi.' : ''}${data.warnings?.length ? ` Lưu ý: ${data.warnings.join(' ')}` : ''}`);
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa tạo được phòng.'); }
    finally { setBusy(false); }
  };
  const date = (value: string) => { const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : value; };
  return <div className="fixed inset-0 z-[11000] grid place-items-center overflow-y-auto bg-slate-950/50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="rooms-from-links-title" className="my-4 w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl">
      <div className="mb-2 flex justify-between gap-3"><h2 id="rooms-from-links-title" className="text-lg font-bold">Tạo phòng thi từ phân phòng trên Sheet</h2><button type="button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></div>
      <p className="text-sm text-slate-600">Mỗi link phòng (cột "Địa điểm/Phòng thi") thành một phòng, đặt tên theo thứ tự SBD. Chỉ ghi việc xếp thí sinh vào phòng; ngày giờ, link, SBD và Sheet giữ nguyên. Mỗi phòng có sẵn ca coi thi và link cho giám thị ngoài.</p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {summary && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{summary}</p>}
      {!plans && !error && <p className="py-8 text-center text-sm text-slate-500">Đang đọc phân phòng…</p>}
      {plans && !plans.length && <p className="py-8 text-center text-sm text-slate-500">Chưa có thí sinh nào có link phòng trong kỳ này.</p>}
      <div className="mt-4 space-y-4">{(plans || []).map(plan => {
        const key = `${plan.roundId}|${plan.occurrenceId}`;
        return <section key={key} className="rounded-xl border border-slate-200 p-3">
          <label className="flex items-center gap-2 font-bold text-[#001e40]"><input type="checkbox" checked={chosen.includes(key)} onChange={e => setChosen(e.target.checked ? [...chosen, key] : chosen.filter(item => item !== key))} />{plan.roundName}{plan.occurrenceLabel ? ` · ${plan.occurrenceLabel}` : ''} · {date(plan.date) || 'chưa có ngày'} · {plan.time || 'chưa có giờ'}</label>
          {!plan.startsAt && <p className="mt-1 text-xs text-amber-700">Chưa đọc được ngày giờ thi nên sẽ chưa tạo ca coi thi cho đợt này.</p>}
          {plan.unresolved > 0 && <p className="mt-1 text-xs text-amber-700">{plan.unresolved} thí sinh có link nhưng chưa rõ thuộc đợt nào: chưa xếp.</p>}
          <table className="mt-2 w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-1">Phòng</th><th>Link</th><th>Thí sinh</th><th>Ghi chú</th></tr></thead><tbody>{plan.rooms.map(room => <tr key={room.key} className="border-t border-slate-100"><td className="py-1.5 font-semibold">{room.label}{room.existingRoomId ? ' (đã có)' : ''}</td><td className="max-w-56 truncate text-xs text-slate-600">{room.link}</td><td>{room.candidates}</td><td className="text-xs text-slate-500">từ SBD {room.firstSbd}{room.missingDate ? ` · ${room.missingDate} em thiếu ngày thi trên Sheet` : ''}{room.moving ? ` · ${room.moving} em chuyển từ phòng khác` : ''}{room.alreadySeated === room.candidates ? ' · đã xếp đủ' : ''}</td></tr>)}</tbody></table>
        </section>;
      })}</div>
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 font-bold">Đóng</button><button type="button" disabled={busy || !chosen.length} onClick={() => void apply()} className="rounded-lg bg-[#001e40] px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? 'Đang tạo…' : 'Tạo phòng & ca coi thi'}</button></div>
    </div>
  </div>;
}

export default function InvigilationWorkspace({ token, userName, onBack, embedded = false, sessions = [] }: { token: string; userName: string; onBack?: () => void; embedded?: boolean; sessions?: SessionOption[] }) {
  const [sessionId, setSessionId] = useState(() => decodeURIComponent(window.location.pathname.split('/')[3] || ''));
  const initialShift = new URLSearchParams(window.location.search).get('shift') || '';
  const [shifts, setShifts] = useState<Shift[]>([]), [staff, setStaff] = useState<Employee[]>([]), [rooms, setRooms] = useState<Room[]>([]);
  const [canManage, setCanManage] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(initialShift);
  const [form, setForm] = useState<Form | null>(null), [configSaving, setConfigSaving] = useState(false);
  const [roomsDialog, setRoomsDialog] = useState(false), [copied, setCopied] = useState('');
  const sequence = useRef(0), edits = useRef(0);
  const load = useCallback(async () => {
    if (edits.current) return;
    const serial = ++sequence.current;
    try {
      const response = await fetch(`/api/examination/invigilation/shifts${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chưa tải được ca thi.');
      if (serial !== sequence.current) return;
      setShifts(data.shifts); setStaff(data.staff); setRooms(data.rooms || []); setCanManage(data.canManage); setError('');
    } catch (e) { if (serial === sequence.current) setError(e instanceof Error ? e.message : 'Chưa tải được ca thi.'); }
    finally { if (serial === sequence.current) setLoading(false); }
  }, [token, sessionId]);
  useEffect(() => { void load(); const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000); window.addEventListener('focus', load); return () => { clearInterval(poll); window.removeEventListener('focus', load); sequence.current++; }; }, [load]);
  const chooseSession = (id: string) => {
    setSessionId(id); setSelectedId(''); setLoading(true);
    window.history.replaceState(null, '', `/examination/invigilation${id ? `/${encodeURIComponent(id)}` : ''}`);
  };
  const selected = shifts.find(s => s.id === selectedId) || shifts[0];
  // Shifts of the same time slot form one "ca"; its rooms sit side by side.
  const groups = useMemo(() => {
    const map = new Map<string, Shift[]>();
    shifts.forEach(s => { const key = `${s.sessionId}|${s.startsAt}|${s.label}`; map.set(key, [...(map.get(key) || []), s]); });
    return [...map.values()].map(list => list.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, 'vi', { numeric: true })));
  }, [shifts]);
  const edit = (shift: Shift) => setForm({ id: shift.id, revision: shift.revision, examRoomId: shift.examRoomId || '', label: shift.label, roundName: shift.roundName, occurrenceId: shift.occurrenceId, roomNumber: shift.roomNumber, startsAt: localInput(shift.startsAt), endsAt: localInput(shift.endsAt), roomLink: shift.roomLink, invigilatorEmails: shift.invigilators.map(u => u.email), enabled: shift.enabled, guestName: shift.guestName || '', guestEmail: shift.guestEmail || '' });
  const saveConfig = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form) return; setConfigSaving(true); setError('');
    try {
      const response = await fetch(`/api/examination/invigilation/shifts${form.id ? `/${form.id}` : ''}`, {
        method: form.id ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, sessionId, startsAt: `${form.startsAt}:00+07:00`, endsAt: `${form.endsAt}:00+07:00` }),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Chưa lưu được lịch.');
      setSelectedId(data.id); setForm(null); void load(); window.dispatchEvent(new Event('ft-exam-duties-changed'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa lưu được lịch.'); }
    finally { setConfigSaving(false); }
  };
  const fullGuestUrl = (shift: Shift) => (shift.guestUrl ? `${window.location.origin}${shift.guestUrl}` : '');
  const guestAction = async (shift: Shift, action: 'create' | 'rotate' | 'revoke') => {
    setError('');
    try {
      const response = await fetch(`/api/examination/invigilation/shifts/${shift.id}/guest-link`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Chưa đổi được link.');
      setShifts(prev => prev.map(s => s.id === shift.id ? { ...s, guestUrl: data.guestUrl } : s));
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa đổi được link.'); }
  };
  const copyGuestUrl = async (shift: Shift) => {
    try { await navigator.clipboard.writeText(fullGuestUrl(shift)); setCopied(shift.id); window.setTimeout(() => setCopied(''), 2000); } catch { setCopied(''); }
  };
  const onEntrySaved = (entry: Entry) => setShifts(prev => prev.map(s => s.id === selected?.id ? { ...s, roster: s.roster.map(item => item.code === entry.code ? { ...item, ...entry } : item) } : s));

  return <div className={embedded ? 'space-y-5' : 'min-h-dvh bg-slate-50 p-4 text-slate-900 sm:p-6'}>
    <div className={embedded ? 'space-y-5' : 'mx-auto max-w-7xl space-y-5'}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {!embedded && onBack && <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-600"><ArrowLeft size={16} />Workspace</button>}
          <h1 className="text-2xl font-extrabold text-[#001e40]">Coi thi</h1>
          <p className="mt-1 text-sm text-slate-500">{canManage ? 'Tất cả phòng thi' : `Phòng được phân công cho ${userName}`} · giờ Việt Nam · danh sách lấy trực tiếp từ phân phòng của Khảo thí</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && sessions.length > 0 && <select aria-label="Chọn kỳ thi" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" value={sessionId} onChange={e => chooseSession(e.target.value)}><option value="">Các ca sắp tới</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select>}
          <button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-bold"><RefreshCw size={15} />Tải lại</button>
          {canManage && selected && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('ft-exam-reminder-preview', { detail: selected }))} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-bold"><BellRing size={15} />Thử nhắc ca</button>}
          {canManage && sessionId && <button type="button" onClick={() => setRoomsDialog(true)} className="flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm font-bold"><DoorOpen size={15} />Tạo phòng từ link Meet</button>}
          {canManage && sessionId && <button type="button" onClick={() => setForm({ examRoomId: '', label: '', roundName: '', occurrenceId: '', roomNumber: '', startsAt: '', endsAt: '', roomLink: '', invigilatorEmails: [], enabled: true, guestName: '', guestEmail: '' })} className="flex items-center gap-1 rounded-lg bg-[#001e40] px-3 py-2 text-sm font-bold text-white"><Plus size={15} />Thêm ca/phòng</button>}
        </div>
      </header>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {loading && <p className="py-12 text-center text-slate-500">Đang tải ca thi…</p>}
      {!loading && !shifts.length && <p className="rounded-2xl border bg-white p-8 text-center text-slate-500">{canManage ? 'Chưa có ca coi thi nào trong thời gian này.' : 'Bạn chưa được phân công ca coi thi nào.'}</p>}

      {groups.map(group => <section key={group[0].id} aria-label={group[0].label} className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-extrabold text-[#001e40]">{group[0].competitionCode} · {group[0].label} <span className="font-semibold text-slate-500">· {dutyTime(group[0].startsAt)}–{dutyTime(group[0].endsAt)} · {dutyDate(group[0].startsAt)}</span></p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{group.map(s => {
          const here = s.roster.filter(present).length;
          const active = selected?.id === s.id;
          return <button key={s.id} type="button" onClick={() => setSelectedId(s.id)} className={`rounded-xl border p-3 text-left transition ${active ? 'border-[#001e40] bg-[#001e40] text-white' : 'border-slate-200 bg-slate-50 hover:border-slate-400'}`}>
            <div className="flex items-baseline justify-between gap-2"><strong>Phòng {s.roomNumber}</strong><span className={`text-xs font-bold ${active ? 'text-white/80' : 'text-slate-500'}`}>{here}/{s.roster.length} có mặt</span></div>
            <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${active ? 'bg-white/20' : 'bg-slate-200'}`}><div className={`h-full ${active ? 'bg-white' : 'bg-emerald-500'}`} style={{ width: `${s.roster.length ? (here / s.roster.length) * 100 : 0}%` }} /></div>
            <p className={`mt-2 truncate text-xs ${active ? 'text-white/80' : 'text-slate-500'}`}>{[...s.invigilators.map(u => u.name), ...(s.guestName ? [`${s.guestName} (ngoài)`] : [])].join(', ') || 'Chưa phân công giám thị'}{!s.enabled && ' · Đã tắt'}</p>
          </button>;
        })}</div>
      </section>)}

      {selected && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div><h2 className="text-lg font-extrabold text-[#001e40]">{selected.competitionCode} · {selected.label} · Phòng {selected.roomNumber}</h2><p className="mt-1 text-sm text-slate-500">{selected.roundName} · {dutyTime(selected.startsAt)}–{dutyTime(selected.endsAt)} {dutyDate(selected.startsAt)} · Giám thị: {[...selected.invigilators.map(u => u.name), ...(selected.guestName ? [`${selected.guestName} (giám thị ngoài)`] : [])].join(', ') || 'chưa phân công'}</p></div>
          <div className="flex flex-wrap gap-2">{selected.roomLink && <a href={selected.roomLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white"><ExternalLink size={15} />Vào phòng thi</a>}{canManage && <button type="button" onClick={() => edit(selected)} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-bold"><Settings2 size={15} />Lịch & giám thị</button>}</div>
        </div>
        {canManage && selected.examRoomId && <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3 text-sm">
          <Link2 size={15} className="text-slate-500" /><span className="font-bold text-slate-700">Link giám thị ngoài{selected.guestEmail ? ` (${selected.guestName} · ${selected.guestEmail})` : ''}:</span>
          {selected.guestUrl ? <>
            <input readOnly aria-label="Link giám thị ngoài" value={fullGuestUrl(selected)} onFocus={e => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs" />
            <button type="button" onClick={() => void copyGuestUrl(selected)} className="flex items-center gap-1 rounded-lg bg-[#001e40] px-3 py-1.5 font-bold text-white"><Copy size={14} />{copied === selected.id ? 'Đã chép' : 'Sao chép'}</button>
            <button type="button" onClick={() => void guestAction(selected, 'rotate')} className="rounded-lg border px-3 py-1.5 font-bold">Đổi link</button>
            <button type="button" onClick={() => void guestAction(selected, 'revoke')} className="rounded-lg border border-rose-200 px-3 py-1.5 font-bold text-rose-700">Thu hồi</button>
          </> : <button type="button" onClick={() => void guestAction(selected, 'create')} className="rounded-lg border px-3 py-1.5 font-bold">Tạo link</button>}
          {selected.guestUrl && !selected.guestEmail && <span className="w-full text-xs text-amber-700">Chưa gắn email giám thị: ai có link cũng mở được. Bấm "Lịch & giám thị" để nhập tên và email.</span>}
        </div>}
        {selected.pendingSheetCount > 0 && <p className="border-b bg-blue-50 px-4 py-2 text-sm text-blue-800">{selected.pendingSheetCount} thí sinh đã lưu trên web, đang ghi sang Sheet phân phòng.{selected.sheetError && ' Một số dòng chưa ghi được; hệ thống tự thử lại riêng các dòng đó.'}</p>}
        <RosterBoard key={selected.id} shift={selected} api={{ url: code => `/api/examination/invigilation/shifts/${selected.id}/roster/${encodeURIComponent(code)}`, headers: { Authorization: `Bearer ${token}` } }} onEntrySaved={onEntrySaved} onBegin={() => { edits.current++; sequence.current++; }} onEnd={() => { edits.current--; if (!edits.current) window.setTimeout(() => { if (!edits.current) void load(); }, 1500); }} />
      </section>}

      {form && <div className="fixed inset-0 z-[11000] grid place-items-center overflow-y-auto bg-slate-950/50 p-4"><form onSubmit={saveConfig} role="dialog" aria-modal="true" aria-labelledby="duty-config-title" className="my-4 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl"><div className="mb-4 flex justify-between"><h2 id="duty-config-title" className="text-lg font-bold">Lịch ca & phân công giám thị</h2><button type="button" onClick={() => setForm(null)} aria-label="Đóng"><X size={20} /></button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold sm:col-span-2">Phòng thi trong Khảo thí<select className={`${inputClass} mt-1`} value={form.examRoomId} onChange={e => { const room = rooms.find(r => r.id === e.target.value); setForm(room ? { ...form, examRoomId: room.id, roundName: room.roundName, occurrenceId: room.occurrenceId, roomNumber: room.roomNumber, roomLink: form.roomLink || room.link } : { ...form, examRoomId: '' }); }}><option value="">Không gắn phòng (nhập tay)</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.roundName} · {r.label} · {r.candidateCount} thí sinh</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Gắn phòng thì danh sách thí sinh lấy trực tiếp từ phân phòng của Khảo thí; điểm danh và điểm ghi vào kết quả vòng thi.</span></label>{([['roundName', 'Vòng thi'], ['label', 'Tên ca'], ['occurrenceId', 'Mã ca/vòng'], ['roomNumber', 'Phòng thi']] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}<input required disabled={Boolean(form.examRoomId) && key !== 'label'} className={`${inputClass} mt-1 disabled:bg-slate-100`} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}<label className="text-sm font-semibold">Bắt đầu<input required type="datetime-local" className={`${inputClass} mt-1`} value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} /></label><label className="text-sm font-semibold">Kết thúc<input required type="datetime-local" className={`${inputClass} mt-1`} value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })} /></label><label className="text-sm font-semibold sm:col-span-2">Link phòng thi<input type="url" className={`${inputClass} mt-1`} value={form.roomLink} onChange={e => setForm({ ...form, roomLink: e.target.value })} placeholder="Có thể để trống" /></label><fieldset className="sm:col-span-2"><legend className="mb-2 text-sm font-bold">Giám thị</legend><div className="grid max-h-48 gap-2 overflow-auto rounded-xl border p-3 sm:grid-cols-2">{staff.map(u => <label key={u.email} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.invigilatorEmails.includes(u.email)} onChange={e => setForm({ ...form, invigilatorEmails: e.target.checked ? [...form.invigilatorEmails, u.email] : form.invigilatorEmails.filter(email => email !== u.email) })} />{u.name}</label>)}</div></fieldset><fieldset className="grid gap-3 rounded-xl border p-3 sm:col-span-2 sm:grid-cols-2"><legend className="px-1 text-sm font-bold">Giám thị ngoài (không có tài khoản)</legend><label className="text-sm font-semibold">Họ tên<input className={`${inputClass} mt-1`} value={form.guestName} onChange={e => setForm({ ...form, guestName: e.target.value })} placeholder="Ví dụ: Lê Thu Hà" /></label><label className="text-sm font-semibold">Email<input type="email" className={`${inputClass} mt-1`} value={form.guestEmail} onChange={e => setForm({ ...form, guestEmail: e.target.value })} placeholder="email@gmail.com" /></label><span className="text-xs text-slate-500 sm:col-span-2">Có email thì hệ thống tạo link riêng cho phòng; giám thị phải nhập đúng email này mới mở được.</span></fieldset><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />Bật ca thi và nhắc trước 15 phút</label></div>{error && <p className="mt-3 text-sm text-rose-700">{error}</p>}<button disabled={configSaving} type="submit" className="mt-5 rounded-lg bg-[#001e40] px-5 py-3 font-bold text-white">{configSaving ? 'Đang lưu…' : 'Lưu lịch & phân công'}</button></form></div>}
      {roomsDialog && sessionId && <RoomsFromLinksDialog token={token} sessionId={sessionId} onClose={() => setRoomsDialog(false)} onDone={() => void load()} />}
    </div>
  </div>;
}
