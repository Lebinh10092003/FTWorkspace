import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, ExternalLink, Eye, EyeOff, Globe, Plus, Save, Trash2 } from 'lucide-react';
import { appDialog } from '../AppDialog';
import LandingSiteView, { type LandingContent, type LandingSite } from './LandingSiteView';

type LandingTemplate = { key: string; name: string; description: string; layout: string; content: LandingContent; isSystem: boolean; updatedAt: string };

type Section = 'hero' | 'design' | 'overview' | 'papers' | 'timeline' | 'awards' | 'registration' | 'contact' | 'custom' | 'leads';
const sections: Array<[Section, string]> = [
  ['hero', 'Đầu trang & nút'], ['design', 'Kiểu chữ & nút'], ['overview', 'Giới thiệu'], ['papers', 'Đề mẫu'],
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
const toSlug = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export default function LandingStudio({ idToken }: { idToken: string }) {
  const [sites, setSites] = useState<LandingSite[]>([]);
  const [templates, setTemplates] = useState<LandingTemplate[]>([]);
  const [draft, setDraft] = useState<LandingSite | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newPage, setNewPage] = useState({ title: '', slug: '', template: 'olympiad', subject: 'FIMO' });
  const [section, setSection] = useState<Section>('hero');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [leads, setLeads] = useState<Array<{ fullName: string; phone: string; email: string; schoolCity: string; message: string; createdAt: string }>>([]);

  useEffect(() => {
    let active = true;
    fetch('/api/landing-sites', { headers: { Authorization: `Bearer ${idToken}` } })
      .then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error || 'Không tải được trang.'); return p; })
      .then(p => { if (active) { setSites(p.items || []); setDraft(copy((p.items || [])[0] || null)); } })
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
    if (!draft || section !== 'leads') return;
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
  const isSiaio = draft?.content.subject === 'SIAIO' || draft?.layout === 'siaio';
  const paperSubjects = draft?.content.paperSubjects || [];
  const create = async (duplicate = false) => {
    const title = duplicate && draft ? `${draft.title} (bản sao)` : newPage.title.trim();
    const slug = duplicate && draft ? `${draft.slug}-copy-${Date.now().toString(36)}` : newPage.slug.trim();
    if (!title || !slug) { void appDialog.alert('Nhập tên trang và đường dẫn trước khi tạo.'); return; }
    const template = duplicate && draft ? draft.template : newPage.template;
    const payload = duplicate && draft
      ? { title, slug, template, content: draft.content }
      : { title, slug, template, subject: newPage.subject };
    try {
      const r = await fetch('/api/landing-sites', { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || 'Không tạo được trang.');
      setSites(current => [...current, p]); setDraft(copy(p)); setSection('hero'); setPreview(false); setCreateOpen(false);
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
      const r = await fetch(`/api/landing-sites/${next.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(p.error || 'Không lưu được trang.');
      setSites(current => current.map(item => item.id === p.id ? p : item));
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
    const remaining = sites.filter(item => item.id !== draft.id);
    setSites(remaining); setDraft(copy(remaining[0] || null));
  };
  if (error) return <div className="rounded-xl bg-rose-50 p-5 text-rose-700">{error}</div>;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4"><div className="mr-auto"><h2 className="text-lg font-extrabold text-[#0B3B60]">Trình tạo Landing Page</h2><p className="text-xs text-slate-600">Chọn mẫu, tạo trang, sửa từng khối, xem trước và công bố. Mọi nút đều có ô gắn link riêng.</p></div><button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#0284C7] px-4 py-2.5 text-xs font-bold text-white"><Plus className="h-4 w-4" />Tạo trang mới</button></div>
    {createOpen && <div className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="text-base font-extrabold text-[#0B3B60]">Tạo trang từ mẫu</h3><p className="text-xs text-slate-500">Nội dung mẫu được sao chép vào trang mới. Chỉnh sửa trang sau này không làm đổi mẫu.</p></div><button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Đóng</button></div><div className="mb-4 grid gap-3 sm:grid-cols-2">{templates.map(item => <button type="button" key={item.key} onClick={() => setNewPage(current => ({ ...current, template: item.key }))} className={`rounded-xl border p-4 text-left ${newPage.template === item.key ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:border-sky-300'}`}><strong className="block text-sm text-[#0B3B60]">{item.name}</strong><span className="mt-1 block text-xs text-slate-500">{item.description || 'Mẫu landing page tùy chỉnh'}</span></button>)}</div><div className="grid gap-3 sm:grid-cols-3"><Field label="Tên trang" value={newPage.title} onChange={title => setNewPage(current => ({ ...current, title, slug: current.slug && current.slug !== toSlug(current.title) ? current.slug : toSlug(title) }))} /><Field label="Đường dẫn (slug)" value={newPage.slug} onChange={slug => setNewPage(current => ({ ...current, slug }))} /><label className="block"><span className={labelStyle}>Nội dung bắt đầu</span><select value={newPage.template === 'siaio' ? 'SIAIO' : newPage.subject} disabled={newPage.template !== 'olympiad'} onChange={event => setNewPage(current => ({ ...current, subject: event.target.value }))} className={inputStyle}><option value="FIMO">FIMO · Toán</option><option value="FIEO">FIEO · Tiếng Anh</option><option value="SIAIO">SIAIO · Trí tuệ nhân tạo</option></select></label></div><button type="button" onClick={() => void create()} className="mt-4 rounded-xl bg-[#0284C7] px-5 py-2.5 text-xs font-bold text-white">Tạo và chỉnh sửa trang</button></div>}
    <div className="grid gap-5 xl:grid-cols-[230px_minmax(0,1fr)]"><aside className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3"><p className="px-2 pb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Trang của bạn</p>{sites.map(item => <button key={item.id} onClick={() => { setDraft(copy(item)); setPreview(false); setSection('hero'); }} className={`w-full rounded-xl px-3 py-3 text-left ${draft?.id === item.id ? 'bg-sky-50 text-[#0369A1]' : 'hover:bg-slate-50'}`}><strong className="block truncate text-sm">{item.title}</strong><span className="mt-1 block text-xs text-slate-500">{templates.find(template => template.key === item.template)?.name || 'Mẫu 1 · Olympic học thuật'}</span><span className="mt-1 block text-xs text-slate-500">/cuoc-thi/{item.slug} · {item.published ? 'Công khai' : 'Bản nháp'}</span></button>)}</aside>
      {draft && <div className="min-w-0 space-y-4"><div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3"><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-extrabold ${draft.published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}><span aria-hidden="true" className={`h-2 w-2 rounded-full ${draft.published ? 'bg-emerald-500' : 'bg-slate-400'}`} />{draft.published ? 'Đang công khai' : 'Bản nháp'}</span><button type="button" disabled={saving} onClick={() => void save(!draft.published)} className={`mr-auto inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50 ${draft.published ? 'border border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>{draft.published ? <><EyeOff className="h-4 w-4" />Gỡ công bố</> : <><Globe className="h-4 w-4" />Công bố trang</>}</button><button onClick={() => setPreview(!preview)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Eye className="h-4 w-4" />{preview ? 'Chỉnh sửa' : 'Xem trước'}</button><button onClick={() => void create(true)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Copy className="h-4 w-4" />Nhân bản</button><button onClick={() => void saveAsTemplate()} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Plus className="h-4 w-4" />Lưu thành mẫu mới</button>{templates.some(item => item.key === draft.template && !item.isSystem) && <button onClick={() => void updateTemplate()} className="rounded-lg border px-3 py-2 text-xs font-bold">Cập nhật mẫu</button>}<button onClick={() => void remove()} className="rounded-lg border border-rose-200 p-2 text-rose-600" aria-label="Xóa trang"><Trash2 className="h-4 w-4" /></button><button disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-1 rounded-lg bg-[#0284C7] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Đang lưu' : 'Lưu trang'}</button></div>
        {saveError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{saveError}</p>}
        {savedNote && !saveError && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{savedNote}</p>}
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2"><Field label="Tên trang" value={draft.title} onChange={title => setDraft({ ...draft, title })} /><Field label="Đường dẫn (slug)" value={draft.slug} onChange={slug => setDraft({ ...draft, slug })} /><div className="sm:col-span-2"><a href={`/cuoc-thi/${draft.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-xs font-bold text-[#0284C7]">{window.location.origin}/cuoc-thi/{draft.slug}<ExternalLink className="h-3 w-3" /></a>{!draft.published && <p className="mt-1 text-xs text-amber-700">Trang đang là bản nháp nên URL công khai chưa mở. Bấm “Công bố trang” ở trên để đăng ngay.</p>}</div></div>
        {preview ? <div className="max-h-[780px] overflow-auto rounded-2xl border border-slate-200"><LandingSiteView site={draft} preview /></div> : <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]"><nav className="space-y-1 rounded-2xl border border-slate-200 bg-white p-2">{sections.map(([id, label]) => <button key={id} onClick={() => setSection(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-xs font-bold ${section === id ? 'bg-sky-50 text-[#0369A1]' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}</nav><div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5"><h3 className="mb-5 text-base font-extrabold text-[#0B3B60]">{sections.find(item => item[0] === section)?.[1]}</h3>
          {section === 'hero' && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><label><span className={labelStyle}>Chủ đề trang</span><select value={draft.content.subject || ''} onChange={e => setContent(['subject'], e.target.value)} className={inputStyle}><option value="">Trang chung</option><option value="FIMO">FIMO · Toán</option><option value="FIEO">FIEO · Tiếng Anh</option><option value="SIAIO">SIAIO · Trí tuệ nhân tạo</option></select></label><Field label="Huy hiệu" value={draft.content.badge} onChange={v => setContent(['badge'], v)} /><Field label="URL logo" value={draft.content.logoUrl} onChange={v => setContent(['logoUrl'], v)} /><div className="sm:col-span-2"><Field label="Tiêu đề chính" value={draft.content.headline} onChange={v => setContent(['headline'], v)} /></div><div className="sm:col-span-2"><Field label="Mô tả" multiline value={draft.content.intro} onChange={v => setContent(['intro'], v)} /></div></div><ListHeading title="Các nút đầu trang" onAdd={() => setList('buttons', [...(draft.content.buttons || []), { label: 'Nút mới', url: '' }])} />{(draft.content.buttons || []).map((item, i) => <Item key={i} onRemove={() => removeItem('buttons', i)}><Field label="Tên nút" value={item.label} onChange={v => updateItem('buttons', i, { label: v })} /><Field label="URL nút" value={item.url} onChange={v => updateItem('buttons', i, { url: v })} /></Item>)}<ListHeading title="Số liệu nổi bật" onAdd={() => setList('highlights', [...(draft.content.highlights || []), { value: '', label: '' }])} />{(draft.content.highlights || []).map((item, i) => <Item key={i} onRemove={() => removeItem('highlights', i)}><Field label="Giá trị" value={item.value} onChange={v => updateItem('highlights', i, { value: v })} /><Field label="Nhãn" value={item.label} onChange={v => updateItem('highlights', i, { label: v })} /></Item>)}</div>}
          {section === 'design' && <div className="space-y-5"><p className="text-sm text-slate-600">Thay đổi hiển thị ngay trong phần Xem trước. Mỗi trang có kiểu chữ và nút riêng.</p><div className="grid gap-4 sm:grid-cols-2">{([
            ['heroTitleSize', 'Cỡ tiêu đề đầu trang', 30, 90, 60],
            ['introSize', 'Cỡ mô tả đầu trang', 14, 30, 18],
            ['sectionTitleSize', 'Cỡ tiêu đề các khối', 24, 60, 36],
            ['buttonSize', 'Cỡ chữ trên nút', 12, 28, 14],
            ['buttonPadding', 'Độ cao nút', 8, 28, 14],
          ] as const).map(([key, label, min, max, fallback]) => <label key={key} className="rounded-xl border border-slate-200 p-4"><span className="mb-2 flex justify-between text-sm font-bold"><span>{label}</span><span>{draft.content.style?.[key] || fallback}px</span></span><input type="range" min={min} max={max} value={draft.content.style?.[key] || fallback} onChange={event => setContent(['style', key], Number(event.target.value))} className="w-full accent-sky-600" /></label>)}</div><label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm font-bold">Màu nhấn <input type="color" value={draft.content.style?.accentColor || (isSiaio ? '#7c3aed' : '#0284c7')} onChange={event => setContent(['style', 'accentColor'], event.target.value)} className="h-10 w-14 cursor-pointer" /></label></div>}
          {section === 'overview' && <div className="space-y-3"><p className="text-xs text-slate-500">Nội dung của cuộc thi hiện tại hiển thị ở phần Giới thiệu. Nếu muốn dẫn sang cuộc thi còn lại, thêm URL /cuoc-thi/fimo hoặc /cuoc-thi/fieo; thẻ đó sẽ nằm cuối trang.</p><ListHeading title="Nội dung giới thiệu" onAdd={() => setList('overview', [...(draft.content.overview || []), { title: '', body: '', url: '' }])} />{(draft.content.overview || []).map((item, i) => <Item key={i} onRemove={() => removeItem('overview', i)}><Field label="Tiêu đề" value={item.title} onChange={v => updateItem('overview', i, { title: v })} /><Field label="URL trang cuộc thi" value={item.url} onChange={v => updateItem('overview', i, { url: v })} /><div className="sm:col-span-2"><Field label="Nội dung" multiline value={item.body} onChange={v => updateItem('overview', i, { body: v })} /></div></Item>)}</div>}
          {section === 'papers' && <div className="space-y-6">{isSiaio ? <><p className="text-sm text-slate-600">Khai báo từng môn; người xem chọn môn và lớp trong một khu vực đề mẫu.</p><ListHeading title="Các môn thi SIAIO" onAdd={() => setContent(['paperSubjects'], [...paperSubjects, `Môn mới ${paperSubjects.length + 1}`])} />{paperSubjects.map((name, index) => <Item key={index} onRemove={() => setContent(['paperSubjects'], paperSubjects.filter((_, i) => i !== index))}><Field label="Tên môn" value={name} onChange={value => { const names = [...paperSubjects]; names[index] = value; setContent(['paperSubjects'], names); if (value && value !== name) setContent(['papers', value], draft.content.papers?.[name] || {}); }} /><div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">{Array.from({ length: 12 }, (_, i) => i + 1).map(grade => <Field key={grade} label={`URL PDF lớp ${grade}`} value={draft.content.papers?.[name]?.[String(grade)]} onChange={value => setContent(['papers', name, String(grade)], value)} />)}</div></Item>)}</> : (draft.content.subject ? [draft.content.subject] : []).map(code => <div key={code}><h4 className="mb-3 font-bold">{code === 'FIMO' ? 'Đề Toán FIMO' : 'Đề Tiếng Anh FIEO'}</h4><div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 9 }, (_, i) => i + 1).map(grade => <Field key={grade} label={`URL PDF lớp ${grade}`} value={draft.content.papers?.[code]?.[String(grade)]} onChange={v => setContent(['papers', code, String(grade)], v)} />)}</div></div>)}{!draft.content.subject && <p className="text-sm text-slate-500">Chọn cuộc thi tại phần Đầu trang để cấu hình đề mẫu.</p>}<p className="text-xs text-slate-500">Dùng đường dẫn PDF có thể đọc công khai để thí sinh xem đề mẫu.</p></div>}
          {section === 'timeline' && <div className="space-y-3"><ListHeading title="Các mốc thi" onAdd={() => setList('timeline', [...(draft.content.timeline || []), { title: '', date: '', mode: '' }])} />{(draft.content.timeline || []).map((item, i) => <Item key={i} onRemove={() => removeItem('timeline', i)}><Field label="Tên vòng" value={item.title} onChange={v => updateItem('timeline', i, { title: v })} /><Field label="Ngày thi" type="date" value={item.date} onChange={v => updateItem('timeline', i, { date: v })} /><div className="sm:col-span-2"><Field label="Hình thức" value={item.mode} onChange={v => updateItem('timeline', i, { mode: v })} /></div></Item>)}</div>}
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
