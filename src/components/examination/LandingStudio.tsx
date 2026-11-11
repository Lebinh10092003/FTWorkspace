import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, ExternalLink, Eye, EyeOff, Globe, Plus, Save, Trash2 } from 'lucide-react';
import { appDialog } from '../AppDialog';
import LandingSiteView, { type LandingContent, type LandingSite } from './LandingSiteView';
import { slugify } from '../../lib/searchText';
import LandingHubEditor from './LandingHubEditor';
import CompetitionIntroDialog from './CompetitionIntroDialog';
import { additionalPublicCompetition, withAdditionalCompetitions } from './additionalPublicCompetitions';
import { competitionOrder } from './competitionIdentity';
import { landingPresentation } from './landingPresentation';

type LandingTemplate = { key: string; name: string; description: string; layout: string; content: LandingContent; isSystem: boolean; updatedAt: string };

type Section = 'hero' | 'design' | 'overview' | 'papers' | 'resources' | 'timeline' | 'awards' | 'registration' | 'contact' | 'custom' | 'leads';
const sections: Array<[Section, string]> = [
  ['hero', 'Nhận diện & giới thiệu'], ['design', 'Màu sắc'], ['overview', 'Popup & chủ đề'], ['papers', 'Đề mẫu'], ['resources', 'Tài liệu & hồ sơ'],
  ['timeline', 'Lộ trình'], ['awards', 'Giải thưởng'], ['registration', 'Đăng ký'],
  ['contact', 'Liên hệ & mạng xã hội'], ['custom', 'Khối tự tạo'], ['leads', 'Yêu cầu tư vấn'],
];
const inputStyle = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#0284C7]';
const labelStyle = 'mb-1 block text-xs font-bold text-slate-500';
const urlFields = new Set(['url', 'logoUrl', 'schoolUrl', 'excelUrl', 'individualUrl', 'handbookUrl', 'zaloUrl', 'facebookFimoUrl', 'facebookFieoUrl', 'buttonUrl']);

function Field({ label, value, onChange, multiline = false, type }: { label: string; value?: string; onChange: (value: string) => void; multiline?: boolean; type?: string }) {
  return <label className="block min-w-0"><span className={labelStyle}>{label}</span>{multiline ? <textarea rows={3} value={value || ''} onChange={e => onChange(e.target.value)} className={inputStyle} /> : <input type={type || (urlFields.has(label) ? 'url' : 'text')} value={value || ''} onChange={e => onChange(e.target.value)} className={inputStyle} />}</label>;
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const toSlug = (value: string) => slugify(value);
export default function LandingStudio({ idToken }: { idToken: string }) {
  const [isHub, setIsHub] = useState(true);
  const [hubDirty, setHubDirty] = useState(false);
  const [sites, setSites] = useState<LandingSite[]>([]);
  const [templates, setTemplates] = useState<LandingTemplate[]>([]);
  const [draft, setDraft] = useState<LandingSite | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newPage, setNewPage] = useState({ title: '', slug: '', template: 'olympiad', subject: 'FIMO' });
  const [section, setSection] = useState<Section>('hero');
  const [popupPreview, setPopupPreview] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [leads, setLeads] = useState<Array<{ fullName: string; phone: string; email: string; schoolCity: string; message: string; createdAt: string }>>([]);
  const dirty = isHub ? hubDirty : !!draft && JSON.stringify(draft) !== JSON.stringify(sites.find(site => site.id === draft.id));
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty]);
  const selectPage = async (site: LandingSite | null) => {
    if ((site === null && isHub) || (site?.id === draft?.id && !isHub)) return;
    if (dirty && !(await appDialog.confirm('Nội dung đang sửa chưa được lưu. Chuyển trang và bỏ các thay đổi này?', { title: 'Chuyển trang', confirmText: 'Bỏ thay đổi' }))) return;
    setIsHub(!site); setHubDirty(false); setPreview(false); setSection('hero'); setSaveError(''); setSavedNote('');
    if (site) setDraft(copy(site));
  };

  useEffect(() => {
    let active = true;
    fetch('/api/landing-sites', { headers: { Authorization: `Bearer ${idToken}` } })
      .then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error || 'Không tải được trang.'); return p; })
      .then(p => { if (active) { const pages = withAdditionalCompetitions<LandingSite>(p.items || []); setSites(pages); setDraft(copy(pages[0] || null)); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [idToken]);

  useEffect(() => {
    let active = true;
    fetch('/api/landing-templates', { headers: { Authorization: `Bearer ${idToken}` } })
      .then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error || 'Không tải được mẫu.'); return p; })
      .then(p => { if (active) setTemplates(p.items || []); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [idToken]);

  useEffect(() => {
    if (!draft || draft.id < 0 || section !== 'leads') { setLeads([]); return; }
    fetch(`/api/landing-sites/${draft.id}/leads`, { headers: { Authorization: `Bearer ${idToken}` } })
      .then(r => r.json()).then(p => setLeads(p.items || [])).catch(() => setLeads([]));
  }, [draft?.id, section, idToken]);

  const setContent = (path: Array<string | number>, value: unknown) => setDraft(current => {
    if (!current) return current;
    const next = copy(current);
    let target: any = next.content;
    path.slice(0, -1).forEach((part, index) => { if (target[part] == null) target[part] = typeof path[index + 1] === 'number' ? [] : {}; target = target[part]; });
    target[path[path.length - 1]] = value;
    return next;
  });
  const setList = (key: keyof LandingContent, value: unknown) => setContent([key], value);
  const updateItem = (key: keyof LandingContent, index: number, patch: Record<string, string>) => {
    const list = copy((draft?.content[key] || []) as Array<Record<string, string>>);
    list[index] = { ...list[index], ...patch };
    setList(key, list);
  };
  const removeItem = (key: keyof LandingContent, index: number) => setList(key, ((draft?.content[key] || []) as unknown[]).filter((_, i) => i !== index));
  const moveItem = (key: keyof LandingContent, index: number, offset: number) => {
    const list = copy((draft?.content[key] || []) as unknown[]);
    const next = index + offset;
    if (next < 0 || next >= list.length) return;
    [list[index], list[next]] = [list[next], list[index]];
    setList(key, list);
  };
  const identity = draft ? landingPresentation(draft) : null;
  const paperSubjects = draft?.content.paperSubjects || Object.keys(draft?.content.papers || {});
  const create = async (duplicate = false) => {
    const title = duplicate && draft ? `${draft.title} (bản sao)` : newPage.title.trim();
    const slug = duplicate && draft ? `${draft.slug}-copy-${Date.now().toString(36)}` : newPage.slug.trim();
    if (!title || !slug) { void appDialog.alert('Nhập tên trang và đường dẫn trước khi tạo.'); return; }
    const template = duplicate && draft && templates.some(item => item.key === draft.template) ? draft.template : newPage.template;
    const starter = sites.find(item => item.content.subject === newPage.subject) || additionalPublicCompetition(newPage.subject.toLowerCase());
    const payload = duplicate && draft
      ? { title, slug, template, content: draft.content }
      : { title, slug, template, subject: newPage.subject, ...(starter ? { content: copy(starter.content) } : {}) };
    try {
      const r = await fetch('/api/landing-sites', { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || 'Không tạo được trang.');
      setSites(current => withAdditionalCompetitions<LandingSite>([...current.filter(item => item.id > 0), p])); setIsHub(false); setDraft(copy(p)); setSection('hero'); setPreview(false); setCreateOpen(false);
    } catch (e) { void appDialog.alert(e instanceof Error ? e.message : 'Không tạo được trang.'); }
  };
  const saveAsTemplate = async () => {
    if (!draft) return;
    const name = await appDialog.prompt('Đặt tên mẫu mới từ trang hiện tại.', { title: 'Lưu thành mẫu landing page', defaultValue: `${draft.title} · Mẫu` });
    if (!name?.trim()) return;
    try {
      const r = await fetch('/api/landing-templates', { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), content: draft.content }) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || 'Không lưu được mẫu.');
      setTemplates(current => [...current, p]);
      void appDialog.alert('Đã lưu mẫu. Bạn có thể chọn mẫu này khi tạo trang mới.');
    } catch (e) { void appDialog.alert(e instanceof Error ? e.message : 'Không lưu được mẫu.'); }
  };
  const updateTemplate = async () => {
    if (!draft) return;
    const template = templates.find(item => item.key === draft.template);
    if (!template || template.isSystem) return;
    if (!(await appDialog.confirm(`Cập nhật "${template.name}" bằng nội dung đang sửa? Các trang đã tạo sẽ giữ nguyên.`, { title: 'Cập nhật mẫu' }))) return;
    try {
      const r = await fetch(`/api/landing-templates/${template.key}`, { method: 'PUT', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: template.name, description: template.description, content: draft.content }) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || 'Không cập nhật được mẫu.');
      setTemplates(current => current.map(item => item.key === p.key ? p : item));
      void appDialog.alert('Mẫu đã được cập nhật cho các trang tạo sau này.');
    } catch (e) { void appDialog.alert(e instanceof Error ? e.message : 'Không cập nhật được mẫu.'); }
  };
  /** Lưu trang; truyền `publish` để vừa đổi trạng thái công bố vừa lưu trong một
   *  thao tác, vì công bố mà không lưu thì URL công khai vẫn chưa đổi. */
  const save = async (publish?: boolean) => {
    if (!draft) return false;
    const next = publish === undefined ? draft : { ...draft, published: publish };
    setSaving(true);
    setSaveError('');
    setSavedNote('');
    try {
      const isDefault = next.id < 0;
      const payload = isDefault ? { ...next, template: 'olympiad' } : next;
      const r = await fetch(isDefault ? '/api/landing-sites' : `/api/landing-sites/${next.id}`, { method: isDefault ? 'POST' : 'PUT', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(p.error || 'Không lưu được trang.');
      setSites(current => current.map(item => item.id === next.id ? p : item));
      setDraft(copy(p));
      setSavedNote(p.published ? 'Đã lưu và trang đang công khai.' : 'Đã lưu. Trang vẫn ở chế độ bản nháp.');
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Không lưu được trang.');
      return false;
    } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!draft || !(await appDialog.confirm(`Xóa trang "${draft.title}"?`, { title: 'Xóa landing page', tone: 'danger' }))) return;
    const r = await fetch(`/api/landing-sites/${draft.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` } });
    if (!r.ok) { void appDialog.alert('Không xóa được trang.'); return; }
    const remaining = withAdditionalCompetitions<LandingSite>(sites.filter(item => item.id > 0 && item.id !== draft.id));
    setSites(remaining); setDraft(copy(remaining[0] || null));
  };
  if (error) return <div className="rounded-xl bg-rose-50 p-5 text-rose-700">{error}</div>;

  return <div className="space-y-5">
    {popupPreview && draft && <CompetitionIntroDialog site={draft} onClose={() => setPopupPreview(false)} />}
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4"><div className="mr-auto"><h2 className="text-lg font-extrabold text-[#0B3B60]">Trình tạo Landing Page</h2><p className="text-xs text-slate-600">Quản lý trang tổng quan, popup giới thiệu và landing page của từng cuộc thi.</p></div><a href="/examination/registration-forms" className="rounded-xl border border-sky-200 bg-white px-4 py-2.5 text-xs font-bold text-sky-800">Trang đăng ký dự thi</a><button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#0284C7] px-4 py-2.5 text-xs font-bold text-white"><Plus className="h-4 w-4" />Tạo trang mới</button></div>
    {createOpen && <div className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="text-base font-extrabold text-[#0B3B60]">Tạo trang từ mẫu</h3><p className="text-xs text-slate-500">Nội dung mẫu được sao chép vào trang mới. Chỉnh sửa trang sau này không làm đổi mẫu.</p></div><button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Đóng</button></div><div className="mb-4 grid gap-3 sm:grid-cols-2">{templates.map(item => <button type="button" key={item.key} onClick={() => setNewPage(current => ({ ...current, template: item.key }))} className={`rounded-xl border p-4 text-left ${newPage.template === item.key ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:border-sky-300'}`}><strong className="block text-sm text-[#0B3B60]">{item.name}</strong><span className="mt-1 block text-xs text-slate-500">{item.description || 'Mẫu landing page tùy chỉnh'}</span></button>)}</div><div className="grid gap-3 sm:grid-cols-3"><Field label="Tên trang" value={newPage.title} onChange={title => setNewPage(current => ({ ...current, title, slug: current.slug && current.slug !== toSlug(current.title) ? current.slug : toSlug(title) }))} /><Field label="Đường dẫn (slug)" value={newPage.slug} onChange={slug => setNewPage(current => ({ ...current, slug }))} /><label className="block"><span className={labelStyle}>Nội dung bắt đầu</span><select value={newPage.subject} onChange={event => setNewPage(current => ({ ...current, subject: event.target.value }))} className={inputStyle}>{competitionOrder.map(code => <option key={code} value={code}>{code}</option>)}</select></label></div><button type="button" onClick={() => void create()} className="mt-4 rounded-xl bg-[#0284C7] px-5 py-2.5 text-xs font-bold text-white">Tạo và chỉnh sửa trang</button></div>}
    <div className="grid gap-5 xl:grid-cols-[230px_minmax(0,1fr)]"><aside className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3"><p className="px-2 pb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Trang của bạn</p><button type="button" onClick={() => void selectPage(null)} className={`mb-3 w-full rounded-xl border px-3 py-4 text-left ${isHub ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 hover:bg-slate-50'}`}><strong className="block text-sm">Trang tổng quan</strong><span className="mt-1 block text-xs text-slate-500">Giới thiệu FT & các khung cuộc thi</span><span className="mt-1 block text-xs text-slate-500">/cuoc-thi</span></button>{sites.map(item => <button key={item.id} onClick={() => void selectPage(item)} className={`w-full rounded-xl px-3 py-3 text-left ${!isHub && draft?.id === item.id ? 'bg-sky-50 text-[#0369A1]' : 'hover:bg-slate-50'}`}><strong className="block truncate text-sm">{item.title}</strong><span className="mt-1 block text-xs text-slate-500">{item.content.subject || 'Cuộc thi'}{item.id < 0 ? ' · Nội dung mặc định' : ''}</span><span className="mt-1 block text-xs text-slate-500">/cuoc-thi/{item.slug} · {item.published ? 'Công khai' : 'Bản nháp'}</span></button>)}</aside>
      {isHub ? <LandingHubEditor idToken={idToken} sites={sites} onDirtyChange={setHubDirty} /> : draft && <div className="min-w-0 space-y-4"><div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3"><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-extrabold ${draft.published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}><span aria-hidden="true" className={`h-2 w-2 rounded-full ${draft.published ? 'bg-emerald-500' : 'bg-slate-400'}`} />{draft.published ? 'Đang công khai' : 'Bản nháp'}</span><button type="button" disabled={saving} onClick={() => void save(!draft.published)} className={`mr-auto inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50 ${draft.published ? 'border border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>{draft.published ? <><EyeOff className="h-4 w-4" />Gỡ công bố</> : <><Globe className="h-4 w-4" />Công bố trang</>}</button><button onClick={() => setPreview(!preview)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Eye className="h-4 w-4" />{preview ? 'Chỉnh sửa' : 'Xem trước'}</button><button onClick={() => void create(true)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Copy className="h-4 w-4" />Nhân bản</button><button onClick={() => void saveAsTemplate()} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Plus className="h-4 w-4" />Lưu thành mẫu mới</button>{templates.some(item => item.key === draft.template && !item.isSystem) && <button onClick={() => void updateTemplate()} className="rounded-lg border px-3 py-2 text-xs font-bold">Cập nhật mẫu</button>}<button disabled={draft.id < 0} onClick={() => void remove()} className="rounded-lg border border-rose-200 p-2 text-rose-600" aria-label="Xóa trang"><Trash2 className="h-4 w-4" /></button><button disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-1 rounded-lg bg-[#0284C7] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Đang lưu' : 'Lưu trang'}</button></div>
        {saveError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{saveError}</p>}
        {savedNote && !saveError && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{savedNote}</p>}
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2"><Field label="Tên trang" value={draft.title} onChange={title => setDraft({ ...draft, title })} /><Field label="Đường dẫn (slug)" value={draft.slug} onChange={slug => setDraft({ ...draft, slug })} /><div className="sm:col-span-2"><a href={`/cuoc-thi/${draft.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-xs font-bold text-[#0284C7]">{window.location.origin}/cuoc-thi/{draft.slug}<ExternalLink className="h-3 w-3" /></a>{!draft.published && <p className="mt-1 text-xs text-amber-700">Trang đang là bản nháp nên URL công khai chưa mở. Bấm “Công bố trang” ở trên để đăng ngay.</p>}</div></div>
        {preview ? <div className="max-h-[780px] overflow-auto rounded-2xl border border-slate-200"><LandingSiteView site={draft} preview /></div> : <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]"><nav className="space-y-1 rounded-2xl border border-slate-200 bg-white p-2">{sections.map(([id, label]) => <button key={id} onClick={() => setSection(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-xs font-bold ${section === id ? 'bg-sky-50 text-[#0369A1]' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}</nav><div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5"><h3 className="mb-5 text-base font-extrabold text-[#0B3B60]">{sections.find(item => item[0] === section)?.[1]}</h3>
          {section === 'hero' && identity && <div className="grid gap-4 sm:grid-cols-2">
            <label><span className={labelStyle}>Mã cuộc thi</span><input value={draft.content.subject || ''} onChange={event => setContent(['subject'], event.target.value.toUpperCase())} className={inputStyle} list="landing-subjects" /><datalist id="landing-subjects">{competitionOrder.map(code => <option key={code} value={code} />)}</datalist></label>
            <Field label="Mùa thi / năm học" value={draft.content.season} onChange={value => setContent(['season'], value)} />
            <div className="sm:col-span-2"><Field label="Tên cuộc thi hiển thị" value={identity.name} onChange={value => setContent(['display', 'name'], value)} /></div>
            <Field label="Lĩnh vực / tên trên thẻ" value={identity.area} onChange={value => setContent(['display', 'area'], value)} />
            <Field label="Đối tượng tham gia" value={identity.audience} onChange={value => setContent(['display', 'audience'], value)} />
            <div className="sm:col-span-2"><Field label="URL logo" value={identity.logo} onChange={value => setContent(['logoUrl'], value)} /></div>
            <div className="sm:col-span-2"><Field label="Giới thiệu ngắn (popup & trang chi tiết)" multiline value={draft.content.intro} onChange={value => setContent(['intro'], value)} /></div>
          </div>}
          {section === 'design' && identity && <div className="space-y-5"><p className="text-sm leading-6 text-slate-600">Màu nhấn dùng thống nhất cho thẻ cuộc thi, popup và trang chi tiết. Nền pastel tự phối từ màu nhấn; bố cục và cỡ chữ co giãn theo màn hình.</p><label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm font-bold">Màu nhấn <input aria-label="Màu nhấn" type="color" value={identity.accent} onChange={event => setContent(['style', 'accentColor'], event.target.value)} className="h-10 w-14 cursor-pointer" /><span>{identity.accent}</span></label><div className="rounded-xl border p-5" style={{ background: identity.tint, color: identity.accent }}><strong>{identity.code}</strong><p className="mt-2 text-sm">{identity.name}</p></div></div>}
          {section === 'overview' && identity && <div className="space-y-4"><p className="text-sm leading-6 text-slate-600">Các nội dung này hiển thị trong popup trên trang tổng quan và phần “Nội dung khám phá” của trang chi tiết.</p><Field label="Dòng chủ đề khi di chuột trên thẻ" multiline value={identity.hoverSummary} onChange={value => setContent(['display', 'hoverSummary'], value)} /><Field label="Giới thiệu mở rộng" multiline value={identity.context} onChange={value => setContent(['display', 'context'], value)} /><Field label="Chủ đề khám phá (mỗi dòng một chủ đề)" multiline value={identity.topics.join('\n')} onChange={value => setContent(['display', 'topics'], value.split('\n'))} /><button type="button" onClick={() => setPopupPreview(true)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Xem trước popup</button></div>}
          {section === 'papers' && <div className="space-y-4"><ListHeading title="Các môn thi" onAdd={() => setContent(['paperSubjects'], [...paperSubjects, `Môn mới ${paperSubjects.length + 1}`])} />{paperSubjects.map((name, index) => <Item key={index} onRemove={() => setContent(['paperSubjects'], paperSubjects.filter((_, i) => i !== index))}><Field label="Tên môn" value={name} onChange={value => { const names = [...paperSubjects]; names[index] = value; setContent(['paperSubjects'], names); if (value && value !== name) setContent(['papers', value], draft.content.papers?.[name] || {}); }} /><div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">{Array.from({ length: (identity?.profile?.maxGrade || 12) - (identity?.profile?.minGrade || 1) + 1 }, (_, i) => i + (identity?.profile?.minGrade || 1)).map(grade => <Field key={grade} label={`URL PDF lớp ${grade}`} value={draft.content.papers?.[name]?.[String(grade)]} onChange={value => setContent(['papers', name, String(grade)], value)} />)}</div></Item>)}<p className="text-xs text-slate-500">Chỉ thêm đề mẫu đã công bố và có thể đọc công khai.</p></div>}
          {section === 'resources' && <div className="space-y-3"><p className="text-sm text-slate-600">Liên kết đến thể lệ, hồ sơ tổ chức và học liệu có thể xem công khai.</p><ListHeading title="Tài liệu trên landing page" onAdd={() => setList('resources', [...(draft.content.resources || []), { category: '', title: '', body: '', url: '' }])} />{(draft.content.resources || []).map((item, i) => <Item key={i} onRemove={() => removeItem('resources', i)}><Field label="Nhóm tài liệu" value={item.category} onChange={v => updateItem('resources', i, { category: v })} /><Field label="Tiêu đề" value={item.title} onChange={v => updateItem('resources', i, { title: v })} /><div className="sm:col-span-2"><Field label="Mô tả" multiline value={item.body} onChange={v => updateItem('resources', i, { body: v })} /></div><div className="sm:col-span-2"><Field label="URL tài liệu" value={item.url} onChange={v => updateItem('resources', i, { url: v })} /></div></Item>)}</div>}
          {section === 'timeline' && <div className="space-y-3"><ListHeading title="Các mốc thi" onAdd={() => setList('timeline', [...(draft.content.timeline || []), { title: '', date: '', mode: '' }])} />{(draft.content.timeline || []).map((item, i) => <Item key={i} onRemove={() => removeItem('timeline', i)}><Field label="Tên vòng" value={item.title} onChange={v => updateItem('timeline', i, { title: v })} /><Field label="Ngày bắt đầu" type="date" value={item.date} onChange={v => updateItem('timeline', i, { date: v })} /><Field label="Ngày kết thúc (nếu có)" type="date" value={item.endDate} onChange={v => updateItem('timeline', i, { endDate: v })} /><div className="sm:col-span-2"><Field label="Hình thức" value={item.mode} onChange={v => updateItem('timeline', i, { mode: v })} /></div></Item>)}</div>}
          {section === 'awards' && <div className="space-y-3"><ListHeading title="Các hạng giải" onAdd={() => setList('awards', [...(draft.content.awards || []), { title: '', percent: '', description: '' }])} />{(draft.content.awards || []).map((item, i) => <Item key={i} onRemove={() => removeItem('awards', i)}><Field label="Tên giải" value={item.title} onChange={v => updateItem('awards', i, { title: v })} /><Field label="Tỷ lệ (%)" value={item.percent} onChange={v => updateItem('awards', i, { percent: v })} /><div className="sm:col-span-2"><Field label="Mô tả" value={item.description} onChange={v => updateItem('awards', i, { description: v })} /></div></Item>)}</div>}
          {section === 'registration' && <div className="grid gap-3 sm:grid-cols-2">{([['schoolUrl', 'URL đăng ký trường'], ['excelUrl', 'URL Excel Phụ lục 4'], ['individualUrl', 'URL form cá nhân'], ['handbookUrl', 'URL cẩm nang']] as const).map(([key, label]) => <Field key={key} label={label} value={draft.content.registration?.[key]} onChange={v => setContent(['registration', key], v)} />)}</div>}
          {section === 'contact' && <div className="grid gap-3 sm:grid-cols-2">{([['phone', 'Hotline'], ['email', 'Email'], ['address', 'Địa chỉ'], ['zaloUrl', 'URL Zalo OA'], ['facebookFimoUrl', 'URL Facebook FIMO'], ['facebookFieoUrl', 'URL Facebook FIEO']] as const).map(([key, label]) => <Field key={key} label={label} value={draft.content.contact?.[key]} onChange={v => setContent(['contact', key], v)} />)}</div>}
          {section === 'custom' && <div className="space-y-3"><ListHeading title="Khối nội dung tự tạo" onAdd={() => setList('customSections', [...(draft.content.customSections || []), { title: 'Tiêu đề mới', body: '', buttonLabel: '', buttonUrl: '' }])} />{(draft.content.customSections || []).map((item, i) => <div key={i}><div className="mb-1 flex justify-end gap-1"><button title="Chuyển lên" onClick={() => moveItem('customSections', i, -1)} className="rounded border p-1"><ArrowUp className="h-3 w-3" /></button><button title="Chuyển xuống" onClick={() => moveItem('customSections', i, 1)} className="rounded border p-1"><ArrowDown className="h-3 w-3" /></button></div><Item onRemove={() => removeItem('customSections', i)}><Field label="Tiêu đề" value={item.title} onChange={v => updateItem('customSections', i, { title: v })} /><Field label="Tên nút" value={item.buttonLabel} onChange={v => updateItem('customSections', i, { buttonLabel: v })} /><div className="sm:col-span-2"><Field label="Nội dung" multiline value={item.body} onChange={v => updateItem('customSections', i, { body: v })} /></div><div className="sm:col-span-2"><Field label="URL nút" value={item.buttonUrl} onChange={v => updateItem('customSections', i, { buttonUrl: v })} /></div></Item></div>)}</div>}
          {section === 'leads' && <div className="space-y-3">{leads.length ? leads.map((lead, i) => <div key={i} className="rounded-xl border border-slate-200 p-4 text-sm"><strong>{lead.fullName}</strong><span className="ml-2 text-xs text-slate-400">{new Date(lead.createdAt).toLocaleString('vi-VN')}</span><p className="mt-1">{lead.phone} · {lead.email} · {lead.schoolCity}</p><p className="mt-2 text-slate-600">{lead.message}</p></div>) : <p className="text-sm text-slate-500">Chưa có yêu cầu tư vấn.</p>}</div>}
        </div></div>}
      </div>}</div>
  </div>;
}

function ListHeading({ title, onAdd }: { title: string; onAdd: () => void }) { return <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-bold">{title}</h4><button type="button" onClick={onAdd} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold"><Plus className="h-3 w-3" />Thêm</button></div>; }
function Item({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) { return <div className="relative grid gap-3 rounded-xl border border-slate-200 p-4 pr-12 sm:grid-cols-2"><button type="button" onClick={onRemove} aria-label="Xóa khối" className="absolute right-3 top-3 text-rose-500"><Trash2 className="h-4 w-4" /></button>{children}</div>; }
