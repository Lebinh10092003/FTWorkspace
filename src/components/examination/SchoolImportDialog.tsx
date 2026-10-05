import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, LoaderCircle, X } from 'lucide-react';
import type { Candidate, ExaminationSession } from './types';
import type { Partner } from './Partners';

type Issue = { level: 'error' | 'warning'; message: string; row?: number };
type ImportReport = { sessionId: string; label: string; registrations: number; newCandidates: number; existingCandidates: number; newRegistrations: number; existingRegistrations: number; amount: number | null; assigned: number; alreadyAssigned: number; waiting: number };
type Preview = {
  sheet: string; sheets: string[]; partner: Partial<Partner> & { address?: string }; newPartner: boolean;
  previewToken: string; canCommit: boolean; issues: Issue[];
  summary: { rows: number; candidates: number; newCandidates: number; existingCandidates: number; registrations: number; newRegistrations: number; existingRegistrations: number; preservedIndividualRegistrations?: number; sessions: number };
  routes: { contest: string; sessionId: string; options: { id: string; label: string }[] }[];
  groups: { sessionId: string; label: string; registrations: number; amount: number | null; assigned: number; waiting: number }[];
  rows: { row: number; name: string; contest: string; sessionId: string; matches: { code: string; name: string; birthDate: string; school: string; reason: string }[] }[];
};
type Result = { items: Candidate[]; partners: Partner[]; sessions: ExaminationSession[]; issues: Issue[]; summary: Preview['summary']; report: ImportReport[] };
const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';

export default function SchoolImportDialog({ idToken, sessions, onClose, onImported }: {
  idToken?: string | null; sessions: ExaminationSession[]; onClose: () => void;
  onImported: (result: Result) => void;
}) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [partner, setPartner] = useState<Partial<Partner>>({});
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [sessionMapping, setSessionMapping] = useState<Record<string, string>>({});
  const [candidateMatches, setCandidateMatches] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [partnersLoaded, setPartnersLoaded] = useState(false);
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
  const invalidate = () => { revision.current += 1; setPreview(current => current ? { ...current, canCommit: false, previewToken: '' } : null); setError(''); };
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
        setPreview(data);
        if (!data.newPartner && data.partner.id) { setPartnerId(data.partner.id); setPartner(data.partner); }
        // Keep exactly the options used to sign the preview. Metadata is shown below;
        // editing it requests a fresh preview before committing.
      } else {
        setResult(data); setPreview(null); onImported(data);
      }
    } catch (cause: any) {
      if (active.current) { setError(cause?.message || 'Không thể nhập file.'); if (action === 'commit') setPreview(null); }
    } finally { if (active.current) setBusy(false); }
  };
  const displayedPartner = partnerId ? partner : { ...(preview?.partner || {}), ...partner };
  const updatePartner = (field: keyof Partner, value: string) => {
    setPartner({ ...displayedPartner, [field]: value }); invalidate();
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="school-import-title">
    <div className="max-h-[calc(100vh-2rem)] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 id="school-import-title" className="flex items-center gap-2 text-xl font-extrabold text-[#001e40]"><FileSpreadsheet className="h-6 w-6" />Nhập Excel theo trường</h2><p className="mt-2 text-sm text-slate-600">Nhập một lần cho nhiều cuộc thi. Học sinh dùng chung hồ sơ; chỉ các lượt đăng ký qua trường được gộp đối soát. Lượt cá nhân đã có được giữ nguyên.</p></div><button type="button" aria-label="Đóng" disabled={busy} onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-50"><X /></button></div>
      {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {result ? <div className="mt-5 space-y-4">
        <h3 className="text-lg font-extrabold text-[#001e40]">Báo cáo kết quả nhập</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
          ['Thí sinh trong file', result.summary.candidates], ['Hồ sơ thí sinh mới', result.summary.newCandidates],
          ['Hồ sơ đã có được dùng lại', result.summary.existingCandidates], ['Lượt đăng ký bổ sung', result.summary.newRegistrations],
        ].map(([label, count]) => <div key={label} className="rounded-xl bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-800">{label}</p><b className="mt-2 block text-2xl text-[#001e40]">{count}</b></div>)}</div>
        <p className="text-sm text-slate-600">{result.summary.registrations} lượt đăng ký thuộc {result.summary.sessions} kỳ, gồm {result.summary.existingRegistrations} lượt đã có. Một học sinh đăng ký nhiều cuộc thi chỉ được tính một lần ở tổng số thí sinh.</p>
        {!!result.summary.preservedIndividualRegistrations && <p className="rounded-lg bg-blue-50 p-3 text-sm text-[#001e40]">Giữ nguyên {result.summary.preservedIndividualRegistrations} lượt đăng ký cá nhân cùng dữ liệu thanh toán và phân phòng đã có. Các lượt này không tính lại vào khoản thu của trường.</p>}
        <div className="overflow-x-auto"><table className="ft-table min-w-[950px]"><thead><tr><th>Cuộc thi / Kỳ tổ chức</th><th>Học sinh đăng ký</th><th>Hồ sơ mới</th><th>Hồ sơ đã có</th><th>Đăng ký bổ sung</th><th>Đã thuộc kỳ</th><th>Lệ phí trong file</th><th>Phân phòng</th></tr></thead><tbody>{result.report.map(group => <tr key={group.sessionId}><td className="font-bold">{group.label}</td><td>{group.registrations}</td><td>{group.newCandidates}</td><td>{group.existingCandidates}</td><td>{group.newRegistrations}</td><td>{group.existingRegistrations}</td><td>{group.amount === null ? 'Chưa đủ lệ phí' : `${group.amount.toLocaleString('vi-VN')}đ`}</td><td>{group.assigned} mới · {group.alreadyAssigned} đã phân · {group.waiting} chờ</td></tr>)}</tbody></table></div>
        <p className="text-sm text-emerald-800">Báo cáo đã được ghi vào nhật ký từng kỳ. Dữ liệu chờ đồng bộ vào các Sheet đã liên kết.</p>
        {result.issues.map((issue, i) => <p key={i} className="text-sm text-amber-800">{issue.row ? `Dòng ${issue.row}: ` : ''}{issue.message}</p>)}
        <button type="button" onClick={onClose} className="ft-primary">Hoàn tất</button>
      </div> : <>
        <fieldset disabled={busy} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 disabled:opacity-60">
          <label className="text-sm font-bold sm:col-span-2">File đăng ký (.xlsx)<input type="file" accept=".xlsx" className={fieldClass} onChange={event => { invalidate(); setFile(event.target.files?.[0] || null); setSheet(''); setSessionMapping({}); setCandidateMatches({}); }} /></label>
          <label className="text-sm font-bold">Năm học<select className={fieldClass} value={academicYear} onChange={event => { invalidate(); setAcademicYear(event.target.value); setSessionMapping({}); }}><option value="">Tự xác định / tất cả</option>{years.map(year => <option key={year}>{year}</option>)}</select></label>
          <label className="text-sm font-bold lg:col-span-3">Đối tác trường học<select className={fieldClass} value={partnerId} onChange={event => choosePartner(event.target.value)} disabled={!partnersLoaded}><option value="">Chọn trường hoặc nhập trường mới</option>{partners.map(p => <option key={p.id} value={p.id}>{p.school} · {p.province} · {p.representative}</option>)}</select></label>
          {(['school', 'representative', 'phone', 'email', 'province', 'ward', 'level'] as const).map((field, index) => <label key={field} className="text-sm font-bold">{['Tên trường *', 'Người liên lạc', 'Số điện thoại', 'Email liên lạc', 'Tỉnh / Thành phố', 'Xã / Phường', 'Cấp học'][index]}<input type={field === 'email' ? 'email' : 'text'} readOnly={!!partnerId} className={fieldClass} value={displayedPartner[field] || ''} onChange={event => updatePartner(field, event.target.value)} /></label>)}
        </fieldset>
        <p className="mt-3 text-xs text-slate-500">File có thông tin trường ở đầu trang sẽ được đọc tự động. Nếu có nhiều tab danh sách, kiểm tra một tab mỗi lần để tránh nhập cả bản sao.</p>
        <p className="mt-2 text-xs text-slate-500">Ngày sinh, lớp và thông tin liên lạc còn thiếu được để trống để bổ sung sau. CCCD dạng số được bù số 0 ở đầu đủ 12 số; SĐT Việt Nam đủ 10 số.</p>
        {preview && <div className="mt-5 space-y-4">
          <label className="block text-sm font-bold">Tab danh sách<select disabled={busy} className={fieldClass} value={preview.sheet} onChange={event => { invalidate(); setSheet(event.target.value); }}>{preview.sheets.map(name => <option key={name}>{name}</option>)}</select></label>
          <p className="rounded-lg bg-blue-50 p-3 text-sm font-bold text-[#001e40]">{preview.summary.rows} dòng · {preview.summary.candidates} học sinh ({preview.summary.newCandidates} mới) · {preview.summary.registrations} lượt đăng ký · {preview.summary.sessions} kỳ</p>
          {!!preview.summary.preservedIndividualRegistrations && <p className="text-sm text-blue-800">Có {preview.summary.preservedIndividualRegistrations} lượt đăng ký cá nhân đã tồn tại: giữ nguyên thanh toán, phân phòng và không tính lại vào khoản thu của trường.</p>}
          <div className="grid gap-3 sm:grid-cols-2">{preview.routes.map(route => <label key={route.contest} className="text-sm font-bold">{route.contest || 'Chưa có mã cuộc thi'}<select disabled={busy} value={sessionMapping[route.contest] || route.sessionId} className={fieldClass} onChange={event => { setSessionMapping({ ...sessionMapping, [route.contest]: event.target.value }); invalidate(); }}><option value="">Chọn kỳ tổ chức</option>{route.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>)}</div>
          <div className="overflow-x-auto"><table className="ft-table"><thead><tr><th>Kỳ tổ chức</th><th>Lượt đăng ký</th><th>Lệ phí trong file</th><th>Phân phòng</th></tr></thead><tbody>{preview.groups.map(group => <tr key={group.sessionId}><td>{group.label}</td><td>{group.registrations}</td><td>{group.amount === null ? 'Chưa đủ lệ phí' : `${group.amount.toLocaleString('vi-VN')}đ`}</td><td>{group.assigned} sẽ phân · {group.waiting} chờ</td></tr>)}</tbody></table></div>
          {preview.issues.length > 0 && <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-amber-200 p-3" aria-live="polite">{preview.issues.map((issue, index) => <p key={index} className={`text-sm ${issue.level === 'error' ? 'text-rose-700' : 'text-amber-800'}`}><b>{issue.level === 'error' ? 'Lỗi' : 'Lưu ý'}{issue.row ? ` · Dòng ${issue.row}` : ''}: </b>{issue.message}</p>)}</div>}
          <div className="max-h-72 overflow-auto"><table className="ft-table min-w-[700px]"><thead><tr><th>Dòng</th><th>Họ tên</th><th>Cuộc thi</th><th>Đối chiếu hồ sơ</th></tr></thead><tbody>{preview.rows.map(row => <tr key={`${row.row}-${row.contest}`}><td>{row.row}</td><td>{row.name}</td><td>{row.contest}</td><td>{row.matches.length ? <select disabled={busy} className={fieldClass} value={candidateMatches[String(row.row)] || ''} onChange={event => { setCandidateMatches({ ...candidateMatches, [row.row]: event.target.value }); invalidate(); }}><option value="">Theo kết quả tự đối chiếu</option>{row.matches.map(match => <option key={match.code} value={match.code}>{match.code} · {match.name} · {match.birthDate} · {match.reason}</option>)}<option value="__new__">Xác nhận là học sinh khác, tạo mới</option></select> : 'Tạo hồ sơ mới / dùng hồ sơ cùng học sinh trong file'}</td></tr>)}</tbody></table></div>
        </div>}
        <div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-4 py-2 text-sm font-bold">Đóng</button><button type="button" disabled={busy || !file || !partnersLoaded} onClick={() => void run('preview')} className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-bold text-[#001e40] disabled:opacity-50">{busy && <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />}Kiểm tra / xem trước</button><button type="button" disabled={busy || !preview?.canCommit} onClick={() => void run('commit')} className="ft-primary disabled:opacity-50">Xác nhận nhập toàn bộ</button></div>
      </>}
    </div>
  </div>;
}
