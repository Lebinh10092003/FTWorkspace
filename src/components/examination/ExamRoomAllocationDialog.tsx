import { useMemo, useState } from 'react';
import { Check, DoorOpen, Link2, MapPin, Plus, Trash2, Users, X } from 'lucide-react';
import type { Candidate, SessionRound } from './types';

type AllocationStrategy = 'BALANCED' | 'CAPACITY';
type ExamMode = 'IN_PERSON' | 'ONLINE';
type RoomDraft = { id: string; number: string; location: string; link: string; examLink: string };
export type SavedRoom = {
  id: string;
  commonName: string;
  number: string;
  label: string;
  mode: ExamMode;
  location: string;
  link: string;
  examLink: string;
  allocationStrategy: AllocationStrategy;
  capacity?: number | null;
  assignedCount: number;
  occurrenceId?: string;
};
type AllocationResponse = {
  roundName: string;
  candidateCount: number;
  assignedCount: number;
  rooms: SavedRoom[];
  updatedCandidates?: Candidate[];
  error?: string;
};
type Props = {
  sessionId: string;
  round: SessionRound;
  occurrenceId?: string;
  candidateCount: number;
  idToken?: string | null;
  onAllocated: (candidates: Candidate[], rooms: SavedRoom[]) => void;
};

const newRoom = (): RoomDraft => ({
  id: `room-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  number: '',
  location: '',
  link: '',
  examLink: '',
});

const authHeaders = (idToken?: string | null) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${idToken || ''}`,
});
const normalizeOnlineLink = (value: string) => {
  const link = value.trim();
  if (/^https?:\/\/\S+$/i.test(link)) return link;
  return /^(?:meet\.google\.com|(?:[a-z0-9-]+\.)?facebook\.com|(?:www\.)?(?:fb\.com|fb\.watch|m\.me))(?:\/|$)/i.test(link) ? `https://${link}` : link;
};

export default function ExamRoomAllocationDialog({ sessionId, round, occurrenceId, candidateCount, idToken, onAllocated }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [knownRoomCount, setKnownRoomCount] = useState(0);
  const [totalCandidates, setTotalCandidates] = useState(candidateCount);
  const [commonName, setCommonName] = useState('');
  const [mode, setMode] = useState<ExamMode>('IN_PERSON');
  const [strategy, setStrategy] = useState<AllocationStrategy>('BALANCED');
  const [maxCandidates, setMaxCandidates] = useState(20);
  const [rooms, setRooms] = useState<RoomDraft[]>([newRoom()]);

  const endpoint = `/api/examination/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(round.id)}/rooms${occurrenceId ? `?occurrenceId=${encodeURIComponent(occurrenceId)}` : ''}`;
  const capacity = strategy === 'CAPACITY' ? rooms.length * Math.max(0, maxCandidates) : null;
  const roomCounts = useMemo(() => rooms.map((_, index) => {
    if (!rooms.length) return 0;
    if (strategy === 'BALANCED') {
      const minimum = Math.floor(totalCandidates / rooms.length);
      return minimum + (index < totalCandidates % rooms.length ? 1 : 0);
    }
    return Math.max(0, Math.min(maxCandidates, totalCandidates - index * maxCandidates));
  }), [maxCandidates, rooms, strategy, totalCandidates]);
  const assignedPreview = roomCounts.reduce((sum, count) => sum + count, 0);
  const missingSeats = Math.max(0, totalCandidates - assignedPreview);

  const load = async () => {
    setOpen(true);
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(endpoint, { headers: authHeaders(idToken) });
      const body = await response.json() as AllocationResponse;
      if (!response.ok) throw new Error(body.error || 'Không thể tải cấu hình phòng thi.');
      setTotalCandidates(body.candidateCount);
      setKnownRoomCount(body.rooms.length);
      if (body.rooms.length) {
        const first = body.rooms[0];
        setCommonName(first.commonName);
        setMode(first.mode);
        setStrategy(first.allocationStrategy);
        setMaxCandidates(first.capacity || 20);
        setRooms(body.rooms.map(item => ({
          id: item.id,
          number: item.number,
          location: item.location,
          link: item.link,
          examLink: item.examLink,
        })));
      } else {
        setCommonName('');
        setMode('IN_PERSON');
        setStrategy('BALANCED');
        setMaxCandidates(20);
        setRooms([newRoom()]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải cấu hình phòng thi.');
    } finally {
      setLoading(false);
    }
  };

  const updateRoom = (id: string, field: keyof Omit<RoomDraft, 'id'>, value: string) => {
    setRooms(current => current.map(room => room.id === id ? { ...room, [field]: value } : room));
  };

  const setRoomCount = (nextCount: number) => {
    const targetCount = Math.min(200, Math.max(1, Math.trunc(nextCount) || 1));
    setRooms(current => {
      if (targetCount === current.length) return current;
      if (targetCount < current.length) return current.slice(0, targetCount);
      return [...current, ...Array.from({ length: targetCount - current.length }, () => newRoom())];
    });
  };

  const copyFirstLocation = () => {
    const location = rooms[0]?.location.trim();
    if (!location) {
      setError('Hãy nhập địa chỉ/số phòng ở dòng đầu tiên trước.');
      return;
    }
    setRooms(current => current.map(room => ({ ...room, location: room.location.trim() || location })));
    setError('');
  };

  const submit = async () => {
    setError('');
    if (!commonName.trim()) {
      setError('Vui lòng nhập tên gọi chung của phòng thi.');
      return;
    }
    if (!rooms.length || rooms.some(room => !room.number.trim())) {
      setError('Mỗi phòng cần có số hoặc mã phòng.');
      return;
    }
    if (mode === 'IN_PERSON' && rooms.some(room => !room.location.trim())) {
      setError('Mỗi phòng trực tiếp cần có địa chỉ/số phòng.');
      return;
    }
    const normalizedOnlineRooms = rooms.map(room => ({ ...room, link: normalizeOnlineLink(room.link), examLink: normalizeOnlineLink(room.examLink) }));
    if (mode === 'ONLINE' && normalizedOnlineRooms.some(room => !/^https?:\/\/\S+$/i.test(room.link))) {
      setError('Vui lòng nhập link hợp lệ. Link Google Meet/Facebook có thể dán không cần https://.');
      return;
    }
    if (normalizedOnlineRooms.some(room => room.examLink && !/^https?:\/\/\S+$/i.test(room.examLink))) {
      setError('Vui lòng nhập Link dự thi hợp lệ.');
      return;
    }
    if (strategy === 'CAPACITY' && maxCandidates <= 0) {
      setError('Số thí sinh tối đa mỗi phòng phải lớn hơn 0.');
      return;
    }
    if (strategy === 'CAPACITY' && missingSeats > 0) {
      setError(`Còn thiếu ${missingSeats} chỗ. Hãy thêm phòng hoặc tăng số thí sinh tối đa.`);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(idToken),
        body: JSON.stringify({
          occurrenceId: occurrenceId || '',
          commonName: commonName.trim(),
          mode,
          allocationStrategy: strategy,
          maxCandidates: strategy === 'CAPACITY' ? maxCandidates : null,
          rooms: rooms.map(room => ({
            number: room.number.trim(),
            location: room.location.trim(),
            link: normalizeOnlineLink(room.link),
            examLink: normalizeOnlineLink(room.examLink),
          })),
        }),
      });
      const body = await response.json() as AllocationResponse;
      if (!response.ok) throw new Error(body.error || 'Không thể phân phòng thi.');
      setKnownRoomCount(body.rooms.length);
      setTotalCandidates(body.candidateCount);
      onAllocated(body.updatedCandidates || [], body.rooms || []);
      setNotice(`Đã phân ${body.assignedCount} thí sinh vào ${body.rooms.length} phòng.`);
      setOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không thể phân phòng thi.');
    } finally {
      setSaving(false);
    }
  };

  return <>
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={load} className="inline-flex items-center gap-1 rounded-lg bg-[#aa3000] px-3 py-2 text-sm font-bold text-white hover:bg-[#8f2900]">
        <DoorOpen className="h-4 w-4"/>Tạo / phân phòng thi
        {knownRoomCount > 0 && <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">{knownRoomCount}</span>}
      </button>
      {notice && <span className="text-xs font-semibold text-emerald-700">{notice}</span>}
    </div>

    {open && <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="room-allocation-title">
      <div className="max-h-[94dvh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-white px-5 py-4 sm:px-7">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#aa3000]">{round.name}</p>
            <h2 id="room-allocation-title" className="mt-1 text-xl font-extrabold text-[#001e40] sm:text-2xl">Tạo / phân phòng thi</h2>
            <p className="mt-1 text-sm text-slate-500">Thông tin phân phòng sẽ được ghi vào Địa điểm/Phòng của từng thí sinh; Link dự thi được giữ riêng để làm bài.</p>
          </div>
          <button type="button" onClick={() => !saving && setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Đóng popup phân phòng"><X className="h-5 w-5"/></button>
        </header>

        <div className="space-y-6 p-5 sm:p-7">
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-[#001e40] p-4 text-white">
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-white/65"><Users className="h-4 w-4"/>Tổng thí sinh của vòng</div>
              <p className="mt-2 text-3xl font-extrabold">{totalCandidates.toLocaleString('vi-VN')}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-bold uppercase text-emerald-700">Dự kiến được phân</p>
              <p className="mt-2 text-3xl font-extrabold text-emerald-900">{assignedPreview.toLocaleString('vi-VN')}</p>
            </div>
            <div className={`rounded-xl border p-4 ${missingSeats ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
              <p className={`text-xs font-bold uppercase ${missingSeats ? 'text-rose-700' : 'text-slate-500'}`}>{missingSeats ? 'Còn thiếu chỗ' : 'Tổng số phòng'}</p>
              <p className={`mt-2 text-3xl font-extrabold ${missingSeats ? 'text-rose-900' : 'text-[#001e40]'}`}>{(missingSeats || rooms.length).toLocaleString('vi-VN')}</p>
            </div>
          </section>

          {knownRoomCount > 0 && <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">Vòng này đã có {knownRoomCount} phòng. Lưu lại sẽ phân lại toàn bộ {totalCandidates} thí sinh theo cấu hình mới.</div>}

          <section className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-sm font-bold text-[#001e40]">Tên gọi chung <span className="text-rose-600">*</span></span>
              <input value={commonName} onChange={event => setCommonName(event.target.value)} maxLength={255} placeholder="Ví dụ: Phòng thi SIMO" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-[#aa3000] focus:ring-4 focus:ring-orange-100"/>
              <span className="mt-1 block text-xs text-slate-500">Tên hiển thị sẽ là “Tên gọi chung + Số/mã phòng”.</span>
            </label>
            <fieldset>
              <legend className="mb-1.5 text-sm font-bold text-[#001e40]">Hình thức thi</legend>
              <div className="grid grid-cols-2 gap-2">
                {([['IN_PERSON', 'Trực tiếp', MapPin], ['ONLINE', 'Trực tuyến', Link2]] as const).map(([value, label, Icon]) => <button key={value} type="button" onClick={() => setMode(value)} className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-bold ${mode === value ? 'border-[#aa3000] bg-orange-50 text-[#8f2900]' : 'border-slate-300 text-slate-600'}`} aria-pressed={mode === value}><Icon className="h-4 w-4"/>{label}</button>)}
              </div>
            </fieldset>
          </section>

          <fieldset>
            <legend className="mb-2 text-sm font-bold text-[#001e40]">Cách chia thí sinh</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setStrategy('BALANCED')} className={`rounded-xl border p-4 text-left ${strategy === 'BALANCED' ? 'border-[#aa3000] bg-orange-50' : 'border-slate-200'}`} aria-pressed={strategy === 'BALANCED'}>
                <b className="text-[#001e40]">Chia đều giữa các phòng</b>
                <p className="mt-1 text-xs leading-5 text-slate-500">Số lượng giữa hai phòng bất kỳ chênh tối đa một thí sinh.</p>
              </button>
              <button type="button" onClick={() => setStrategy('CAPACITY')} className={`rounded-xl border p-4 text-left ${strategy === 'CAPACITY' ? 'border-[#aa3000] bg-orange-50' : 'border-slate-200'}`} aria-pressed={strategy === 'CAPACITY'}>
                <b className="text-[#001e40]">Giới hạn tối đa mỗi phòng</b>
                <p className="mt-1 text-xs leading-5 text-slate-500">Xếp đủ phòng theo thứ tự, không phòng nào vượt sức chứa đã đặt.</p>
              </button>
            </div>
            {strategy === 'BALANCED' && <label className="mt-3 block max-w-xs"><span className="mb-1 block text-sm font-bold">Số phòng cần tạo</span><input type="number" min={1} max={200} value={rooms.length} onChange={event => setRoomCount(Number(event.target.value))} className="w-full rounded-lg border border-slate-300 px-3 py-2.5"/><span className="mt-1 block text-xs text-slate-500">Hệ thống sẽ tạo đủ dòng phòng ở bên dưới và chia lệch tối đa 1 thí sinh/phòng.</span></label>}
            {strategy === 'CAPACITY' && <label className="mt-3 block max-w-xs"><span className="mb-1 block text-sm font-bold">Số thí sinh tối đa mỗi phòng</span><input type="number" min={1} max={10000} value={maxCandidates} onChange={event => setMaxCandidates(Math.max(0, Number(event.target.value) || 0))} className="w-full rounded-lg border border-slate-300 px-3 py-2.5"/><span className="mt-1 block text-xs text-slate-500">Tổng sức chứa hiện tại: {capacity?.toLocaleString('vi-VN')} chỗ.</span></label>}
          </fieldset>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="font-extrabold text-[#001e40]">Danh sách phòng</h3><p className="mt-1 text-xs text-slate-500">Thứ tự bên dưới cũng là thứ tự xếp phòng khi dùng giới hạn tối đa.</p></div>
              <div className="flex flex-wrap gap-2">
                {mode === 'IN_PERSON' && rooms.length > 1 && <button type="button" onClick={copyFirstLocation} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600">Dùng địa chỉ đầu cho phòng trống</button>}
                <button type="button" onClick={() => setRooms(current => [...current, newRoom()])} className="inline-flex items-center gap-1 rounded-lg border border-[#aa3000] px-3 py-2 text-xs font-bold text-[#aa3000]"><Plus className="h-4 w-4"/>Thêm phòng</button>
              </div>
            </div>
            <div className="space-y-3">
              {rooms.map((room, index) => <article key={room.id} className="grid gap-3 rounded-xl border bg-slate-50 p-4 sm:grid-cols-[130px_minmax(0,1fr)_minmax(0,1fr)_110px_auto] sm:items-end">
                <label><span className="mb-1 block text-xs font-bold text-slate-500">Số/mã phòng</span><input value={room.number} onChange={event => updateRoom(room.id, 'number', event.target.value)} maxLength={100} placeholder="101" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/></label>
                {mode === 'IN_PERSON'
                  ? <label><span className="mb-1 block text-xs font-bold text-slate-500">Địa chỉ / vị trí / số phòng</span><input value={room.location} onChange={event => updateRoom(room.id, 'location', event.target.value)} placeholder="Tầng 2, số 10 Trần Phú, Hà Nội" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/></label>
                  : <label><span className="mb-1 block text-xs font-bold text-slate-500">Link phòng trực tuyến</span><input type="url" value={room.link} onChange={event => updateRoom(room.id, 'link', event.target.value)} placeholder="meet.google.com/... hoặc facebook.com/..." className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/><span className="mt-1 block text-[11px] text-slate-500">Sẽ hiển thị cùng tên phòng trong Địa điểm/Phòng.</span></label>}
                <label><span className="mb-1 block text-xs font-bold text-slate-500">Link dự thi (nếu có)</span><input type="url" value={room.examLink} onChange={event => updateRoom(room.id, 'examLink', event.target.value)} placeholder="https://www.schoolconnectonline.com/..." className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/><span className="mt-1 block text-[11px] text-slate-500">Ghi riêng vào Link dự thi cho các thí sinh của phòng này.</span></label>
                <div><span className="mb-1 block text-xs font-bold text-slate-500">Dự kiến</span><div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-[#001e40]">{roomCounts[index] || 0} thí sinh</div></div>
                <button type="button" disabled={rooms.length === 1} onClick={() => setRooms(current => current.filter(item => item.id !== room.id))} className="inline-flex h-10 items-center justify-center rounded-lg border border-rose-200 px-3 text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-35" aria-label={`Xóa phòng ${index + 1}`}><Trash2 className="h-4 w-4"/></button>
              </article>)}
            </div>
          </section>

          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800" role="alert">{error}</div>}
          {loading && <div className="rounded-lg bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800" role="status">Đang tải cấu hình phòng hiện tại...</div>}
        </div>

        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
          <button type="button" disabled={saving} onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">Hủy</button>
          <button type="button" disabled={loading || saving || !rooms.length} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#aa3000] px-5 py-2.5 text-sm font-extrabold text-white hover:bg-[#8f2900] disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-4 w-4"/>{saving ? 'Đang phân phòng...' : knownRoomCount ? 'Phân lại và lưu' : 'Phân phòng và lưu'}</button>
        </footer>
      </div>
    </div>}
  </>;
}
