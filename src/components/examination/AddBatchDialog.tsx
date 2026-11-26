import { useState } from 'react';
import ExamDialog from './ExamDialog';
import { batchDates, resultBatchDate, sessionRounds } from './rounds';
import { formatBirthDate } from './ui';
import type { Candidate, CandidateExamHistory, ExaminationSession, SessionRound } from './types';

export function batchedRounds(session: ExaminationSession) {
  return sessionRounds(session).map(round => ({ round, dates: batchDates(round) })).filter(item => item.dates.length);
}

export function candidateRoundResults(candidate: Candidate, sessionId: string, round: SessionRound) {
  return candidate.participations?.find(item => item.sessionId === sessionId)?.rounds.filter(
    entry => entry.roundId ? entry.roundId === round.id : entry.round === round.name,
  ) || [];
}

export function canMoveBatch(result: CandidateExamHistory) {
  return Boolean(result.id) && ![
    result.roomId, result.roomName, result.sbd, result.time, result.mode, result.location, result.link,
    result.account, result.password, result.attendance, result.score, result.scoreRate, result.rank, result.result,
  ].some(Boolean);
}

export default function AddBatchDialog({ candidate, session, moveFrom, idToken, onClose, onDone }: {
  candidate: Candidate;
  session: ExaminationSession;
  moveFrom?: CandidateExamHistory;
  idToken?: string | null;
  onClose: () => void;
  onDone: (candidate: Candidate) => void;
}) {
  const rounds = batchedRounds(session).filter(({ round }) => !moveFrom || (
    moveFrom.roundId ? moveFrom.roundId === round.id : moveFrom.round === round.name
  ));
  const [choice, setChoice] = useState<{ roundId: string; examDate: string }>();
  const [error, setError] = useState('');
  const moveDay = moveFrom && rounds[0] ? resultBatchDate(rounds[0].round, moveFrom) : '';
  const action = moveFrom ? 'Chuyển đợt' : 'Thêm đợt';

  const submit = async () => {
    if (!choice) return;
    setError('');
    try {
      const response = await fetch(`/api/examination/candidates/${encodeURIComponent(candidate.code)}/sessions/${encodeURIComponent(session.id)}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken || ''}` },
        body: JSON.stringify({ ...choice, ...(moveFrom ? { moveFromResultId: moveFrom.id, moveFromExamDate: moveDay } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Chưa ${action.toLocaleLowerCase('vi-VN')} được. Vui lòng thử lại.`);
      onDone(body.candidate);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể lưu thay đổi.');
    }
  };

  return <ExamDialog open title={`${action} thi`} description={`${candidate.name} · ${candidate.code} · ${session.code}`} onClose={onClose}
    onSubmit={submit} submitLabel={action} submitDisabled={!choice}>
    <div className="grid gap-4">
      <p className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm leading-6 text-slate-700">
        {moveFrom ? `Chuyển lượt ngày ${formatBirthDate(moveDay)} sang ngày mới. Các đợt khác của thí sinh vẫn được giữ.`
          : 'Thí sinh có thể dự thi nhiều đợt. Thao tác này giữ các đợt và kết quả đã có, miễn phí.'}
      </p>
      {rounds.map(({ round, dates }) => {
        const taken = new Set(candidateRoundResults(candidate, session.id, round).map(result => resultBatchDate(round, result)));
        return <fieldset key={round.id} className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-bold text-[#001e40]">{round.name}</legend>
          <div className="grid gap-2">
            {dates.map((day, index) => {
              const already = taken.has(day);
              const checked = choice?.roundId === round.id && choice.examDate === day;
              return <label key={day} className={`flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm focus-within:outline-2 focus-within:outline-blue-700 ${checked ? 'border-sky-700 bg-sky-50' : 'border-slate-200'}`}>
                <input type="radio" name="batch" disabled={already} checked={checked} onChange={() => { setChoice({ roundId: round.id, examDate: day }); setError(''); }} />
                <span className="font-bold">Đợt {index + 1}</span>
                <span>{formatBirthDate(day)}</span>
                {already && <span className="text-xs font-semibold text-slate-600">{day === moveDay ? 'Đợt đang chuyển' : 'Đã đăng ký'}</span>}
              </label>;
            })}
          </div>
        </fieldset>;
      })}
      {!rounds.length && <p className="text-sm text-slate-600">Kỳ này chưa có lịch thi chia đợt.</p>}
      {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    </div>
  </ExamDialog>;
}
