/** Coi thi for invigilators without a Workspace account: /coi-thi/<token>.
 *  The link belongs to one room. When Khảo thí tied it to an e-mail, the
 *  invigilator types that address once; otherwise they type their name. */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { RosterBoard, type Entry, type RosterApi, type Shift } from './InvigilationWorkspace';
import { dutyDate, dutyTime, roomTitle } from './invigilationTiming';

const read = (key: string) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const write = (key: string, value: string) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* private mode: ask again next time */ } };

export default function GuestInvigilation({ token }: { token: string }) {
  const emailKey = `ft-guest-email:${token}`, nameKey = `ft-guest-name:${token}`;
  const [email, setEmail] = useState(() => read(emailKey)), [name, setName] = useState(() => read(nameKey));
  const [draftEmail, setDraftEmail] = useState(email), [draftName, setDraftName] = useState(name);
  const [shift, setShift] = useState<(Shift & { guestName?: string }) | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'needEmail' | 'closed'>('loading');
  const [message, setMessage] = useState('');
  const edits = useRef(0);

  const load = useCallback(async () => {
    if (edits.current) return;
    try {
      const response = await fetch(`/api/public/invigilation/${encodeURIComponent(token)}`, { headers: email ? { 'X-Guest-Email': email } : {}, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && data.needEmail) { setState('needEmail'); setMessage(email ? String(data.error || '') : ''); return; }
      if (!response.ok) { setState('closed'); setMessage(String(data.error || 'Không mở được phòng thi.')); return; }
      setShift(data.shift); setState('ready'); setMessage('');
    } catch { setMessage('Mất kết nối. Đang thử lại…'); }
  }, [token, email]);

  useEffect(() => {
    document.title = 'Coi thi · FermatTech';
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const value = draftEmail.trim().toLowerCase();
    write(emailKey, value); setEmail(value); setState('loading');
  };
  const submitName = (event: FormEvent) => {
    event.preventDefault();
    const value = draftName.trim().replace(/\s+/g, ' ');
    write(nameKey, value); setName(value);
  };
  const signOut = () => { write(emailKey, ''); write(nameKey, ''); setEmail(''); setName(''); setDraftEmail(''); setDraftName(''); setShift(null); setState('loading'); };

  const needsName = state === 'ready' && shift && !shift.guestName && !name;
  const api: RosterApi = {
    url: code => `/api/public/invigilation/${encodeURIComponent(token)}/roster/${encodeURIComponent(code)}`,
    headers: { ...(email ? { 'X-Guest-Email': email } : {}), ...(name ? { 'X-Guest-Name': encodeURIComponent(name) } : {}) },
  };
  const onEntrySaved = (entry: Entry) => setShift(current => current ? { ...current, roster: current.roster.map(item => item.code === entry.code ? { ...item, ...entry } : item) } : current);
  const card = 'mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm';

  return <div className="min-h-dvh bg-slate-50 font-sans text-slate-900">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <img src="/logo.png" alt="FermatTech" className="h-9 w-auto" />
        <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Coi thi</p><p className="truncate text-sm font-extrabold text-[#001e40]">{shift ? `${shift.competitionCode} · ${roomTitle(shift.roomNumber)}` : 'FermatTech'}</p></div>
        {(email || name) && <button type="button" onClick={signOut} className="ml-auto flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-bold text-slate-600"><LogOut size={14} />Đổi người</button>}
      </div>
    </header>
    <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      {state === 'loading' && <p className="flex items-center justify-center gap-2 py-16 text-slate-500"><Loader2 className="animate-spin" size={18} />Đang mở phòng thi…</p>}
      {state === 'closed' && <div className={card}><h1 className="text-lg font-extrabold text-[#001e40]">Không mở được phòng thi</h1><p className="mt-2 text-sm text-slate-600">{message}</p></div>}
      {state === 'needEmail' && <form onSubmit={submitEmail} className={card}>
        <h1 className="text-lg font-extrabold text-[#001e40]">Xác nhận giám thị</h1>
        <p className="mt-2 text-sm text-slate-600">Nhập email Ban tổ chức đã dùng để phân công bạn coi thi phòng này.</p>
        <input required type="email" autoComplete="email" value={draftEmail} onChange={e => setDraftEmail(e.target.value)} placeholder="email@gmail.com" className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-3 text-base focus:border-[#001e40] focus:outline-none" />
        {message && <p role="alert" className="mt-2 text-sm text-rose-700">{message}</p>}
        <button type="submit" className="mt-4 w-full rounded-lg bg-[#001e40] py-3 font-bold text-white">Mở phòng thi</button>
      </form>}
      {needsName && <form onSubmit={submitName} className={card}>
        <h1 className="text-lg font-extrabold text-[#001e40]">Họ tên giám thị</h1>
        <p className="mt-2 text-sm text-slate-600">Tên của bạn được ghi kèm mỗi lần điểm danh để Ban tổ chức đối chiếu.</p>
        <input required autoComplete="name" value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="Ví dụ: Nguyễn Văn A" className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-3 text-base focus:border-[#001e40] focus:outline-none" />
        <button type="submit" className="mt-4 w-full rounded-lg bg-[#001e40] py-3 font-bold text-white">Tiếp tục</button>
      </form>}
      {state === 'ready' && shift && !needsName && <>
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <h1 className="text-lg font-extrabold text-[#001e40]">{shift.competitionCode} · {shift.label} · {roomTitle(shift.roomNumber)}</h1>
            <p className="mt-1 text-sm text-slate-500">{shift.roundName} · {dutyTime(shift.startsAt)}–{dutyTime(shift.endsAt)} {dutyDate(shift.startsAt)} · Giám thị: {shift.guestName || name}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-bold"><RefreshCw size={15} />Tải lại</button>
            {shift.roomLink && <a href={shift.roomLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white"><ExternalLink size={15} />Vào phòng thi</a>}
          </div>
        </section>
        {message && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <RosterBoard shift={shift} api={api} onEntrySaved={onEntrySaved} onBegin={() => { edits.current++; }} onEnd={() => { edits.current = Math.max(0, edits.current - 1); }} onBulkEnd={() => void load()} />
        </section>
        <p className="text-center text-xs text-slate-400">Link này chỉ dành cho giám thị được phân công. Không chia sẻ cho người khác.</p>
      </>}
    </main>
  </div>;
}
