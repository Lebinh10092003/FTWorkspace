import { useMemo, useState } from 'react';
import ExamDialog from './ExamDialog';
import { formatBirthDate } from './ui';
import type { Candidate, ExaminationSession, SessionRound, SessionRoundSlot } from './types';

/** Rounds organised in several exam days ("đợt"); a candidate may sit more than one, free of charge. */
export function batchedRounds(session: ExaminationSession): { round: SessionRound; batches: { number: number; slot: SessionRoundSlot }[] }[] {
  return (session.rounds || []).map(round => {
    const slots = (round.slots || []).filter(slot => slot.id && slot.date);
    const days = [...new Set(slots.map(slot => String(slot.date)))].sort();
    const batches = slots
      .map(slot => ({ number: days.indexOf(String(slot.date)) + 1, slot }))
      .sort((a, b) => a.number - b.number || String(a.slot.time || '').localeCompare(String(b.slot.time || '')));
    return { round, batches: days.length > 1 ? batches : [] };
  }).filter(item => item.batches.length);
}

export default function AddBatchDialog({ candidate, session, idToken, onClose, onDone }: {
  candidate: Candidate;
  session: ExaminationSession;
  idToken?: string | null;
  onClose: () => void;
  onDone: (candidate: Candidate) => void;
}) {
  const rounds = useMemo(() => batchedRounds(session), [session]);
  const participation = candidate.participations?.find(item => item.sessionId === session.id);
  const taken = (roundId: string, slot: SessionRoundSlot) => (participation?.rounds || []).some(entry =>
    (entry.roundId === roundId || !entry.roundId) && (entry.occurrenceId === slot.id || (!!slot.date && String(entry.date || '').slice(0, 10) === slot.date)));
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const [roundId, occurrenceId] = choice.split('|');
    if (!roundId || !occurrenceId) { setError('Hãy chọn đợt thi.'); return; }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/examination/candidates/${encodeURIComponent(candidate.code)}/sessions/${encodeURIComponent(session.id)}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken || ''}` },
        body: JSON.stringify({ roundId, occurrenceId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Không thêm được đợt thi.');
      onDone(body.candidate);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thêm được đợt thi.');
    } finally {
      setBusy(false);
    }
  };
  return <ExamDialog open title="Thêm đợt thi" description={`${candidate.name} · ${candidate.code}`} onClose={onClose} onSubmit={submit} busy={busy} submitLabel="Thêm đợt">
    <div className="grid gap-4">
      {rounds.map(({ round, batches }) => <fieldset key={round.id} className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 text-sm font-bold text-[#001e40]">{round.name}</legend>
        <div className="grid gap-2">
          {batches.map(({ number, slot }) => {
            const already = taken(round.id, slot);
            const value = `${round.id}|${slot.id}`;
            return <label key={slot.id} className={`flex min-h-[44px] items-center gap-3 rounded-lg border px-3 py-2 text-sm ${already ? 'border-slate-200 bg-slate-50 text-slate-400' : choice === value ? 'border-[#001e40] bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}>
              <input type="radio" name="batch" value={value} disabled={already} checked={choice === value} onChange={() => { setChoice(value); setError(''); }} />
              <span className="font-bold">Đợt {number}</span>
              <span>thi {formatBirthDate(slot.date || '')}{slot.time ? ` · ${slot.time}` : ''}</span>
              {already && <span className="ml-auto text-xs font-semibold">Đã đăng ký</span>}
            </label>;
          })}
        </div>
      </fieldset>)}
      {!rounds.length && <p className="text-sm text-slate-500">Kỳ này không có vòng thi chia nhiều đợt.</p>}
      <p className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-slate-700">Thi thêm đợt <b>miễn phí</b>: không tạo khoản thu mới. Các đợt đã thi giữ nguyên kết quả; vào vòng sau xét theo điểm cao nhất.</p>
      {error && <p role="alert" className="text-sm font-semibold text-rose-600">{error}</p>}
    </div>
  </ExamDialog>;
}
