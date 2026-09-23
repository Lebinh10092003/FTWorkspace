import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, ExternalLink, Eye, Plus, Save, Trash2 } from 'lucide-react';
import { appDialog } from '../AppDialog';
import LandingSiteView, { type LandingContent, type LandingSite } from './LandingSiteView';

type Section = 'hero' | 'overview' | 'papers' | 'timeline' | 'awards' | 'registration' | 'contact' | 'custom' | 'leads';
const sections: Array<[Section, string]> = [
  ['hero', 'Đầu trang & nút'], ['overview', 'Giới thiệu'], ['papers', 'Đề mẫu lớp 1–9'],
  ['timeline', 'Lộ trình'], ['awards', 'Giải thưởng'], ['registration', 'Đăng ký & thanh toán'],
  ['contact', 'Liên hệ & mạng xã hội'], ['custom', 'Khối tự tạo'], ['leads', 'Yêu cầu tư vấn'],
];
const inputStyle = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#0284C7]';
const labelStyle = 'mb-1 block text-xs font-bold text-slate-500';
const urlFields = new Set(['url', 'logoUrl', 'schoolUrl', 'excelUrl', 'individualUrl', 'handbookUrl', 'zaloUrl', 'facebookFimoUrl', 'facebookFieoUrl', 'buttonUrl']);

function Field({ label, value, onChange, multiline = false, type }: { label: string; value?: string; onChange: (value: string) => void; multiline?: boolean; type?: string }) {
  return <label className="block min-w-0"><span className={labelStyle}>{label}</span>{multiline ? <textarea rows={3} value={value || ''} onChange={e => onChange(e.target.value)} className={inputStyle} /> : <input type={type || (urlFields.has(label) ? 'url' : 'text')} value={value || ''} onChange={e => onChange(e.target.value)} className={inputStyle} />}</label>;
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export default function LandingStudio({ idToken }: { idToken: string }) {
  const [sites, setSites] = useState<LandingSite[]>([]);
  const [draft, setDraft] = useState<LandingSite | null>(null);
  const [section, setSection] = useState<Section>('hero');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
    if (!draft || section !== 'leads') return;
    fetch(`/api/landing-sites/${draft.id}/leads`, { headers: { Authorization: `Bearer ${idToken}` } })
      .then(r => r.json()).then(p => setLeads(p.items || [])).catch(() => setLeads([]));
  }, [draft?.id, section, idToken]);

  const setContent = (path: Array<string | number>, value: unknown) => setDraft(current => {
    if (!current) return current;
    const next = copy(current);
    let target: any = next.content;
    path.slice(0, -1).forEach(part => { if (target[part] == null) target[part] = typeof path[path.indexOf(part) + 1] === 'number' ? [] : {}; target = target[part]; });
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
  const create = async (duplicate = false) => {
    const title = duplicate && draft ? `${draft.title} (bản sao)` : 'Trang landing mới';
    const slug = duplicate && draft ? `${draft.slug}-copy-${Date.now().toString(36)}` : `landing-${Date.now().toString(36)}`;
    const content = duplicate && draft ? draft.content : {
      badge: 'FermatTech', headline: title, intro: '', logoUrl: '/logo.png',
      buttons: [{ label: 'Đăng ký ngay', url: '#dang-ky' }], highlights: [], overview: [],
      papers: { FIMO: {}, FIEO: {} }, timeline: [], awards: [], registration: {},
      contact: { phone: '0969 627 162', address: 'Eurowindow Multi Complex, 27 Trần Duy Hưng, Hà Nội', zaloUrl: 'https://zalo.me/fermattech' }, customSections: [],
    };
    try {
      const r = await fetch('/api/landing-sites', { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title, slug, content }) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || 'Không tạo được trang.');
      setSites(current => [...current, p]); setDraft(copy(p)); setSection('hero'); setPreview(false);
    } catch (e) { void appDialog.alert(e instanceof Error ? e.message : 'Không tạo được trang.'); }
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/landing-sites/${draft.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || 'Không lưu được trang.');
      setSites(current => current.map(item => item.id === p.id ? p : item)); setDraft(copy(p));
    } catch (e) { void appDialog.alert(e instanceof Error ? e.message : 'Không lưu được trang.'); }
    finally { setSaving(false); }
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
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4"><div className="mr-auto"><h2 className="text-lg font-extrabold text-[#0B3B60]">Trình tạo Landing Page</h2><p className="text-xs text-slate-600">Chọn trang, sửa từng khối, xem trước và công bố. Mọi nút đều có ô gắn link riêng.</p></div><button onClick={() => void create()} className="inline-flex items-center gap-2 rounded-xl bg-[#0284C7] px-4 py-2.5 text-xs font-bold text-white"><Plus className="h-4 w-4" />Tạo trang mới</button></div>
    <div className="grid gap-5 xl:grid-cols-[230px_minmax(0,1fr)]"><aside className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3"><p className="px-2 pb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Trang của bạn</p>{sites.map(item => <button key={item.id} onClick={() => { setDraft(copy(item)); setPreview(false); setSection('hero'); }} className={`w-full rounded-xl px-3 py-3 text-left ${draft?.id === item.id ? 'bg-sky-50 text-[#0369A1]' : 'hover:bg-slate-50'}`}><strong className="block truncate text-sm">{item.title}</strong><span className="mt-1 block text-xs text-slate-500">/cuoc-thi/{item.slug} · {item.published ? 'Công khai' : 'Bản nháp'}</span></button>)}</aside>
      {draft && <div className="min-w-0 space-y-4"><div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3"><label className="mr-auto inline-flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.published} onChange={e => setDraft({ ...draft, published: e.target.checked })} />Công bố trang</label><button onClick={() => setPreview(!preview)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Eye className="h-4 w-4" />{preview ? 'Chỉnh sửa' : 'Xem trước'}</button><button onClick={() => void create(true)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Copy className="h-4 w-4" />Nhân bản</button><button onClick={() => void remove()} className="rounded-lg border border-rose-200 p-2 text-rose-600" aria-label="Xóa trang"><Trash2 className="h-4 w-4" /></button><button disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-1 rounded-lg bg-[#0284C7] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Đang lưu' : 'Lưu trang'}</button></div>
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2"><Field label="Tên trang" value={draft.title} onChange={title => setDraft({ ...draft, title })} /><Field label="Đường dẫn (slug)" value={draft.slug} onChange={slug => setDraft({ ...draft, slug })} /><div className="sm:col-span-2"><a href={`/cuoc-thi/${draft.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-xs font-bold text-[#0284C7]">{window.location.origin}/cuoc-thi/{draft.slug}<ExternalLink className="h-3 w-3" /></a>{!draft.published && <p className="mt-1 text-xs text-amber-700">Cần công bố và lưu trước khi mở URL công khai.</p>}</div></div>
        {preview ? <div className="max-h-[780px] overflow-auto rounded-2xl border border-slate-200"><LandingSiteView site={draft} preview /></div> : <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]"><nav className="space-y-1 rounded-2xl border border-slate-200 bg-white p-2">{sections.map(([id, label]) => <button key={id} onClick={() => setSection(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-xs font-bold ${section === id ? 'bg-sky-50 text-[#0369A1]' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}</nav><div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5"><h3 className="mb-5 text-base font-extrabold text-[#0B3B60]">{sections.find(item => item[0] === section)?.[1]}</h3>
          {section === 'hero' && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><label><span className={labelStyle}>Chủ đề trang</span><select value={draft.content.subject || ''} onChange={e => setContent(['subject'], e.target.value)} className={inputStyle}><option value="">Trang chung</option><option value="FIMO">FIMO · Toán</option><option value="FIEO">FIEO · Tiếng Anh</option></select></label><Field label="Huy hiệu" value={draft.content.badge} onChange={v => setContent(['badge'], v)} /><Field label="URL logo" value={draft.content.logoUrl} onChange={v => setContent(['logoUrl'], v)} /><div className="sm:col-span-2"><Field label="Tiêu đề chính" value={draft.content.headline} onChange={v => setContent(['headline'], v)} /></div><div className="sm:col-span-2"><Field label="Mô tả" multiline value={draft.content.intro} onChange={v => setContent(['intro'], v)} /></div></div><ListHeading title="Các nút đầu trang" onAdd={() => setList('buttons', [...(draft.content.buttons || []), { label: 'Nút mới', url: '' }])} />{(draft.content.buttons || []).map((item, i) => <Item key={i} onRemove={() => removeItem('buttons', i)}><Field label="Tên nút" value={item.label} onChange={v => updateItem('buttons', i, { label: v })} /><Field label="URL nút" value={item.url} onChange={v => updateItem('buttons', i, { url: v })} /></Item>)}<ListHeading title="Số liệu nổi bật" onAdd={() => setList('highlights', [...(draft.content.highlights || []), { value: '', label: '' }])} />{(draft.content.highlights || []).map((item, i) => <Item key={i} onRemove={() => removeItem('highlights', i)}><Field label="Giá trị" value={item.value} onChange={v => updateItem('highlights', i, { value: v })} /><Field label="Nhãn" value={item.label} onChange={v => updateItem('highlights', i, { label: v })} /></Item>)}</div>}
          {section === 'overview' && <div className="space-y-3"><p className="text-xs text-slate-500">Nội dung của cuộc thi hiện tại hiển thị ở phần Giới thiệu. Nếu muốn dẫn sang cuộc thi còn lại, thêm URL /cuoc-thi/fimo hoặc /cuoc-thi/fieo; thẻ đó sẽ nằm cuối trang.</p><ListHeading title="Nội dung giới thiệu" onAdd={() => setList('overview', [...(draft.content.overview || []), { title: '', body: '', url: '' }])} />{(draft.content.overview || []).map((item, i) => <Item key={i} onRemove={() => removeItem('overview', i)}><Field label="Tiêu đề" value={item.title} onChange={v => updateItem('overview', i, { title: v })} /><Field label="URL trang cuộc thi" value={item.url} onChange={v => updateItem('overview', i, { url: v })} /><div className="sm:col-span-2"><Field label="Nội dung" multiline value={item.body} onChange={v => updateItem('overview', i, { body: v })} /></div></Item>)}</div>}
          {section === 'papers' && <div className="space-y-6">{(draft.content.subject ? [draft.content.subject] : []).map(code => <div key={code}><h4 className="mb-3 font-bold">{code === 'FIMO' ? 'Đề Toán FIMO' : 'Đề Tiếng Anh FIEO'}</h4><div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 9 }, (_, i) => i + 1).map(grade => <Field key={grade} label={`URL PDF lớp ${grade}`} value={draft.content.papers?.[code]?.[String(grade)]} onChange={v => setContent(['papers', code, String(grade)], v)} />)}</div></div>)}{!draft.content.subject && <p className="text-sm text-slate-500">Chọn FIMO hoặc FIEO tại phần Đầu trang để cấu hình đề mẫu.</p>}<p className="text-xs text-slate-500">Mỗi URL dùng cho cả hai nút. Để trình duyệt tải file ổn định, hãy dùng PDF cùng tên miền hoặc URL trả về file đính kèm.</p></div>}
          {section === 'timeline' && <div className="space-y-3"><ListHeading title="Các mốc thi" onAdd={() => setList('timeline', [...(draft.content.timeline || []), { title: '', date: '', mode: '' }])} />{(draft.content.timeline || []).map((item, i) => <Item key={i} onRemove={() => removeItem('timeline', i)}><Field label="Tên vòng" value={item.title} onChange={v => updateItem('timeline', i, { title: v })} /><Field label="Ngày thi" type="date" value={item.date} onChange={v => updateItem('timeline', i, { date: v })} /><div className="sm:col-span-2"><Field label="Hình thức" value={item.mode} onChange={v => updateItem('timeline', i, { mode: v })} /></div></Item>)}</div>}
          {section === 'awards' && <div className="space-y-3"><ListHeading title="Các hạng giải" onAdd={() => setList('awards', [...(draft.content.awards || []), { title: '', percent: '', description: '' }])} />{(draft.content.awards || []).map((item, i) => <Item key={i} onRemove={() => removeItem('awards', i)}><Field label="Tên giải" value={item.title} onChange={v => updateItem('awards', i, { title: v })} /><Field label="Tỷ lệ (%)" value={item.percent} onChange={v => updateItem('awards', i, { percent: v })} /><div className="sm:col-span-2"><Field label="Mô tả" value={item.description} onChange={v => updateItem('awards', i, { description: v })} /></div></Item>)}</div>}
          {section === 'registration' && <div className="grid gap-3 sm:grid-cols-2">{([['schoolUrl', 'URL đăng ký trường'], ['excelUrl', 'URL Excel Phụ lục 4'], ['individualUrl', 'URL form cá nhân'], ['handbookUrl', 'URL cẩm nang'], ['bankName', 'Ngân hàng'], ['accountName', 'Chủ tài khoản'], ['accountNumber', 'Số tài khoản'], ['transferNote', 'Nội dung chuyển khoản']] as const).map(([key, label]) => <Field key={key} label={label} value={draft.content.registration?.[key]} onChange={v => setContent(['registration', key], v)} />)}</div>}
          {section === 'contact' && <div className="grid gap-3 sm:grid-cols-2">{([['phone', 'Hotline'], ['email', 'Email'], ['address', 'Địa chỉ'], ['zaloUrl', 'URL Zalo OA'], ['facebookFimoUrl', 'URL Facebook FIMO'], ['facebookFieoUrl', 'URL Facebook FIEO']] as const).map(([key, label]) => <Field key={key} label={label} value={draft.content.contact?.[key]} onChange={v => setContent(['contact', key], v)} />)}</div>}
          {section === 'custom' && <div className="space-y-3"><ListHeading title="Khối nội dung tự tạo" onAdd={() => setList('customSections', [...(draft.content.customSections || []), { title: 'Tiêu đề mới', body: '', buttonLabel: '', buttonUrl: '' }])} />{(draft.content.customSections || []).map((item, i) => <div key={i}><div className="mb-1 flex justify-end gap-1"><button title="Chuyển lên" onClick={() => moveItem('customSections', i, -1)} className="rounded border p-1"><ArrowUp className="h-3 w-3" /></button><button title="Chuyển xuống" onClick={() => moveItem('customSections', i, 1)} className="rounded border p-1"><ArrowDown className="h-3 w-3" /></button></div><Item onRemove={() => removeItem('customSections', i)}><Field label="Tiêu đề" value={item.title} onChange={v => updateItem('customSections', i, { title: v })} /><Field label="Tên nút" value={item.buttonLabel} onChange={v => updateItem('customSections', i, { buttonLabel: v })} /><div className="sm:col-span-2"><Field label="Nội dung" multiline value={item.body} onChange={v => updateItem('customSections', i, { body: v })} /></div><div className="sm:col-span-2"><Field label="URL nút" value={item.buttonUrl} onChange={v => updateItem('customSections', i, { buttonUrl: v })} /></div></Item></div>)}</div>}
          {section === 'leads' && <div className="space-y-3">{leads.length ? leads.map((lead, i) => <div key={i} className="rounded-xl border border-slate-200 p-4 text-sm"><strong>{lead.fullName}</strong><span className="ml-2 text-xs text-slate-400">{new Date(lead.createdAt).toLocaleString('vi-VN')}</span><p className="mt-1">{lead.phone} · {lead.email} · {lead.schoolCity}</p><p className="mt-2 text-slate-600">{lead.message}</p></div>) : <p className="text-sm text-slate-500">Chưa có yêu cầu tư vấn.</p>}</div>}
        </div></div>}
      </div>}</div>
  </div>;
}

function ListHeading({ title, onAdd }: { title: string; onAdd: () => void }) { return <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-bold">{title}</h4><button type="button" onClick={onAdd} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold"><Plus className="h-3 w-3" />Thêm</button></div>; }
function Item({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) { return <div className="relative grid gap-3 rounded-xl border border-slate-200 p-4 pr-12 sm:grid-cols-2"><button type="button" onClick={onRemove} aria-label="Xóa khối" className="absolute right-3 top-3 text-rose-500"><Trash2 className="h-4 w-4" /></button>{children}</div>; }
