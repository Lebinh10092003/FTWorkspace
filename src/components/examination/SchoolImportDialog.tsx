import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, LoaderCircle, X } from 'lucide-react';
import type { Candidate, ExaminationSession } from './types';
import type { Partner } from './Partners';
import { formatBirthDate } from './ui';

type Issue = { level: 'error' | 'warning'; message: string; row?: number };
type ImportReport = { sessionId: string; label: string; registrations: number; newCandidates: number; existingCandidates: number; newRegistrations: number; existingRegistrations: number; amount: number | null; assigned: number; alreadyAssigned: number; waiting: number };
type Match = { code: string; name: string; birthDate: string; school: string; reason: string };
type PreviewRow = { row: number; name: string; contest: string; sessionId: string; needsDecision?: boolean; resolvedCode?: string; skipped?: boolean; matches: Match[] };
type Preview = {
  sheet: string; sheets: string[]; partner: Partial<Partner> & { address?: string }; newPartner: boolean;
  previewToken: string; canCommit: boolean; issues: Issue[]; skippedRows?: number[];
  summary: { rows: number; candidates: number; newCandidates: number; existingCandidates: number; registrations: number; newRegistrations: number; existingRegistrations: number; preservedIndividualRegistrations?: number; sessions: number };
  routes: { contest: string; sessionId: string; options: { id: string; label: string }[] }[];
  groups: { sessionId: string; label: string; registrations: number; amount: number | null; assigned: number; waiting: number }[];
  rows: PreviewRow[];
};
type Result = { items: Candidate[]; partners: Partner[]; sessions: ExaminationSession[]; issues: Issue[]; summary: Preview['summary']; report: ImportReport[] };
type IssueGroup = { level: Issue['level']; message: string; rows: number[] };
const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const DUPLICATE_DECISION = 'Cần xác nhận hồ sơ có khả năng trùng.';
const NEW_PROFILE = '__new__';

// One message per kind with its rows, instead of one line per row.
function groupIssues(issues: Issue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  issues.forEach(issue => {
    const key = `${issue.level}|${issue.message}`;
    const group = groups.get(key) || { level: issue.level, message: issue.message, rows: [] };
    if (issue.row && !group.rows.includes(issue.row)) group.rows.push(issue.row);
    groups.set(key, group);
  });
  return [...groups.values()].sort((left, right) => Number(left.level === 'warning') - Number(right.level === 'warning'));
}

const rowList = (rows: number[]) => rows.length ? `Dòng ${rows.slice(0, 30).join(', ')}${rows.length > 30 ? ` … (+${rows.length - 30})` : ''}` : '';

export default function SchoolImportDialog({ idToken, sessions, initialFile = null, onClose, onImported }: {
  idToken?: string | null; sessions: ExaminationSession[]; initialFile?: File | null; onClose: () => void;
  onImported: (result: Result) => void;
}) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [partner, setPartner] = useState<Partial<Partner>>({});
  const [file, setFile] = useState<File | null>(initialFile);
  const [sheet, setSheet] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [sessionMapping, setSessionMapping] = useState<Record<string, string>>({});
  const [candidateMatches, setCandidateMatches] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [partnersLoaded, setPartnersLoaded] = useState(false);
  const [stale, setStale] = useState(Boolean(initialFile));
  const [showAllRows, setShowAllRows] = useState(false);
  const revision = useRef(0);
  const active = useRef(true);
  const years = useMemo(() => [...new Set(sessions.map(s => s.academicYear || (s.time.match(/20\d{2}/g) || []).slice(0, 2).join('-')).filter(Boolean))].sort().reverse(), [sessions]);
  useEffect(() => {
    active.current = true;
    fetch('/api/examination/partners', { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} })
      .then(async response => { if (!response.ok) throw new Error('Không thể tải danh sách đối tác.'); return response.json(); })
      .then(data => { if (active.current) { setPartners(data.partners || []); setPartnersLoaded(true); } })
      .catch(cause => { if (active.current) setError(cause.message); });
    return () => { active.current = false; };
  }, [idToken]);
  // Any change re-checks the file automatically; the previous preview stays on
  // screen meanwhile so the operator keeps their place in the table.
  const invalidate = () => { revision.current += 1; setStale(true); setPreview(current => current ? { ...current, canCommit: false, previewToken: '' } : null); setError(''); };
  const choosePartner = (id: string) => {
    invalidate(); setPartnerId(id);
    setPartner(id ? partners.find(p => p.id === id) || {} : {});
  };
  const run = async (action: 'preview' | 'commit') => {
    if (!file) { setError('Chọn file Excel trước khi kiểm tra.'); return; }
    if (action === 'commit' && !preview?.canCommit) return;
    const currentRevision = revision.current;
    setBusy(true); setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('options', JSON.stringify({ action, partnerId, partner, academicYear, sheet, sessionMapping, candidateMatches, previewToken: preview?.previewToken }));
      const response = await fetch('/api/examination/import/school', { method: 'POST', body, headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thể nhập file.');
      if (!active.current || currentRevision !== revision.current) return;
      if (action === 'preview') {
        setPreview(data); setStale(false);
        if (!data.newPartner && data.partner.id) { setPartnerId(data.partner.id); setPartner(data.partner); }
      } else {
        setResult(data); setPreview(null); onImported(data);
      }
    } catch (cause: any) {
      if (!active.current) return;
      setError(cause?.message || 'Không thể nhập file.');
      // A rejected commit (expired/changed data) is re-checked, not discarded.
      if (action === 'commit') { revision.current += 1; setStale(true); }
      else setStale(false);
    } finally { if (active.current) setBusy(false); }
  };
  useEffect(() => {
    if (!stale || busy || !file || !partnersLoaded) return;
    const timer = window.setTimeout(() => void run('preview'), 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, busy, file, partnersLoaded, partnerId, partner, academicYear, sheet, sessionMapping, candidateMatches]);
  const displayedPartner = partnerId ? partner : { ...(preview?.partner || {}), ...partner };
  const updatePartner = (field: keyof Partner, value: string) => {
    setPartner({ ...displayedPartner, [field]: value }); invalidate();
  };
  const chooseMatch = (row: number, code: string) => { setCandidateMatches(current => ({ ...current, [row]: code })); invalidate(); };

  // A pupil registering several contests is one decision, not one per contest.
  const pupils = useMemo(() => {
    const byRow = new Map<number, PreviewRow & { contests: string[] }>();
    (preview?.rows || []).forEach(row => {
      const current = byRow.get(row.row);
      if (current) { if (row.contest && !current.contests.includes(row.contest)) current.contests.push(row.contest); }
      else byRow.set(row.row, { ...row, contests: row.contest ? [row.contest] : [] });
    });
    return [...byRow.values()];
  }, [preview]);
  const undecided = pupils.filter(row => row.needsDecision && !candidateMatches[String(row.row)]);
  const reviewRows = pupils.filter(row => row.matches.length > 0 || row.skipped);
  const visibleRows = showAllRows ? pupils : reviewRows;
  const issueGroups = useMemo(() => groupIssues((preview?.issues || []).filter(issue => issue.message !== DUPLICATE_DECISION)), [preview]);
  // Row errors only drop that row; errors without a row block the whole file.
  const errorGroups = issueGroups.filter(group => group.level === 'error' && !group.rows.length);
  const skippedGroups = issueGroups.filter(group => group.level === 'error' && group.rows.length);
  const skippedCount = preview?.skippedRows?.length || 0;
  const warningGroups = issueGroups.filter(group => group.level === 'warning');
  const checking = busy || stale;
  const blockers = errorGroups.map(group => group.message);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="school-import-title">
    <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4"><div><h2 id="school-import-title" className="flex items-center gap-2 text-xl font-extrabold text-[#001e40]"><FileSpreadsheet className="h-6 w-6" />Nhập Excel theo trường</h2><p className="mt-1 text-sm text-slate-600">Nhập một lần cho nhiều cuộc thi. Học sinh dùng chung hồ sơ; chỉ các lượt đăng ký qua trường được gộp đối soát. Lượt cá nhân đã có được giữ nguyên.</p></div><button type="button" aria-label="Đóng" disabled={busy} onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-50"><X /></button></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {result ? <div className="space-y-4">
        <h3 className="text-lg font-extrabold text-[#001e40]">Báo cáo kết quả nhập</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
          ['Thí sinh trong file', result.summary.candidates], ['Hồ sơ thí sinh mới', result.summary.newCandidates],
          ['Hồ sơ đã có được dùng lại', result.summary.existingCandidates], ['Lượt đăng ký bổ sung', result.summary.newRegistrations],
        ].map(([label, count]) => <div key={label} className="rounded-xl bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-800">{label}</p><b className="mt-2 block text-2xl text-[#001e40]">{count}</b></div>)}</div>
        <p className="text-sm text-slate-600">{result.summary.registrations} lượt đăng ký thuộc {result.summary.sessions} kỳ, gồm {result.summary.existingRegistrations} lượt đã có. Một học sinh đăng ký nhiều cuộc thi chỉ được tính một lần ở tổng số thí sinh.</p>
        {!!result.summary.preservedIndividualRegistrations && <p className="rounded-lg bg-blue-50 p-3 text-sm text-[#001e40]">Giữ nguyên {result.summary.preservedIndividualRegistrations} lượt đăng ký cá nhân cùng dữ liệu thanh toán và phân phòng đã có. Các lượt này không tính lại vào khoản thu của trường.</p>}
        <div className="overflow-x-auto"><table className="ft-table min-w-[950px]"><thead><tr><th>Cuộc thi / Kỳ tổ chức</th><th>Học sinh đăng ký</th><th>Hồ sơ mới</th><th>Hồ sơ đã có</th><th>Đăng ký bổ sung</th><th>Đã thuộc kỳ</th><th>Lệ phí trong file</th><th>Phân phòng</th></tr></thead><tbody>{result.report.map(group => <tr key={group.sessionId}><td className="font-bold">{group.label}</td><td>{group.registrations}</td><td>{group.newCandidates}</td><td>{group.existingCandidates}</td><td>{group.newRegistrations}</td><td>{group.existingRegistrations}</td><td>{group.amount === null ? 'Chưa đủ lệ phí' : `${group.amount.toLocaleString('vi-VN')}đ`}</td><td>{group.assigned} mới · {group.alreadyAssigned} đã phân · {group.waiting} chờ</td></tr>)}</tbody></table></div>
        <p className="text-sm text-emerald-800">Báo cáo đã được ghi vào nhật ký từng kỳ. Dữ liệu chờ đồng bộ vào các Sheet đã liên kết.</p>
        {groupIssues(result.issues).map(group => <p key={`${group.level}-${group.message}`} className="text-sm text-amber-800">{group.message}{group.rows.length ? ` (${rowList(group.rows)})` : ''}</p>)}
      </div> : <>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 disabled:opacity-60">
          <label className="text-sm font-bold sm:col-span-2">File đăng ký (.xlsx){file && <span className="ml-2 font-normal text-slate-500">· {file.name}</span>}<input type="file" accept=".xlsx" className={fieldClass} onChange={event => { setFile(event.target.files?.[0] || null); setSheet(''); setSessionMapping({}); setCandidateMatches({}); setPreview(null); invalidate(); }} /></label>
          <label className="text-sm font-bold">Năm học<select className={fieldClass} value={academicYear} onChange={event => { setAcademicYear(event.target.value); setSessionMapping({}); invalidate(); }}><option value="">Tự xác định / tất cả</option>{years.map(year => <option key={year}>{year}</option>)}</select></label>
          <label className="text-sm font-bold lg:col-span-3">Đối tác trường học<select className={fieldClass} value={partnerId} onChange={event => choosePartner(event.target.value)} disabled={!partnersLoaded}><option value="">Chọn trường hoặc nhập trường mới</option>{partners.map(p => <option key={p.id} value={p.id}>{p.school} · {p.province} · {p.representative}</option>)}</select></label>
          {(['school', 'representative', 'phone', 'email', 'province', 'ward', 'level'] as const).map((field, index) => <label key={field} className="text-sm font-bold">{['Tên trường *', 'Người liên lạc', 'Số điện thoại', 'Email liên lạc', 'Tỉnh / Thành phố', 'Xã / Phường', 'Cấp học'][index]}<input type={field === 'email' ? 'email' : 'text'} readOnly={!!partnerId} className={fieldClass} value={displayedPartner[field] || ''} onChange={event => updatePartner(field, event.target.value)} /></label>)}
        </fieldset>
        <p className="mt-3 text-xs text-slate-500">Thông tin trường ở đầu file được đọc tự động. Mọi thay đổi bên dưới được kiểm tra lại ngay, không cần bấm lại. Ngày sinh, lớp, liên lạc còn thiếu được để trống để bổ sung sau.</p>
        {preview && <div className={`mt-5 space-y-4 ${checking ? 'opacity-70' : ''}`}>
          {preview.sheets.length > 1 && <label className="block text-sm font-bold">Tab danh sách<select disabled={busy} className={fieldClass} value={preview.sheet} onChange={event => { setSheet(event.target.value); invalidate(); }}>{preview.sheets.map(name => <option key={name}>{name}</option>)}</select></label>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
            ['Học sinh', `${preview.summary.candidates}`, `${preview.summary.newCandidates} hồ sơ mới`],
            ['Lượt đăng ký', `${preview.summary.registrations}`, `${preview.summary.newRegistrations} bổ sung · ${preview.summary.existingRegistrations} đã có`],
            ['Kỳ tổ chức', `${preview.summary.sessions}`, `${preview.summary.rows} dòng trong file`],
            ['Dòng sẽ bỏ qua', `${skippedCount}`, skippedCount ? `${undecided.length} dòng chỉ cần chọn hồ sơ` : 'Không có'],
          ].map(([label, value, note]) => <div key={label} className={`rounded-xl p-3 ${label === 'Dòng sẽ bỏ qua' && skippedCount ? 'bg-amber-50' : 'bg-slate-50'}`}><p className="text-xs font-bold text-slate-600">{label}</p><b className="mt-1 block text-2xl text-[#001e40]">{value}</b><p className="text-xs text-slate-500">{note}</p></div>)}</div>
          {preview.routes.some(route => !route.sessionId || route.options.length > 1) && <div className="grid gap-3 sm:grid-cols-2">{preview.routes.map(route => <label key={route.contest} className="text-sm font-bold">{route.contest || 'Chưa có mã cuộc thi'}<select disabled={busy} value={sessionMapping[route.contest] || route.sessionId} className={fieldClass} onChange={event => { setSessionMapping({ ...sessionMapping, [route.contest]: event.target.value }); invalidate(); }}><option value="">Chọn kỳ tổ chức</option>{route.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>)}</div>}
          <div className="overflow-x-auto"><table className="ft-table"><thead><tr><th>Kỳ tổ chức</th><th>Lượt đăng ký</th><th>Lệ phí trong file</th><th>Phân phòng</th></tr></thead><tbody>{preview.groups.map(group => <tr key={group.sessionId}><td>{group.label}</td><td>{group.registrations}</td><td>{group.amount === null ? 'Chưa đủ lệ phí' : `${group.amount.toLocaleString('vi-VN')}đ`}</td><td>{group.assigned} sẽ phân · {group.waiting} chờ</td></tr>)}</tbody></table></div>
          {errorGroups.length > 0 && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3" aria-live="polite"><p className="flex items-center gap-2 text-sm font-extrabold text-rose-800"><AlertTriangle className="h-4 w-4" />Lỗi chung của file — cần sửa trước khi nhập</p><ul className="mt-2 space-y-1 text-sm text-rose-800">{errorGroups.map(group => <li key={group.message}><b>{group.message}</b>{group.rows.length ? <span className="text-rose-700"> — {rowList(group.rows)}</span> : null}</li>)}</ul></div>}
          {skippedGroups.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="flex items-center gap-2 text-sm font-extrabold text-amber-900"><AlertTriangle className="h-4 w-4" />{skippedCount} dòng sẽ không được nhập; các học sinh khác vẫn nhập bình thường</p><ul className="mt-2 space-y-1 text-sm text-amber-900">{skippedGroups.map(group => <li key={group.message}><b>{group.message}</b> — {rowList(group.rows)}</li>)}</ul><p className="mt-2 text-xs text-amber-800">Sửa file rồi nhập lại, hoặc chọn hồ sơ ở bảng bên dưới với dòng nghi trùng.</p></div>}
          {warningGroups.length > 0 && <details className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><summary className="cursor-pointer font-bold">{warningGroups.length} loại lưu ý (không chặn việc nhập)</summary><ul className="mt-2 space-y-1">{warningGroups.map(group => <li key={group.message}>{group.message}{group.rows.length ? <span className="text-amber-700"> — {group.rows.length} dòng ({rowList(group.rows)})</span> : null}</li>)}</ul></details>}
          <div className="rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2"><b className="text-sm text-[#001e40]">Đối chiếu hồ sơ học sinh</b><div className="flex gap-1 text-xs font-bold">{([[false, `Cần xem (${reviewRows.length})`], [true, `Tất cả (${pupils.length})`]] as const).map(([all, label]) => <button key={label} type="button" onClick={() => setShowAllRows(all)} className={`rounded-lg px-3 py-1.5 ${showAllRows === all ? 'bg-[#001e40] text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{label}</button>)}</div></div>
            {visibleRows.length === 0 ? <p className="p-4 text-sm text-slate-600">Không có học sinh nào trùng hoặc gần giống hồ sơ trên web; tất cả sẽ được tạo hồ sơ mới hoặc dùng hồ sơ trùng khớp chắc chắn.</p> : <div className="max-h-[26rem] overflow-auto"><table className="ft-table min-w-[820px]"><thead className="sticky top-0 z-10"><tr><th className="w-16">Dòng</th><th className="w-56">Học sinh</th><th>Hồ sơ sẽ dùng</th></tr></thead><tbody>{visibleRows.map(row => {
              const chosen = candidateMatches[String(row.row)] || '';
              const effective = chosen || row.resolvedCode || '';
              const waiting = row.needsDecision && !chosen;
              return <tr key={row.row} className={waiting ? 'bg-amber-50/70' : ''}>
                <td className="align-top font-bold">{row.row}</td>
                <td className="align-top"><b>{row.name}</b><p className="mt-1 text-xs text-slate-500">{row.contests.join(', ') || 'Chưa có cuộc thi'}</p>{waiting ? <span className="mt-1 inline-block rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900">Chọn hồ sơ để nhập</span> : row.skipped ? <span className="mt-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">Bỏ qua do lỗi</span> : <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" />{effective === NEW_PROFILE ? 'Tạo hồ sơ mới' : effective ? `Dùng ${effective}` : 'Tạo hồ sơ mới'}</span>}</td>
                <td className="align-top">{row.matches.length ? <div className="flex flex-col gap-1.5">{row.matches.map(match => <button key={match.code} type="button" disabled={busy} onClick={() => chooseMatch(row.row, match.code)} className={`rounded-lg border px-3 py-2 text-left text-xs ${effective === match.code ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-400' : 'border-slate-200 bg-white hover:border-emerald-300'}`}><b>{match.code} · {match.name}</b> · {formatBirthDate(match.birthDate) || 'chưa có ngày sinh'}{match.school ? ` · ${match.school}` : ''}<span className="block text-slate-500">{match.reason}</span></button>)}<button type="button" disabled={busy} onClick={() => chooseMatch(row.row, NEW_PROFILE)} className={`rounded-lg border px-3 py-2 text-left text-xs font-bold ${effective === NEW_PROFILE ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-400' : 'border-dashed border-slate-300 bg-white text-slate-700 hover:border-sky-300'}`}>Học sinh khác — tạo hồ sơ mới</button></div> : <span className="text-xs text-slate-500">Tạo hồ sơ mới (hoặc dùng chung hồ sơ với dòng cùng học sinh trong file)</span>}</td>
              </tr>;
            })}</tbody></table></div>}
          </div>
        </div>}
      </>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3">
        {result ? <button type="button" onClick={onClose} className="ft-primary">Hoàn tất</button> : <>
          <p className="mr-auto text-sm font-semibold" aria-live="polite">{!file ? <span className="text-slate-500">Chọn file đăng ký của trường để bắt đầu.</span> : checking ? <span className="inline-flex items-center gap-2 text-slate-600"><LoaderCircle className="h-4 w-4 animate-spin" />Đang kiểm tra file…</span> : preview?.canCommit ? <span className="text-emerald-700">Sẵn sàng nhập {preview.summary.registrations} lượt đăng ký{skippedCount ? ` · bỏ qua ${skippedCount} dòng lỗi` : ''}.</span> : preview ? <span className="text-rose-700">Chưa nhập được: {blockers.join(' · ') || 'không còn dòng hợp lệ để nhập'}.</span> : null}</p>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border bg-white px-4 py-2 text-sm font-bold">Đóng</button>
          {!preview && <button type="button" disabled={busy || !file || !partnersLoaded} onClick={() => void run('preview')} className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40] disabled:opacity-50">Kiểm tra file</button>}
          <button type="button" disabled={checking || !preview?.canCommit} onClick={() => void run('commit')} className="ft-primary disabled:opacity-50">{preview?.canCommit ? `Nhập ${preview.summary.registrations} lượt đăng ký` : 'Xác nhận nhập'}</button>
        </>}
      </div>
    </div>
  </div>;
}
