import SchoolEntryPicker, { type SchoolEntry } from './SchoolEntryPicker';
import type { Partner } from './Partners';
import React, { useState } from 'react';
import type { Candidate, Competition, ExaminationSession, SessionRound } from './types';
import ExamDialog from './ExamDialog';
import ConfirmModal from '../ConfirmModal';
import { sessionRounds } from './rounds';
import { BirthDateControl, TimeField, dateValue, emptyDate, formatPersonName } from './ui';
import { matchesSearch } from '../../lib/searchText';

type Teacher = { name: string; subject: string; phone: string; email: string; workplace: string };
type Mode = 'competition' | 'session' | 'candidate' | 'teacher' | 'enrol' | null;
type Props = { mode: Mode; error: string; busy: boolean; competitions: Competition[]; competition: Competition; session: ExaminationSession; candidate: Candidate; candidates?: Candidate[]; enrollmentSessionId?: string; teacher: Teacher; onClose: () => void; onCompetitionChange: (value: Competition) => void; onSessionChange: (value: ExaminationSession) => void; onCandidateChange: (value: Candidate) => void; onTeacherChange: (value: Teacher) => void; onSave: () => void | Promise<void>; partners?: Partner[]; schoolEntry?: SchoolEntry; onSchoolEntryChange?: (value: SchoolEntry) => void; enrolExtra?: React.ReactNode; };
const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2';
const SESSION_PHASE_SUGGESTIONS = [
  'Chuẩn bị/Truyền thông',
  'Tuyển sinh',
  'Vòng quốc gia',
  'Ôn tập Vòng quốc tế',
  'Vòng quốc tế',
  'Công bố kết quả',
  'Hoàn thành',
];
const CandidateFields = ({ value, onChange, enrollment = false }: { value: Candidate; onChange: (value: Candidate) => void; enrollment?: boolean }) => {
  const fields: [keyof Candidate, string][] = [['name', 'Họ và tên *'], ['identity', 'Căn cước công dân'], ['email', 'Email'], ['school', 'Tên trường'], ['className', 'Lớp đang học'], ['grade', 'Khối lớp hiện tại'], ['city', 'Tỉnh / thành phố cư trú'], ['ward', 'Xã / phường'], ['nationality', 'Quốc tịch'], ['achievement', 'Kết quả / giải thưởng'], ['highestRound', 'Vòng cao nhất đã đạt'], ['parent', 'Phụ huynh'], ['phone', 'Điện thoại'], ['address', 'Địa chỉ'], ...(enrollment ? ([['code', 'Mã FT (để trống để tự tạo)']] as [keyof Candidate, string][]) : [])];
  return <div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold">Ngày sinh</span><BirthDateControl value={value.birthDate} onChange={birthDate => onChange({ ...value, birthDate })}/></label>{fields.map(([field, label]) => <label key={field} className={field === 'address' ? 'sm:col-span-2' : ''}><span className="text-sm font-bold">{label}</span><input type="text" value={String(value[field] || '')} onChange={event => onChange({ ...value, [field]: field === 'name' || field === 'parent' ? formatPersonName(event.target.value) : event.target.value })} className={input}/></label>)}{!enrollment && <label className="sm:col-span-2"><span className="text-sm font-bold">Các cuộc thi đã tham gia</span><input value={value.contests} onChange={event => onChange({ ...value, contests: event.target.value })} className={input} placeholder="AYSBC, IMO"/></label>}</div>;
};
function draftDateFrom(date?: string, label?: string) {
  const text = String(label || '').trim();
  const unknown = text.toLocaleLowerCase('vi-VN').includes('ch\u01b0a c\u00f3 th\u00f4ng tin');
  const planned = text.toLocaleLowerCase('vi-VN').startsWith('d\u1ef1 ki\u1ebfn');
  const iso = String(date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return { day: String(Number(iso[3])), month: String(Number(iso[2])), year: iso[1], planned, unknown: false };
  const monthYear = text.match(/(\d{1,2})\/(\d{4})/);
  if (monthYear) return { day: '', month: String(Number(monthYear[1])), year: monthYear[2], planned, unknown: false };
  return { ...emptyDate(), planned, unknown };
}

function CandidatePoolPicker({ value, candidates = [], sessionId, onChange }: { value: Candidate; candidates?: Candidate[]; sessionId?: string; onChange: (value: Candidate) => void }) {
  const [query, setQuery] = useState('');
  const [school, setSchool] = useState('');
  const [grade, setGrade] = useState('');
  const queryKey = query.trim();
  const schools = [...new Set(candidates.map(item => item.school).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  const grades = [...new Set(candidates.map(item => String(item.grade || item.className || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  const pool = candidates.filter(item => {
    const haystack = [item.code, item.name, item.school, item.className, item.email, item.phone, item.identity, item.contests].join(' ');
    return matchesSearch(haystack, queryKey) && (!school || item.school === school) && (!grade || String(item.grade || item.className || '').trim() === grade);
  }).sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.code.localeCompare(b.code, 'en', { numeric: true }));
  return <div className="space-y-4"><section className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-extrabold text-[#001e40]">{'Ch\u1ecdn t\u1eeb kho th\u00ed sinh'}</h3><p className="mt-1 text-sm text-slate-500">{'T\u00ecm, l\u1ecdc v\u00e0 ch\u1ecdn h\u1ed3 s\u01a1 c\u00f3 s\u1eb5n \u0111\u1ec3 th\u00eam v\u00e0o k\u1ef3 t\u1ed5 ch\u1ee9c.'}</p></div>{value.code && <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-[#001e40]">{'\u0110\u00e3 ch\u1ecdn: '}{value.code}</span>}</div><div className="mt-4 grid gap-3 sm:grid-cols-3"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={'T\u00ecm m\u00e3 FT, t\u00ean, tr\u01b0\u1eddng...'} className={input}/><select value={school} onChange={event => setSchool(event.target.value)} className={input}><option value="">{'T\u1ea5t c\u1ea3 tr\u01b0\u1eddng'}</option>{schools.map(item => <option key={item} value={item}>{item}</option>)}</select><select value={grade} onChange={event => setGrade(event.target.value)} className={input}><option value="">{'T\u1ea5t c\u1ea3 kh\u1ed1i/l\u1edbp'}</option>{grades.map(item => <option key={item} value={item}>{item}</option>)}</select></div><div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white"><div className="divide-y divide-slate-100">{pool.map(item => { const alreadyInSession = Boolean(sessionId && item.sessionIds?.includes(sessionId)); const selected = item.code === value.code; return <button key={item.code} type="button" disabled={alreadyInSession} onClick={() => onChange({ ...item })} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : 'hover:bg-slate-50'} ${alreadyInSession ? 'cursor-not-allowed opacity-50' : ''}`}><span><b className="block text-sm text-[#001e40]">{item.name}</b><small className="mt-1 block font-mono text-xs text-slate-500">{item.code}{' \u00b7 '}{item.school || 'Ch\u01b0a c\u00f3 tr\u01b0\u1eddng'}{' \u00b7 '}{item.className || item.grade || 'Ch\u01b0a c\u00f3 l\u1edbp'}</small></span><span className="text-right text-xs text-slate-500">{alreadyInSession ? '\u0110\u00e3 thu\u1ed9c k\u1ef3 n\u00e0y' : (item.contests || 'Ch\u01b0a c\u00f3 k\u1ef3 thi')}</span></button>; })}{!pool.length && <p className="p-5 text-center text-sm text-slate-500">{'Kh\u00f4ng t\u00ecm th\u1ea5y th\u00ed sinh ph\u00f9 h\u1ee3p.'}</p>}</div></div></section><details className="rounded-xl border border-dashed border-slate-300 p-4"><summary className="cursor-pointer text-sm font-bold text-[#001e40]">{'Ho\u1eb7c t\u1ea1o h\u1ed3 s\u01a1 th\u00ed sinh m\u1edbi'}</summary><p className="mt-2 text-sm text-slate-500">{'Ch\u1ec9 d\u00f9ng khi th\u00ed sinh ch\u01b0a c\u00f3 trong kho. H\u1ec7 th\u1ed1ng s\u1ebd t\u1ea1o m\u00e3 FT n\u1ebfu \u0111\u1ec3 tr\u1ed1ng.'}</p><div className="mt-4"><CandidateFields value={value} onChange={onChange} enrollment/></div></details></div>;
}

function SessionFields({ value, competitions, onChange }: { value: ExaminationSession; competitions: Competition[]; onChange: (next: ExaminationSession) => void }) {
  // Keep blank rounds while editing. Filtering them here made 'Thêm vòng thi'
  // appear to do nothing on the next render.
  const rounds = Array.isArray(value.rounds) ? value.rounds : sessionRounds(value);
  const [pendingRoundDelete, setPendingRoundDelete] = useState<number | null>(null);
  const updateRound = (index: number, patch: Partial<SessionRound>) => onChange({ ...value, rounds: rounds.map((round, current) => current === index ? { ...round, ...patch } : round) });
  const dayDrafts = (round: SessionRound) => round.slots?.length ? round.slots.map(slot => ({ id: slot.id || `day-${Date.now()}`, time: draftDateFrom(slot.date) })) : [{ id: `day-${round.id || 'round'}`, time: draftDateFrom(round.date, round.label) }];
  const updateRoundDay = (roundIndex: number, dayIndex: number, time: ReturnType<typeof emptyDate>) => {
    const days = dayDrafts(rounds[roundIndex]); days[dayIndex] = { ...days[dayIndex], time };
    const slots = days.map(day => ({ id: day.id, date: dateValue(day.time).date || '' }));
    const first = dateValue(days[0]?.time || emptyDate());
    updateRound(roundIndex, { slots, label: first.label || '', date: first.date || '' });
  };
  const addRoundDay = (roundIndex: number) => updateRound(roundIndex, { slots: [...dayDrafts(rounds[roundIndex]).map(day => ({ id: day.id, date: dateValue(day.time).date || '' })), { id: `day-${Date.now()}`, date: '' }] });
  const removeRoundDay = (roundIndex: number, dayIndex: number) => {
    const days = dayDrafts(rounds[roundIndex]).filter((_, current) => current !== dayIndex); const first = dateValue(days[0]?.time || emptyDate());
    updateRound(roundIndex, { slots: days.map(day => ({ id: day.id, date: dateValue(day.time).date || '' })), label: first.label || '', date: first.date || '' });
  };
  return <div className="grid gap-4">
    <label><span className="text-sm font-bold">Tên kỳ tổ chức *</span><input value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} className={input}/></label>
    <label><span className="text-sm font-bold">Cuộc thi *</span><select value={value.competitionId || ''} onChange={event => onChange({ ...value, competitionId: event.target.value })} className={input}>{competitions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
    <div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold">Giai đoạn hiện tại</span><input list="session-phase-suggestions" value={value.phase || ''} onChange={event => onChange({ ...value, phase: event.target.value })} placeholder="Chọn hoặc nhập giai đoạn khác" className={input}/><datalist id="session-phase-suggestions">{SESSION_PHASE_SUGGESTIONS.map(phase => <option key={phase} value={phase}/>)}</datalist><small className="mt-1 block text-xs text-slate-500">Có thể chọn gợi ý hoặc nhập giai đoạn mới.</small></label><label><span className="text-sm font-bold">Ghi chú chung</span><input value={value.note || ''} onChange={event => onChange({ ...value, note: event.target.value })} className={input}/></label></div>
    <div className="grid gap-4 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 sm:grid-cols-2"><div className="sm:col-span-2"><h3 className="font-extrabold text-emerald-950">Google Sheets của kỳ tổ chức</h3><p className="mt-1 text-xs text-emerald-800">Sheet đầu vào chỉ nhập. Sheet tổng hợp cho phép nhập bản sửa thủ công và xuất dữ liệu.</p></div><label className="sm:col-span-2"><span className="text-sm font-bold">Sheet đầu vào</span><input type="url" value={value.registrationSheetUrl || ''} onChange={event => onChange({ ...value, registrationSheetUrl: event.target.value })} placeholder="https://docs.google.com/spreadsheets/d/..." className={input}/></label><label><span className="text-sm font-bold">Tên tab đầu vào</span><input value={value.registrationSheetTab || ''} onChange={event => onChange({ ...value, registrationSheetTab: event.target.value })} placeholder="Ví dụ: Form Responses 1" className={input}/></label><label className="sm:col-span-2"><span className="text-sm font-bold">Sheet tổng hợp</span><input type="url" value={value.outputSheetUrl || ''} onChange={event => onChange({ ...value, outputSheetUrl: event.target.value })} placeholder="https://docs.google.com/spreadsheets/d/..." className={input}/></label><label><span className="text-sm font-bold">Tên tab tổng hợp</span><input value={value.outputSheetTab || ''} onChange={event => onChange({ ...value, outputSheetTab: event.target.value })} placeholder="Ví dụ: Danh sách thí sinh" className={input}/></label><label className="sm:col-span-2"><span className="text-sm font-bold">Sheet phân phòng (file riêng)</span><input type="url" value={value.roomSheetUrl || ''} onChange={event => onChange({ ...value, roomSheetUrl: event.target.value })} placeholder="https://docs.google.com/spreadsheets/d/..." className={input}/><small className="mt-1 block text-xs text-emerald-800">Mỗi phòng một tab: giờ thi, link, giám thị và danh sách thí sinh kèm liên hệ, điểm danh. Web tự ghi một chiều; chia sẻ quyền sửa cho tài khoản hệ thống test-228@cogent-joy-504217-d0.iam.gserviceaccount.com.</small></label></div>    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3"><h3 className="font-extrabold text-[#001e40]">Các vòng thi</h3><p className="mt-1 text-sm text-slate-500">Tên vòng tạo ra tab tương ứng trên trang chi tiết. Mỗi vòng dùng cùng cách khai báo thời gian như lúc tạo kỳ.</p></div><div className="grid gap-3">{rounds.map((round, index) => <div key={round.id || index} className="rounded-lg border bg-white p-3"><div className="flex items-center justify-between gap-3"><b className="text-sm text-[#001e40]">Vòng {index + 1}</b><button type="button" onClick={() => setPendingRoundDelete(index)} className="text-xs font-bold text-rose-600">Xóa vòng</button></div><label className="mt-3 block"><span className="text-xs font-bold text-slate-500">Tên vòng thi *</span><input value={round.name || ''} onChange={event => updateRound(index, { name: event.target.value })} className={input}/></label><div className="mt-3 grid gap-3">{dayDrafts(round).map((day, dayIndex) => <div key={day.id} className="rounded-lg border border-slate-200 p-3"><div className="mb-2 flex items-center justify-between"><b className="text-xs text-slate-600">Ngày tổ chức {dayIndex + 1}</b>{dayDrafts(round).length > 1 && <button type="button" onClick={() => removeRoundDay(index, dayIndex)} className="text-xs font-bold text-rose-600">Xóa ngày</button>}</div><TimeField label={`Thời gian ${round.name || `Vòng ${index + 1}`}`} value={day.time} onChange={time => updateRoundDay(index, dayIndex, time)}/></div>)}<button type="button" onClick={() => addRoundDay(index)} className="w-fit rounded-lg border border-dashed border-[#aa3000] px-3 py-2 text-xs font-bold text-[#aa3000]">+ Thêm ngày tổ chức</button></div></div>)}</div><button type="button" onClick={() => onChange({ ...value, rounds: [...rounds, { id: `round-${Date.now()}`, name: '', label: '', date: '' }] })} className="mt-3 rounded-lg border border-dashed border-[#aa3000] px-3 py-2 text-sm font-bold text-[#aa3000]">+ Thêm vòng thi</button></div>
  <ConfirmModal
    isOpen={pendingRoundDelete !== null}
    onClose={() => setPendingRoundDelete(null)}
    onConfirm={() => {
      if (pendingRoundDelete !== null) onChange({ ...value, rounds: rounds.filter((_, current) => current !== pendingRoundDelete) });
    }}
    title={'X\u00f3a v\u00f2ng thi'}
    message={pendingRoundDelete === null ? '' : `X\u00f3a ${rounds[pendingRoundDelete]?.name || `V\u00f2ng ${pendingRoundDelete + 1}`} kh\u1ecfi k\u1ef3 t\u1ed5 ch\u1ee9c? D\u1eef li\u1ec7u l\u1ecbch, ca thi v\u00e0 tab c\u1ee7a v\u00f2ng n\u00e0y s\u1ebd b\u1ecb b\u1ecf khi l\u01b0u thay \u0111\u1ed5i.`}
    confirmText={'X\u00f3a v\u00f2ng'}
    type="danger"
  />
  </div>;
}
export default function DetailEditDialogs(props: Props) {
  const { mode, error, busy, competitions, competition, session, candidate, candidates, enrollmentSessionId, teacher, onClose, onCompetitionChange, onSessionChange, onCandidateChange, onTeacherChange, onSave, partners, schoolEntry, onSchoolEntryChange, enrolExtra } = props;
  if (!mode) return null;
  const body = mode === 'competition' ? <div className="grid gap-4 sm:grid-cols-2">{([['code', 'Mã cuộc thi'], ['name', 'Tên cuộc thi'], ['organizer', 'Ban tổ chức quốc tế'], ['parent', 'Cuộc thi mẹ']] as [keyof Competition, string][]).map(([field, label]) => <label key={field} className={field === 'name' ? 'sm:col-span-2' : ''}><span className="text-sm font-bold">{label}</span><input value={competition[field]} onChange={event => onCompetitionChange({ ...competition, [field]: event.target.value })} className={input}/></label>)}</div> : mode === 'session' ? <SessionFields value={session} competitions={competitions} onChange={onSessionChange}/> : mode === 'teacher' ? <div className="grid gap-4 sm:grid-cols-2">{([['name', 'Họ và tên'], ['subject', 'Chuyên môn'], ['phone', 'Điện thoại'], ['email', 'Email'], ['workplace', 'Đơn vị công tác']] as [keyof Teacher, string][]).map(([field, label]) => <label key={field} className={field === 'workplace' ? 'sm:col-span-2' : ''}><span className="text-sm font-bold">{label}</span><input value={teacher[field]} onChange={event => onTeacherChange({ ...teacher, [field]: event.target.value })} className={input}/></label>)}</div> : mode === 'enrol' ? <CandidatePoolPicker value={candidate} candidates={candidates} sessionId={enrollmentSessionId} onChange={onCandidateChange}/> : <CandidateFields value={candidate} onChange={onCandidateChange}/>;
  const title = mode === 'competition' ? 'Thay đổi thông tin cuộc thi' : mode === 'session' ? 'Thay đổi thông tin kỳ tổ chức' : mode === 'teacher' ? 'Thay đổi thông tin giáo viên' : mode === 'enrol' ? 'Thêm thí sinh vào kỳ thi' : 'Thay đổi hồ sơ thí sinh';
  const description = mode === 'session' ? 'Cập nhật cùng một cấu trúc với lúc tạo kỳ: tên kỳ, cuộc thi, các vòng và mốc ngày. Vòng chưa có thông tin có thể để trống ngày.' : mode === 'enrol' ? 'Chọn hồ sơ từ kho để liên kết vào kỳ tổ chức. Hồ sơ mới chỉ được tạo khi bạn chủ động nhập trong phần bên dưới.' : 'Các thay đổi được cập nhật ngay vào dữ liệu chung và những luồng liên quan.';
  return <ExamDialog open title={title} description={description} onClose={onClose} onSubmit={onSave} busy={busy} submitLabel={mode === 'enrol' ? 'Thêm và đồng bộ' : 'Lưu thay đổi'}>{body}{mode === 'enrol' && partners && schoolEntry && onSchoolEntryChange && <div className="mt-4"><SchoolEntryPicker partners={partners} value={schoolEntry} onChange={onSchoolEntryChange} /></div>}{mode === 'enrol' && enrolExtra && <div className="mt-4">{enrolExtra}</div>}{error && <p className="mt-4 text-sm font-semibold text-rose-600">{error}</p>}</ExamDialog>;
}
