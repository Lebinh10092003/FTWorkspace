import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, Copy, Eye, Plus, Save, Trash2 } from 'lucide-react';
import { appDialog } from '../AppDialog';
import { CompetitionLandingView, type CompetitionLanding } from './CompetitionLandingPublic';
import LandingStudio from './LandingStudio';

type LandingSessions = CompetitionLanding['sessions'];
type LandingStats = CompetitionLanding['stats'];

type Block = Record<string, string>;
type LandingRow = {
  competitionId: string;
  competitionCode: string;
  competitionName: string;
  organizer: string;
  sessionCount: number;
  slug: string;
  published: boolean;
  tagline: string;
  heroDescription: string;
  heroImageUrl: string;
  aboutTitle: string;
  aboutBody: string;
  registrationUrl: string;
  registrationNote: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  highlights: Block[];
  prizes: Block[];
  faqs: Block[];
  organizers: Block[];
  updatedAt: string;
  updatedBy: string;
  sessions: LandingSessions;
  stats: LandingStats;
};

const BLOCK_SECTIONS: Array<{ field: 'highlights' | 'prizes' | 'faqs' | 'organizers'; label: string; keys: [string, string]; captions: [string, string] }> = [
  { field: 'highlights', label: 'Điểm nổi bật', keys: ['title', 'description'], captions: ['Tiêu đề', 'Mô tả'] },
  { field: 'prizes', label: 'Giải thưởng', keys: ['title', 'description'], captions: ['Tên giải', 'Nội dung giải'] },
  { field: 'faqs', label: 'Câu hỏi thường gặp', keys: ['question', 'answer'], captions: ['Câu hỏi', 'Trả lời'] },
  { field: 'organizers', label: 'Ban tổ chức', keys: ['name', 'role'], captions: ['Đơn vị', 'Vai trò'] },
];

const field = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-[#0055DA]';
const labelClass = 'mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500';

/** Bản xem trước dùng đúng thành phần của trang công khai, nên nội dung hiển thị
 *  trong Workspace luôn khớp với trang người dùng sẽ mở qua đường dẫn. */
export function previewPayload(row: LandingRow): CompetitionLanding {
  return {
    slug: row.slug,
    competition: { id: row.competitionId, code: row.competitionCode, name: row.competitionName, organizer: row.organizer },
    tagline: row.tagline,
    heroDescription: row.heroDescription,
    heroImageUrl: row.heroImageUrl,
    aboutTitle: row.aboutTitle,
    aboutBody: row.aboutBody,
    registrationUrl: row.registrationUrl,
    registrationNote: row.registrationNote,
    contact: { email: row.contactEmail, phone: row.contactPhone, address: row.contactAddress },
    highlights: row.highlights,
    prizes: row.prizes,
    faqs: row.faqs,
    organizers: row.organizers,
    sessions: row.sessions || [],
    stats: row.stats,
  };
}

export default function CompetitionLandingManager({ idToken }: { idToken: string }) {
  const [studio, setStudio] = useState(true);
  const [rows, setRows] = useState<LandingRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<LandingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch('/api/examination/landing-pages', { headers: { Authorization: `Bearer ${idToken}` } });
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) { setError(payload?.error || 'Không tải được danh sách cuộc thi.'); return; }
        const items: LandingRow[] = payload.items || [];
        setRows(items);
        setSelectedId(current => current || items[0]?.competitionId || '');
      } catch {
        if (active) setError('Không kết nối được máy chủ.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [idToken]);

  const selected = useMemo(() => rows.find(row => row.competitionId === selectedId) || null, [rows, selectedId]);
  useEffect(() => { setDraft(selected ? { ...selected } : null); setCopied(false); }, [selected]);

  const patch = (changes: Partial<LandingRow>) => setDraft(current => (current ? { ...current, ...changes } : current));
  const publicUrl = draft?.slug ? `${window.location.origin}/cuoc-thi/${draft.slug}` : '';

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/examination/landing-pages/${encodeURIComponent(draft.competitionId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Không lưu được trang giới thiệu.');
      setRows(current => current.map(row => (row.competitionId === payload.competitionId ? payload : row)));
      setDraft(payload);
    } catch (cause: any) {
      void appDialog.alert(cause.message, { title: 'Không lưu được', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  if (studio) return <div><button type="button" onClick={() => setStudio(false)} className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-[#0369A1]">Trang giới thiệu gắn với Khảo thí →</button><LandingStudio idToken={idToken} /></div>;
  if (loading) return <div className="py-16 text-center text-sm font-semibold text-slate-500">Đang tải cuộc thi từ mô-đun Khảo thí...</div>;
  if (error) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-semibold text-rose-700">{error}</div>;
  if (!rows.length) return <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">Chưa có cuộc thi nào trong mô-đun Khảo thí.</div>;

  if (preview && draft) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-bold text-amber-800">Bản xem trước — thay đổi chưa lưu vẫn hiển thị ở đây nhưng chưa có trên trang công khai.</p>
          <button type="button" onClick={() => setPreview(false)} className="ml-auto rounded-xl bg-white px-4 py-2 text-xs font-extrabold text-amber-800 ring-1 ring-amber-300">Đóng xem trước</button>
        </div>
        <div className="overflow-hidden rounded-3xl border border-slate-200">
          <CompetitionLandingView data={previewPayload(draft)} />
        </div>
      </div>
    );
  }

  return (
    <div><button type="button" onClick={() => setStudio(true)} className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-[#0369A1]">← Trình tạo Landing Page</button><div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Cuộc thi trong Khảo thí</p>
        {rows.map(row => (
          <button
            key={row.competitionId}
            type="button"
            onClick={() => setSelectedId(row.competitionId)}
            className={`w-full rounded-2xl border p-4 text-left transition ${row.competitionId === selectedId ? 'border-[#0055DA] bg-sky-50' : 'border-slate-200 bg-white hover:border-sky-300'}`}
          >
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#0055DA]">{row.competitionCode}</p>
            <p className="mt-1 text-sm font-extrabold text-[#001E40]">{row.competitionName}</p>
            <p className="mt-1 text-xs text-slate-500">{row.sessionCount} bảng thi</p>
            <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${row.published ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {row.published ? 'Đã công bố' : 'Chưa công bố'}
            </span>
          </button>
        ))}
      </aside>

      {draft && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={draft.published} onChange={event => patch({ published: event.target.checked })} className="h-4 w-4 accent-[#0055DA]" />
              Công bố trang
            </label>
            <button type="button" onClick={() => setPreview(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50">
              <Eye className="h-4 w-4" />Xem trước
            </button>
            {publicUrl && draft.published && (
              <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50">
                <ArrowUpRight className="h-4 w-4" />Mở trang công khai
              </a>
            )}
            <button type="button" onClick={() => void save()} disabled={saving} className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#0055DA] px-5 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-blue-200 disabled:opacity-60">
              <Save className="h-4 w-4" />{saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h3 className="text-base font-extrabold text-[#001E40]">Đường dẫn công khai</h3>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="min-w-[240px] flex-1">
                <span className={labelClass}>Slug</span>
                <input value={draft.slug} onChange={event => patch({ slug: event.target.value })} placeholder="vi-du-cuoc-thi" className={field} />
              </label>
              {publicUrl && (
                <button
                  type="button"
                  onClick={async () => { await navigator.clipboard.writeText(publicUrl); setCopied(true); }}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Đã sao chép' : 'Sao chép liên kết'}
                </button>
              )}
            </div>
            {publicUrl && <p className="mt-2 break-all text-xs font-semibold text-slate-500">{publicUrl}</p>}
            {!draft.published && <p className="mt-2 text-xs font-semibold text-amber-700">Trang chỉ mở được sau khi bật "Công bố trang" và lưu lại.</p>}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h3 className="text-base font-extrabold text-[#001E40]">Phần đầu trang</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label><span className={labelClass}>Khẩu hiệu</span><input value={draft.tagline} onChange={event => patch({ tagline: event.target.value })} className={field} /></label>
              <label><span className={labelClass}>Ảnh nền (URL)</span><input value={draft.heroImageUrl} onChange={event => patch({ heroImageUrl: event.target.value })} className={field} /></label>
              <label className="sm:col-span-2"><span className={labelClass}>Mô tả ngắn</span><textarea rows={3} value={draft.heroDescription} onChange={event => patch({ heroDescription: event.target.value })} className={field} /></label>
              <label><span className={labelClass}>Liên kết đăng ký</span><input value={draft.registrationUrl} onChange={event => patch({ registrationUrl: event.target.value })} className={field} /></label>
              <label><span className={labelClass}>Ghi chú đăng ký</span><input value={draft.registrationNote} onChange={event => patch({ registrationNote: event.target.value })} className={field} /></label>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h3 className="text-base font-extrabold text-[#001E40]">Giới thiệu</h3>
            <div className="mt-4 grid gap-4">
              <label><span className={labelClass}>Tiêu đề</span><input value={draft.aboutTitle} onChange={event => patch({ aboutTitle: event.target.value })} className={field} /></label>
              <label><span className={labelClass}>Nội dung (mỗi dòng là một đoạn)</span><textarea rows={5} value={draft.aboutBody} onChange={event => patch({ aboutBody: event.target.value })} className={field} /></label>
            </div>
          </section>

          {BLOCK_SECTIONS.map(section => {
            const blocks = draft[section.field];
            return (
              <section key={section.field} className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-extrabold text-[#001E40]">{section.label}</h3>
                  <button
                    type="button"
                    onClick={() => patch({ [section.field]: [...blocks, { [section.keys[0]]: '', [section.keys[1]]: '' }] } as Partial<LandingRow>)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-4 w-4" />Thêm
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {blocks.map((block, index) => (
                    <div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                      <input
                        value={block[section.keys[0]] || ''}
                        placeholder={section.captions[0]}
                        onChange={event => patch({ [section.field]: blocks.map((item, position) => position === index ? { ...item, [section.keys[0]]: event.target.value } : item) } as Partial<LandingRow>)}
                        className={field}
                      />
                      <textarea
                        rows={2}
                        value={block[section.keys[1]] || ''}
                        placeholder={section.captions[1]}
                        onChange={event => patch({ [section.field]: blocks.map((item, position) => position === index ? { ...item, [section.keys[1]]: event.target.value } : item) } as Partial<LandingRow>)}
                        className={field}
                      />
                      <button
                        type="button"
                        onClick={() => patch({ [section.field]: blocks.filter((_, position) => position !== index) } as Partial<LandingRow>)}
                        className="self-start rounded-xl border border-rose-200 p-2.5 text-rose-600 hover:bg-rose-50"
                        aria-label={`Xóa mục ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {blocks.length === 0 && <p className="text-sm text-slate-400">Chưa có mục nào. Phần này sẽ được ẩn trên trang công khai.</p>}
                </div>
              </section>
            );
          })}

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h3 className="text-base font-extrabold text-[#001E40]">Liên hệ</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label><span className={labelClass}>Email</span><input value={draft.contactEmail} onChange={event => patch({ contactEmail: event.target.value })} className={field} /></label>
              <label><span className={labelClass}>Điện thoại</span><input value={draft.contactPhone} onChange={event => patch({ contactPhone: event.target.value })} className={field} /></label>
              <label><span className={labelClass}>Địa chỉ</span><input value={draft.contactAddress} onChange={event => patch({ contactAddress: event.target.value })} className={field} /></label>
            </div>
          </section>

          {draft.updatedAt && (
            <p className="text-xs font-semibold text-slate-500">
              Cập nhật lần cuối: {new Date(draft.updatedAt).toLocaleString('vi-VN')}{draft.updatedBy ? ` · ${draft.updatedBy}` : ''}
            </p>
          )}
        </div>
      )}
    </div></div>
  );
}
