import React, { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import ExamDialog from './ExamDialog';
import RoomEntryPicker, { type RoomChoices } from './RoomEntryPicker';
import type { Candidate, ExaminationSession } from './types';

// "Đổi môn thi": move one registration to another contest of the same season.
// School group and fee move with it; results, SBD and room of the old contest stay behind.
export default function TransferSessionDialog({ candidate, session, sessions, idToken, onClose, onDone }: {
  candidate: Candidate;
  session: ExaminationSession;
  sessions: ExaminationSession[];
  idToken?: string | null;
  onClose: () => void;
  onDone: (result: { candidate: Candidate; sessions: ExaminationSession[]; message: string }) => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [rooms, setRooms] = useState<RoomChoices>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const joined = new Set([...(candidate.sessionIds || []), ...(candidate.participations || []).map(item => item.sessionId)]);
  const options = useMemo(() => sessions
    .filter(item => item.id !== session.id && (!session.time || item.time === session.time))
    .sort((a, b) => a.code.localeCompare(b.code, 'vi')), [sessions, session]);
  const target = options.find(item => item.id === targetId);
  const participation = candidate.participations?.find(item => item.sessionId === session.id);
  const firstRound = participation?.rounds?.[0];
  const api = async (path: string) => {
    const response = await fetch(`/api/examination${path}`, { headers: { Authorization: `Bearer ${idToken || ''}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Không tải được danh sách phòng.');
    return body;
  };
  const submit = async () => {
    if (!target) { setError('Hãy chọn cuộc thi mới.'); return; }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/examination/candidates/${encodeURIComponent(candidate.code)}/sessions/${encodeURIComponent(session.id)}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken || ''}` },
        body: JSON.stringify({ targetSessionId: target.id, examRoom: rooms[target.id] || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Không đổi được cuộc thi.');
      onDone(body);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không đổi được cuộc thi.');
    } finally {
      setBusy(false);
    }
  };
  const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
  return <ExamDialog open title="Đổi cuộc thi" description={`${candidate.name} · ${candidate.code}`} onClose={onClose} onSubmit={submit} busy={busy} submitLabel="Đổi cuộc thi">
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
        <span className="rounded-lg bg-white px-3 py-2 font-bold text-[#001e40] shadow-sm">{session.code}</span>
        <ArrowRight className="h-4 w-4 text-slate-400" />
        <span className={`rounded-lg px-3 py-2 font-bold shadow-sm ${target ? 'bg-[#001e40] text-white' : 'bg-white text-slate-400'}`}>{target?.code || 'Chọn cuộc thi'}</span>
      </div>
      <label className="text-sm font-bold">Cuộc thi mới
        <select className={field} value={targetId} onChange={event => { setTargetId(event.target.value); setRooms({}); }}>
          <option value="">Chọn cuộc thi…</option>
          {options.map(item => <option key={item.id} value={item.id} disabled={joined.has(item.id)}>{item.code} · {item.name}{joined.has(item.id) ? ' (đã đăng ký)' : ''}</option>)}
        </select>
      </label>
      <ul className="space-y-1 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-slate-700">
        <li><b>Giữ nguyên:</b> hồ sơ, đơn vị đăng ký{participation?.registration.registrationUnit ? ` (${participation.registration.registrationUnit})` : ''}, lệ phí của trường hoặc khoản đã thanh toán.</li>
        <li><b>Bỏ ở {session.code}:</b> {firstRound?.sbd ? `SBD ${firstRound.sbd}, ` : ''}{firstRound?.roomName ? `${firstRound.roomName}, ` : ''}kết quả các vòng. Dòng trên tab Sheet {session.code} được xóa, tab {target?.code || 'mới'} có thêm dòng.</li>
        <li><b>Lệ phí trường:</b> tổng của nhóm trường ở hai cuộc thi tự cập nhật (nếu kế toán chưa xử lý).</li>
      </ul>
      {target && <RoomEntryPicker api={api} value={rooms} onChange={setRooms} sessions={[{ id: target.id, label: target.code }]} />}
      {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}
    </div>
  </ExamDialog>;
}
