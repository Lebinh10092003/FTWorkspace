import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BellRing, CheckCircle2, ExternalLink, Loader2, RefreshCw, Settings2, X } from 'lucide-react';
import type { Duty } from './InvigilationReminders';
import { dutyDate, dutyTime } from './invigilationTiming';

type Entry = { code: string; sbd?: string; name: string; school: string; grade: string; attendance: string; score: string; note: string; revision: string; updatedBy?: string; updatedAt?: string };
type Shift = Duty & { roster: Entry[]; pendingSheetCount: number; sheetError: boolean; revision: string; occurrenceId: string; sheetTab?: string; examRoomId?: string };
type Room = { id: string; label: string; roomNumber: string; roundName: string; occurrenceId: string; link: string; candidateCount: number };
type Employee = { email: string; name: string; employeeCode: string };
type Form = { id?: string; revision?: string; examRoomId: string; label: string; roundName: string; occurrenceId: string; roomNumber: string; startsAt: string; endsAt: string; roomLink: string; invigilatorEmails: string[]; enabled: boolean };
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900';
const localInput = (iso: string) => {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const p = (type: string) => parts.find(i => i.type === type)?.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
};

function RosterRow({ entry, token, shiftId, onBegin, onEnd, onSaved }: { entry: Entry; token: string; shiftId: string; onBegin: () => void; onEnd: () => void; onSaved: (entry: Entry) => void }) {
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
      setDraft(data.entry); setDirty(false); setPending(data.pendingSheet); onSaved(data.entry);
    } catch (e) { setDirty(true); setError(e instanceof Error ? e.message : 'Chưa lưu được.'); }
    finally { setSaving(false); onEnd(); }
  };
  return <tr className="border-t border-slate-100 align-top">
    <td className="px-3 py-3 text-sm"><strong>{entry.sbd ? `SBD ${entry.sbd}` : entry.code}</strong>{entry.sbd && <span className="ml-2 text-xs text-slate-500">{entry.code}</span>}<p className="mt-1 font-semibold">{entry.name}</p><p className="mt-1 text-xs text-slate-500">Khối {entry.grade || '—'} · {entry.school || '—'}</p></td>
    <td className="min-w-44 px-3 py-3"><select aria-label={`Điểm danh ${entry.code}`} disabled={saving} className={inputClass} value={draft.attendance} onChange={e => { setDirty(true); void save({ attendance: e.target.value }); }}>{[...new Set([draft.attendance, 'Chưa điểm danh', 'Có mặt', 'Vắng', 'Đến muộn'].filter(Boolean))].map(s => <option key={s}>{s}</option>)}</select></td>
    <td className="w-28 min-w-28 px-3 py-3"><input aria-label={`Điểm ${entry.code}`} disabled={saving} inputMode="decimal" className={inputClass} value={draft.score} placeholder="Chưa ghi" onChange={e => { setDraft({ ...draft, score: e.target.value }); setDirty(true); }} onBlur={() => { if (dirty) void save(); }} /></td>
    <td className="min-w-56 px-3 py-3"><textarea aria-label={`Ghi chú ${entry.code}`} disabled={saving} className={inputClass} rows={2} value={draft.note} onChange={e => { setDraft({ ...draft, note: e.target.value }); setDirty(true); }} onBlur={() => { if (dirty) void save(); }} /></td>
    <td className="min-w-44 px-3 py-3 text-xs text-slate-500">{saving ? <span className="flex items-center gap-1 text-blue-700"><Loader2 size={14} className="animate-spin" />Đang lưu…</span> : dirty ? <button type="button" onClick={() => void save()} className="rounded-lg bg-blue-600 px-3 py-2 font-bold text-white">Lưu lại</button> : <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={14} />{pending ? 'Đã lưu web, chờ ghi Sheet' : 'Đã lưu'}</span>}
      {error && <p role="alert" className="mt-2 max-w-56 text-red-700">{error}</p>}
      {entry.updatedAt && <p className="mt-2">{new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(entry.updatedAt))}<br />{entry.updatedBy}</p>}
    </td>
  </tr>;
}

export default function InvigilationWorkspace({ token, userName, onBack }: { token: string; userName: string; onBack: () => void }) {
  const sessionId = decodeURIComponent(window.location.pathname.split('/')[3] || '');
  const initialShift = new URLSearchParams(window.location.search).get('shift') || '';
  const [shifts, setShifts] = useState<Shift[]>([]), [staff, setStaff] = useState<Employee[]>([]), [rooms, setRooms] = useState<Room[]>([]);
  const [canManage, setCanManage] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(initialShift), [search, setSearch] = useState('');
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
  const selected = shifts.find(s => s.id === selectedId) || shifts[0];
  const filtered = (selected?.roster || []).filter(e => `${e.code} ${e.name} ${e.school}`.toLocaleLowerCase('vi-VN').includes(search.toLocaleLowerCase('vi-VN')));
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
  return <div className="min-h-dvh bg-slate-50 p-4 text-slate-900 sm:p-6">
    <div className="mx-auto max-w-7xl">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-600"><ArrowLeft size={16} />Workspace</button><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Khảo thí · Giám thị</p><h1 className="mt-1 text-2xl font-extrabold">{selected?.sessionName || 'Ca coi thi của tôi'}</h1><p className="mt-1 text-sm text-slate-500">{userName} · Thời gian theo giờ Việt Nam</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-bold"><RefreshCw size={16} />Tải lại</button>{canManage && selected && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('ft-exam-reminder-preview', { detail: selected }))} className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-bold"><BellRing size={16} />Thử popup nhắc ca</button>}{canManage && sessionId && <button type="button" onClick={() => setForm({ examRoomId: '', label: '', roundName: '', occurrenceId: '', roomNumber: '', startsAt: '', endsAt: '', roomLink: '', invigilatorEmails: [], enabled: true })} className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white">Thêm ca/phòng</button>}</div></header>
      {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading && <p className="py-12 text-center text-slate-500">Đang tải ca thi…</p>}
      {!loading && !shifts.length && <p className="rounded-2xl border bg-white p-8 text-center text-slate-500">Bạn chưa được phân công ca thi tại đây.</p>}
      <nav aria-label="Chọn ca và phòng thi" className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{shifts.map(s => <button key={s.id} type="button" onClick={() => { setSelectedId(s.id); setSearch(''); }} className={`rounded-2xl border p-4 text-left ${selected?.id === s.id ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'}`}><strong>{s.label} · Phòng {s.roomNumber}</strong><p className="mt-1 text-sm">{dutyDate(s.startsAt)} · {dutyTime(s.startsAt)}–{dutyTime(s.endsAt)}</p><p className="mt-1 text-xs text-slate-500">{s.invigilators.map(u => u.name).join(', ') || `${s.invigilatorLabel || 'Giám thị'} — chưa gắn nhân viên`}{!s.enabled && ' · Đã tắt'}</p></button>)}</nav>
      {selected && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="text-lg font-bold">{selected.roundName} · {selected.label} · Phòng {selected.roomNumber}</h2><p className="mt-1 text-sm text-slate-500">{selected.roster.length} thí sinh · Có mặt/đến muộn: {selected.roster.filter(e => ['Có mặt', 'Đến muộn'].includes(e.attendance)).length} · Vắng: {selected.roster.filter(e => e.attendance === 'Vắng').length}</p></div><div className="flex flex-wrap gap-2">{selected.roomLink && <a href={selected.roomLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white"><ExternalLink size={15} />Vào phòng thi</a>}{selected.sheetUrl && <a href={selected.sheetUrl} target="_blank" rel="noreferrer" className="rounded-xl border px-3 py-2 text-sm font-bold">Mở Sheet cuộc thi</a>}{canManage && <><button type="button" onClick={() => edit(selected)} className="flex items-center gap-1 rounded-xl border px-3 py-2 text-sm font-bold"><Settings2 size={15} />Lịch & giám thị</button></>}</div></div>
        {selected.demo && <p className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-900">Danh sách DEMO để thử phân phòng, điểm danh và ghi điểm. Xếp giải thực hiện ở Khảo thí.</p>}
        {selected.pendingSheetCount > 0 && <p className="border-b bg-blue-50 px-4 py-3 text-sm text-blue-800">Có {selected.pendingSheetCount} hồ sơ đã lưu trên web, đang chờ ghi sang Sheet.{selected.sheetError && ' Một số dòng chưa ghi được; hệ thống sẽ thử lại riêng các dòng đó.'}</p>}
        <div className="p-4"><input aria-label="Tìm thí sinh trong phòng" className={`${inputClass} max-w-md`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm SBD, họ tên hoặc trường…" /></div>
        <div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Thí sinh', 'Điểm danh', 'Điểm', 'Ghi chú', 'Trạng thái lưu'].map(h => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>{filtered.map(e => <RosterRow key={`${selected.id}:${e.code}`} entry={e} shiftId={selected.id} token={token} onBegin={() => { edits.current++; sequence.current++; }} onEnd={() => { edits.current--; void load(); }} onSaved={entry => setShifts(prev => prev.map(s => s.id === selected.id ? { ...s, roster: s.roster.map(item => item.code === entry.code ? entry : item) } : s))} />)}</tbody></table>{!filtered.length && <p className="p-8 text-center text-sm text-slate-500">Chưa có thí sinh khớp với danh sách phòng.</p>}</div>
      </section>}
      {form && <div className="fixed inset-0 z-[11000] grid place-items-center overflow-y-auto bg-slate-950/50 p-4"><form onSubmit={saveConfig} role="dialog" aria-modal="true" aria-labelledby="duty-config-title" className="my-4 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl"><div className="mb-4 flex justify-between"><h2 id="duty-config-title" className="text-lg font-bold">Lịch ca & phân công nhân viên</h2><button type="button" onClick={() => setForm(null)} aria-label="Đóng cấu hình ca"><X size={20} /></button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold sm:col-span-2">Phòng thi trong Khảo thí<select className={`${inputClass} mt-1`} value={form.examRoomId} onChange={e => { const room = rooms.find(r => r.id === e.target.value); setForm(room ? { ...form, examRoomId: room.id, roundName: room.roundName, occurrenceId: room.occurrenceId, roomNumber: room.roomNumber, roomLink: form.roomLink || room.link } : { ...form, examRoomId: '' }); }}><option value="">Không gắn phòng (nhập tay)</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.roundName} · {r.label} · {r.candidateCount} thí sinh</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Gắn phòng thì danh sách thí sinh lấy trực tiếp từ phân phòng của Khảo thí; điểm danh và điểm ghi vào kết quả vòng thi.</span></label>{([['roundName', 'Vòng thi'], ['label', 'Tên ca'], ['occurrenceId', 'Mã ca/vòng'], ['roomNumber', 'Phòng thi']] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}<input required disabled={Boolean(form.examRoomId) && key !== 'label'} className={`${inputClass} mt-1 disabled:bg-slate-100`} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}<label className="text-sm font-semibold">Bắt đầu (giờ Việt Nam)<input required type="datetime-local" className={`${inputClass} mt-1`} value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} /></label><label className="text-sm font-semibold">Kết thúc (giờ Việt Nam)<input required type="datetime-local" className={`${inputClass} mt-1`} value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })} /></label><label className="text-sm font-semibold sm:col-span-2">Link phòng thi<input type="url" className={`${inputClass} mt-1`} value={form.roomLink} onChange={e => setForm({ ...form, roomLink: e.target.value })} placeholder="Có thể để trống" /></label><fieldset className="sm:col-span-2"><legend className="mb-2 text-sm font-bold">Giám thị · chọn trực tiếp từ nhân viên Workspace</legend><div className="grid max-h-48 gap-2 overflow-auto rounded-xl border p-3 sm:grid-cols-2">{staff.map(u => <label key={u.email} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.invigilatorEmails.includes(u.email)} onChange={e => setForm({ ...form, invigilatorEmails: e.target.checked ? [...form.invigilatorEmails, u.email] : form.invigilatorEmails.filter(email => email !== u.email) })} />{u.name}</label>)}</div></fieldset><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />Bật ca thi và nhắc trước 15 phút</label></div>{error && <p className="mt-3 text-sm text-red-700">{error}</p>}<button disabled={configSaving} type="submit" className="mt-5 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white">{configSaving ? 'Đang lưu…' : 'Lưu lịch & phân công'}</button></form></div>}
    </div>
  </div>;
}
