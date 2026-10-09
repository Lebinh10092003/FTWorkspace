import React, { useEffect, useState } from 'react';

type RoomOption = { id: string; label: string; link: string; location: string; occurrenceId: string; occurrenceLabel: string; date: string; time: string; assignedCount: number; capacity: number | null; invigilators: string[] };
type Occurrence = { id: string; date: string; time: string; label: string };
type Options = { roundName?: string; rooms: RoomOption[]; occurrences: Occurrence[] };
export type RoomChoice = { roomId?: string; newRoom?: { occurrenceId: string; label: string; link: string } };
export type RoomChoices = Record<string, RoomChoice>;

const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const occurrenceName = (occurrence: Occurrence | undefined, room?: RoomOption) =>
  [occurrence?.label || room?.occurrenceLabel, room?.time || occurrence?.time, room?.date || occurrence?.date].filter(Boolean).join(' · ') || 'Chưa có giờ thi';

// Shown when someone adds a candidate to a session whose first round already
// has rooms: the candidate is seated in the chosen room, or a new one.
export default function RoomEntryPicker({ sessions, api, value, onChange }: {
  sessions: { id: string; label: string }[];
  api: (path: string) => Promise<any>;
  value: RoomChoices;
  onChange: (value: RoomChoices) => void;
}) {
  const [options, setOptions] = useState<Record<string, Options>>({});
  const key = sessions.map(session => session.id).join('|');
  useEffect(() => {
    let active = true;
    sessions.forEach(session => {
      if (options[session.id]) return;
      api(`/sessions/${encodeURIComponent(session.id)}/room-options`)
        .then(data => active && setOptions(current => ({ ...current, [session.id]: { rooms: data.rooms || [], occurrences: data.occurrences || [], roundName: data.roundName } })))
        .catch(() => active && setOptions(current => ({ ...current, [session.id]: { rooms: [], occurrences: [] } })));
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const withRooms = sessions.filter(session => options[session.id]?.rooms.length);
  if (!withRooms.length) return null;
  const set = (sessionId: string, choice: RoomChoice | null) => {
    const next = { ...value };
    if (choice) next[sessionId] = choice; else delete next[sessionId];
    onChange(next);
  };
  return <div className="grid gap-3">{withRooms.map(session => {
    const data = options[session.id];
    const choice = value[session.id];
    const byOccurrence = data.rooms.reduce<Record<string, RoomOption[]>>((groups, room) => ({ ...groups, [room.occurrenceId]: [...(groups[room.occurrenceId] || []), room] }), {});
    const occurrenceIds = Object.keys(byOccurrence);
    return <section key={session.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-extrabold text-amber-900">{session.label}: cuộc thi đã được phân chia phòng thi, bạn muốn phân thí sinh vào phòng nào?</p>
      {data.roundName && <p className="mt-1 text-xs text-amber-800">{data.roundName}</p>}
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="radio" checked={!choice} onChange={() => set(session.id, null)} />Chưa xếp phòng (Khảo thí xếp sau)</label>
      {occurrenceIds.map(occurrenceId => <div key={occurrenceId} className="mt-3">
        <p className="text-xs font-bold uppercase text-slate-500">{occurrenceName(data.occurrences.find(item => item.id === occurrenceId), byOccurrence[occurrenceId][0])}</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">{byOccurrence[occurrenceId].map(room => <label key={room.id} className={`flex cursor-pointer gap-2 rounded-lg border bg-white p-2 text-sm ${choice?.roomId === room.id ? 'border-[#001e40] ring-1 ring-[#001e40]' : 'border-slate-200'}`}>
          <input type="radio" checked={choice?.roomId === room.id} onChange={() => set(session.id, { roomId: room.id })} />
          <span className="min-w-0"><b className="block text-[#001e40]">{room.label} · {room.assignedCount}{room.capacity ? `/${room.capacity}` : ''} thí sinh</b>
            <small className="block text-slate-600">{[room.time, room.date].filter(Boolean).join(' · ') || 'Chưa có giờ thi'}</small>
            <small className="block truncate text-slate-500">Giám thị: {room.invigilators.length ? room.invigilators.join(', ') : 'chưa phân công'}</small>
          </span>
        </label>)}</div>
      </div>)}
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="radio" checked={Boolean(choice?.newRoom)} onChange={() => set(session.id, { newRoom: { occurrenceId: occurrenceIds[0] || data.occurrences[0]?.id || '', label: '', link: '' } })} />Tạo phòng mới</label>
      {choice?.newRoom && <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-bold">Đợt / ca
          <select className={field} value={choice.newRoom.occurrenceId} onChange={event => set(session.id, { newRoom: { ...choice.newRoom!, occurrenceId: event.target.value } })}>
            {data.occurrences.map(occurrence => <option key={occurrence.id} value={occurrence.id}>{occurrenceName(occurrence, byOccurrence[occurrence.id]?.[0])}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold">Tên phòng
          <input className={field} value={choice.newRoom.label} onChange={event => set(session.id, { newRoom: { ...choice.newRoom!, label: event.target.value } })} placeholder={`Room ${(byOccurrence[choice.newRoom.occurrenceId]?.length || 0) + 1}`} />
        </label>
        <label className="text-xs font-bold">Link phòng (trực tuyến)
          <input className={field} value={choice.newRoom.link} onChange={event => set(session.id, { newRoom: { ...choice.newRoom!, link: event.target.value } })} placeholder="meet.google.com/..." />
        </label>
      </div>}
    </section>;
  })}</div>;
}
