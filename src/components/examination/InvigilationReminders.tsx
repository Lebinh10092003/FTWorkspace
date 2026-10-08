import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, ChevronDown, Clock3, ExternalLink, X } from 'lucide-react';
import { dutyDate, dutyTime, reminderDue, reminderKey, ServerClock } from './invigilationTiming';

export type Duty = {
  id: string; sessionId: string; sessionName: string; competitionCode: string; roundName: string;
  label: string; roomNumber: string; startsAt: string; endsAt: string; enabled: boolean;
  candidateCount: number; actionUrl: string; demo: boolean; sheetUrl: string; roomLink: string;
  invigilators: { email: string; name: string }[]; invigilatorLabel: string;
};

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Keep in-memory operation available. */ } };

export default function InvigilationReminders({ token, email, canPreview = false }: { token: string; email: string; canPreview?: boolean }) {
  const [shifts, setShifts] = useState<Duty[]>([]);
  const [now, setNow] = useState<number | null>(null);
  const [popup, setPopup] = useState<{ shift: Duty; preview?: boolean } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [offline, setOffline] = useState(false);
  const clock = useRef(new ServerClock());
  const latest = useRef<Duty[]>([]);
  const shown = useRef(new Set<string>());
  const popupRef = useRef(popup);
  const owner = useRef(crypto.randomUUID());
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const claimName = `ft-exam-popup-owner:${email}`;

  const setActivePopup = (value: typeof popup) => { popupRef.current = value; setPopup(value); };
  const release = () => {
    try { const lease = JSON.parse(read(claimName) || '{}'); if (lease.owner === owner.current) localStorage.removeItem(claimName); } catch { /* Optional multi-tab coordination. */ }
  };
  const dismiss = () => {
    const active = popupRef.current;
    if (active && !active.preview) {
      const key = reminderKey(email, active.shift);
      shown.current.add(key); write(key, 'seen');
    }
    release(); setActivePopup(null);
  };

  useEffect(() => {
    let active = true, loading = false;
    const controller = new AbortController();
    latest.current = []; shown.current = new Set(); clock.current = new ServerClock();
    setShifts([]); setNow(null); setActivePopup(null); setCollapsed(false);
    const refresh = async () => {
      if (loading || document.visibilityState !== 'visible') return;
      loading = true;
      const sent = performance.now();
      try {
        const response = await fetch('/api/examination/invigilation/my-shifts', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Không tải được lịch ca');
        const data = await response.json();
        if (!active) return;
        clock.current.sync(data.serverNow, sent, performance.now());
        latest.current = data.shifts || []; setShifts(latest.current); setOffline(false);
        setNow(clock.current.now(performance.now()));
      } catch {
        if (active) setOffline(true);
      } finally { loading = false; }
    };
    const tick = () => {
      const current = clock.current.now(performance.now());
      if (current === null || (!latest.current.length && !popupRef.current)) return;
      setNow(current);
      if (document.visibilityState !== 'visible') { release(); setActivePopup(null); return; }
      const existing = popupRef.current;
      if (existing?.preview) return;
      const due = latest.current.filter(s => reminderDue(s, current)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
      if (existing && !due.some(s => reminderKey(email, s) === reminderKey(email, existing.shift))) { release(); setActivePopup(null); }
      let lease: { owner?: string; until?: number } = {};
      try { lease = JSON.parse(read(claimName) || '{}'); } catch { /* Invalid storage is ignored. */ }
      if (lease.owner && lease.owner !== owner.current && (lease.until || 0) > current) return;
      if (popupRef.current) {
        write(claimName, JSON.stringify({ owner: owner.current, until: current + 5000 })); return;
      }
      // Defer a reminder while another dialog is open, instead of stacking overlays.
      if (document.querySelector('[aria-modal="true"]:not([data-exam-reminder])')) return;
      const next = due.find(s => !shown.current.has(reminderKey(email, s)) && !read(reminderKey(email, s)));
      if (!next) return;
      write(claimName, JSON.stringify({ owner: owner.current, until: current + 5000 }));
      setCollapsed(false); setActivePopup({ shift: next });
    };
    const wake = () => { void refresh(); tick(); };
    const preview = (event: Event) => {
      if (canPreview) { setActivePopup({ shift: (event as CustomEvent<Duty>).detail, preview: true }); }
    };
    const interval = window.setInterval(tick, 1000);
    // Duties rarely change and reminders are timed locally from server time:
    // fetch on open, on return to the tab, after a duty edit, plus a slow safety net.
    const polling = window.setInterval(() => void refresh(), 10 * 60_000);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake); window.addEventListener('pageshow', wake); window.addEventListener('online', wake);
    window.addEventListener('ft-exam-reminder-preview', preview);
    window.addEventListener('ft-exam-duties-changed', wake);
    void refresh();
    return () => {
      active = false; controller.abort(); release();
      clearInterval(interval); clearInterval(polling);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake); window.removeEventListener('pageshow', wake); window.removeEventListener('online', wake);
      window.removeEventListener('ft-exam-reminder-preview', preview);
      window.removeEventListener('ft-exam-duties-changed', wake);
    };
  }, [token, email, canPreview]);

  useEffect(() => {
    if (!popup) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key === 'Tab') {
        const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button,a[href]') || [])];
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); if (previous?.isConnected) previous.focus(); };
  }, [popup]);

  const relevant = now === null ? [] : shifts.filter(s => s.enabled && Date.parse(s.endsAt) > now);
  const next = relevant[0];
  const open = (shift: Duty) => { dismiss(); window.location.assign(shift.actionUrl); };
  const active = popup?.shift;
  const minutes = next && now !== null ? Math.max(0, Math.ceil((Date.parse(next.startsAt) - now) / 60_000)) : 0;
  return createPortal(<>
    {next && !popup && <aside className="fixed bottom-5 right-4 z-[10000] max-w-[calc(100vw-2rem)] font-sans">
      {collapsed ? <button type="button" onClick={() => setCollapsed(false)} aria-label="Mở nhắc ca thi" className="flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-xl"><BellRing size={18} />Ca coi thi{relevant.length > 1 ? ` (${relevant.length})` : ''}</button>
        : <div className="w-80 rounded-2xl border border-emerald-200 bg-white p-4 text-slate-900 shadow-2xl">
          <div className="flex items-center justify-between"><p className="flex items-center gap-2 text-sm font-bold text-emerald-700"><Clock3 size={17} />{now! >= Date.parse(next.startsAt) ? 'Ca thi đang diễn ra' : 'Ca coi thi tiếp theo'}</p><button type="button" onClick={() => setCollapsed(true)} aria-label="Thu gọn nhắc ca thi" className="rounded-lg p-1 hover:bg-slate-100"><ChevronDown size={19} /></button></div>
          <p className="mt-2 font-bold">{next.competitionCode} · {next.label} · Phòng {next.roomNumber}</p>
          <p className="mt-1 text-sm text-slate-600">{dutyDate(next.startsAt)} · {dutyTime(next.startsAt)}–{dutyTime(next.endsAt)}</p>
          {minutes > 0 && minutes <= 60 && <p className="mt-1 text-sm text-amber-700">Còn {minutes} phút</p>}
          {offline && <p className="mt-1 text-xs text-amber-700">Đang dùng lịch đã tải; chờ kết nối để cập nhật.</p>}
          <button type="button" onClick={() => open(next)} className="mt-3 w-full rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white">Mở phòng thi / Điểm danh</button>
          {relevant.length > 1 && <p className="mt-2 text-xs text-slate-500">Ca tiếp: {relevant[1].label} · {dutyTime(relevant[1].startsAt)} · Phòng {relevant[1].roomNumber}</p>}
        </div>}
    </aside>}
    {active && <div className="fixed inset-0 z-[12000] grid place-items-center bg-slate-950/60 p-4 font-sans backdrop-blur-sm">
      <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="exam-reminder-title" data-exam-reminder className="w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-200 bg-white text-slate-900 shadow-2xl">
        <div className="flex items-start gap-3 border-b border-emerald-100 bg-emerald-50 p-6"><BellRing className="mt-1 shrink-0 text-emerald-700" size={28} /><div className="flex-1"><h2 id="exam-reminder-title" className="text-xl font-extrabold">{popup?.preview ? 'Xem thử nhắc ca thi' : now! >= Date.parse(active.startsAt) ? 'Đã đến ca coi thi của bạn' : 'Sắp đến ca coi thi của bạn'}</h2><p className="mt-1 text-sm text-emerald-800">{active.sessionName}</p></div><button ref={closeButton} type="button" onClick={dismiss} aria-label="Đóng popup nhắc ca thi" className="rounded-lg p-1 hover:bg-emerald-100"><X size={20} /></button></div>
        <div className="space-y-3 p-6"><p className="text-lg font-bold">{active.roundName} · {active.label} · Phòng {active.roomNumber}</p><p>{dutyDate(active.startsAt)} · <strong>{dutyTime(active.startsAt)}–{dutyTime(active.endsAt)}</strong> (giờ Việt Nam)</p><p className="text-sm text-slate-600">{active.candidateCount} thí sinh · Giám thị: {active.invigilators.map(u => u.name).join(', ') || active.invigilatorLabel}</p>
          {active.demo && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Danh sách thí sinh hiện là dữ liệu demo.</p>}
          {popup?.preview && <p className="text-sm text-slate-500">Chế độ xem thử; giờ nhắc và lịch thi thật không thay đổi.</p>}
          <div className="grid gap-3 pt-2 sm:grid-cols-2"><button type="button" onClick={() => open(active)} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white"><ExternalLink size={18} />Mở phòng thi</button><button type="button" onClick={dismiss} className="rounded-xl bg-slate-100 px-4 py-3 font-bold text-slate-700">Thu gọn, xem sau</button></div>
        </div>
      </div>
    </div>}
  </>, document.body);
}
