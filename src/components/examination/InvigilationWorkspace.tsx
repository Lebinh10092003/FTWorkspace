import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BellRing, CheckCircle2, ExternalLink, Loader2, Mail, Phone, Plus, RefreshCw, Search, Settings2, X } from 'lucide-react';
import type { Duty } from './InvigilationReminders';
import { dutyDate, dutyTime } from './invigilationTiming';

type Entry = { code: string; sbd?: string; name: string; school: string; grade: string; className?: string; birthDate?: string; email?: string; phone?: string; parent?: string; attendance: string; score: string; note: string; revision: string; updatedBy?: string; updatedAt?: string };
type Shift = Duty & { roster: Entry[]; pendingSheetCount: number; sheetError: boolean; revision: string; occurrenceId: string; sheetTab?: string; examRoomId?: string };
type Room = { id: string; label: string; roomNumber: string; roundName: string; occurrenceId: string; link: string; candidateCount: number };
type Employee = { email: string; name: string; employeeCode: string };
type Form = { id?: string; revision?: string; examRoomId: string; label: string; roundName: string; occurrenceId: string; roomNumber: string; startsAt: string; endsAt: string; roomLink: string; invigilatorEmails: string[]; enabled: boolean };
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

function RosterRow({ index, entry, token, shiftId, onBegin, onEnd, onSaved }: { index: number; entry: Entry; token: string; shiftId: string; onBegin: () => void; onEnd: () => void; onSaved: (entry: Entry) => void }) {
  const [draft, setDraft] = useState(entry);
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => { if (!dirty && !saving) setDraft(entry); }, [entry, dirty, saving]);
  const save = async (patch: Partial<Entry> = {}) => {
    if (saving) return;
    const value = { ...draft, ...patch }; setDraft(value); setSaving(true); setError(''); onBegin();
    try {
      const response = await fetch(`/api/examination/invigilation/shifts/${shiftId}/roster/${encodeURIComponent(entry.code)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance: value.attendance, score: value.score, note: value.note, revision: value.revision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chưa lưu được. Hãy thử lại.');
      setDraft({ ...value, ...data.entry }); setDirty(false); setPending(data.pendingSheet); onSaved(data.entry);
    } catch (e) { setDirty(true); setError(e instanceof Error ? e.message : 'Chưa lưu được.'); }
    finally { setSaving(false); onEnd(); }
  };
  const tone = draft.attendance === 'Vắng' ? 'bg-rose-50/60' : present(draft) ? 'bg-emerald-50/40' : '';
  return <tr className={`border-t border-slate-100 align-top ${tone}`}>
    <td className="px-3 py-3 text-xs text-slate-400">{index}</td>
    <td className="whitespace-nowrap px-3 py-3 font-mono text-sm font-bold text-[#001e40]">{entry.sbd || '—'}</td>
    <td className="min-w-48 px-3 py-3"><p className="font-semibold text-slate-900">{entry.name}</p><p className="font-mono text-xs text-slate-500">{entry.code}</p></td>
    <td className="whitespace-nowrap px-3 py-3 text-sm">{birth(entry.birthDate)}</td>
    <td className="min-w-44 px-3 py-3 text-sm"><p>{entry.className || (entry.grade ? `Khối ${entry.grade}` : '—')}</p><p className="text-xs text-slate-500">{entry.school || '—'}</p></td>
    <td className="min-w-56 px-3 py-3 text-sm">
      {entry.phone ? <a href={`tel:${entry.phone.split(/[ /]/)[0]}`} className="flex items-center gap-1 font-semibold text-[#001e40] hover:underline"><Phone size={13} />{entry.phone}</a> : <p className="text-slate-400">Chưa có SĐT</p>}
      {entry.email ? <a href={`mailto:${entry.email}`} className="mt-1 flex items-center gap-1 break-all text-xs text-slate-600 hover:underline"><Mail size={12} />{entry.email}</a> : null}
      {entry.parent && <p className="mt-1 text-xs text-slate-500">PH: {entry.parent}</p>}
    </td>
    <td className="px-3 py-3"><div role="group" aria-label={`Điểm danh ${entry.name}`} className="flex gap-1">{ATTENDANCE.map(option => {
      const active = draft.attendance === option.value;
      return <button key={option.value} type="button" disabled={saving} aria-pressed={active} onClick={() => { setDirty(true); void save({ attendance: active ? 'Chưa điểm danh' : option.value }); }} className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${active ? option.active : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}>{option.short}</button>;
    })}</div></td>
    <td className="w-24 min-w-24 px-3 py-3"><input aria-label={`Điểm ${entry.name}`} disabled={saving} inputMode="decimal" className={inputClass} value={draft.score} placeholder="—" onChange={e => { setDraft({ ...draft, score: e.target.value }); setDirty(true); }} onBlur={() => { if (dirty) void save(); }} /></td>
    <td className="min-w-52 px-3 py-3"><textarea aria-label={`Ghi chú ${entry.name}`} disabled={saving} className={inputClass} rows={1} value={draft.note} placeholder="Ghi chú" onChange={e => { setDraft({ ...draft, note: e.target.value }); setDirty(true); }} onBlur={() => { if (dirty) void save(); }} /></td>
    <td className="w-28 px-3 py-3 text-xs text-slate-500">{saving ? <span className="flex items-center gap-1 text-blue-700"><Loader2 size={14} className="animate-spin" />Đang lưu</span> : dirty ? <button type="button" onClick={() => void save()} className="rounded-lg bg-blue-600 px-3 py-1.5 font-bold text-white">Lưu lại</button> : <span title={pending ? 'Đã lưu web, đang ghi Sheet' : 'Đã lưu'} className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={14} />{pending ? 'Chờ Sheet' : 'Đã lưu'}</span>}
      {error && <p role="alert" className="mt-1 text-rose-700">{error}</p>}
      {entry.updatedAt && <p className="mt-1" title={entry.updatedBy}>{new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(entry.updatedAt))}</p>}
    </td>
  </tr>;
}

export default function InvigilationWorkspace({ token, userName, onBack, embedded = false, sessions = [] }: { token: string; userName: string; onBack?: () => void; embedded?: boolean; sessions?: SessionOption[] }) {
  const [sessionId, setSessionId] = useState(() => decodeURIComponent(window.location.pathname.split('/')[3] || ''));
  const initialShift = new URLSearchParams(window.location.search).get('shift') || '';
  const [shifts, setShifts] = useState<Shift[]>([]), [staff, setStaff] = useState<Employee[]>([]), [rooms, setRooms] = useState<Room[]>([]);
  const [canManage, setCanManage] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(initialShift), [search, setSearch] = useState(''), [filter, setFilter] = useState('all');
  const [form, setForm] = useState<Form | null>(null), [configSaving, setConfigSaving] = useState(false);
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
  const roster = selected?.roster || [];
  const counts = { total: roster.length, present: roster.filter(e => e.attendance === 'Có mặt').length, late: roster.filter(e => e.attendance === 'Đến muộn').length, absent: roster.filter(e => e.attendance === 'Vắng').length };
  const waiting = counts.total - counts.present - counts.late - counts.absent;
  const query = search.trim().toLocaleLowerCase('vi-VN');
  const filtered = roster.filter(e => (!query || [e.sbd, e.code, e.name, e.school, e.className, e.phone, e.email].join(' ').toLocaleLowerCase('vi-VN').includes(query))
    && (filter === 'all' || (filter === 'waiting' ? !['Có mặt', 'Đến muộn', 'Vắng'].includes(e.attendance) : e.attendance === filter)));
  const edit = (shift: Shift) => setForm({ id: shift.id, revision: shift.revision, examRoomId: shift.examRoomId || '', label: shift.label, roundName: shift.roundName, occurrenceId: shift.occurrenceId, roomNumber: shift.roomNumber, startsAt: localInput(shift.startsAt), endsAt: localInput(shift.endsAt), roomLink: shift.roomLink, invigilatorEmails: shift.invigilators.map(u => u.email), enabled: shift.enabled });
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
  const chip = (key: string, label: string, value: number, tone: string) => <button key={key} type="button" onClick={() => setFilter(filter === key ? 'all' : key)} className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${filter === key ? 'border-[#001e40] ring-1 ring-[#001e40]' : 'border-slate-200'} ${tone}`}>{label} <span className="ml-1">{value}</span></button>;

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
          {canManage && sessionId && <button type="button" onClick={() => setForm({ examRoomId: '', label: '', roundName: '', occurrenceId: '', roomNumber: '', startsAt: '', endsAt: '', roomLink: '', invigilatorEmails: [], enabled: true })} className="flex items-center gap-1 rounded-lg bg-[#001e40] px-3 py-2 text-sm font-bold text-white"><Plus size={15} />Thêm ca/phòng</button>}
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
          return <button key={s.id} type="button" onClick={() => { setSelectedId(s.id); setSearch(''); setFilter('all'); }} className={`rounded-xl border p-3 text-left transition ${active ? 'border-[#001e40] bg-[#001e40] text-white' : 'border-slate-200 bg-slate-50 hover:border-slate-400'}`}>
            <div className="flex items-baseline justify-between gap-2"><strong>Phòng {s.roomNumber}</strong><span className={`text-xs font-bold ${active ? 'text-white/80' : 'text-slate-500'}`}>{here}/{s.roster.length} có mặt</span></div>
            <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${active ? 'bg-white/20' : 'bg-slate-200'}`}><div className={`h-full ${active ? 'bg-white' : 'bg-emerald-500'}`} style={{ width: `${s.roster.length ? (here / s.roster.length) * 100 : 0}%` }} /></div>
            <p className={`mt-2 truncate text-xs ${active ? 'text-white/80' : 'text-slate-500'}`}>{s.invigilators.map(u => u.name).join(', ') || 'Chưa phân công giám thị'}{!s.enabled && ' · Đã tắt'}</p>
          </button>;
        })}</div>
      </section>)}

      {selected && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div><h2 className="text-lg font-extrabold text-[#001e40]">{selected.competitionCode} · {selected.label} · Phòng {selected.roomNumber}</h2><p className="mt-1 text-sm text-slate-500">{selected.roundName} · {dutyTime(selected.startsAt)}–{dutyTime(selected.endsAt)} {dutyDate(selected.startsAt)} · Giám thị: {selected.invigilators.map(u => u.name).join(', ') || 'chưa phân công'}</p></div>
          <div className="flex flex-wrap gap-2">{selected.roomLink && <a href={selected.roomLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white"><ExternalLink size={15} />Vào phòng thi</a>}{canManage && <button type="button" onClick={() => edit(selected)} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-bold"><Settings2 size={15} />Lịch & giám thị</button>}</div>
        </div>
        {selected.pendingSheetCount > 0 && <p className="border-b bg-blue-50 px-4 py-2 text-sm text-blue-800">{selected.pendingSheetCount} thí sinh đã lưu trên web, đang ghi sang Sheet.{selected.sheetError && ' Một số dòng chưa ghi được; hệ thống tự thử lại riêng các dòng đó.'}</p>}
        <div className="flex flex-wrap items-center gap-2 border-b p-4">
          {chip('all', 'Tất cả', counts.total, 'bg-white text-slate-700')}
          {chip('Có mặt', 'Có mặt', counts.present, 'bg-emerald-50 text-emerald-800')}
          {chip('Đến muộn', 'Muộn', counts.late, 'bg-amber-50 text-amber-800')}
          {chip('Vắng', 'Vắng', counts.absent, 'bg-rose-50 text-rose-800')}
          {chip('waiting', 'Chưa điểm danh', waiting, 'bg-slate-50 text-slate-700')}
          <label className="ml-auto flex w-full max-w-sm items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 sm:w-auto"><Search size={15} className="text-slate-400" /><input aria-label="Tìm thí sinh trong phòng" className="w-full text-sm outline-none" value={search} onChange={e => setSearch(e.target.value)} placeholder="SBD, tên, SĐT, email…" /></label>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['#', 'SBD', 'Thí sinh', 'Ngày sinh', 'Lớp · Trường', 'Liên hệ', 'Điểm danh', 'Điểm', 'Ghi chú', ''].map(h => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead>
          <tbody>{filtered.map((e, i) => <RosterRow key={`${selected.id}:${e.code}`} index={i + 1} entry={e} shiftId={selected.id} token={token} onBegin={() => { edits.current++; sequence.current++; }} onEnd={() => { edits.current--; void load(); }} onSaved={entry => setShifts(prev => prev.map(s => s.id === selected.id ? { ...s, roster: s.roster.map(item => item.code === entry.code ? { ...item, ...entry } : item) } : s))} />)}</tbody></table>
          {!filtered.length && <p className="p-8 text-center text-sm text-slate-500">Không có thí sinh phù hợp.</p>}</div>
      </section>}

      {form && <div className="fixed inset-0 z-[11000] grid place-items-center overflow-y-auto bg-slate-950/50 p-4"><form onSubmit={saveConfig} role="dialog" aria-modal="true" aria-labelledby="duty-config-title" className="my-4 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl"><div className="mb-4 flex justify-between"><h2 id="duty-config-title" className="text-lg font-bold">Lịch ca & phân công giám thị</h2><button type="button" onClick={() => setForm(null)} aria-label="Đóng"><X size={20} /></button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold sm:col-span-2">Phòng thi trong Khảo thí<select className={`${inputClass} mt-1`} value={form.examRoomId} onChange={e => { const room = rooms.find(r => r.id === e.target.value); setForm(room ? { ...form, examRoomId: room.id, roundName: room.roundName, occurrenceId: room.occurrenceId, roomNumber: room.roomNumber, roomLink: form.roomLink || room.link } : { ...form, examRoomId: '' }); }}><option value="">Không gắn phòng (nhập tay)</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.roundName} · {r.label} · {r.candidateCount} thí sinh</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Gắn phòng thì danh sách thí sinh lấy trực tiếp từ phân phòng của Khảo thí; điểm danh và điểm ghi vào kết quả vòng thi.</span></label>{([['roundName', 'Vòng thi'], ['label', 'Tên ca'], ['occurrenceId', 'Mã ca/vòng'], ['roomNumber', 'Phòng thi']] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}<input required disabled={Boolean(form.examRoomId) && key !== 'label'} className={`${inputClass} mt-1 disabled:bg-slate-100`} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}<label className="text-sm font-semibold">Bắt đầu<input required type="datetime-local" className={`${inputClass} mt-1`} value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} /></label><label className="text-sm font-semibold">Kết thúc<input required type="datetime-local" className={`${inputClass} mt-1`} value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })} /></label><label className="text-sm font-semibold sm:col-span-2">Link phòng thi<input type="url" className={`${inputClass} mt-1`} value={form.roomLink} onChange={e => setForm({ ...form, roomLink: e.target.value })} placeholder="Có thể để trống" /></label><fieldset className="sm:col-span-2"><legend className="mb-2 text-sm font-bold">Giám thị</legend><div className="grid max-h-48 gap-2 overflow-auto rounded-xl border p-3 sm:grid-cols-2">{staff.map(u => <label key={u.email} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.invigilatorEmails.includes(u.email)} onChange={e => setForm({ ...form, invigilatorEmails: e.target.checked ? [...form.invigilatorEmails, u.email] : form.invigilatorEmails.filter(email => email !== u.email) })} />{u.name}</label>)}</div></fieldset><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />Bật ca thi và nhắc trước 15 phút</label></div>{error && <p className="mt-3 text-sm text-rose-700">{error}</p>}<button disabled={configSaving} type="submit" className="mt-5 rounded-lg bg-[#001e40] px-5 py-3 font-bold text-white">{configSaving ? 'Đang lưu…' : 'Lưu lịch & phân công'}</button></form></div>}
    </div>
  </div>;
}
