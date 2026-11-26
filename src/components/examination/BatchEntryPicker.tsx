import type { ExaminationSession } from './types';
import { batchDates, sessionRounds } from './rounds';
import { formatBirthDate } from './ui';

export type BatchChoices = Record<string, string>;

export default function BatchEntryPicker({ sessions, value, onChange }: {
  sessions: ExaminationSession[];
  value: BatchChoices;
  onChange: (value: BatchChoices) => void;
}) {
  const options = sessions.map(session => ({ session, dates: batchDates(sessionRounds(session)[0]) })).filter(item => item.dates.length);
  if (!options.length) return null;

  return <fieldset className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
    <legend className="px-1 text-sm font-bold text-[#001e40]">Đợt thi vòng đầu</legend>
    {options.map(({ session, dates }) => <label key={session.id} className="block min-w-0 text-sm font-semibold">
      {session.code}
      <select value={value[session.id] || ''} onChange={event => onChange({ ...value, [session.id]: event.target.value })}
        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-700">
        <option value="">Chưa xếp đợt</option>
        {dates.map((day, index) => <option key={day} value={day}>Đợt {index + 1} · {formatBirthDate(day)}</option>)}
      </select>
    </label>)}
    <p className="text-xs leading-5 text-slate-600 sm:col-span-2">Chọn ngày thi nếu đã biết. Ca và phòng được phân sau trong danh sách của đợt.</p>
  </fieldset>;
}
