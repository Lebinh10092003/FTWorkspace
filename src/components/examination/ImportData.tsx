import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appDialog } from '../AppDialog';
import * as XLSX from 'xlsx';
import {
  CheckCircle2, Download, FileSpreadsheet, Link2, LoaderCircle,
  UploadCloud, RefreshCw, Clock, AlertCircle, Zap, CalendarCheck,
  Trash2, Pencil, Plus,
} from 'lucide-react';
import type { Candidate, ExaminationSession } from './types';
import SchoolImportDialog from './SchoolImportDialog';
import type { Partner } from './Partners';
import { LIST_PAGE_SIZE, TablePagination, formatBirthDate, formatPersonName, normaliseBirthDate, sessionDisplayName, sessionRecencyKey, sessionTimelineLabel } from './ui';

type ImportRow = Record<string, unknown>;
type Props = {
  idToken?: string | null;
  googleAccessToken?: string | null;
  canImport: boolean;
  sessionId?: string;
  sessions: ExaminationSession[];
  onImported: (items: Candidate[]) => void;
  onPartnersImported?: (partners: Partner[]) => void;
  onSessionsImported?: (sessions: ExaminationSession[]) => void;
};

interface SyncState {
  status?: 'success' | 'failed' | 'running' | 'attention' | 'idle';
  lastSyncTime?: string;
  lastSyncDate?: string;
  created?: number;
  updated?: number;
  total?: number;
  error?: string;
}

type DuplicateCandidate = {
  row: number;
  importedName: string;
  status: 'confirmed' | 'possible';
  matchBy: string;
  existing: { code: string; name: string; birthDate?: string; identity?: string; email?: string; phone?: string; school?: string; className?: string; city?: string; ward?: string; address?: string; sessions?: { id: string; code: string; name: string }[] };
};
type Publication = {
  spreadsheetUrl: string;
  enabled: boolean;
  lastSyncedAt?: string | null;
  lastStatus?: string;
  lastError?: string;
  lastSummary?: { sessions?: number; partners?: number };
};
interface SheetSource {
  id: string;
  name: string;
  url: string;
  status?: 'success' | 'failed' | 'running' | 'idle';
  lastSyncTime?: string;
  created?: number;
  updated?: number;
  total?: number;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  sessionId?: string;
  sheetTab?: string;
  stage?: string;
  automationEnabled?: boolean;
  automationStartDate?: string;
  automationEndDate?: string;
  lastImportAt?: string | null;
  lastExportAt?: string | null;
  pendingManualImport?: boolean;
  lastError?: string;
}

type PreviewStatus = 'new' | 'changed' | 'unchanged' | 'conflict';
type PreviewCandidate = Candidate & {
  examHistory?: RoundHistory[];
  _preview?: { sourceRow: number; status: PreviewStatus; matchedCode?: string; changedFields?: string[]; changes?: { field: string; label: string; current: string; next: string }[] };
};
type SheetImportPreview = {
  records: PreviewCandidate[];
  sessionId: string;
  timestamp: string;
  summary: { total: number; new: number; matched: number; changed: number; unchanged: number; conflicts: number };
  mapping: { headerCount: number; mapped: { field: string; column: string; index: number }[]; unmapped: string[]; roundGroups: string[] };
  warnings: string[];
  source: { id?: string; name?: string; url: string; sheetTab?: string; fingerprint: string; stage?: string };
  targetSession: { id: string; code: string; name: string; time?: string };
};

// ─── Cột & alias cho import từ file ──────────────────────────────────────────
// Mẫu chính thức có 2 hàng tiêu đề: nhóm thông tin và tên cột.
const previewGroups = [
  { label: 'HỒ SƠ THÍ SINH', columns: ['STT', 'Mã hồ sơ', 'Họ và tên thí sinh', 'Ngày sinh', 'Số CCCD/Hộ chiếu', 'Quốc tịch', 'Họ tên phụ huynh', 'Số điện thoại', 'Email', 'Tỉnh/Thành phố', 'Xã/phường', 'Địa chỉ liên hệ', 'Trường', 'Lớp đang học', 'Khối lớp'] },
  { label: 'THÔNG TIN ĐĂNG KÝ', columns: ['Môn thi/Lĩnh vực', 'Bảng thi/Category', 'Hình thức đăng ký', 'Tên đội/Nhóm', 'Ngôn ngữ thi', 'Ghi chú'] },
  { label: 'VÒNG 1', columns: ['Điều kiện tham gia', 'Số báo danh (SBD)', 'Ngày thi', 'Giờ/Ca thi', 'Hình thức thi', 'Địa điểm/Phòng thi', 'Link thi', 'Tài khoản/Mã truy cập', 'Mật khẩu', 'Trạng thái dự thi', 'Điểm', 'Tỷ lệ điểm', 'Xếp hạng', 'Kết quả/Giải thưởng', 'Ghi chú/Sự cố'] },
  { label: 'VÒNG 2', columns: ['Điều kiện tham gia', 'Số báo danh (SBD)', 'Ngày thi', 'Giờ/Ca thi', 'Hình thức thi', 'Địa điểm/Phòng thi', 'Link thi', 'Tài khoản/Mã truy cập', 'Mật khẩu', 'Trạng thái dự thi', 'Điểm', 'Tỷ lệ điểm', 'Xếp hạng', 'Kết quả/Giải thưởng', 'Ghi chú/Sự cố'] },
  { label: 'VÒNG 3', columns: ['Điều kiện tham gia', 'Số báo danh (SBD)', 'Ngày thi', 'Giờ/Ca thi', 'Hình thức thi', 'Địa điểm/Phòng thi', 'Link thi', 'Tài khoản/Mã truy cập', 'Mật khẩu', 'Trạng thái dự thi', 'Điểm', 'Tỷ lệ điểm', 'Xếp hạng', 'Kết quả/Giải thưởng', 'Ghi chú/Sự cố'] },
  { label: 'TỔNG HỢP', columns: ['Vòng cao nhất đã đạt', 'Kết quả cao nhất', 'Link chứng nhận', 'Ngày cập nhật gần nhất'] },
] as const;

const roundPreviewFields: (keyof Omit<RoundHistory, 'round'>)[] = [
  'eligibility', 'sbd', 'date', 'time', 'mode', 'location', 'link', 'account', 'password', 'attendance', 'score', 'scoreRate', 'rank', 'result', 'note',
];

const aliases: Record<string, string[]> = {
  code: ['ma ft', 'ma ho so', 'ma ho so ft', 'ft code', 'profile code'],
  name: ['ho va ten thi sinh', 'ho va ten', 'ho ten', 'thi sinh', 'full name', 'name'],
  school: ['ten truong', 'truong hoc', 'truong', 'school'],
  className: ['lop dang hoc', 'hoc sinh lop', 'lop', 'class'],
  city: ['tinh thanh pho cu tru', 'tinh thanh pho', 'tinh thanhpho', 'dia phuong', 'city'],
  ward: ['xa phuong', 'phuong xa', 'phuong', 'ward'], nationality: ['quoc tich', 'nationality'], grade: ['khoi lop hien tai', 'khoi lop', 'khoi', 'grade'],
  subject: ['mon thi linh vuc', 'mon thi', 'linh vuc', 'subject'], category: ['bang thi category', 'bang thi', 'category'],
  registrationMethod: ['hinh thuc dang ky', 'registration method'], registrationUnit: ['don vi dang ky', 'registration unit'], teamName: ['ten doi nhom', 'doi nhom', 'team'], examLanguage: ['ngon ngu thi', 'exam language'], generalNote: ['ghi chu chung', 'ghi chu', 'general note'], certificateLink: ['link chung nhan', 'certificate link'],
  contests: ['cuoc thi dang ky tham gia', 'cuoc thi dang ky', 'cuoc thi', 'contest', 'ky thi', 'dang ky thi'],
  achievement: ['tong hop ket qua cao nhat', 'ket qua cao nhat', 'ket qua giai thuong', 'ket qua thanh tich', 'ket qua', 'thanh tich', 'xep hang', 'result'],
  highestRound: ['tong hop vong cao nhat da dat', 'vong cao nhat da dat', 'highest round'],
  birthDate: ['ngay sinh dd mm yyyy hoac yyyy', 'ngay sinh', 'ngay thang nam sinh', 'birth date', 'birthday'],
  email: ['email lien lac', 'email'], parent: ['ho ten phu huynh', 'phu huynh', 'parent'],
  phone: ['so dien thoai lien lac', 'so dien thoai', 'sdt', 'dien thoai', 'phone', 'so dien thoai nguoi giam ho'],
  identity: ['so cccd ho chieu', 'cccd dinh danh', 'cccd', 'cmnd', 'dinh danh', 'identity', 'so cccd'],
  address: ['dia chi lien he', 'dia chi', 'address'], updated: ['ngay cap nhat gan nhat', 'updated'],
};
const normalise = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('vi-VN')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const text = (value: unknown) => String(value ?? '').trim();
const normalizeEligibility = (value: unknown) => { const normalized = normalise(value); return normalized.includes('khong du dieu kien') || normalized.includes('chua du dieu kien') ? 'Không đủ điều kiện' : 'Đủ điều kiện'; };
const valueFor = (entries: [string, string][], field: string) => aliases[field]?.map(alias => entries.find(([key]) => key.includes(alias))?.[1] || '').find(Boolean) || '';

type RoundHistory = { round: string; eligibility?: string; sbd?: string; date?: string; time?: string; mode?: string; location?: string; link?: string; account?: string; password?: string; attendance?: string; score?: string; scoreRate?: string; rank?: string; result?: string; note?: string };
function historyFromRow(row: ImportRow): RoundHistory[] {
  const fields: Record<string, string[]> = { eligibility: ['dieu kien tham gia'], sbd: ['so bao danh'], date: ['ngay thi'], time: ['gio ca thi'], mode: ['hinh thuc thi'], location: ['dia diem phong thi'], link: ['link thi'], account: ['tai khoan ma truy cap'], password: ['mat khau', 'password'], attendance: ['trang thai du thi'], score: ['diem'], scoreRate: ['ty le diem'], rank: ['xep hang'], result: ['ket qua giai thuong'], note: ['ghi chu su co'] };
  const matchesField = (field: string, key: string, names: string[]) => names.some(name => {
    // A score must not accidentally match the location column.
    if (field === 'score') return key.endsWith(' diem') && !key.includes('dia diem') && !key.includes('ty le diem');
    return key.includes(name);
  });
  return [1, 2, 3].map(roundNumber => {
    const prefix = `vong ${roundNumber}`;
    const entries = Object.entries(row).map(([key, value]) => [normalise(key), text(value)] as [string, string]).filter(([key]) => key.startsWith(prefix));
    const sourceHeader = Object.keys(row).find(key => normalise(key).startsWith(prefix)) || '';
    const sourceGroup = sourceHeader.split(':', 1)[0].replace(/\s+Điều kiện tham gia\s*$/iu, '').trim();
    const detailedRound = sourceGroup.replace(new RegExp(`^Vòng\\s*${roundNumber}\\s*[–—-]?\\s*`, 'iu'), '').trim();
    const item: RoundHistory = { round: detailedRound || `Vòng ${roundNumber}` };
    Object.entries(fields).forEach(([field, names]) => { const value = entries.find(([key]) => matchesField(field, key, names))?.[1] || ''; if (field === 'eligibility') item.eligibility = normalizeEligibility(value); else if (value) item[field as keyof RoundHistory] = (field === 'date' ? normaliseBirthDate(value) : value) as never; });
    return item;
  }).filter(item => Object.keys(item).length > 1);
}

function mapRows(rawRows: ImportRow[]): (Candidate & { examHistory?: RoundHistory[] })[] {
  return rawRows.map((row, index) => {
    const entries = Object.entries(row).map(([key, value]) => [normalise(key), text(value)] as [string, string]);
    const name = formatPersonName(valueFor(entries, 'name'));
    const code = valueFor(entries, 'code');
    return { code, name, school: valueFor(entries, 'school'), className: valueFor(entries, 'className'), city: valueFor(entries, 'city'), ward: valueFor(entries, 'ward'), nationality: valueFor(entries, 'nationality'), grade: valueFor(entries, 'grade'), contests: valueFor(entries, 'contests'), subject: valueFor(entries, 'subject'), category: valueFor(entries, 'category'), registrationMethod: valueFor(entries, 'registrationMethod'), registrationUnit: valueFor(entries, 'registrationUnit'), teamName: valueFor(entries, 'teamName'), examLanguage: valueFor(entries, 'examLanguage'), generalNote: valueFor(entries, 'generalNote'), certificateLink: valueFor(entries, 'certificateLink'), achievement: valueFor(entries, 'achievement'), highestRound: valueFor(entries, 'highestRound'), email: valueFor(entries, 'email'), parent: formatPersonName(valueFor(entries, 'parent')), phone: valueFor(entries, 'phone'), identity: valueFor(entries, 'identity'), address: valueFor(entries, 'address'), birthDate: normaliseBirthDate(valueFor(entries, 'birthDate')), updated: valueFor(entries, 'updated'), examHistory: historyFromRow(row) };
  }).filter(row => row.name && !['stt', 'họ và tên', 'ho va ten'].includes(normalise(row.name)));
}

function rowsFromSheet(sheet: XLSX.WorkSheet): ImportRow[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
  const headerScore = (row: unknown[]) => {
    const cells = row.map(normalise).filter(Boolean);
    const matchedFields = Object.entries(aliases).filter(([field, options]) => field !== 'code' && options.some(alias => alias.length > 3 && cells.some(cell => cell.includes(alias))));
    const hasName = matchedFields.some(([field]) => field === 'name');
    const hasProfileField = matchedFields.some(([field]) => ['birthDate', 'school', 'className', 'identity', 'email', 'phone'].includes(field));
    return hasName && hasProfileField ? matchedFields.length : 0;
  };
  const scores = grid.map(row => headerScore(row as unknown[]));
  const bestScore = Math.max(0, ...scores);
  const headerIndex = bestScore >= 4 ? scores.indexOf(bestScore) : -1;
  if (headerIndex < 0) return [];
  const groups = headerIndex > 0 ? grid[headerIndex - 1] as unknown[] : [];
  let currentGroup = '';
  const headers = (grid[headerIndex] as unknown[]).map((header, index) => {
    const group = text(groups[index]); if (group) currentGroup = group;
    const label = text(header); return currentGroup && label ? `${currentGroup}: ${label}` : label;
  });
  let inlineRoundGroup = '';
  const expandedHeaders = headers.map(header => {
    const normalized = normalise(header);
    if (/^vong [123]/.test(normalized)) {
      inlineRoundGroup = header.includes(':') ? header.split(':', 1)[0] : header.replace(/\s+Điều kiện tham gia\s*$/iu, '').trim();
      return header;
    }
    if (normalized.startsWith('tong hop')) inlineRoundGroup = '';
    return inlineRoundGroup && header ? `${inlineRoundGroup}: ${header}` : header;
  });
  return grid.slice(headerIndex + 1)
    .filter(row => (row as unknown[]).some(cell => text(cell)))
    .map(row => Object.fromEntries(expandedHeaders.map((header, index) => [header || `column_${index + 1}`, (row as unknown[])[index] ?? ''])));
}

const sessionOptionLabel = (session: ExaminationSession) => sessionDisplayName(session);
const sheetKind = (sheet: SheetSource) => sheet.stage === 'session-output' ? 'output' : 'input';
const sheetKindLabel = (sheet: SheetSource) => sheetKind(sheet) === 'output' ? 'Sheet tổng hợp' : 'Sheet đầu vào';
const sheetScheduleLabel = (sheet: SheetSource) => {
  if (!sheet.automationEnabled) return 'Tự động: Tắt';
  const hours = sheetKind(sheet) === 'output' ? '11:00, 16:00' : 'Khi Sheet thay đổi · mỗi 5 phút';
  const window = [sheet.automationStartDate, sheet.automationEndDate].filter(Boolean).map(value => value!.split('-').reverse().join('/')).join(' – ');
  return `${hours}${window ? ` · ${window}` : ''}`;
};
const DEFAULT_SYNC_URL =
  'https://docs.google.com/spreadsheets/d/1kqztN_iCeZ9uR1mO7gz9j1TcUt8ZmCdpEv0TagTf4VA/edit?usp=sharing';

export default function ImportData({ idToken, googleAccessToken, canImport, sessionId, sessions, onImported, onPartnersImported, onSessionsImported }: Props) {
  const [schoolImportOpen, setSchoolImportOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const duplicateCheckRef = useRef(0);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceSheetTab, setSourceSheetTab] = useState('');
  const [targetSessionId, setTargetSessionId] = useState(sessionId || '');
  const [sessionYearFilter, setSessionYearFilter] = useState('');
  const [sessionOrganizerFilter, setSessionOrganizerFilter] = useState('');
  const [sessionCompetitionFilter, setSessionCompetitionFilter] = useState('');
  const [rows, setRows] = useState<PreviewCandidate[]>([]);
  const [previewPage, setPreviewPage] = useState(1);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [confirmedMatches, setConfirmedMatches] = useState<Record<string, string>>({});
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [updateMode, setUpdateMode] = useState<'fill-empty' | 'replace-nonempty'>('replace-nonempty');
  const [sheetPreview, setSheetPreview] = useState<SheetImportPreview | null>(null);
  const previewPageCount = Math.max(1, Math.ceil(rows.length / LIST_PAGE_SIZE));
  const activePreviewPage = Math.min(previewPage, previewPageCount);
  const sample = useMemo(() => rows.slice((activePreviewPage - 1) * LIST_PAGE_SIZE, activePreviewPage * LIST_PAGE_SIZE), [rows, activePreviewPage]);
  useEffect(() => setPreviewPage(1), [rows]);
  const rowIndexForPreview = (row: Candidate) => rows.indexOf(row) + 1;

  // States mới cho việc quản lý đa nguồn Google Sheets
  const [sheets, setSheets] = useState<SheetSource[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [syncingSheetId, setSyncingSheetId] = useState<string | null>(null);
  const [exportingSheetId, setExportingSheetId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [newSheetUrl, setNewSheetUrl] = useState('');
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [newSheetSessionId, setNewSheetSessionId] = useState('');
  const [newSheetTab, setNewSheetTab] = useState('');
  const [newSheetStage, setNewSheetStage] = useState('registration-source');
  const [newSheetAutomationEnabled, setNewSheetAutomationEnabled] = useState(true);
  const [newSheetAutomationStart, setNewSheetAutomationStart] = useState('');
  const [newSheetAutomationEnd, setNewSheetAutomationEnd] = useState('');
  const [importSheetId, setImportSheetId] = useState('');
  const [importSourceFingerprint, setImportSourceFingerprint] = useState('');
  const [publication, setPublication] = useState<Publication | null>(null);
  const [publicationUrl, setPublicationUrl] = useState('');
  const defaultAcademicYear = (() => { const now = new Date(); const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1; return `${start}-${start + 1}`; })();
  const [publicationAcademicYear, setPublicationAcademicYear] = useState(defaultAcademicYear);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [publicationMessage, setPublicationMessage] = useState('');

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken || ''}`,
    'X-Google-OAuth-Token': googleAccessToken || '',
  };


  const checkDuplicateCandidates = async (records: Candidate[]) => {
    const requestId = ++duplicateCheckRef.current;
    setDuplicates([]);
    if (!records.length || !idToken) return;
    setCheckingDuplicates(true);
    try {
      const response = await fetch('/api/examination/import/candidates/duplicates', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ records }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Không thể kiểm tra hồ sơ trùng.');
      if (requestId === duplicateCheckRef.current) setDuplicates(Array.isArray(body.duplicates) ? body.duplicates : []);
    } catch (error) {
      console.warn('Không thể kiểm tra hồ sơ trùng:', error);
    } finally {
      if (requestId === duplicateCheckRef.current) setCheckingDuplicates(false);
    }
  };
  const activeSheetSources = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return sheets.filter(sheet => {
      const linkedSession = sessions.find(item => item.id === sheet.sessionId);
      if (!linkedSession) return false;
      const lastRelevantDate = linkedSession.internationalDate || linkedSession.nationalDate || '';
      return !lastRelevantDate || lastRelevantDate >= today;
    });
  }, [sheets, sessions]);
  const sessionYears = (session: ExaminationSession) => [...new Set([
    ...(sessionTimelineLabel(session).match(/20\d{2}/g) || []),
    ...(String(session.academicYear || '').match(/20\d{2}/g) || []),
  ])];
  const sessionCompetitionLabel = (session: ExaminationSession) => `${session.code} · ${session.competitionName || session.parent || session.code}`;
  const matchesImportFilters = (session: ExaminationSession, ignored: 'year' | 'organizer' | 'competition' | null = null) =>
    (ignored === 'year' || !sessionYearFilter || sessionYears(session).includes(sessionYearFilter))
    && (ignored === 'organizer' || !sessionOrganizerFilter || session.organizer === sessionOrganizerFilter)
    && (ignored === 'competition' || !sessionCompetitionFilter || session.code === sessionCompetitionFilter);
  const sessionYearOptions = useMemo(() => [...new Set(sessions.filter(item => matchesImportFilters(item, 'year')).flatMap(sessionYears))].sort(), [sessions, sessionOrganizerFilter, sessionCompetitionFilter]);
  const sessionOrganizerOptions = useMemo(() => [...new Set(sessions.filter(item => matchesImportFilters(item, 'organizer')).map(item => item.organizer).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'vi')), [sessions, sessionYearFilter, sessionCompetitionFilter]);
  const sessionCompetitionOptions = useMemo(() => [...new Map(sessions.filter(item => matchesImportFilters(item, 'competition')).map(item => [item.code, sessionCompetitionLabel(item)])).entries()].sort((left, right) => left[1].localeCompare(right[1], 'vi')), [sessions, sessionYearFilter, sessionOrganizerFilter]);
  useEffect(() => { if (sessionYearFilter && !sessionYearOptions.includes(sessionYearFilter)) setSessionYearFilter(''); }, [sessionYearFilter, sessionYearOptions]);
  useEffect(() => { if (sessionOrganizerFilter && !sessionOrganizerOptions.includes(sessionOrganizerFilter)) setSessionOrganizerFilter(''); }, [sessionOrganizerFilter, sessionOrganizerOptions]);
  useEffect(() => { if (sessionCompetitionFilter && !sessionCompetitionOptions.some(([value]) => value === sessionCompetitionFilter)) setSessionCompetitionFilter(''); }, [sessionCompetitionFilter, sessionCompetitionOptions]);
  const selectableSessions = useMemo(() => sessions
    .filter(item => matchesImportFilters(item))
    .sort((left, right) => sessionRecencyKey(right).localeCompare(sessionRecencyKey(left))), [sessions, sessionYearFilter, sessionOrganizerFilter, sessionCompetitionFilter]);

  // Load danh sách sheet nguồn từ DB
  const loadSheets = useCallback(async () => {
    if (!idToken) return;
    setLoadingSheets(true);
    try {
      const res = await fetch('/api/examination/sheets', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSheets(data);
      }
    } catch (err) {
      console.warn('Lỗi tải danh sách nguồn Google Sheets:', err);
    } finally {
      setLoadingSheets(false);
    }
  }, [idToken]);

  const loadPublication = useCallback(async () => {
    if (!idToken) return;
    try {
      const response = await fetch(`/api/examination/sheet-publication?academicYear=${encodeURIComponent(publicationAcademicYear)}`, { headers: { Authorization: `Bearer ${idToken}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thể tải cấu hình Google Sheet.');
      setPublication(data);
      setPublicationUrl(data.spreadsheetUrl || '');
    } catch (error) {
      console.warn('Không thể tải cấu hình xuất bản Google Sheet:', error);
    }
  }, [idToken, publicationAcademicYear]);

  useEffect(() => {
    loadSheets();
  }, [loadSheets]);

  const savePublication = async () => {
    if (!canImport) return;
    setPublicationBusy(true); setPublicationMessage('');
    try {
      const response = await fetch('/api/examination/sheet-publication', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ academicYear: publicationAcademicYear, spreadsheetUrl: publicationUrl.trim(), enabled: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thể lưu cấu hình.');
      setPublication(data); setPublicationMessage('Đã lưu Google Sheet trung tâm.');
    } catch (error: any) { setPublicationMessage(error.message || 'Không thể lưu cấu hình.'); }
    finally { setPublicationBusy(false); }
  };

  const syncPublication = async (scope: 'all' | 'partners' | 'sessions') => {
    if (!canImport) return;
    if (!publicationUrl.trim()) { setPublicationMessage('Hãy lưu đường dẫn Google Sheet trung tâm trước.'); return; }
    if (scope === 'sessions' && !targetSessionId) { setPublicationMessage('Hãy chọn kỳ tổ chức trước khi đồng bộ riêng kỳ đó.'); return; }
    setPublicationBusy(true); setPublicationMessage('Đang xuất bản dữ liệu sang Google Sheet…');
    try {
      const response = await fetch('/api/examination/sheet-publication/sync', { method: 'POST', headers: authHeaders, body: JSON.stringify({ academicYear: publicationAcademicYear, scope, sessionIds: scope === 'sessions' ? [targetSessionId] : [] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Đồng bộ Google Sheet không thành công.');
      setPublication(data.publication || publication);
      setPublicationMessage(`Đã đồng bộ ${data.result.sessions} kỳ tổ chức và ${data.result.partners} đối tác.`);
    } catch (error: any) { setPublicationMessage(error.message || 'Đồng bộ Google Sheet không thành công.'); }
    finally { setPublicationBusy(false); }
  };

  const setParsedRows = (rawRows: ImportRow[], sourceName: string) => {
    const parsed = mapRows(rawRows);
    setConfirmedMatches({});
    setRows(parsed);
    setSource(sourceName);
    setUpdateMode('replace-nonempty');
    setSheetPreview(null);
    setImportSheetId('');
    setImportSourceFingerprint('');
    void checkDuplicateCandidates(parsed);
    setMessage(
      parsed.length
        ? `Đã nhận diện ${parsed.length} thí sinh. Kiểm tra mẫu xem trước rồi nhập dữ liệu.`
        : 'Không nhận diện được cột "Họ và tên". Hãy dùng file mẫu hoặc kiểm tra lại cấu trúc file.',
    );
  };

  const requestSheetPreview = async (payload: { id?: string; url?: string; sessionId?: string; sheetTab?: string; updateMode?: 'fill-empty' | 'replace-nonempty' }) => {
    const response = await fetch('/api/examination/sheets/preview', {
      method: 'POST', headers: authHeaders, body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Không thể đọc và phân tích Google Sheets.');
    setSheetPreview(body as SheetImportPreview);
  };

  const acceptSheetPreview = () => {
    if (!sheetPreview) return;
    setTargetSessionId(sheetPreview.sessionId);
    setRows(sheetPreview.records || []);
    setSource(`${sheetPreview.source.name || 'Google Sheets'}${sheetPreview.source.sheetTab ? ` · ${sheetPreview.source.sheetTab}` : ''}`);
    setUpdateMode('replace-nonempty');
    setImportSheetId(sheetPreview.source.id || '');
    setImportSourceFingerprint(sheetPreview.source.fingerprint || '');
    setConfirmedMatches({});
    void checkDuplicateCandidates(sheetPreview.records || []);
    setMessage(`Đã chuẩn bị ${sheetPreview.summary.total} hồ sơ. Hãy đối chiếu hồ sơ trùng và chọn chính sách cập nhật trước khi nhập.`);
    setSheetPreview(null);
  };

  const readFile = async (file: File) => {
    setLoading(true); setMessage('');
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
      const rawRows = book.SheetNames.flatMap(n => rowsFromSheet(book.Sheets[n]));
      setParsedRows(rawRows, file.name);
    } catch { setMessage('Không thể đọc tệp. Vui lòng dùng định dạng .xlsx hoặc .csv hợp lệ.'); }
    finally { setLoading(false); }
  };

  const loadSheet = async () => {
    if (!sourceUrl.trim()) return setMessage('Hãy dán liên kết Google Sheets có quyền xem.');
    const resolvedSessionId = targetSessionId || sessionId;
    if (!resolvedSessionId) return setMessage('Chọn kỳ tổ chức trước khi kiểm tra dữ liệu.');
    setLoading(true); setMessage('');
    try {
      await requestSheetPreview({ url: sourceUrl.trim(), sessionId: resolvedSessionId, sheetTab: sourceSheetTab.trim() });
    } catch (err: any) { setMessage(`❌ ${err.message || 'Không thể đọc Google Sheets.'}`); }
    finally { setLoading(false); }
  };

  const importRows = async () => {
    if (!rows.length) return;
    const resolvedSessionId = targetSessionId || sessionId;
    if (!resolvedSessionId) return setMessage('Chọn kỳ tổ chức trước khi nhập dữ liệu.');
    setLoading(true); setMessage('');
    try {
      const res = await fetch('/api/examination/import/candidates', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ records: rows, source, sessionId: resolvedSessionId, confirmedMatches, updateMode, sheetId: importSheetId, sourceFingerprint: importSourceFingerprint }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Không thể nhập dữ liệu.');
      const importedItems = body.items || [];
      onImported(importedItems);
      await loadSheets();
      const linkedExisting = Number(body.linkedExisting || 0);
      const importedCount = importedItems.length || Number(body.created || 0) + Number(body.updated || 0);
      duplicateCheckRef.current += 1;
      setRows([]); setDuplicates([]); setCheckingDuplicates(false); setConfirmedMatches({}); setSource(''); setImportSheetId(''); setImportSourceFingerprint('');
      if (inputRef.current) inputRef.current.value = '';
      setMessage(`✅ Đã nhập ${importedCount} hồ sơ: ${body.created} mới, ${body.updated} cập nhật từ ${source}.${linkedExisting ? ` ${linkedExisting} hồ sơ đã có được bổ sung vào kỳ tổ chức này.` : ''}`);
    } catch (err: any) { setMessage(err.message || 'Không thể nhập dữ liệu.'); }
    finally { setLoading(false); }
  };

  // Quản lý CRUD cho sheets nguồn
  const handleAddSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSheetName.trim() || !newSheetUrl.trim()) return;
    if (!newSheetSessionId) {
      setMessage('Chọn kỳ tổ chức cho tab nguồn trước khi lưu.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const url = `/api/examination/sheets${editingSheetId ? `/${editingSheetId}` : ''}`;
      const method = editingSheetId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: JSON.stringify({ name: newSheetName.trim(), url: newSheetUrl.trim(), sessionId: newSheetSessionId, sheetTab: newSheetTab.trim(), stage: newSheetStage, automationEnabled: newSheetAutomationEnabled, automationStartDate: newSheetAutomationStart, automationEndDate: newSheetAutomationEnd }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Có lỗi xảy ra.');
      
      await loadSheets();
      setNewSheetName('');
      setNewSheetUrl('');
      setNewSheetAutomationEnabled(true);
      setNewSheetAutomationStart('');
      setNewSheetAutomationEnd('');
      setEditingSheetId(null);
      setShowAddModal(false);
      setMessage(editingSheetId ? '✅ Cập nhật nguồn dữ liệu thành công.' : '✅ Thêm nguồn dữ liệu mới thành công.');
    } catch (err: any) {
      setMessage(`❌ Lỗi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEditSheet = (sheet: SheetSource) => {
    setEditingSheetId(sheet.id);
    setNewSheetName(sheet.name);
    setNewSheetUrl(sheet.url);
    setNewSheetSessionId(sheet.sessionId || '');
    setNewSheetTab(sheet.sheetTab || '');
    setNewSheetStage(sheet.stage === 'session-output' ? 'session-output' : 'registration-source');
    setNewSheetAutomationEnabled(Boolean(sheet.automationEnabled));
    setNewSheetAutomationStart(sheet.automationStartDate || '');
    setNewSheetAutomationEnd(sheet.automationEndDate || '');
    setShowAddModal(true);
  };

  const handleDeleteSheet = async (id: string) => {
    const confirmed = await appDialog.confirm('Bạn có chắc chắn muốn xóa nguồn Google Sheets này?', {
      title: 'Xóa nguồn Google Sheets',
      confirmText: 'Xóa nguồn',
      tone: 'danger',
    });
    if (!confirmed) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/examination/sheets/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Có lỗi xảy ra.');
      
      await loadSheets();
      setMessage('✅ Xóa nguồn dữ liệu thành công.');
    } catch (err: any) {
      setMessage(`❌ Lỗi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncSheet = async (sheet: SheetSource) => {
    if (!canImport) return;
    setSyncingSheetId(sheet.id);
    setMessage('');
    try {
      await requestSheetPreview({ id: sheet.id });
    } catch (err: any) {
      const errMsg = err.message || 'Lỗi không xác định.';
      setMessage(`❌ Không thể kiểm tra nguồn "${sheet.name}": ${errMsg}`);
    } finally {
      setSyncingSheetId(null);
    }
  };

  const handleExportSheet = async (sheet: SheetSource) => {
    if (!canImport) return;
    setExportingSheetId(sheet.id);
    setMessage('');
    try {
      const res = await fetch(`/api/examination/sheets/${sheet.id}/export`, {
        method: 'POST',
        headers: authHeaders,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Không thể xuất dữ liệu.');
      setMessage(`✅ ${body.message}`);
      await loadSheets();
      onImported([]);
    } catch (err: any) {
      setMessage(`❌ ${err.message || 'Không thể xuất dữ liệu.'}`);
      await loadSheets();
    } finally {
      setExportingSheetId(null);
    }
  };

  const downloadTemplate = () => {
    window.location.assign('/templates/Template_du_lieu_thi_sinh.xlsx');
  };

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-[#101827]">Nhập dữ liệu</h1>
          <p className="mt-1 text-sm text-slate-600">
            Đọc danh sách thí sinh từ Excel/CSV, Google Sheets.
            {sessionId ? ' Hồ sơ sẽ được liên kết với kỳ thi đang chọn.' : ''}
          </p>
        </div>
        <button onClick={downloadTemplate}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40] hover:bg-slate-50 transition-colors">
          <Download className="h-4 w-4" />Tải file mẫu
        </button>
      </div>

      <section className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
        <div><h2 className="font-extrabold text-[#001e40]">Trường đăng ký nhiều học sinh / nhiều cuộc thi</h2><p className="mt-1 text-sm text-slate-600">Nhập một file, đối chiếu hồ sơ, chọn kỳ và gom đối soát theo trường trong cùng popup.</p></div>
        <button type="button" disabled={!canImport} onClick={() => setSchoolImportOpen(true)} className="ft-primary disabled:opacity-50"><UploadCloud className="h-4 w-4" />Nhập Excel theo trường</button>
      </section>
      {schoolImportOpen && <SchoolImportDialog idToken={idToken} sessions={sessions} onClose={() => setSchoolImportOpen(false)} onImported={result => { onImported(result.items); onPartnersImported?.(result.partners); onSessionsImported?.(result.sessions); }} />}
      <section className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block"><span className="text-sm font-bold text-[#001e40]">Năm</span><select value={sessionYearFilter} onChange={event => { setSessionYearFilter(event.target.value); setTargetSessionId(''); }} className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"><option value="">Tất cả năm</option>{sessionYearOptions.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="block"><span className="text-sm font-bold text-[#001e40]">BTC quốc tế</span><select value={sessionOrganizerFilter} onChange={event => { setSessionOrganizerFilter(event.target.value); setTargetSessionId(''); }} className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"><option value="">Tất cả BTC quốc tế</option>{sessionOrganizerOptions.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="block"><span className="text-sm font-bold text-[#001e40]">Cuộc thi</span><select value={sessionCompetitionFilter} onChange={event => { setSessionCompetitionFilter(event.target.value); setTargetSessionId(''); }} className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"><option value="">Tất cả cuộc thi</option>{sessionCompetitionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block md:col-span-3"><span className="text-sm font-bold text-[#001e40]">Dữ liệu thuộc kỳ tổ chức</span><select value={targetSessionId} onChange={event => setTargetSessionId(event.target.value)} className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"><option value="">Chọn kỳ tổ chức trước khi nhập</option>{selectableSessions.map(item => <option key={item.id} value={item.id}>{sessionOptionLabel(item)}</option>)}</select><p className="mt-2 text-xs text-slate-600">Hồ sơ trong file sẽ được bổ sung vào lịch sử của thí sinh, đồng thời liên kết với kỳ này.</p></label>
        </div>
      </section>
{!canImport && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Chỉ quản lý hoặc quản trị viên mới có thể nhập dữ liệu.
        </div>
      )}

      {/* ── Quản lý các nguồn Google Sheets ──────────────────── */}
{/* Modal Thêm/Sửa nguồn dữ liệu */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900">
              {editingSheetId ? 'Chỉnh sửa nguồn Google Sheets' : 'Thêm nguồn Google Sheets mới'}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Cung cấp tên gợi nhớ và liên kết Google Sheets có quyền xem công khai (Anyone with the link).
            </p>
            <form onSubmit={handleAddSheet} className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-700">Tên nguồn dữ liệu *</span>
                <input required type="text" value={newSheetName} onChange={e => setNewSheetName(e.target.value)}
                  placeholder="Ví dụ: Kỳ thi IMO 2026, Young Food Scientist..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-700">Liên kết Google Sheets *</span>
                <input required type="url" value={newSheetUrl} onChange={e => setNewSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label><span className="mb-1 block text-sm font-bold text-slate-700">Kỳ tổ chức</span><select value={newSheetSessionId} onChange={event => setNewSheetSessionId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Chưa gán kỳ</option>{selectableSessions.map(item => <option key={item.id} value={item.id}>{sessionOptionLabel(item)}</option>)}</select></label>
                <label><span className="mb-1 block text-sm font-bold text-slate-700">Loại Sheet</span><select value={newSheetStage} onChange={event => { setNewSheetStage(event.target.value); setNewSheetAutomationEnabled(event.target.value === 'registration-source'); }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="registration-source">Sheet đầu vào</option><option value="session-output">Sheet tổng hợp</option></select></label>
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold text-slate-700">Tên tab</span><input value={newSheetTab} onChange={event => setNewSheetTab(event.target.value)} placeholder="Ví dụ: Danh sách thí sinh" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label className="flex items-start gap-3"><input type="checkbox" checked={newSheetAutomationEnabled} onChange={event => setNewSheetAutomationEnabled(event.target.checked)} className="mt-1 h-4 w-4"/><span><b className="block text-sm text-slate-800">Bật đồng bộ tự động</b><small className="text-slate-500">{newSheetStage==='session-output'?'Xuất lúc 11:00 và 16:00':'Tự nhập khi Sheet thay đổi; kiểm tra mỗi 5 phút'}</small></span></label>
                {newSheetAutomationEnabled&&<div className="mt-3 grid gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-xs font-bold text-slate-600">Từ ngày</span><input type="date" value={newSheetAutomationStart} onChange={event=>setNewSheetAutomationStart(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"/></label><label><span className="mb-1 block text-xs font-bold text-slate-600">Đến ngày</span><input type="date" value={newSheetAutomationEnd} onChange={event=>setNewSheetAutomationEnd(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"/></label></div>}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                  Hủy
                </button>
                <button type="submit" disabled={loading}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm">
                  {loading ? 'Đang lưu...' : 'Lưu lại'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Import thủ công ───────────────────────────────────────── */}
      {sheetPreview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Xem trước dữ liệu Google Sheets">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-600">Chưa thay đổi dữ liệu hệ thống</p>
                <h3 className="mt-1 text-xl font-extrabold text-slate-950">Kiểm tra trước khi nhập Google Sheets</h3>
                <p className="mt-1 text-sm text-slate-600">{sheetPreview.source.name || 'Google Sheets'}{sheetPreview.source.sheetTab ? ` · Tab ${sheetPreview.source.sheetTab}` : ''} → {sheetPreview.targetSession.code} · {sheetPreview.targetSession.name}</p>
              </div>
              <button type="button" onClick={() => setSheetPreview(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">Đóng</button>
            </div>
            <div className="overflow-y-auto px-5 py-5 sm:px-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ['Tổng hồ sơ', sheetPreview.summary.total, 'bg-slate-50 text-slate-900'],
                  ['Tạo mới', sheetPreview.summary.new, 'bg-blue-50 text-blue-800'],
                  ['Đã nhận diện', sheetPreview.summary.matched, 'bg-indigo-50 text-indigo-800'],
                  ['Có thay đổi', sheetPreview.summary.changed, 'bg-amber-50 text-amber-800'],
                  ['Không đổi', sheetPreview.summary.unchanged, 'bg-emerald-50 text-emerald-800'],
                  ['Cần đối chiếu', sheetPreview.summary.conflicts, 'bg-rose-50 text-rose-800'],
                ].map(([label, value, tone]) => <div key={String(label)} className={`rounded-xl border border-current/10 p-3 ${tone}`}><p className="text-xs font-bold">{label}</p><p className="mt-1 text-2xl font-extrabold">{value}</p></div>)}
              </div>

              {sheetPreview.warnings.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>Cần lưu ý:</b><ul className="mt-1 list-disc space-y-1 pl-5">{sheetPreview.warnings.map(item => <li key={item}>{item}</li>)}</ul></div>}

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-4">
                  <h4 className="font-extrabold text-slate-900">Schema đã nhận diện</h4>
                  <p className="mt-1 text-xs text-slate-500">{sheetPreview.mapping.mapped.length}/{sheetPreview.mapping.headerCount} cột được ánh xạ vào hệ thống.</p>
                  <div className="mt-3 flex max-h-36 flex-wrap content-start gap-2 overflow-y-auto">{sheetPreview.mapping.mapped.map(item => <span key={`${item.field}-${item.index}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"><b>{item.column}</b> → {item.field}</span>)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <h4 className="font-extrabold text-slate-900">Các nhóm vòng thi</h4>
                  <div className="mt-3 flex flex-wrap gap-2">{sheetPreview.mapping.roundGroups.length ? sheetPreview.mapping.roundGroups.map(item => <span key={item} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">{item}</span>) : <span className="text-sm text-slate-500">Không có dữ liệu vòng thi.</span>}</div>
                  <p className="mt-4 text-xs leading-5 text-slate-500">Ô trống trong Sheet không xóa dữ liệu cũ. Hồ sơ không xuất hiện trong Sheet cũng không bị xóa khỏi hệ thống.</p>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-[880px] w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Dòng</th><th className="px-3 py-3">Trạng thái</th><th className="px-3 py-3">Thí sinh</th><th className="px-3 py-3">Mã đối chiếu</th><th className="px-3 py-3">Trường / lớp</th><th className="px-3 py-3">Nội dung sẽ cập nhật</th><th className="px-3 py-3">Vòng có dữ liệu</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{sheetPreview.records.slice(0, 12).map((row, index) => {
                    const preview = row._preview;
                    const statusLabel = { new: 'Tạo mới', changed: 'Có thay đổi', unchanged: 'Không đổi', conflict: 'Cần đối chiếu' }[preview?.status || 'new'];
                    const statusTone = { new: 'bg-blue-50 text-blue-700', changed: 'bg-amber-50 text-amber-700', unchanged: 'bg-emerald-50 text-emerald-700', conflict: 'bg-rose-50 text-rose-700' }[preview?.status || 'new'];
                    return <tr key={`${preview?.sourceRow || index}-${row.name}`}><td className="px-3 py-3">{preview?.sourceRow || index + 1}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${statusTone}`}>{statusLabel}</span></td><td className="px-3 py-3"><b>{row.name}</b><div className="text-xs text-slate-500">{formatBirthDate(row.birthDate)} · {row.phone || row.email || 'Chưa có thông tin liên hệ'}</div></td><td className="px-3 py-3">{preview?.matchedCode || row.code || 'Tự sinh'}</td><td className="px-3 py-3">{row.school || '—'}{row.className ? ` · ${row.className}` : ''}</td><td className="px-3 py-3 text-xs">{preview?.changes?.length ? <ul className="space-y-1">{preview.changes.map(change => <li key={change.field}><b>{change.label}:</b> <span className="text-slate-500">{change.current || 'Trống'}</span> → <span className="font-semibold text-amber-800">{change.next}</span></li>)}</ul> : '—'}</td><td className="px-3 py-3">{row.examHistory?.map(item => item.round).join(', ') || '—'}</td></tr>;
                  })}</tbody>
                </table>
              </div>
              {sheetPreview.records.length > 12 && <p className="mt-2 text-xs text-slate-500">Đang hiển thị 12/{sheetPreview.records.length} hồ sơ. Toàn bộ hồ sơ sẽ có trong bước đối chiếu tiếp theo.</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button type="button" onClick={() => setSheetPreview(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100">Hủy</button>
              <button type="button" onClick={acceptSheetPreview} className="rounded-lg bg-[#0057d9] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0047b3]">Tiếp tục đối chiếu {sheetPreview.summary.total} hồ sơ</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Upload file */}
        <section className="ft-surface">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-6 w-6 text-[#003366]" />
            <div>
              <h2 className="font-bold text-[#001e40]">Tệp Excel hoặc CSV</h2>
              <p className="text-sm text-slate-500">Dùng file mẫu để giữ đúng tên cột.</p>
            </div>
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => e.target.files?.[0] && readFile(e.target.files[0])} />
          <button disabled={!canImport || loading} onClick={() => inputRef.current?.click()}
            className="mt-5 ft-primary disabled:opacity-50">
            <UploadCloud className="h-4 w-4" />Chọn tệp dữ liệu
          </button>
        </section>

        {/* Google Sheets URL thủ công */}
        <section className="ft-surface">
          <div className="flex items-center gap-3">
            <Link2 className="h-6 w-6 text-[#003366]" />
            <div>
              <h2 className="font-bold text-[#001e40]">Google Sheets nguồn khác</h2>
              <p className="text-sm text-slate-500">
                Dán link chia sẻ công khai (Anyone with link) · Không cần đăng nhập Google.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
            <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..."
              className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            <input value={sourceSheetTab} onChange={e => setSourceSheetTab(e.target.value)} placeholder="Tên tab (nếu cần)"
              className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            <button disabled={!canImport || loading} onClick={loadSheet}
              className="rounded-lg border border-[#003366] px-4 py-2 text-sm font-bold text-[#003366] hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap">
              Kiểm tra dữ liệu
            </button>
          </div>
        </section>
      </div>

      {/* Loading */}
      {loading && (
        <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-600">
          <LoaderCircle className="h-4 w-4 animate-spin" />Đang xử lý dữ liệu…
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`mt-5 flex items-start gap-2 rounded-xl border p-4 text-sm ${
          message.startsWith('❌')
            ? 'border-red-100 bg-red-50 text-red-800'
            : 'border-blue-100 bg-blue-50 text-[#001e40]'
        }`}>
          {message.startsWith('❌')
            ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          }
          {message}
        </div>
      )}

      {(checkingDuplicates || duplicates.length > 0) && (
        <section className="mt-5 ft-surface overflow-hidden border-amber-200">
          <div className="border-b border-amber-100 bg-amber-50 px-5 py-4">
            <h2 className="text-lg font-bold text-amber-900">Hồ sơ cần đối chiếu {duplicates.length ? `(${duplicates.length})` : ''}</h2>
            <p className="mt-1 text-sm text-amber-800">
              {checkingDuplicates
                ? 'Đang đối chiếu danh sách…'
                : '“Đủ căn cứ” sẽ tự giữ mã FT cũ. Với “Cần xác nhận”, hãy chọn đúng hồ sơ cũ nếu là cùng một thí sinh; nếu không chọn, hệ thống sẽ tạo hồ sơ riêng.'}
            </p>
          </div>
          {!checkingDuplicates && (
            <div className="overflow-x-auto">
              <table className="ft-table min-w-[1320px]">
                <thead><tr><th>Dòng trong file</th><th>Thông tin nhập</th><th>Hồ sơ cũ nghi ngờ</th><th>Trạng thái</th><th>Căn cứ đối chiếu</th><th>Các kỳ đã tham gia</th><th>Quyết định</th></tr></thead>
                <tbody>{duplicates.map(item => {
                  const selected = confirmedMatches[String(item.row)] === item.existing.code;
                  return <tr key={`${item.row}-${item.existing.code}`}>
                    <td>{item.row}</td>
                    <td><b>{item.importedName}</b></td>
                    <td>
                      <b>{item.existing.name}</b>
                      <p className="mt-1 text-xs text-slate-500">{item.existing.code} · {formatBirthDate(item.existing.birthDate)} · {item.existing.school || 'Chưa có trường'}{item.existing.className ? ` · ${item.existing.className}` : ''}</p>
                      <p className="mt-1 text-xs text-slate-500">CCCD: {item.existing.identity || '—'} · SĐT: {item.existing.phone || '—'} · Email: {item.existing.email || '—'}</p>
                    </td>
                    <td><span className={item.status === 'confirmed' ? 'rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700' : 'rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800'}>{item.status === 'confirmed' ? 'Đủ căn cứ' : 'Cần xác nhận'}</span></td>
                    <td>{item.matchBy}</td>
                    <td>{item.existing.sessions?.length ? item.existing.sessions.map(session => `${session.code} · ${session.name}`).join(', ') : 'Chưa ghi nhận kỳ trước'}</td>
                    <td>{item.status === 'confirmed' ? <span className="text-xs font-semibold text-emerald-700">Tự động dùng {item.existing.code}</span> : <div className="flex min-w-[220px] flex-col gap-2"><button type="button" onClick={() => setConfirmedMatches(current => selected ? Object.fromEntries(Object.entries(current).filter(([row]) => row !== String(item.row))) : { ...current, [String(item.row)]: item.existing.code })} className={selected ? 'rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white' : 'rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50'}>{selected ? `✓ Xác nhận dùng ${item.existing.code}` : `Xác nhận trùng với ${item.existing.code}`}</button><button type="button" onClick={() => setConfirmedMatches(current => Object.fromEntries(Object.entries(current).filter(([row]) => row !== String(item.row))))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Giữ là hai hồ sơ riêng</button></div>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          )}
        </section>
      )}      {/* Preview bảng */}
      {rows.length > 0 && (
        <section className="mt-5 ft-surface overflow-hidden">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-[#001e40]">Xem trước dữ liệu</h2>
              <p className="mt-1 text-sm text-slate-500">Nguồn: {source} · {rows.length} hồ sơ hợp lệ</p>
            </div>
            <button disabled={!canImport || loading} onClick={importRows}
              className="ft-primary disabled:opacity-50">
              Nhập {rows.length} hồ sơ
            </button>
          </div>
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-extrabold text-slate-900">Cách cập nhật hồ sơ đã có</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className={`cursor-pointer rounded-xl border p-3 ${updateMode === 'fill-empty' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                <input type="radio" name="update-mode" className="mr-2" checked={updateMode === 'fill-empty'} onChange={() => setUpdateMode('fill-empty')} />
                <b>Chỉ bổ sung ô còn trống (an toàn)</b>
                <span className="mt-1 block pl-5 text-xs text-slate-600">Giữ thông tin đang có; chỉ điền dữ liệu còn thiếu và liên kết vào kỳ ISO.</span>
              </label>
              <label className={`cursor-pointer rounded-xl border p-3 ${updateMode === 'replace-nonempty' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                <input type="radio" name="update-mode" className="mr-2" checked={updateMode === 'replace-nonempty'} onChange={() => setUpdateMode('replace-nonempty')} />
                <b>Cập nhật theo giá trị trong Sheet</b>
                <span className="mt-1 block pl-5 text-xs text-slate-600">Giá trị có nội dung trong Sheet thay thế giá trị cũ; ô trống vẫn không xóa dữ liệu.</span>
              </label>
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-600">Hệ thống không xóa hồ sơ chỉ vì hồ sơ đó không xuất hiện trong Sheet.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="ft-table min-w-[1180px]">
              <thead>
                <tr><th>STT</th><th>Trạng thái</th><th>Hồ sơ thí sinh</th><th>Liên hệ / định danh</th><th>Trường / lớp</th><th>Đăng ký</th><th>Dữ liệu các vòng thi</th><th>Tổng hợp</th></tr>
              </thead>
              <tbody>
                {sample.map(row => {
                  const preview = row._preview;
                  const statusLabel = preview ? { new: 'Tạo mới', changed: 'Có thay đổi', unchanged: 'Không đổi', conflict: 'Cần đối chiếu' }[preview.status] : 'Từ tệp';
                  const statusTone = preview ? { new: 'bg-blue-50 text-blue-700', changed: 'bg-amber-50 text-amber-700', unchanged: 'bg-emerald-50 text-emerald-700', conflict: 'bg-rose-50 text-rose-700' }[preview.status] : 'bg-slate-100 text-slate-700';
                  return <tr key={`${row.code || 'new'}-${row.name}`}>
                    <td>{rowIndexForPreview(row)}</td>
                    <td><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold ${statusTone}`}>{statusLabel}</span>{preview?.matchedCode && <div className="mt-1 text-xs text-slate-500">Khớp {preview.matchedCode}</div>}</td>
                    <td><b>{row.name}</b><div className="mt-1 text-xs text-slate-500">{row.code || 'Tự sinh mã'} · {formatBirthDate(row.birthDate) || 'Chưa có ngày sinh'} · {row.nationality || '—'}</div><div className="mt-1 text-xs text-slate-500">PH: {row.parent || '—'}</div></td>
                    <td><div>CCCD: {row.identity || '—'}</div><div className="mt-1 text-xs text-slate-500">{row.phone || '—'} · {row.email || '—'}</div><div className="mt-1 text-xs text-slate-500">{row.city || '—'}{row.ward ? ` · ${row.ward}` : ''}</div></td>
                    <td><b>{row.school || '—'}</b><div className="mt-1 text-xs text-slate-500">{row.className || '—'} · Khối {row.grade || '—'}</div></td>
                    <td>{row.subject || '—'}<div className="mt-1 text-xs text-slate-500">{row.category || '—'} · {row.registrationMethod || '—'}</div><div className="mt-1 text-xs text-slate-500">{row.examLanguage || '—'}{row.teamName ? ` · ${row.teamName}` : ''}</div></td>
                    <td><div className="space-y-2">{row.examHistory?.length ? row.examHistory.map((round, index) => <div key={`${round.round}-${index}`} className="rounded-lg bg-slate-50 p-2"><b className="text-xs text-[#003366]">{round.round}</b><div className="mt-1 text-xs text-slate-600">{[round.date, round.time, round.sbd && `SBD ${round.sbd}`, round.mode, round.score && `Điểm ${round.score}`, round.result].filter(Boolean).join(' · ') || 'Có thông tin điều kiện tham gia'}</div></div>) : '—'}</div></td>
                    <td>{row.highestRound || '—'}<div className="mt-1 text-xs text-slate-500">{row.achievement || '—'}</div>{row.certificateLink && <a className="mt-1 block text-xs font-semibold text-indigo-600" href={row.certificateLink} target="_blank" rel="noreferrer">Chứng nhận</a>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <TablePagination total={rows.length} page={activePreviewPage} onPageChange={setPreviewPage} label="bản ghi"/>
        </section>
      )}
    </>
  );
}
