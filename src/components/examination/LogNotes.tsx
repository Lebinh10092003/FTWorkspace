import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Send } from 'lucide-react';

export type SystemEvent = string | { content: string; time?: string };
type LogNote = { id: string; time: string; createdAt?: string; actor: string; actorEmail?: string; actorPhotoURL?: string; content: string; system?: boolean; pending?: boolean };
type Props = { entityKey: string; title?: string; systemEvents?: SystemEvent[]; actor?: string | null; canWrite: boolean; idToken?: string | null };

const storageKey = (entityKey: string) => `ft-examination-lognotes:${entityKey}`;
const labels: Record<string, string> = {
  province: 'Tỉnh/Thành phố', ward: 'Phường/Xã', school: 'Trường', level: 'Cấp học', representative: 'Đại diện', phone: 'Số điện thoại', email: 'Email',
  contests: 'Các cuộc thi đã tham gia', studentCounts: 'Số học sinh cộng tác', name: 'Tên lớp', sessionId: 'Kỳ tổ chức', subject: 'Nội dung ôn tập',
  teacher: 'Giáo viên', teacherEmail: 'Email giáo viên', start: 'Ngày bắt đầu', end: 'Ngày kết thúc', mode: 'Hình thức', scheduleSlots: 'Lịch học', note: 'Ghi chú',
  id: 'Mã', code: 'Mã', title: 'Tiêu đề', date: 'Ngày', time: 'Thời gian', day: 'Ngày trong tuần', month: 'Tháng', year: 'Năm',
  startTime: 'Giờ bắt đầu', endTime: 'Giờ kết thúc', status: 'Trạng thái', phase: 'Giai đoạn', description: 'Mô tả', content: 'Nội dung',
  session: 'Kỳ tổ chức', sessionIds: 'Các kỳ tổ chức', count: 'Số lượng', candidateCodes: 'Danh sách học viên', attendance: 'Điểm danh',
  location: 'Địa điểm', link: 'Đường dẫn', planned: 'Dự kiến', unknown: 'Chưa xác định', category: 'Bảng thi', registration: 'Thông tin đăng ký',
};

function parseStructuredValue(value: string): unknown {
  const text = value.trim();
  if (!text || !['{', '['].includes(text[0]) || !['}', ']'].includes(text.at(-1) || '')) return value;
  try { return JSON.parse(text); } catch { /* Try legacy Python dictionary syntax below. */ }
  try {
    const normalized = text
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, item: string) => JSON.stringify(item.replace(/\\'/g, '\'')));
    return JSON.parse(normalized);
  } catch {
    return value;
  }
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'chưa có thông tin';
  if (typeof value === 'string') {
    const parsed = parseStructuredValue(value);
    if (parsed !== value) return displayValue(parsed);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/');
    return value.trim() || 'chưa có thông tin';
  }
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (Array.isArray(value)) {
    if (!value.length) return 'chưa có thông tin';
    return value.map(item => {
      if (item && typeof item === 'object' && 'session' in item && 'count' in item) return `${String(item.session)}: ${String(item.count)} học sinh`;
      if (item && typeof item === 'object' && 'day' in item && 'start' in item) return `${String(item.day)} ${String(item.start)}–${String((item as { end?: unknown }).end || '')}`.trim();
      return displayValue(item);
    }).join(', ');
  }
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null && item !== undefined && item !== '')
    .map(([key, item]) => `${labels[key] || key}: ${displayValue(item)}`).join('; ') || 'chưa có thông tin';
  return String(value).trim() || 'chưa có thông tin';
}

export function formatChangeLog(title: string, before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, fieldLabels: Record<string, string> = labels): string {
  const previous = before || {}, next = after || {};
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(key => key !== 'id');
  const lines = keys.flatMap(key => {
    if (JSON.stringify(previous[key]) === JSON.stringify(next[key])) return [];
    const oldValue = displayValue(previous[key]), newValue = displayValue(next[key]), label = fieldLabels[key] || labels[key] || key;
    if (oldValue === 'chưa có thông tin') return [`Đã bổ sung ${label}: ${newValue}.`];
    if (newValue === 'chưa có thông tin') return [`Đã xóa ${label} (trước đó: ${oldValue}).`];
    return [`Đã đổi ${label} từ “${oldValue}” thành “${newValue}”.`];
  });
  return lines.length ? `${title.replace(/[.:\s]+$/, '')}.\n${lines.join('\n')}` : `${title.replace(/[.:\s]+$/, '')}.`;
}

function replaceStructuredLiterals(content: string): string {
  let result = '', index = 0;
  const pairs: Record<string, string> = { '{': '}', '[': ']' };
  while (index < content.length) {
    const opener = content[index];
    if (!pairs[opener]) { result += opener; index += 1; continue; }
    const stack = [pairs[opener]];
    let quote = '', escaped = false, cursor = index + 1;
    while (cursor < content.length && stack.length) {
      const char = content[cursor];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
      } else if (char === String.fromCharCode(34) || char === String.fromCharCode(39)) quote = char;
      else if (pairs[char]) stack.push(pairs[char]);
      else if (char === stack.at(-1)) stack.pop();
      cursor += 1;
    }
    if (stack.length) { result += opener; index += 1; continue; }
    const candidate = content.slice(index, cursor);
    const parsed = parseStructuredValue(candidate);
    if (parsed !== candidate) { result += displayValue(parsed); index = cursor; }
    else { result += opener; index += 1; }
  }
  return result;
}

export function humanizeLegacyContent(content: string): string {
  const text = String(content || '').trim();
  const markerPairs = [
    ['. Thông tin trước: ', '. Thông tin sau: '],
    ['. Dữ liệu trước: ', '. Dữ liệu sau: '],
  ];
  for (const [beforeMarker, afterMarker] of markerPairs) {
    if (!text.includes(beforeMarker)) continue;
    const [title, rest] = text.split(beforeMarker, 2);
    if (!rest.includes(afterMarker)) continue;
    const [beforeRaw, afterRaw] = rest.split(afterMarker, 2);
    const before = parseStructuredValue(beforeRaw.trim().replace(/\.$/, ''));
    const after = parseStructuredValue(afterRaw.trim().replace(/\.$/, ''));
    if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
      return formatChangeLog(title, before as Record<string, unknown>, after as Record<string, unknown>);
    }
  }
  const parsed = parseStructuredValue(text);
  if (parsed !== text) return displayValue(parsed);
  return replaceStructuredLiterals(text);
}

export function appendLogNote(entityKey: string, content: string, actor = 'Hệ thống FT Workspace', system = false, idToken?: string | null) {
  const key = storageKey(entityKey);
  let current: LogNote[] = [];
  try { current = JSON.parse(localStorage.getItem(key) || '[]'); } catch { current = []; }
  const readableContent = humanizeLegacyContent(content);
  const createdAt = new Date().toISOString();
  const optimisticId = `pending-${Date.now()}-${Math.random()}`;
  const next = [{ id: optimisticId, time: new Date(createdAt).toLocaleString('vi-VN'), createdAt, actor, content: readableContent, system, pending: true }, ...current];
  localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('ft-examination-lognote', { detail: entityKey }));
  fetch(`/api/examination/lognotes/${encodeURIComponent(entityKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ content: readableContent, actor, system }),
  }).then(async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.note) throw new Error(body?.error || 'Máy chủ không thể lưu lognote.');
    let stored: LogNote[] = [];
    try { stored = JSON.parse(localStorage.getItem(key) || '[]'); } catch { stored = []; }
    const reconciled = [body.note as LogNote, ...stored.filter(note => note.id !== optimisticId && note.id !== body.note.id)];
    localStorage.setItem(key, JSON.stringify(reconciled));
    window.dispatchEvent(new CustomEvent('ft-examination-lognote', { detail: entityKey }));
  }).catch(error => {
    let stored: LogNote[] = [];
    try { stored = JSON.parse(localStorage.getItem(key) || '[]'); } catch { stored = []; }
    localStorage.setItem(key, JSON.stringify(stored.filter(note => note.id !== optimisticId)));
    window.dispatchEvent(new CustomEvent('ft-examination-lognote', { detail: entityKey }));
    window.dispatchEvent(new CustomEvent('ft-examination-lognote-error', { detail: { entityKey, content: readableContent, message: error instanceof Error ? error.message : 'Không thể lưu lognote.' } }));
    console.warn('Không thể lưu lognote:', error);
  });
}

function noteTimestamp(note: LogNote): number {
  if (note.createdAt) {
    const parsed = Date.parse(note.createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  const match = note.time?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,)?\s+(\d{1,2}):(\d{2})/);
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5])).getTime() : 0;
}

export default function LogNotes({ entityKey, title = 'Lognote & lịch sử thay đổi', systemEvents = [], actor, canWrite, idToken }: Props) {
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loadMessage, setLoadMessage] = useState(idToken ? 'Đang tải lognote...' : 'Đăng nhập để xem lognote và lịch sử thay đổi.');
  const [notes, setNotes] = useState<LogNote[]>(() => { try { return JSON.parse(localStorage.getItem(storageKey(entityKey)) || '[]'); } catch { return []; } });
  useEffect(() => {
    const load = () => {
      if (!idToken) {
        setLoadMessage('Đăng nhập để xem lognote và lịch sử thay đổi.');
        return;
      }
      setLoadMessage('Đang tải lognote...');
      fetch(`/api/examination/lognotes/${encodeURIComponent(entityKey)}`, { headers: { Authorization: `Bearer ${idToken}` } })
        .then(async response => {
          if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Phiên đăng nhập không còn quyền xem lognote.' : 'Không thể tải lognote từ máy chủ.');
          return response.json();
        })
        .then(data => {
          if (!Array.isArray(data)) throw new Error('Dữ liệu lognote không đúng định dạng.');
          setNotes(current => {
            const pending = current.filter(note => note.pending);
            const merged = [...pending, ...data.filter(note => !pending.some(item => item.id === note.id))];
            localStorage.setItem(storageKey(entityKey), JSON.stringify(merged));
            return merged;
          });
          setLoadMessage('');
        })
        .catch(error => setLoadMessage(error instanceof Error ? error.message : 'Không thể tải lognote từ máy chủ.'));
    };
    load();
    const refresh = (event: Event) => { if ((event as CustomEvent<string>).detail !== entityKey) return; try { setNotes(JSON.parse(localStorage.getItem(storageKey(entityKey)) || '[]')); } catch { setNotes([]); } };
    const showError = (event: Event) => { const detail = (event as CustomEvent<{ entityKey: string; content: string; message: string }>).detail; if (detail?.entityKey === entityKey) { setDraft(detail.content); setSaveError(detail.message); } };
    setSaveError('');
    window.addEventListener('ft-examination-lognote', refresh); window.addEventListener('ft-examination-audit-refresh', load); window.addEventListener('ft-examination-lognote-error', showError);
    return () => { window.removeEventListener('ft-examination-lognote', refresh); window.removeEventListener('ft-examination-audit-refresh', load); window.removeEventListener('ft-examination-lognote-error', showError); };
  }, [entityKey, idToken]);
  const systemNotes = useMemo<LogNote[]>(() => systemEvents.map((event, index) => ({ id: `system-${index}`, time: typeof event === 'string' ? '' : event.time || '', actor: 'Hệ thống FT Workspace', content: typeof event === 'string' ? event : event.content, system: true })), [systemEvents]);
  const entries = useMemo(() => [...notes, ...systemNotes].sort((left, right) => noteTimestamp(right) - noteTimestamp(left)), [notes, systemNotes]);
  const add = () => { const content = draft.trim(); if (!content || !canWrite) return; setSaveError(''); appendLogNote(entityKey, content, actor || 'Nhân viên FT Workspace', false, idToken); setDraft(''); };
  const errorMessage = saveError ? `Không thể lưu lognote: ${saveError}` : '';
  const dismissError = () => setSaveError('');
  if (saveError) return <section className={'ft-lognote-error'} role={'alert'}><p>{errorMessage}</p><button type={'button'} onClick={dismissError}>Quay lại lognote</button></section>;
  return <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white"><header className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-extrabold text-[#001e40]"><ClipboardList className="h-5 w-5"/>{title}</h2><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500 shadow-sm">{entries.length} mục</span></header>{canWrite && <div className="border-b bg-white p-5"><div className="flex gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#001e40] text-xs font-bold text-white">{(actor || 'NV').slice(0,2).toUpperCase()}</div><div className="flex-1"><textarea value={draft} onChange={event => setDraft(event.target.value)} className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" placeholder="Ghi lại thông tin cần lưu vết..."/><div className="mt-2 flex justify-end"><button onClick={add} disabled={!draft.trim()} className="ft-primary disabled:opacity-50"><Send className="h-4 w-4"/>Thêm lognote</button></div></div></div></div>}<div className="max-h-[440px] overflow-y-auto p-5"><div className="relative ml-2 border-l border-slate-200 pl-6">{entries.map(note => <article key={note.id} className="relative pb-5 last:pb-0"><span className={`absolute -left-[31px] top-1 grid h-4 w-4 place-items-center rounded-full border-4 border-white ${note.system ? 'bg-blue-500' : 'bg-[#aa3000]'}`}/><div className={`rounded-lg border p-4 ${note.system ? 'border-blue-100 bg-blue-50/40' : 'border-slate-200 bg-white shadow-sm'}`}><div className="flex flex-wrap items-center gap-x-2 gap-y-1">{note.actorPhotoURL ? <img src={note.actorPhotoURL} alt={note.actor} className="h-7 w-7 rounded-full border border-slate-200 object-cover"/> : <span className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-extrabold ${note.system ? 'bg-blue-100 text-blue-700' : 'bg-sky-100 text-sky-800'}`}>{note.actor.slice(0,2).toUpperCase()}</span>}<b className={note.system ? 'text-sm text-blue-800' : 'text-sm text-[#001e40]'}>{note.actor}</b><span className="text-xs font-medium text-slate-500">· {note.time}</span>{note.system && <span className="ml-auto text-xs text-blue-600">Tự động từ hệ thống</span>}</div><p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{humanizeLegacyContent(note.content)}</p></div></article>)}{!entries.length && <div className="py-5 text-sm text-slate-500">{loadMessage || 'Chưa có lognote.'}</div>}</div></div></section>;
}
