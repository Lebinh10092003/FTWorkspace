/** Coi thi tools for Khảo thí managers: the room output Sheet and sending duty
 *  details to invigilators (one-click e-mail, or a pre-filled Gmail draft). */
import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, FileSpreadsheet, Loader2, Mail, Send, X } from 'lucide-react';

type RoomSheet = { url: string; lastExportAt: string; lastError: string; pending: boolean; serviceAccount: string };
type Recipient = { name: string; email: string; kind: 'guest' | 'staff'; gmailUrl: string; subject: string; html: string; text: string };
type NotifyItem = { shiftId: string; room: string; startsAt: string; enabled: boolean; recipients: Recipient[]; notifiedAt: string; hasGuest: boolean; guestOpenedAt: string; previewHtml: string; previewSubject: string };

const time = (iso: string) => (iso ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(iso)) : '');
const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#001e40] focus:outline-none';

/** Where the room output Sheet is; attach or change it without leaving Coi thi. */
export function RoomSheetBar({ token, sessionId }: { token: string; sessionId: string }) {
  const [sheet, setSheet] = useState<RoomSheet | null>(null), [editing, setEditing] = useState(false), [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const endpoint = `/api/examination/invigilation/room-sheet?sessionId=${encodeURIComponent(sessionId)}`;
  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Chưa đọc được Sheet phân phòng.');
      setSheet(data); setUrl(data.url); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa đọc được Sheet phân phòng.'); }
  }, [endpoint, token]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, url: url.trim() }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Chưa gắn được Sheet.');
      setSheet(data); setEditing(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa gắn được Sheet.'); }
    finally { setBusy(false); }
  };
  const copyAccount = async () => { try { await navigator.clipboard.writeText(sheet?.serviceAccount || ''); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };
  if (!sheet && !error) return null;
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <FileSpreadsheet size={17} className="text-emerald-700" />
      <b className="text-[#001e40]">Sheet phân phòng</b>
      {sheet?.url && !editing && <>
        <a href={sheet.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 font-bold text-white"><ExternalLink size={14} />Mở file</a>
        <span className="text-slate-500">{sheet.pending ? 'Đang chờ ghi bản mới…' : sheet.lastExportAt ? `Cập nhật lần cuối ${time(sheet.lastExportAt)}` : 'Chưa ghi lần nào'}</span>
        <button type="button" onClick={() => setEditing(true)} className="ml-auto rounded-lg border px-3 py-1.5 font-bold">Đổi file</button>
      </>}
      {!sheet?.url && !editing && <><span className="text-amber-700">Chưa gắn file. Mỗi phòng sẽ có một tab: giờ thi, link, giám thị, danh sách thí sinh và điểm danh.</span><button type="button" onClick={() => setEditing(true)} className="ml-auto rounded-lg bg-[#001e40] px-3 py-1.5 font-bold text-white">Gắn file</button></>}
    </div>
    {editing && <div className="mt-3 space-y-2">
      <ol className="list-decimal space-y-1 pl-5 text-slate-600">
        <li>Tạo một file Google Sheets mới (để trống), đặt tên ví dụ “Phân phòng FIEO 18/10”.</li>
        <li>Bấm Chia sẻ → thêm quyền <b>Người chỉnh sửa</b> cho tài khoản hệ thống: {sheet?.serviceAccount ? <><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{sheet.serviceAccount}</code> <button type="button" onClick={() => void copyAccount()} className="inline-flex items-center gap-1 text-xs font-bold text-[#0055da]"><Copy size={12} />{copied ? 'Đã chép' : 'Chép'}</button></> : 'tài khoản dịch vụ của Workspace'}.</li>
        <li>Dán link file vào ô dưới rồi Lưu. Web tự tạo các tab và ghi lại mỗi khi có điểm danh.</li>
      </ol>
      <div className="flex flex-wrap gap-2"><input type="url" className={`${input} min-w-0 flex-1`} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" /><button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-[#001e40] px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? 'Đang lưu…' : 'Lưu'}</button><button type="button" onClick={() => { setEditing(false); setUrl(sheet?.url || ''); }} className="rounded-lg border px-4 py-2 font-bold">Hủy</button></div>
    </div>}
    {(error || sheet?.lastError) && <p role="alert" className="mt-2 text-xs text-rose-700">{error || `Lần ghi gần nhất bị lỗi: ${sheet?.lastError}. Kiểm tra file đã chia sẻ quyền chỉnh sửa cho tài khoản hệ thống chưa.`}</p>}
  </section>;
}

/** Every room's invigilators with their message: send by e-mail in one click, or open a Gmail draft. */
export function NotifyDialog({ token, sessionId, onClose, onDone }: { token: string; sessionId: string; onClose: () => void; onDone: (summary: string) => void }) {
  const [items, setItems] = useState<NotifyItem[] | null>(null), [mailConfigured, setMailConfigured] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]), [preview, setPreview] = useState<NotifyItem | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`/api/examination/invigilation/notify?sessionId=${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Chưa đọc được danh sách giám thị.'); return data; })
      .then(data => { if (!active) return; setItems(data.items); setMailConfigured(data.mailConfigured); setChosen(data.items.filter((item: NotifyItem) => item.recipients.length && !item.notifiedAt).map((item: NotifyItem) => item.shiftId)); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Chưa đọc được danh sách giám thị.'); });
    return () => { active = false; };
  }, [sessionId, token]);
  const send = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/examination/invigilation/notify', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, shiftIds: chosen }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Chưa gửi được email.');
      onDone(`Đã gửi ${data.sent.length} email cho giám thị.${data.failed.length ? ` Chưa gửi được: ${data.failed.join('; ')}` : ''}`);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa gửi được email.'); }
    finally { setBusy(false); }
  };
  const markSent = async (item: NotifyItem, sent: boolean) => {
    setError('');
    try {
      const response = await fetch('/api/examination/invigilation/notify', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, shiftIds: [item.shiftId], markSent: sent }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Chưa lưu được.');
      setItems(current => (current || []).map(row => row.shiftId === item.shiftId ? { ...row, notifiedAt: data.notifiedAt } : row));
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa lưu được.'); }
  };
  const [copiedFor, setCopiedFor] = useState('');
  /** Copies the designed message (HTML with buttons) and opens a Gmail draft with recipient and subject;
   *  pasting into the body keeps the layout and the buttons. */
  const composeInGmail = async (person: Recipient) => {
    setError('');
    // Copy first: the page must still have focus for the clipboard to accept it.
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([person.html], { type: 'text/html' }), 'text/plain': new Blob([person.text], { type: 'text/plain' }) })]);
      } else {
        await navigator.clipboard.writeText(person.text);
      }
      setCopiedFor(person.email);
    } catch {
      setError('Trình duyệt chưa cho chép thư. Hãy bấm "Xem thư", bôi đen nội dung rồi chép.');
    }
    if (!window.open(person.gmailUrl, '_blank')) setError('Trình duyệt đã chặn cửa sổ Gmail. Hãy cho phép cửa sổ bật lên rồi bấm lại.');
  };
  const missing = (items || []).filter(item => !item.recipients.length).length;
  const unopened = (items || []).filter(item => item.hasGuest && !item.guestOpenedAt).length;
  return <div className="fixed inset-0 z-[11000] grid place-items-center overflow-y-auto bg-slate-950/50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="notify-title" className="my-4 w-full max-w-4xl rounded-2xl bg-white p-5 shadow-xl">
      <div className="mb-2 flex justify-between gap-3"><h2 id="notify-title" className="text-lg font-bold">Gửi thông tin cho giám thị</h2><button type="button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></div>
      <p className="text-sm text-slate-600">Mỗi giám thị nhận giờ thi, phòng, số thí sinh, nút <b>Mở trang điểm danh</b> (link riêng của người đó) và nút <b>Vào phòng thi</b>.</p>
      {!mailConfigured && items && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Hệ thống chưa cài tài khoản gửi email, nên chưa gửi tự động được. Bấm <b>Soạn trong Gmail</b> ở từng giám thị: Gmail mở sẵn người nhận và tiêu đề, thư đã được chép sẵn; bấm vào thân thư, nhấn <b>Ctrl+V</b> (Mac: ⌘+V) rồi Gửi. Nhớ chọn đúng tài khoản gửi ở ô “Từ”.</p>}
      {copiedFor && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Đã chép thư cho <b>{copiedFor}</b>. Trong Gmail vừa mở: bấm vào thân thư → <b>Ctrl+V</b> → Gửi, rồi quay lại bấm “Đánh dấu đã gửi”.</p>}
      {items && unopened > 0 && <p className="mt-2 text-xs text-slate-600">{unopened} giám thị ngoài chưa mở link. Cột “Đã mở link” tự cập nhật khi giám thị vào trang bằng đúng email.</p>}
      {missing > 0 && <p className="mt-2 text-xs text-amber-700">{missing} phòng chưa có giám thị (hoặc giám thị ngoài chưa có email): bấm “Lịch & giám thị” ở phòng đó để phân công.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {!items && !error && <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Đang đọc danh sách…</p>}
      {items && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs uppercase text-slate-500"><tr>{mailConfigured && <th className="w-8 py-2" />}<th>Phòng</th><th>Giám thị</th><th>Đã gửi</th><th>Đã mở link</th><th className="text-right">Thao tác</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.shiftId} className="border-t border-slate-100 align-top">
          {mailConfigured && <td className="py-2"><input type="checkbox" aria-label={`Chọn ${item.room}`} disabled={!item.recipients.length} checked={chosen.includes(item.shiftId)} onChange={e => setChosen(e.target.checked ? [...chosen, item.shiftId] : chosen.filter(id => id !== item.shiftId))} /></td>}
          <td className="py-2 pr-3 font-semibold">{item.room}{!item.enabled && <span className="ml-1 text-xs text-slate-400">(đã tắt)</span>}</td>
          <td className="py-2 pr-3">{item.recipients.length ? item.recipients.map(person => <p key={person.email}>{person.name} <span className="text-xs text-slate-500">· {person.email}{person.kind === 'guest' ? ' · ngoài' : ' · nhân viên'}</span></p>) : <span className="text-amber-700">Chưa có</span>}</td>
          <td className="py-2 pr-3 text-xs">{item.notifiedAt ? <span className="font-semibold text-emerald-700">{time(item.notifiedAt)}</span> : <span className="text-slate-400">—</span>}{item.recipients.length > 0 && <button type="button" onClick={() => void markSent(item, !item.notifiedAt)} className="mt-1 block text-[11px] font-bold text-[#0055da] hover:underline">{item.notifiedAt ? 'Bỏ đánh dấu' : 'Đánh dấu đã gửi'}</button>}</td>
          <td className="py-2 pr-3 text-xs">{item.hasGuest ? (item.guestOpenedAt ? <span className="font-semibold text-emerald-700">{time(item.guestOpenedAt)}</span> : <span className="font-semibold text-amber-700">Chưa mở</span>) : <span className="text-slate-400">—</span>}</td>
          <td className="py-2 text-right"><div className="flex flex-wrap justify-end gap-1.5">
            {item.previewHtml && <button type="button" onClick={() => setPreview(item)} className="rounded-lg border px-2.5 py-1 text-xs font-bold">Xem thư</button>}
            {item.recipients.map(person => <button key={person.email} type="button" onClick={() => void composeInGmail(person)} className="flex items-center gap-1 rounded-lg border border-[#0055da] px-2.5 py-1 text-xs font-bold text-[#0055da]"><Mail size={12} />Soạn trong Gmail{item.recipients.length > 1 ? ` (${person.name})` : ''}</button>)}
          </div></td>
        </tr>)}</tbody>
      </table></div>}
      {preview && <div className="mt-4 rounded-xl border border-slate-200">
        <div className="flex items-center justify-between border-b px-3 py-2 text-sm"><b>{preview.previewSubject}</b><button type="button" onClick={() => setPreview(null)} aria-label="Đóng bản xem thư"><X size={16} /></button></div>
        <iframe title="Bản xem thư" sandbox="" srcDoc={preview.recipients[0]?.html || preview.previewHtml} className="h-[32rem] w-full" />
      </div>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 font-bold">Đóng</button>{mailConfigured && <button type="button" disabled={busy || !chosen.length} onClick={() => void send()} className="flex items-center gap-2 rounded-lg bg-[#001e40] px-4 py-2 font-bold text-white disabled:opacity-50"><Send size={15} />{busy ? 'Đang gửi…' : `Gửi email cho ${chosen.length} phòng`}</button>}</div>
    </div>
  </div>;
}
