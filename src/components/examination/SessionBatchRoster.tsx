import { useId, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Search } from 'lucide-react';
import { matchesSearch } from '../../lib/searchText';
import { candidateRoundResults, canMoveBatch } from './AddBatchDialog';
import ExamDialog from './ExamDialog';
import { batchDates, resultBatchDate, sessionRounds } from './rounds';
import { formatBirthDate, LIST_PAGE_SIZE, TablePagination } from './ui';
import type { Candidate, CandidateExamHistory, ExaminationSession } from './types';

type Props = {
  session: ExaminationSession;
  candidates: Candidate[];
  idToken?: string | null;
  onUpdated: (candidates: Candidate[]) => void;
  onAdd: (candidate: Candidate) => void;
  onMove: (candidate: Candidate, from: CandidateExamHistory) => void;
  onTransfer?: (candidate: Candidate) => void;
};

const selectionLimit = 250;
const control = 'min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-700';
const action = 'min-h-11 rounded-lg px-2 text-sm font-bold text-sky-800 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:text-slate-500';

export default function SessionBatchRoster({ session, candidates, idToken, onUpdated, onAdd, onMove, onTransfer }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState(false);
  const [codePicker, setCodePicker] = useState(false);
  const [pastedCodes, setPastedCodes] = useState('');
  const [day, setDay] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ added: number; label: string; skipped: { code: string; reason: string }[] }>();
  const round = useMemo(() => sessionRounds(session)[0], [session]);
  const dates = useMemo(() => batchDates(round), [round]);
  const entries = useMemo(() => !round ? [] : candidates.map(candidate => ({
    candidate, batches: candidateRoundResults(candidate, session.id, round)
      .map(result => ({ result, date: resultBatchDate(round, result) }))
      .filter(item => dates.includes(item.date)).sort((a, b) => a.date.localeCompare(b.date)),
  })), [candidates, round, dates, session.id]);
  if (!dates.length) return null;

  const visible = entries.filter(({ candidate, batches }) => (
    (filter === 'all' || (filter === 'unassigned' ? !batches.length : batches.some(item => item.date === filter)))
    && matchesSearch(`${candidate.code} ${candidate.name} ${candidate.school} ${candidate.className}`, query)
  ));
  const activePage = Math.min(page, Math.max(1, Math.ceil(visible.length / LIST_PAGE_SIZE)));
  const pageRows = visible.slice((activePage - 1) * LIST_PAGE_SIZE, activePage * LIST_PAGE_SIZE);
  const codesByUpper = new Map(entries.map(({ candidate }) => [candidate.code.toUpperCase(), candidate.code]));
  const pasted = [...new Set(pastedCodes.toUpperCase().split(/[\s,;|]+/).filter(Boolean))];
  const matched = pasted.flatMap(code => codesByUpper.get(code) || []);
  const missing = pasted.filter(code => !codesByUpper.has(code));
  const selectVisible = [...new Set([...selected, ...visible.map(row => row.candidate.code)])];
  const batchLabel = (date: string) => `Đợt ${dates.indexOf(date) + 1} · ${formatBirthDate(date)}`;
  const updateSelected = (code: string, checked: boolean) => setSelected(list => checked ? [...list, code] : list.filter(item => item !== code));
  const submit = async () => {
    setError('');
    try {
      const response = await fetch(`/api/examination/sessions/${encodeURIComponent(session.id)}/candidate-batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken || ''}` },
        body: JSON.stringify({ examDate: day, candidateCodes: selected }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Chưa xếp được đợt thi. Vui lòng thử lại.');
      onUpdated(data.candidates);
      setStatus({ added: data.candidates.length, label: batchLabel(day), skipped: data.skipped });
      setSelected([]);
      setDialog(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa xếp được đợt thi. Vui lòng thử lại.');
    }
  };

  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[#001e40] focus-visible:outline-2 focus-visible:outline-blue-700 sm:px-5">
      <CalendarDays aria-hidden="true" className="h-5 w-5 shrink-0 text-sky-700" />
      <span className="min-w-0 flex-1 font-extrabold">Xếp đợt vòng đầu <span className="ml-1 text-sm font-medium text-slate-600">· {entries.filter(item => !item.batches.length).length} chưa xếp</span></span>
      <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 ${open ? 'rotate-180' : ''}`} />
    </button>
    <div id={panelId} hidden={!open} className="space-y-4 border-t border-slate-200 p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(14rem,2fr)]">
        <label className="grid gap-1 text-sm font-semibold">Lọc theo đợt
          <select className={control} value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}>
            <option value="all">Tất cả</option>
            <option value="unassigned">Chưa xếp đợt</option>
            {dates.map(date => <option key={date} value={date}>{batchLabel(date)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">Tìm thí sinh
          <span className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
            <input className={`${control} w-full pl-9`} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Tên, mã FT, trường hoặc lớp" />
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 pb-2">
        <button type="button" className={action} disabled={!visible.length || selectVisible.length > selectionLimit || selectVisible.length === selected.length} onClick={() => setSelected(selectVisible)}>Chọn {visible.length} hồ sơ trong bộ lọc</button>
        <button type="button" className={action} onClick={() => { setPastedCodes(''); setCodePicker(true); }}>Chọn theo mã FT</button>
        <span role="status" className="text-sm text-slate-600">Đã chọn {selected.length}</span>
        {selected.length > 0 && <button type="button" className={action} onClick={() => setSelected([])}>Bỏ chọn</button>}
        <button type="button" className="ft-btn ft-btn-primary ml-auto min-h-11" disabled={!selected.length} onClick={() => { setDay(''); setError(''); setDialog(true); }}>Thêm đợt cho nhóm đã chọn</button>
      </div>
      {status && <div role="status" className="rounded-xl bg-sky-50 p-3 text-sm text-sky-950">
        <p>Đã thêm {status.added} thí sinh · {status.label}.{status.skipped.length > 0 && ` Bỏ qua ${status.skipped.length} hồ sơ.`}</p>
        {status.skipped.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{status.skipped.map(item => <li key={item.code}>{item.code} · {item.reason}</li>)}</ul>}
      </div>}
      {!pageRows.length && <p className="py-5 text-center text-sm text-slate-600">Không có thí sinh phù hợp.</p>}
      <ul className="divide-y divide-slate-200">{pageRows.map(({ candidate, batches }) => <li key={candidate.code} className="grid gap-1 py-3 md:grid-cols-[minmax(11rem,1fr)_minmax(12rem,1.3fr)_auto] md:items-start">
        <label className="flex min-h-11 items-center gap-3 pr-2 text-sm">
          <input type="checkbox" checked={selected.includes(candidate.code)} disabled={!selected.includes(candidate.code) && selected.length >= selectionLimit}
            onChange={event => updateSelected(candidate.code, event.target.checked)} className="h-4 w-4 shrink-0" />
          <span><strong className="block">{candidate.name}</strong><small className="text-slate-600">{candidate.code}</small></span>
        </label>
        <ul className="ml-7 flex flex-wrap items-center gap-1 md:ml-0">
          {!batches.length && <li className="py-2 text-sm text-slate-600">Chưa xếp đợt</li>}
          {batches.map(({ date, result }) => <li key={result.id || date} className="flex min-h-11 min-w-0 flex-wrap items-center rounded-lg bg-slate-100 px-2 text-xs font-semibold text-slate-700">
            <span>{batchLabel(date)}</span>
            {canMoveBatch(result) && <button type="button" className={action} aria-label={`Chuyển ${batchLabel(date)} của ${candidate.name}`} onClick={() => onMove(candidate, result)}>Chuyển đợt</button>}
          </li>)}
        </ul>
        <div className="ml-5 flex flex-wrap md:ml-0">
          <button type="button" className={action} aria-label={`Thêm đợt cho ${candidate.name}`} onClick={() => onAdd(candidate)}>Thêm đợt</button>
          {onTransfer && <button type="button" className={action} aria-label={`Đổi cuộc thi của ${candidate.name}`} onClick={() => onTransfer(candidate)}>Đổi cuộc thi</button>}
        </div>
      </li>)}</ul>
      <TablePagination total={visible.length} page={activePage} onPageChange={setPage} label="thí sinh" />
    </div>
    {codePicker && <ExamDialog open title="Chọn thí sinh theo mã FT" description={session.code} onClose={() => setCodePicker(false)}
      onSubmit={() => { setSelected(matched); setFilter('all'); setQuery(''); setPage(1); setCodePicker(false); }}
      submitLabel="Chọn hồ sơ khớp" submitDisabled={!matched.length || matched.length > selectionLimit}>
      <label className="grid gap-1 text-sm font-semibold">Danh sách mã FT
        <textarea className={control} rows={5} value={pastedCodes} onChange={event => setPastedCodes(event.target.value)}
          placeholder="Dán một cột mã FT hoặc gõ mỗi mã trên một dòng" maxLength={12000} />
      </label>
      <p role="status" className="mt-3 text-sm text-slate-600">Khớp {matched.length} hồ sơ trong kỳ.{matched.length > selectionLimit && ` Hãy chia thành các nhóm tối đa ${selectionLimit} hồ sơ.`}</p>
      {missing.length > 0 && <p className="mt-2 break-words text-sm text-amber-900">Không có trong kỳ ({missing.length}): {missing.join(', ')}</p>}
    </ExamDialog>}
    {dialog && <ExamDialog open title="Thêm đợt cho nhóm thí sinh" description={`${session.code} · ${selected.length} thí sinh đã chọn`} onClose={() => setDialog(false)} onSubmit={submit} submitLabel="Thêm đợt" submitDisabled={!day}>
      <label className="grid gap-1 text-sm font-semibold">Đợt thi cần thêm
        <select className={control} value={day} onChange={event => setDay(event.target.value)}>
          <option value="">Chọn đợt thi</option>
          {dates.map(date => <option key={date} value={date}>{batchLabel(date)}</option>)}
        </select>
      </label>
      <p className="mt-3 text-sm leading-6 text-slate-600">Các lượt thi và kết quả trước đó vẫn được giữ. Mỗi thí sinh chỉ được thêm một lần vào đợt đã chọn.</p>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p>}
    </ExamDialog>}
  </section>;
}
