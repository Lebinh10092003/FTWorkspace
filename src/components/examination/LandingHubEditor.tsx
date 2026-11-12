import { useEffect, useMemo, useState } from 'react';
import { Eye, Save } from 'lucide-react';
import CompetitionHub from './CompetitionHub';
import { PublicPageButtons } from './LandingPageActions';
import type { LandingSite } from './LandingSiteView';
import { resolveHubContent, type HubContent } from './landingHubContent';

const groups: Array<{ title: string; fields: Array<[keyof HubContent, string, boolean?]> }> = [
  { title: 'Giới thiệu FermatTech', fields: [['eyebrow', 'Dòng nhãn đầu trang'], ['title', 'Tiêu đề dòng đầu'], ['emphasis', 'Tiêu đề nhấn mạnh'], ['intro', 'Giới thiệu ngắn về FT', true]] },
  { title: 'Các khung cuộc thi', fields: [['discoveryTitle', 'Tiêu đề khu vực cuộc thi'], ['fermatTitle', 'Khung FermatTech'], ['scoTitle', 'Khung SCO'], ['scoIntro', 'Giới thiệu SCO', true], ['aysbcTitle', 'Khung AYSBC'], ['aysbcIntro', 'Giới thiệu AYSBC', true], ['waicyTitle', 'Khung WAICY'], ['waicyIntro', 'Giới thiệu WAICY', true]] },
  { title: 'Đăng ký & liên hệ', fields: [['joinTitle', 'Tiêu đề cuối trang'], ['personalIntro', 'Hướng dẫn cá nhân', true], ['schoolIntro', 'Hướng dẫn nhà trường', true], ['individualUrl', 'Đường dẫn đăng ký cá nhân'], ['email', 'Email liên hệ'], ['phone', 'Điện thoại'], ['address', 'Địa chỉ']] },
];

export default function LandingHubEditor({ idToken, sites, onDirtyChange }: { idToken: string; sites: LandingSite[]; onDirtyChange?: (dirty: boolean) => void }) {
  const [content, setContent] = useState<HubContent | null>(null);
  const [saved, setSaved] = useState('');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const previewSites = useMemo(() => sites.filter(site => site.published), [sites]);
  useEffect(() => { onDirtyChange?.(!!content && JSON.stringify(content) !== saved); }, [content, saved, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/landing-hub', { headers: { Authorization: `Bearer ${idToken}` }, signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Không tải được trang tổng quan.'); return data; })
      .then(data => { const next = resolveHubContent(data.content); setContent(next); setSaved(JSON.stringify(next)); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [idToken]);
  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/landing-hub', { method: 'PUT', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không lưu được trang tổng quan.');
      const next = resolveHubContent(data.content); setContent(next); setSaved(JSON.stringify(next)); setMessage('Đã lưu nội dung trang tổng quan.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không lưu được trang.'); }
    finally { setSaving(false); }
  };

  return <section className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"><div className="mr-auto min-w-0"><h3 className="font-extrabold text-[#0B3B60]">Trang tổng quan các cuộc thi</h3><p className="mt-0.5 text-xs text-slate-500">Thẻ và popup từng cuộc thi lấy từ trang cuộc thi ở danh sách bên trái.</p></div><PublicPageButtons path="/cuoc-thi" published /><button type="button" disabled={!content} onClick={() => setPreview(value => !value)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Eye className="h-4 w-4" />{preview ? 'Chỉnh sửa' : 'Xem trước'}</button><button type="button" disabled={!content || saving} onClick={() => void save()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#0284C7] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Đang lưu…' : 'Lưu trang'}</button></div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">{message}</p>}
    {!content && !error && <p role="status" className="p-4">Đang tải nội dung…</p>}
    {content && (preview ? <div className="max-h-[780px] overflow-auto rounded-2xl border border-slate-200"><CompetitionHub preview overview={content} previewSites={previewSites} /></div> : <>
      {groups.map(group => <section key={group.title} className="rounded-2xl border border-slate-200 bg-white p-5"><h4 className="mb-4 font-bold text-[#0B3B60]">{group.title}</h4><div className="grid gap-4 sm:grid-cols-2">{group.fields.map(([key, label, multiline]) => <label key={key} className={`block ${multiline ? 'sm:col-span-2' : ''}`}><span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>{multiline ? <textarea rows={3} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" value={content[key]} onChange={event => setContent({ ...content, [key]: event.target.value })} /> : <input className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" value={content[key]} onChange={event => setContent({ ...content, [key]: event.target.value })} />}</label>)}</div></section>)}
    </>)}
  </section>;
}
