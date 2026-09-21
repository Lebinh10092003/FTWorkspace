import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, FileSignature, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import ModuleShellHeader from '../layout/ModuleShellHeader';
import AccountMenu from '../AccountMenu';
import SearchableSelect from '../SearchableSelect';
import { COMMUNICATION_TOOLS_NAV } from '../../config/workspaceNavigation';

type DocumentType = { label: string; code: string };
type RegisterEntry = {
  weekday: string; date: string; number: string;
  documentType: string; subject: string; drafter: string; signer: string;
};
type RegisterState = {
  latest: number; next: number; preview: string; typeCode: string;
  sheetTitle: string; spreadsheetId: string; gid: number;
  documentTypes: DocumentType[]; recent: RegisterEntry[];
};

type Props = {
  idToken: string;
  userName: string;
  userRole?: string;
  photoURL?: string | null;
  onAccountClick: () => void;
  onLogout: () => void;
  onNavSelect: (id: string) => void;
};

const todayIso = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
};

/** Mirrors documents/numbering.py so the preview is right before the register
 *  loads, and stays right if the Sheet cannot be reached. "Công văn" carries no
 *  code at all, which initials alone would get wrong. */
const FALLBACK_TYPES: DocumentType[] = [
  { label: 'Công văn', code: '' },
  { label: 'Quyết định', code: 'QĐ' },
  { label: 'Báo cáo', code: 'BC' },
  { label: 'Thông báo', code: 'TB' },
  { label: 'Tờ trình', code: 'TTr' },
  { label: 'Kế hoạch', code: 'KH' },
  { label: 'Biên bản', code: 'BB' },
  { label: 'Hợp đồng', code: 'HĐ' },
  { label: 'Nghị quyết', code: 'NQ' },
  { label: 'Nghị định', code: 'NĐ' },
  { label: 'Quy chế', code: 'QC' },
  { label: 'Quy định', code: 'QyĐ' },
  { label: 'Hướng dẫn', code: 'HD' },
  { label: 'Giấy mời', code: 'GM' },
  { label: 'Giấy giới thiệu', code: 'GGT' },
  { label: 'Phiếu đề xuất kinh phí', code: 'PĐXKP' },
];

const deriveCode = (label: string) =>
  label.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(word => word[0].toUpperCase()).join('');

const formatNumber = (sequence: number, code: string) => {
  const padded = String(sequence).padStart(2, '0');
  return code ? `${padded}/${code}-FT` : `${padded}/FT`;
};

export default function DocumentNumberGenerator({
  idToken, userName, userRole, photoURL, onAccountClick, onLogout, onNavSelect,
}: Props) {
  const [state, setState] = useState<RegisterState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<RegisterEntry & { renumbered?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const [documentType, setDocumentType] = useState('Công văn');
  const [customType, setCustomType] = useState('');
  const [subject, setSubject] = useState('');
  const [drafter, setDrafter] = useState('');
  const [signer, setSigner] = useState('');
  const [issuedOn, setIssuedOn] = useState(todayIso);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/documents/numbers', { headers: { Authorization: `Bearer ${idToken}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Không đọc được sổ văn bản.');
      setState(payload);
    } catch (cause: any) {
      setError(cause.message || 'Không đọc được sổ văn bản.');
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  useEffect(() => { void load(); }, [load]);

  const isCustom = documentType === '__custom__';
  const effectiveType = (isCustom ? customType : documentType).trim();
  const knownTypes = state?.documentTypes?.length ? state.documentTypes : FALLBACK_TYPES;
  const knownCode = useMemo(() => {
    const match = knownTypes.find(item => item.label === effectiveType);
    return match ? match.code : deriveCode(effectiveType);
  }, [knownTypes, effectiveType]);

  const preview = state ? formatNumber(state.next, knownCode) : '…';
  const sheetUrl = state
    ? `https://docs.google.com/spreadsheets/d/${state.spreadsheetId}/edit?gid=${state.gid}#gid=${state.gid}`
    : '';

  const typeOptions = useMemo(() => [
    ...knownTypes.map(item => ({
      value: item.label,
      label: item.code ? `${item.label} — ${item.code}` : `${item.label} — không mã`,
    })),
    { value: '__custom__', label: 'Loại khác…' },
  ], [knownTypes]);

  const issue = async () => {
    if (!effectiveType) { setError('Vui lòng chọn loại văn bản.'); return; }
    if (!subject.trim()) { setError('Vui lòng nhập nội dung công việc.'); return; }
    setIssuing(true);
    setError('');
    try {
      const response = await fetch('/api/documents/numbers/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ documentType: effectiveType, subject, drafter, signer, issuedOn }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Không ghi được số vào Sheet.');
      setIssued(payload);
      setSubject('');
      await load();
    } catch (cause: any) {
      setError(cause.message || 'Không ghi được số vào Sheet.');
    } finally {
      setIssuing(false);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard blocked; the number stays on screen to copy by hand. */
    }
  };

  const field = 'ft-input';
  const label = 'mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500';

  return (
    <div className="ft-module-shell flex min-h-dvh flex-col font-sans text-slate-900">
      <ModuleShellHeader
        eyebrow="Bộ công cụ FermatTech"
        title="Trình tạo số Công văn"
        items={COMMUNICATION_TOOLS_NAV}
        activeId="document-number"
        onSelect={onNavSelect}
        ariaLabel="Điều hướng bộ công cụ FermatTech"
        actions={(
          <button type="button" onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Tải lại sổ</span>
          </button>
        )}
        account={<AccountMenu userName={userName} userRole={userRole} photoURL={photoURL} isGuest={false} onAccountClick={onAccountClick} onLogout={onLogout} variant="avatar" />}
      />

      <main className="min-w-0 flex-1">
        <div className="ft-module-content mx-auto p-5 md:p-7">
          {error && (
            <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /><span>{error}</span>
            </div>
          )}

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-600">Cấp số mới</p>
              <h2 className="mt-1 text-xl font-extrabold">Thông tin văn bản</h2>
              <p className="mt-1 text-sm text-slate-500">
                Số được lấy từ sổ trên Google Sheet và ghi thẳng vào đó, nên luôn nối tiếp số lớn nhất đang có.
              </p>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <label className="block md:col-span-2">
                  <span className={label}>Loại văn bản</span>
                  <SearchableSelect
                    value={isCustom ? '__custom__' : documentType}
                    onChange={setDocumentType}
                    options={typeOptions}
                    placeholder="Chọn loại văn bản"
                    searchPlaceholder="Tìm loại văn bản..."
                  />
                  {isCustom && (
                    <input value={customType} onChange={event => setCustomType(event.target.value)}
                      placeholder="Ví dụ: Thư mời họp" className={`${field} mt-2`} />
                  )}
                </label>

                <label className="block md:col-span-2">
                  <span className={label}>Nội dung công việc</span>
                  <textarea value={subject} onChange={event => setSubject(event.target.value)} rows={3}
                    placeholder="V/v tổ chức các cuộc thi SCO Cycle 1 năm học 2026–2027" className={field} />
                </label>

                <label className="block">
                  <span className={label}>Người soạn</span>
                  <input value={drafter} onChange={event => setDrafter(event.target.value)} placeholder="Mr Phong" className={field} />
                </label>
                <label className="block">
                  <span className={label}>Người ký</span>
                  <input value={signer} onChange={event => setSigner(event.target.value)} placeholder="Mr Thuận" className={field} />
                </label>
                <label className="block">
                  <span className={label}>Ngày văn bản</span>
                  <input type="date" value={issuedOn} onChange={event => setIssuedOn(event.target.value)} className={field} />
                  <span className="mt-1 block text-xs text-slate-500">Mặc định là hôm nay; đổi được nếu cần.</span>
                </label>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
                <button type="button" onClick={() => void issue()} disabled={issuing || loading || !state}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
                  {issuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
                  {issuing ? 'Đang ghi vào Sheet…' : 'Lấy số và ghi vào Sheet'}
                </button>
                {sheetUrl && (
                  <a href={sheetUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900">
                    <ExternalLink className="h-4 w-4" />Mở sổ văn bản
                  </a>
                )}
              </div>

              {issued && (
                <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Đã cấp số và ghi vào sổ</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <b className="font-mono text-2xl font-extrabold text-emerald-900">{issued.number}</b>
                    <button type="button" onClick={() => void copy(issued.number)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800">
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Đã chép' : 'Chép số'}
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-emerald-900">{issued.weekday} · {issued.date} · {issued.documentType}</p>
                  {issued.renumbered && (
                    <p className="mt-2 text-xs font-semibold text-amber-800">
                      Có người lấy số cùng lúc, hệ thống đã tự đổi sang số kế tiếp còn trống.
                    </p>
                  )}
                </div>
              )}
            </section>

            <aside className="space-y-4 xl:sticky xl:top-28">
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Số tiếp theo sẽ cấp</p>
                <b className="mt-1 block font-mono text-3xl font-extrabold text-blue-900">{loading ? '…' : preview}</b>
                <p className="mt-2 text-sm text-blue-900">
                  {loading ? 'Đang đọc sổ…' : <>Số lớn nhất đang có trong sổ là <b>{state?.latest ?? 0}</b>.</>}
                </p>
                {effectiveType && !loading && (
                  <p className="mt-1 text-xs text-blue-800">
                    {knownCode
                      ? <>“{effectiveType}” dùng mã <b>{knownCode}</b>, nên số có dạng <b>Số/{knownCode}-FT</b>.</>
                      : <>“{effectiveType}” không có mã, nên số chỉ là <b>Số/FT</b>.</>}
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Vừa cấp gần đây</p>
                <ul className="mt-3 space-y-3">
                  {(state?.recent || []).map(entry => (
                    <li key={`${entry.number}-${entry.date}`} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <b className="font-mono text-sm font-extrabold text-slate-800">{entry.number}</b>
                        <span className="shrink-0 text-xs text-slate-500">{entry.date}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-600">{entry.subject || '—'}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">{entry.documentType}{entry.drafter ? ` · ${entry.drafter}` : ''}</p>
                    </li>
                  ))}
                  {!loading && !(state?.recent || []).length && (
                    <li className="text-sm text-slate-500">Sổ chưa có dòng nào.</li>
                  )}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
