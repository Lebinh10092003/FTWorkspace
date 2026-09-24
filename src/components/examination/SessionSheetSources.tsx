import React, { useState } from 'react';
import { Clock3, ExternalLink, FileSpreadsheet, Pencil, Plus, RefreshCw, UploadCloud, X } from 'lucide-react';

type SheetSource = { id: string; name?: string; url: string; stage?: string; sheetTab?: string; automationEnabled?: boolean; automationStartDate?: string; automationEndDate?: string; pendingManualImport?: boolean; changeDetectedAt?: string | null };
type Props = { sources: SheetSource[]; sessionId: string; sessionLabel: string; idToken?: string | null; canManage: boolean; onImport: () => void; onSourcesChanged: (sources: SheetSource[]) => void };
type ExportPreview = { currentFingerprint: string; sheetTab: string; changedCells: number; changedRows: number; matchedRows?: number; appendedRows?: number; appendedCandidates?: { code?: string; name?: string; birth_date?: string; identity?: string; email?: string; phone?: string }[]; unmatchedSheetRows?: number[]; matchConflicts?: { row: number; rowLabel: string; reason: string; sheetIdentity?: string; candidateOptions?: string[] }[]; changes: { cell: string; row?: number; rowLabel?: string; column?: string; field?: string; current: string; next: string }[]; changesTruncated?: boolean };
type ImportPreview = { source?: { name?: string; id?: string; fingerprint?: string; sheetTab?: string }; summary?: { total?: number; new?: number; matched?: number; changed?: number; unchanged?: number; conflicts?: number; webOnly?: number }; webOnlyRecords?: { code?: string; name?: string; birthDate?: string; identity?: string; email?: string; phone?: string }[]; records: { code?: string; name?: string; _preview?: { sourceRow?: number; status?: 'new' | 'changed' | 'unchanged' | 'conflict'; matchedCode?: string; changedFields?: string[]; changes?: { field: string; label?: string; current?: string; next?: string }[] } }[] };
const sheetType = (source: SheetSource) => source.stage === 'session-output' ? 'Sheet tổng hợp' : 'Sheet đầu vào';
const schedule = (source: SheetSource) => !source.automationEnabled ? 'Chưa bật lịch tự động' : `${source.stage === 'session-output' ? 'Xuất 11:00 và 16:00' : 'Nhập 10:00 và 15:00'}${[source.automationStartDate, source.automationEndDate].filter(Boolean).length ? ` · ${[source.automationStartDate, source.automationEndDate].filter(Boolean).join(' – ')}` : ''}`;

export default function SessionSheetSources({ sources, sessionId, sessionLabel, idToken, canManage, onImport, onSourcesChanged }: Props) {
  const [editing, setEditing] = useState<SheetSource | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', stage: 'registration-source', sheetTab: '', automationEnabled: false, automationStartDate: '', automationEndDate: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState('');
  const [importNewRecords, setImportNewRecords] = useState(true);
  const [importEmptyValues, setImportEmptyValues] = useState(true);
  const [overwriteExistingValues, setOverwriteExistingValues] = useState(true);
  const [removeWebOnlyCandidates, setRemoveWebOnlyCandidates] = useState(false);
  const [exportSelectedCodes, setExportSelectedCodes] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<{ source: SheetSource; data: ImportPreview } | null>(null);
  const [exportPreview, setExportPreview] = useState<{ source: SheetSource; data: ExportPreview } | null>(null);
  const openForm = (source?: SheetSource) => { setEditing(source || null); setFormOpen(true); setError(''); setForm({ name: source?.name || '', url: source?.url || '', stage: source?.stage === 'session-output' ? 'session-output' : 'registration-source', sheetTab: source?.sheetTab || '', automationEnabled: Boolean(source?.automationEnabled), automationStartDate: source?.automationStartDate || '', automationEndDate: source?.automationEndDate || '' }); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.url.trim()) { setError('Nhập tên nguồn dữ liệu và liên kết Google Sheets.'); return; }
    setSaving(true); setError('');
    try {
      const endpoint = editing ? `/api/examination/sheets/${editing.id}` : '/api/examination/sheets';
      const response = await fetch(endpoint, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken || ''}` }, body: JSON.stringify({ ...form, name: form.name.trim(), url: form.url.trim(), sheetTab: form.sheetTab.trim(), sessionId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Không thể lưu nguồn dữ liệu.');
      const rows = await fetch('/api/examination/sheets', { headers: { Authorization: `Bearer ${idToken || ''}` } }).then(result => result.ok ? result.json() : []);
      onSourcesChanged(Array.isArray(rows) ? rows : []);
      setEditing(null); setFormOpen(false);
    } catch (requestError: any) { setError(requestError.message || 'Không thể lưu nguồn dữ liệu.'); }
    finally { setSaving(false); }
  };
  const requestImport = async (source: SheetSource) => {
    setImportingId(source.id); setImportMessage(''); setError('');
    try {
      const previewResponse = await fetch('/api/examination/sheets/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken || ''}` },
        body: JSON.stringify({ id: source.id }),
      });
      const preview = await previewResponse.json().catch(() => ({}));
      if (!previewResponse.ok) throw new Error(preview?.error || '\u004b\u0068\u00f4\u006e\u0067 th\u1ec3 \u0111\u1ecdc ngu\u1ed3n d\u1eef li\u1ec7u n\u00e0y.');
      setImportNewRecords(true);
      setImportEmptyValues(true);
      setOverwriteExistingValues(true);
      setRemoveWebOnlyCandidates(false);
      setImportPreview({ source, data: preview as ImportPreview });
    } catch (requestError: any) { setImportMessage(requestError.message || '\u004b\u0068\u00f4\u006e\u0067 th\u1ec3 \u0111\u1ecdc ngu\u1ed3n d\u1eef li\u1ec7u n\u00e0y.'); }
    finally { setImportingId(null); }
  };
  const confirmImport = async () => {
    if (!importPreview) return;
    const { source, data } = importPreview;
    if (Number(data.summary?.conflicts || 0)) return;
    setImportingId(source.id); setImportMessage('');
    try {
      const response = await fetch('/api/examination/import/candidates', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken || ''}` },
        body: JSON.stringify({
          records: selectedImportRecords, source: data.source?.name || source.name || 'Google Sheets',
          sessionId, sheetId: source.id, sourceFingerprint: data.source?.fingerprint || '', updateMode: selectedUpdateMode, importEmptyValues, removeSessionCandidateCodes: removeWebOnlyCandidates ? (data.webOnlyRecords || []).map(person => person.code).filter(Boolean) : [],
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '\u004b\u0068\u00f4\u006e\u0067 th\u1ec3 nh\u1eadp d\u1eef li\u1ec7u t\u1eeb ngu\u1ed3n n\u00e0y.');
      setImportPreview(null);
      setImportMessage(`\u0110\u00e3 nh\u1eadp t\u1eeb ngu\u1ed3n \u201c${source.name || 'Google Sheets'}\u201d: ${body.created || 0} m\u1edbi, ${body.updated || 0} c\u1eadp nh\u1eadt.`);
      await Promise.resolve(onImport());
    } catch (requestError: any) { setImportMessage(requestError.message || '\u004b\u0068\u00f4\u006e\u0067 th\u1ec3 nh\u1eadp d\u1eef li\u1ec7u t\u1eeb ngu\u1ed3n n\u00e0y.'); }
    finally { setImportingId(null); }
  };
  const requestExport = async (source: SheetSource, confirmed = false, currentFingerprint = '', exportMode: 'merge' | 'append-only' = 'merge', appendCandidateCodes: string[] = exportSelectedCodes) => {
    setExportingId(source.id); setError('');
    try {
      const response = await fetch(`/api/examination/sheets/${source.id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken || ''}` }, body: JSON.stringify(confirmed ? { confirmOverwrite: true, currentFingerprint, exportMode, appendCandidateCodes } : { exportMode }) });
      const body = await response.json();
      if (response.status === 409 && body.requiresConfirmation && body.preview) { const codes = (body.preview.appendedCandidates || []).map((person: { code?: string }) => person.code).filter(Boolean); setExportSelectedCodes(codes); setExportPreview({ source, data: body.preview }); return; }
      if (!response.ok) throw new Error(body.error || 'Không thể xuất dữ liệu.');
      setExportPreview(null);
      const rows = await fetch('/api/examination/sheets', { headers: { Authorization: `Bearer ${idToken || ''}` } }).then(result => result.ok ? result.json() : []);
      onSourcesChanged(Array.isArray(rows) ? rows : []);
    } catch (requestError: any) { setError(requestError.message || 'Không thể xuất dữ liệu.'); }
    finally { setExportingId(null); }
  };
  const selectedUpdateMode: 'add-only' | 'fill-empty' | 'replace-nonempty' = overwriteExistingValues ? 'replace-nonempty' : importEmptyValues ? 'fill-empty' : 'add-only';
  const selectedChange = (change: { current?: string }) => Boolean(change.current) ? overwriteExistingValues : importEmptyValues;
  const isSelectedRecord = (record: ImportPreview['records'][number]) => {
    const status = record._preview?.status;
    if (status === 'new') return importNewRecords;
    if (status === 'conflict') return true;
    return (record._preview?.changes || []).some(selectedChange);
  };
  const selectedImportRecords = importPreview ? importPreview.data.records.filter(record => record._preview?.status !== 'conflict' && isSelectedRecord(record)) : [];
  const tableRecords = importPreview ? importPreview.data.records.filter(record => record._preview?.status !== 'unchanged' && isSelectedRecord(record)).slice(0, 250) : [];
  const selectedChanges = importPreview ? importPreview.data.records.flatMap(record => (record._preview?.changes || []).filter(selectedChange)) : [];
  const emptyFieldCount = selectedChanges.filter(change => !change.current).length;
  const overwriteFieldCount = selectedChanges.filter(change => Boolean(change.current)).length;
  return <section className="ft-surface mt-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
<div>
<h2 className="flex items-center gap-2 text-xl font-bold text-[#001e40]">
<FileSpreadsheet className="h-5 w-5 text-emerald-700" />Nguồn dữ liệu Google Sheets</h2>
<p className="mt-1 text-sm text-slate-600">Các liên kết dưới đây chỉ thuộc kỳ tổ chức đang mở.</p>
</div>
{importMessage && <p className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-900">
{importMessage}</p>}{canManage && <button onClick={() => openForm()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700">
<Plus className="h-4 w-4" />Thêm liên kết Sheet</button>}</div>
    {sources.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">Kỳ tổ chức này chưa có nguồn Google Sheets.</div> : <div className="mt-4 grid gap-3">
{sources.map(source => { const output = source.stage === 'session-output'; return <div key={source.id} className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
<div className="flex flex-wrap items-start justify-between gap-3">
<div className="min-w-0">
<div className="flex flex-wrap items-center gap-2">
<b className="text-base text-[#001e40]">
{source.name || 'Google Sheets chưa đặt tên'}</b>
<span className={`rounded-full px-2.5 py-1 text-xs font-bold ${output ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
{sheetType(source)}</span>
{source.pendingManualImport && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Tab đã thay đổi · cần nhập vào web{source.changeDetectedAt ? ` · ${new Date(source.changeDetectedAt).toLocaleString('vi-VN')}` : ''}</span>}</div>
<div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
<p>
<span className="font-bold text-slate-700">Tab:</span> {source.sheetTab || 'Chưa khai báo'}</p>
<p className="inline-flex items-center gap-1.5">
<Clock3 className="h-4 w-4" />
{schedule(source)}</p>
</div>
<a href={source.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex max-w-full items-center gap-1.5 truncate text-sm font-bold text-indigo-700 hover:underline">
<ExternalLink className="h-4 w-4 shrink-0" />Mở Google Sheet</a>
</div>
{canManage && <div className="flex shrink-0 flex-wrap gap-2">
<button disabled={importingId === source.id} onClick={() => requestImport(source)} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
<RefreshCw className="h-3.5 w-3.5" />
{importingId === source.id ? '\u0110ang nh\u1eadp\u2026' : 'Nh\u1eadp d\u1eef li\u1ec7u'}</button>
{output && <button disabled={exportingId === source.id} onClick={() => requestExport(source)} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
<UploadCloud className="h-3.5 w-3.5" />
{exportingId === source.id ? 'Đang kiểm tra…' : 'Xuất dữ liệu'}</button>}<button onClick={() => openForm(source)} title="Sửa nguồn dữ liệu" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50">
<Pencil className="h-3.5 w-3.5" />
</button>
</div>}</div>
</div>; })}</div>}
    {canManage && formOpen && <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4">
<form onSubmit={save} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
<div className="flex items-start justify-between gap-4">
<div>
<h3 className="text-xl font-extrabold text-slate-900">
{editing ? 'Chỉnh sửa nguồn Google Sheets' : 'Thêm nguồn Google Sheets'}</h3>
<p className="mt-1 text-sm text-slate-500">Nguồn dữ liệu được gắn cố định với kỳ: <b>
{sessionLabel}</b>.</p>
</div>
<button type="button" onClick={() => { setEditing(null); setFormOpen(false); setForm({ name: '', url: '', stage: 'registration-source', sheetTab: '', automationEnabled: false, automationStartDate: '', automationEndDate: '' }); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
<X className="h-4 w-4" />
</button>
</div>
<div className="mt-5 grid gap-4">
<label>
<span className="mb-1 block text-sm font-bold">Tên nguồn dữ liệu *</span>
<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
</label>
<label>
<span className="mb-1 block text-sm font-bold">Liên kết Google Sheets *</span>
<input required type="url" value={form.url} onChange={event => setForm({ ...form, url: event.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
</label>
<div className="grid gap-3 sm:grid-cols-2">
<label>
<span className="mb-1 block text-sm font-bold">Loại Sheet</span>
<select value={form.stage} onChange={event => setForm({ ...form, stage: event.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2">
<option value="registration-source">Sheet đầu vào</option>
<option value="session-output">Sheet tổng hợp</option>
</select>
</label>
<label>
<span className="mb-1 block text-sm font-bold">Tên tab</span>
<input value={form.sheetTab} onChange={event => setForm({ ...form, sheetTab: event.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
</label>
</div>
<label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
<input type="checkbox" checked={form.automationEnabled} onChange={event => setForm({ ...form, automationEnabled: event.target.checked })} />
<span>
<b className="block text-sm">Bật lịch tự động</b>
<small>
{form.stage === 'session-output' ? 'Xuất lúc 11:00 và 16:00' : 'Nhập lúc 10:00 và 15:00'}</small>
</span>
</label>
{error && <p className="text-sm font-semibold text-rose-600">
{error}</p>}</div>
<div className="mt-6 flex justify-end gap-2">
<button type="button" onClick={() => { setEditing(null); setFormOpen(false); setForm({ name: '', url: '', stage: 'registration-source', sheetTab: '', automationEnabled: false, automationStartDate: '', automationEndDate: '' }); }} className="rounded-lg border px-4 py-2 text-sm font-bold">Hủy</button>
<button disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
{saving ? 'Đang lưu…' : 'Lưu lại'}</button>
</div>
</form>
</div>}
    {importPreview && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4">
<div className="flex max-h-[calc(100vh-1rem)] w-[96vw] max-w-[1600px] flex-col overflow-hidden rounded-2xl bg-white p-7 shadow-2xl">
<div className="flex items-start justify-between gap-4">
<div>
<p className="text-xs font-bold uppercase text-indigo-700">
{'Xem tr\u01b0\u1edbc tr\u01b0\u1edbc khi nh\u1eadp'}</p>
<h3 className="mt-1 text-xl font-extrabold text-slate-900">
{'So s\u00e1nh d\u1eef li\u1ec7u ngu\u1ed3n'} {importPreview.source.name || 'Google Sheets'}</h3>
<p className="mt-2 text-sm text-slate-600">
{'Ch\u1ec9 b\u1ed5 sung v\u00e0o c\u00e1c tr\u01b0\u1eddng c\u00f2n tr\u1ed1ng tr\u00ean h\u1ec7 th\u1ed1ng; d\u1eef li\u1ec7u \u0111ang c\u00f3 \u0111\u01b0\u1ee3c gi\u1eef nguy\u00ean.'}</p>
</div>
<button onClick={() => setImportPreview(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
<X className="h-5 w-5" />
</button>
</div>
<div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
<div className="flex flex-wrap items-center justify-between gap-2">
<div><h4 className="font-extrabold text-slate-900">Chọn dữ liệu được nhập</h4><p className="mt-1 text-sm text-slate-600">Bỏ chọn một loại thì các thay đổi đó biến mất khỏi bảng và không được ghi vào hệ thống.</p></div>
<span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-bold text-slate-700">{selectedImportRecords.length}{' hồ sơ đang chọn'}</span>
</div>
<div className="mt-3 grid gap-3 lg:grid-cols-3">
<label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${importNewRecords ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white'}`}><input type="checkbox" checked={importNewRecords} onChange={event => setImportNewRecords(event.target.checked)} className="mt-1 h-4 w-4" /><span><b className="block text-sky-950">Tạo hồ sơ mới · {importPreview.data.summary?.new || 0}</b><small className="text-slate-600">Thêm các thí sinh chưa có trên hệ thống.</small></span></label>
<label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${importEmptyValues ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'}`}><input type="checkbox" checked={importEmptyValues} onChange={event => setImportEmptyValues(event.target.checked)} className="mt-1 h-4 w-4" /><span><b className="block text-emerald-950">Điền các ô còn trống · {emptyFieldCount}</b><small className="text-slate-600">Chỉ thêm dữ liệu vào trường đang để trống.</small></span></label>
<label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${overwriteExistingValues ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}><input type="checkbox" checked={overwriteExistingValues} onChange={event => setOverwriteExistingValues(event.target.checked)} className="mt-1 h-4 w-4" /><span><b className="block text-amber-950">Cập nhật dữ liệu đang có · {overwriteFieldCount}</b><small className="text-slate-600">Thay giá trị hiện có bằng giá trị trong Sheet.</small></span></label>
</div>
</div>
{Number(importPreview.data.summary?.webOnly || 0) > 0 && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
<b>
{'C\u00f3 th\u00ed sinh tr\u00ean web nh\u01b0ng ch\u01b0a c\u00f3 d\u00f2ng kh\u1edbp tr\u00ean Sheet.'}</b>
{' Kh\u00f4ng t\u1ef1 x\u00f3a c\u00e1c h\u1ed3 s\u01a1 n\u00e0y.'}<div className="mt-2 max-h-28 overflow-auto text-xs">
{(importPreview.data.webOnlyRecords || []).map(person => <p key={person.code || person.name}>
{person.code ? `${person.code} · ` : ''}{person.name || 'Ch\u01b0a c\u00f3 t\u00ean'}{person.identity ? ` · CCCD: ${person.identity}` : ''}</p>)}</div>
</div>}{Number(importPreview.data.summary?.conflicts || 0) > 0 && <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
{'C\u00f3 d\u00f2ng ch\u01b0a gh\u00e9p an to\u00e0n. H\u1ec7 th\u1ed1ng kh\u00f4ng nh\u1eadp \u0111\u1ec3 tr\u00e1nh ghi nh\u1ea7m h\u1ed3 s\u01a1; h\u00e3y b\u1ed5 sung m\u00e3 h\u1ed3 s\u01a1 ho\u1eb7c th\u00f4ng tin \u0111\u1ecbnh danh tr\u00ean Sheet r\u1ed3i xem tr\u01b0\u1edbc l\u1ea1i.'}</div>}<div className="mt-4 min-h-0 flex-1 overflow-auto rounded-xl border">
<table className="w-full min-w-[1200px] table-fixed text-sm">
<thead className="sticky top-0 bg-slate-50 text-left">
<tr>
<th className="w-28 p-3">
{'D\u00f2ng Sheet'}</th>
<th className="w-80 p-3">
{'H\u1ed3 s\u01a1'}</th>
<th className="p-3">
{'Thay \u0111\u1ed5i s\u1ebd nh\u1eadp'}</th>
</tr>
</thead>
<tbody>
{tableRecords.map(record => { const preview = record._preview; const changes = (preview?.changes || []).filter(selectedChange); return <tr key={`${preview?.sourceRow}-${record.code || record.name}`} className={`border-t align-top ${preview?.status === 'conflict' ? 'bg-rose-50' : ''}`}>
<td className="p-3 font-bold">
{preview?.sourceRow || '\u2014'}</td>
<td className="break-words p-3">
<b>
{record.name || '\u0043h\u01b0a c\u00f3 t\u00ean'}</b>
<p className="mt-1 text-xs text-slate-500">
{record.code || preview?.matchedCode || '\u0043h\u01b0a c\u00f3 m\u00e3 h\u1ed3 s\u01a1'}</p>
</td>
<td className="break-words p-3">
{preview?.status === 'new' ? <span className="font-semibold text-sky-700">
{'T\u1ea1o h\u1ed3 s\u01a1 v\u00e0 d\u1eef li\u1ec7u k\u1ef3 thi m\u1edbi'}</span> : preview?.status === 'conflict' ? <span className="font-semibold text-rose-700">
{'Ch\u01b0a gh\u00e9p \u0111\u01b0\u1ee3c v\u1edbi h\u1ed3 s\u01a1 an to\u00e0n'}</span> : changes.length ? <ul className="space-y-1">
{changes.map(change => <li key={change.field} className={`flex flex-wrap items-center gap-1 rounded-md px-2 py-1 ${change.current ? 'bg-amber-50 text-amber-950' : 'bg-emerald-50 text-emerald-950'}`}>
<span className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${change.current ? 'bg-amber-200 text-amber-900' : 'bg-emerald-200 text-emerald-900'}`}>{change.current ? 'Ghi đè' : 'Điền trống'}</span>
<b>
{change.label || change.field}:</b> <span className="text-slate-500">
{change.current || '\u0074r\u1ed1ng'}</span>
<span className="px-1">
{'\u2192'}</span>
<span className="font-semibold text-emerald-700">
{change.next || '\u2014'}</span>
</li>)}</ul> : <span className="text-slate-500">
{'Kh\u00f4ng c\u00f3 tr\u01b0\u1eddng c\u1ea7n b\u1ed5 sung'}</span>}</td>
</tr>; })}</tbody>
</table>
</div>
{tableRecords.length > 250 && <p className="mt-2 text-xs text-slate-500">
{'Chỉ hiển thị 250 dòng thay đổi đầu tiên.'}</p>}<div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm">
<p className="font-bold text-indigo-950">Bảng chỉ hiển thị các thay đổi đang được chọn.</p>
<p className="mt-1 text-xs text-indigo-800">Màu xanh là điền vào ô đang trống; màu vàng là ghi đè giá trị đã có. Không có lựa chọn nào tự xóa dữ liệu.</p>
{Number(importPreview.data.summary?.webOnly || 0) > 0 && <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
<input type="checkbox" checked={removeWebOnlyCandidates} onChange={event => setRemoveWebOnlyCandidates(event.target.checked)} />
<span>
<b>Có, gỡ các thí sinh chỉ có trên web khỏi kỳ thi này</b>
<br/>Hồ sơ gốc vẫn được giữ trong hệ thống.</span>
</label>}</div>
<div className="mt-6 flex justify-end gap-3">
<button onClick={() => setImportPreview(null)} className="rounded-lg border px-4 py-2 text-sm font-bold">
{'H\u1ee7y'}</button>
<button disabled={importingId === importPreview.source.id || selectedImportRecords.length === 0 || Number(importPreview.data.summary?.conflicts || 0) > 0} onClick={confirmImport} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
{importingId === importPreview.source.id ? '\u0110ang nh\u1eadp\u2026' : 'X\u00e1c nh\u1eadn nh\u1eadp d\u1eef li\u1ec7u'}</button>
</div>
</div>
</div>}
    {exportPreview && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4">
<div className="w-full max-w-3xl resize overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
<div className="flex items-start justify-between gap-4">
<div>
<p className="text-xs font-bold uppercase text-amber-700">Đối soát trước khi xuất</p>
<h3 className="mt-1 text-xl font-extrabold text-slate-900">So sánh dữ liệu tab {exportPreview.data.sheetTab}</h3>
{exportPreview.data.matchConflicts?.length ? <p className="mt-2 text-sm font-semibold text-rose-700">
{'C\u00f3 '}{exportPreview.data.matchConflicts.length}{' d\u00f2ng ch\u01b0a gh\u00e9p an to\u00e0n. H\u1ec7 th\u1ed1ng s\u1ebd kh\u00f4ng ghi \u0111\u00e8 cho \u0111\u1ebfn khi b\u1ed5 sung th\u00f4ng tin \u0111\u1ecbnh danh.'}</p> : null}<p className="mt-2 text-sm text-slate-600">
{exportPreview.data.changedCells ? <>
{'H\u1ec7 th\u1ed1ng ph\u00e1t hi\u1ec7n '}{exportPreview.data.changedCells}{' \u00f4 \u0111\u00e3 c\u00f3 d\u1eef li\u1ec7u kh\u00e1c nhau tr\u00ean '}{exportPreview.data.changedRows}{' d\u00f2ng. Ch\u1ec9 ghi \u0111\u00e8 sau khi b\u1ea1n x\u00e1c nh\u1eadn.'}</> : <>
{'Kh\u00f4ng c\u00f3 \u00f4 \u0111\u00e3 c\u00f3 d\u1eef li\u1ec7u b\u1ecb thay \u0111\u1ed5i; c\u00e1c \u00f4 tr\u1ed1ng v\u00e0 Ng\u00e0y c\u1eadp nh\u1eadt g\u1ea7n nh\u1ea5t s\u1ebd \u0111\u01b0\u1ee3c c\u1eadp nh\u1eadt t\u1ef1 \u0111\u1ed9ng.'}</>}</p>
</div>
<button onClick={() => setExportPreview(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
<X className="h-5 w-5" />
</button>
</div>
{Number(exportPreview.data.appendedRows || 0) > 0 && <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
<h4 className="font-extrabold text-amber-950">
{exportPreview.data.appendedRows}{' thí sinh có trên web nhưng chưa có trên Sheet'}</h4>
<p className="mt-1 text-sm text-amber-900">Chọn <b>chỉ xuất thêm</b> để giữ nguyên tất cả dòng hiện có trên Sheet.</p>
<div className="mt-3 max-h-36 overflow-auto text-sm">
{(exportPreview.data.appendedCandidates || []).map(person => { const code = person.code || ''; return <label key={code || person.name} className="flex items-center gap-2 border-t border-amber-200 py-1 first:border-t-0">
<input type="checkbox" checked={Boolean(code && exportSelectedCodes.includes(code))} onChange={event => setExportSelectedCodes(event.target.checked ? [...exportSelectedCodes, code] : exportSelectedCodes.filter(item => item !== code))} disabled={!code} />
<span>
{person.code ? `${person.code} · ` : ''}{person.name || 'Chưa có tên'}{person.identity ? ` · CCCD: ${person.identity}` : ''}</span>
</label>; })}</div>
</div>}{exportPreview.data.matchConflicts?.length ? <div className="mt-4 rounded-xl border-2 border-rose-300 bg-rose-50 p-4">
<div className="flex items-center justify-between gap-3">
<h4 className="font-extrabold text-rose-900">
{'D\u00f2ng ch\u01b0a gh\u00e9p an to\u00e0n - c\u1ea7n x\u1eed l\u00fd tr\u01b0\u1edbc khi ghi'}</h4>
<span className="rounded-full bg-rose-600 px-2 py-1 text-xs font-bold text-white">
{exportPreview.data.matchConflicts.length}</span>
</div>
<p className="mt-1 text-sm text-rose-800">
{'H\u1ec7 th\u1ed1ng \u0111\u00e3 gi\u1eef nguy\u00ean d\u00f2ng n\u00e0y tr\u00ean Sheet v\u00e0 kh\u00f3a thao t\u00e1c ghi \u0111\u00e8.'}</p>
<div className="mt-3 grid gap-3">
{exportPreview.data.matchConflicts.map(conflict => <article key={`${conflict.row}-${conflict.reason}`} className="rounded-lg border border-rose-200 bg-white p-3">
<p className="font-bold text-rose-900">
{'H\u00e0ng '}{conflict.row}{' - '}{conflict.rowLabel}</p>
<p className="mt-1 text-sm font-medium text-rose-800">
{conflict.reason}</p>
{conflict.sheetIdentity ? <p className="mt-2 text-xs text-slate-700">
<b>
{'D\u1eef li\u1ec7u \u0111ang c\u00f3 tr\u00ean Sheet: '}</b>
{conflict.sheetIdentity}</p> : null}{conflict.candidateOptions?.length ? <div className="mt-2 text-xs text-slate-700">
<b>
{'H\u1ed3 s\u01a1 c\u00f3 th\u1ec3 li\u00ean quan trong h\u1ec7 th\u1ed1ng:'}</b>
<ul className="mt-1 list-disc pl-5">
{conflict.candidateOptions.map(option => <li key={option}>
{option}</li>)}</ul>
</div> : null}</article>)}</div>
</div> : null}{exportPreview.data.changes.length ? <div className="mt-4 max-h-80 overflow-auto rounded-xl border">
<table className="min-w-full text-sm">
<thead className="sticky top-0 bg-slate-50 text-left">
<tr>
<th className="p-3">Ô</th>
<th className="p-3">Hiện tại</th>
<th className="p-3">Sẽ ghi</th>
</tr>
</thead>
<tbody>
{exportPreview.data.changes.map(change => <tr key={change.cell} className="border-t align-top">
<td className="p-3 font-mono font-bold">
{change.cell}<p className="mt-1 font-sans text-xs font-medium text-slate-500">
{'H\u00e0ng'} {change.row || change.cell.replace(/^[A-Z]+/, '')}{change.rowLabel ? ` - ${change.rowLabel}` : ''}<br/>
{'C\u1ed9t'} {change.column || '-'}{change.field ? ` - ${change.field}` : ''}</p>
</td>
<td className="max-w-xs break-words p-3 text-rose-700">
{change.current || '—'}</td>
<td className="max-w-xs break-words p-3 text-emerald-700">
{change.next || '—'}</td>
</tr>)}</tbody>
</table>
</div> : null}{exportPreview.data.changesTruncated && <p className="mt-2 text-xs text-slate-500">Danh sách chỉ hiển thị 250 ô đầu; số liệu tổng ở trên vẫn đầy đủ.</p>}<div className="mt-6 flex justify-end gap-3">
<button onClick={() => setExportPreview(null)} className="rounded-lg border px-4 py-2 text-sm font-bold">Hủy</button>
{Number(exportPreview.data.appendedRows || 0) > 0 ? <button disabled={exportingId === exportPreview.source.id || exportSelectedCodes.length === 0} onClick={() => requestExport(exportPreview.source, true, exportPreview.data.currentFingerprint, 'merge', exportSelectedCodes)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Ghi đè và thêm thí sinh đã chọn</button> : <button disabled={exportingId === exportPreview.source.id} onClick={() => requestExport(exportPreview.source, true, exportPreview.data.currentFingerprint, 'merge')} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Ghi đè dữ liệu trên Sheet</button>}</div>
</div>
</div>}  </section>;
}
