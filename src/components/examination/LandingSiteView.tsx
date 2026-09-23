import { useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUp, BookOpen, CalendarDays, CheckCircle2, ExternalLink, Facebook, FileText, Mail, MapPin, Menu, Phone, Send, Trophy, X } from 'lucide-react';
import './LandingSite.css';

export type LinkButton = { label: string; url: string };
export type LandingContent = {
  badge?: string; headline?: string; intro?: string; logoUrl?: string; subject?: string;
  buttons?: LinkButton[];
  highlights?: Array<{ value: string; label: string }>;
  overview?: Array<{ title: string; body: string; url: string }>;
  papers?: Record<string, Record<string, string>>;
  timeline?: Array<{ title: string; date: string; mode: string }>;
  awards?: Array<{ title: string; percent: string; description: string }>;
  registration?: { schoolUrl?: string; excelUrl?: string; individualUrl?: string; handbookUrl?: string; bankName?: string; accountName?: string; accountNumber?: string; transferNote?: string };
  contact?: { email?: string; phone?: string; address?: string; zaloUrl?: string; facebookFimoUrl?: string; facebookFieoUrl?: string };
  customSections?: Array<{ title: string; body: string; buttonLabel: string; buttonUrl: string }>;
};
export type LandingSite = { id: number; slug: string; title: string; template: string; layout: string; content: LandingContent; published: boolean; updatedAt: string; updatedBy: string };

const nav = [
  ['gioi-thieu', 'Giới thiệu'], ['de-mau', 'Đề mẫu'], ['lo-trinh', 'Lộ trình'],
  ['giai-thuong', 'Giải thưởng'], ['dang-ky', 'Đăng ký'], ['lien-he', 'Liên hệ'],
];
const safeUrl = (url?: string) => {
  const value = (url || '').trim();
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value) ? value : '';
};
const external = (url: string) => /^https?:\/\//i.test(url);
const pdfName = (subject: string, grade: number) => `${subject}-lop-${grade}.pdf`;
const displayDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('/') : date;

function Action({ url, children, className = '', download, newTab = false }: { url?: string; children: React.ReactNode; className?: string; download?: string; newTab?: boolean }) {
  const href = safeUrl(url);
  if (!href) return <span title="Chưa gắn liên kết" className={`${className} cursor-not-allowed opacity-45`}>{children}</span>;
  const target = !download && (newTab || external(href)) ? '_blank' : undefined;
  return <a href={href} target={target} rel={target ? 'noopener noreferrer' : undefined} download={download} className={className}>{children}</a>;
}

export default function LandingSiteView({ site, preview = false }: { site: LandingSite; preview?: boolean }) {
  const c = site.content || {};
  const subject = c.subject || (site.slug === 'fieo' ? 'FIEO' : site.slug === 'fimo' ? 'FIMO' : '');
  const otherSubject = subject === 'FIMO' ? 'FIEO' : subject === 'FIEO' ? 'FIMO' : '';
  const aboutEntries = (c.overview || []).filter(item => !otherSubject || !item.url?.toLowerCase().endsWith(`/cuoc-thi/${otherSubject.toLowerCase()}`));
  const crossEntry = (c.overview || []).find(item => otherSubject && item.url?.toLowerCase().endsWith(`/cuoc-thi/${otherSubject.toLowerCase()}`));
  const subjectName = subject === 'FIMO' ? 'Toán học' : subject === 'FIEO' ? 'Tiếng Anh' : 'Cuộc thi';
  const subjectFeatures = subject === 'FIMO'
    ? ['Đề thi song ngữ', 'Tư duy logic', 'Giải quyết vấn đề']
    : subject === 'FIEO'
      ? ['100% tiếng Anh', 'Định hướng CEFR', 'Năng lực ngôn ngữ']
      : [];
  const [menuOpen, setMenuOpen] = useState(false);
  const [facebookOpen, setFacebookOpen] = useState(false);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', schoolCity: '', message: '', website: '' });
  const [formState, setFormState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [formError, setFormError] = useState('');
  const reg = c.registration || {};
  const contact = c.contact || {};
  const heroButtons = c.buttons?.length ? c.buttons : [
    { label: 'Đăng ký ngay', url: reg.individualUrl || '#dang-ky' },
    { label: 'Khám phá đề mẫu', url: '#de-mau' },
  ];

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) return;
    setFormState('sending');
    try {
      const response = await fetch(`/api/public/landing-sites/${encodeURIComponent(site.slug)}/leads`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Không gửi được thông tin.');
      setFormState('sent');
      setForm({ fullName: '', phone: '', email: '', schoolCity: '', message: '', website: '' });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không gửi được thông tin.');
      setFormState('error');
    }
  }

  const callNumber = (contact.phone || '0969 627 162').replace(/\D/g, '');
  return <div className="landing-site relative min-h-screen bg-[#DCEBFA] font-display text-[#0B3B60] [scroll-behavior:smooth]">
    <header className="lp-header sticky top-0 z-40 border-b border-[#E2E8F0] bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3 lg:px-8">
        <a href="#dau-trang" className="flex min-w-0 items-center gap-3">
          {safeUrl(c.logoUrl) && <img src={safeUrl(c.logoUrl)} alt="FermatTech" className="h-10 w-auto max-w-[100px] rounded-lg bg-white p-1 object-contain" />}
          <span className="min-w-0"><strong className="block text-lg leading-none">{subject || site.slug.toUpperCase()}</strong><small className="block truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">FermatTech Olympiad</small></span>
        </a>
        <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label="Điều hướng">
          {nav.filter(([id]) => id !== 'de-mau' || subject).map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-sky-50 hover:text-[#0284C7]">{label}</a>)}
        </nav>
        <Action url={reg.individualUrl || '#dang-ky'} className="ml-auto hidden rounded-xl bg-[#0284C7] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0369A1] lg:ml-3 lg:inline-flex">Đăng ký ngay <ArrowRight className="ml-2 h-4 w-4" /></Action>
        <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Mở menu" className="ml-auto rounded-lg p-2 lg:hidden">{menuOpen ? <X /> : <Menu />}</button>
      </div>
      {menuOpen && <nav className="grid border-t border-slate-200 bg-white px-5 py-3 lg:hidden">{nav.filter(([id]) => id !== 'de-mau' || subject).map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)} className="py-2 text-sm font-semibold">{label}</a>)}</nav>}
    </header>

    <main id="dau-trang">
      <section className="lp-hero relative overflow-hidden bg-white">
        <div className="lp-hero-grid pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute -right-24 -top-44 h-[560px] w-[560px] rounded-full bg-sky-100/70 blur-3xl" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:px-8 lg:py-28">
          <div className="lp-hero-copy">
            <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-extrabold uppercase tracking-[.16em] text-[#0369A1]">{c.badge || 'Olympiad · FermatTech'}</span>
            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.13] tracking-tight text-[#0B3B60] sm:text-5xl lg:text-6xl">{c.headline || site.title}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">{c.intro}</p>
            <div className="mt-8 flex flex-wrap gap-3">{heroButtons.map((button, index) => <Action key={index} url={button.url} className={index === 0 ? 'inline-flex items-center gap-2 rounded-xl bg-[#0284C7] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-sky-100 hover:bg-[#0369A1]' : 'inline-flex items-center gap-2 rounded-xl border border-[#CBD5E1] bg-white px-6 py-3.5 text-sm font-bold text-[#0B3B60] hover:bg-sky-50'}>{button.label}<ArrowRight className="h-4 w-4" /></Action>)}</div>
            <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">{(c.highlights || []).map((item, i) => <div key={i} className="lp-stat rounded-2xl border border-[#E2E8F0] bg-white/80 p-4"><strong className="block text-xl font-extrabold text-[#0284C7]">{item.value}</strong><span className="mt-1 block text-xs font-medium text-slate-500">{item.label}</span></div>)}</div>
          </div>
          <div className="lp-hero-art relative rounded-[2rem] border border-sky-100 bg-gradient-to-br from-[#0B3B60] to-[#0369A1] p-8 text-white shadow-2xl shadow-sky-100 sm:p-12">
            <div className="absolute right-8 top-8 h-24 w-24 rounded-full border border-white/20" />
            <div className="absolute -right-4 bottom-12 h-36 w-36 rounded-full border border-white/20" />
            <p className="text-sm font-bold uppercase tracking-[.25em] text-sky-200">FermatTech</p>
            <div className="mt-20 flex items-center gap-4"><BookOpen className="h-10 w-10 text-sky-200" /><span className="text-5xl font-black">{subject || site.slug.toUpperCase()}</span></div>
            <p className="mt-5 max-w-sm text-lg leading-8 text-sky-100">Tư duy học thuật. Năng lực toàn cầu. Hành trình khám phá bắt đầu từ hôm nay.</p>
            <div className="mt-14 h-1 w-24 rounded-full bg-sky-300" />
          </div>
        </div>
      </section>

      <section id="gioi-thieu" className="lp-overview scroll-mt-24 py-20"><div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Heading eyebrow={`Về ${subject || 'cuộc thi'}`} title={`Một sân chơi dành cho ${subjectName}`} description={subject ? `Khám phá định hướng học thuật và trải nghiệm riêng của ${subject}.` : 'Khám phá định hướng học thuật của cuộc thi.'} />
        <div className="lp-about-panel mt-10 grid gap-8 rounded-[2rem] p-8 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:p-12">
          <div>
            <span className="lp-about-index text-xs font-extrabold uppercase tracking-[.25em]">FermatTech · {subject || 'Olympiad'}</span>
            <h3 className="mt-5 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">{aboutEntries[0]?.title || c.headline || site.title}</h3>
            <p className="mt-5 max-w-2xl text-lg leading-8">{aboutEntries[0]?.body || c.intro}</p>
            {subject && <Action url="#de-mau" className="mt-8 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white">Khám phá đề mẫu <ArrowRight className="h-4 w-4" /></Action>}
          </div>
          <div className="grid gap-3">{subjectFeatures.map((feature, i) => <div key={feature} className="lp-feature flex items-center gap-4 rounded-2xl p-4"><span className="text-xs font-black">0{i + 1}</span><strong>{feature}</strong><CheckCircle2 className="ml-auto h-5 w-5" /></div>)}{!subjectFeatures.length && aboutEntries.slice(1).map((item, i) => <div key={i} className="lp-feature rounded-2xl p-4"><strong>{item.title}</strong><p className="mt-1 text-sm">{item.body}</p></div>)}</div>
        </div>
      </div></section>

      {subject && <section id="de-mau" className="lp-papers scroll-mt-24 bg-white py-20"><div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Heading eyebrow={`Tài liệu ${subject}`} title={`Đề mẫu ${subjectName} · Lớp 1 đến lớp 9`} description="Chọn khối lớp để xem trực tuyến hoặc tải đề PDF." />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }, (_, i) => i + 1).map(grade => { const url = c.papers?.[subject]?.[String(grade)] || ''; return <article key={`${subject}-${grade}`} className="lp-paper-card rounded-2xl border border-[#E2E8F0] p-5"><div className="flex items-center gap-3"><span className="rounded-xl bg-sky-50 p-3 text-[#0284C7]"><FileText className="h-5 w-5" /></span><div><h3 className="font-extrabold">Lớp {grade}</h3><p className="text-xs text-slate-500">Đề mẫu {subject} · PDF</p></div></div><div className="mt-5 flex flex-wrap gap-2"><Action url={url} newTab className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 px-3 py-2 text-xs font-bold text-[#0369A1] hover:bg-sky-50"><ExternalLink className="h-3.5 w-3.5" />Đọc trực tuyến</Action><Action url={url} download={pdfName(subject, grade)} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-3 py-2 text-xs font-bold text-[#0369A1] hover:bg-sky-100"><ArrowDownToLine className="h-3.5 w-3.5" />Tải về (.PDF)</Action></div>{!url && <p className="mt-3 text-xs text-slate-400">Đề mẫu đang được cập nhật</p>}</article>; })}</div>
      </div></section>}

      <section id="lo-trinh" className="lp-timeline scroll-mt-24 py-20"><div className="mx-auto max-w-7xl px-5 lg:px-8"><Heading eyebrow={`Lộ trình ${subject}`} title="Các mốc của mùa thi" description="Lịch thi theo thông tin đang được Ban tổ chức cập nhật." /><div className="mt-10 grid gap-4 md:grid-cols-5">{(c.timeline || []).map((item, i) => <div key={i} className="lp-timeline-card rounded-2xl border border-[#E2E8F0] bg-white p-5"><span className="inline-grid h-9 w-9 place-items-center rounded-full bg-[#0B3B60] text-xs font-bold text-white">{String(i + 1).padStart(2, '0')}</span><h3 className="mt-5 font-extrabold">{item.title}</h3><p className="mt-3 flex items-center gap-2 text-sm font-bold text-[#0284C7]"><CalendarDays className="h-4 w-4" />{displayDate(item.date) || 'Đang cập nhật'}</p><p className="mt-2 text-xs text-slate-500">{item.mode}</p></div>)}</div></div></section>

      <section id="giai-thuong" className="lp-awards scroll-mt-24 bg-white py-20"><div className="mx-auto max-w-7xl px-5 lg:px-8"><Heading eyebrow={`Vinh danh ${subject}`} title="Cơ cấu giải thưởng" description="Tỷ lệ giải thưởng sẽ được công bố theo thể lệ chính thức." /><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{(c.awards || []).map((item, i) => <div key={i} className="lp-award-card rounded-2xl border border-[#E2E8F0] p-6 text-center"><Trophy className={`mx-auto h-9 w-9 ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-orange-600' : 'text-sky-500'}`} /><h3 className="mt-4 font-extrabold">{item.title}</h3><p className="mt-2 text-3xl font-black text-[#0284C7]">{item.percent || '—'}</p><p className="mt-2 text-xs text-slate-500">{item.description || 'Tỷ lệ đang cập nhật'}</p></div>)}</div></div></section>

      <section id="dang-ky" className="lp-registration scroll-mt-24 py-20"><div className="mx-auto max-w-7xl px-5 lg:px-8"><Heading eyebrow={`Tham gia ${subject}`} title="Đăng ký dự thi" description="Chọn hình thức đăng ký phù hợp với nhà trường hoặc gia đình." /><div className="mt-10 grid gap-6 lg:grid-cols-2">
        <article className="rounded-3xl border border-[#E2E8F0] bg-white p-8"><span className="text-xs font-extrabold uppercase tracking-widest text-[#0284C7]">Dành cho nhà trường</span><h3 className="mt-3 text-2xl font-extrabold">Đăng ký theo danh sách</h3><p className="mt-3 leading-7 text-slate-600">Tập hợp thông tin học sinh theo mẫu và gửi hồ sơ đăng ký tập thể.</p><div className="mt-8 flex flex-wrap gap-3"><Action url={reg.excelUrl} download="Phu-luc-4-danh-sach-thi-sinh.xlsx" className="inline-flex items-center gap-2 rounded-xl border border-sky-200 px-4 py-3 text-sm font-bold text-[#0369A1]"><ArrowDownToLine className="h-4 w-4" />Tải Excel Phụ lục 4</Action><Action url={reg.schoolUrl} className="inline-flex items-center gap-2 rounded-xl bg-[#0284C7] px-4 py-3 text-sm font-bold text-white">Đăng ký trường <ArrowRight className="h-4 w-4" /></Action></div></article>
        <article className="rounded-3xl border border-[#E2E8F0] bg-white p-8"><span className="text-xs font-extrabold uppercase tracking-widest text-[#0284C7]">Dành cho cá nhân</span><h3 className="mt-3 text-2xl font-extrabold">Đăng ký trực tiếp</h3><p className="mt-3 leading-7 text-slate-600">Hoàn thành biểu mẫu và tham khảo hướng dẫn thanh toán chính thức.</p><div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><p>Ngân hàng: <strong>{reg.bankName || 'Đang cập nhật'}</strong></p><p className="mt-1">Chủ tài khoản: <strong>{reg.accountName || 'Đang cập nhật'}</strong></p><p className="mt-1">Số tài khoản: <strong>{reg.accountNumber || 'Đang cập nhật'}</strong></p>{reg.transferNote && <p className="mt-1">Nội dung: {reg.transferNote}</p>}</div><div className="mt-6 flex flex-wrap gap-3"><Action url={reg.individualUrl} className="inline-flex items-center gap-2 rounded-xl bg-[#0284C7] px-4 py-3 text-sm font-bold text-white">Mở form đăng ký <ArrowRight className="h-4 w-4" /></Action><Action url={reg.handbookUrl} className="inline-flex items-center gap-2 rounded-xl border border-sky-200 px-4 py-3 text-sm font-bold text-[#0369A1]">Xem cẩm nang <BookOpen className="h-4 w-4" /></Action></div></article>
      </div></div></section>

      {(c.customSections || []).map((item, i) => <section key={i} className="lp-custom bg-white py-16"><div className="mx-auto max-w-4xl px-5 text-center"><h2 className="text-3xl font-extrabold">{item.title}</h2><p className="mt-4 whitespace-pre-line leading-8 text-slate-600">{item.body}</p>{item.buttonLabel && <Action url={item.buttonUrl} className="mt-6 inline-flex rounded-xl bg-[#0284C7] px-5 py-3 text-sm font-bold text-white">{item.buttonLabel}</Action>}</div></section>)}

      <section id="lien-he" className="lp-contact scroll-mt-24 bg-[#0B3B60] py-20 text-white"><div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-2 lg:px-8"><div><span className="text-xs font-bold uppercase tracking-widest text-sky-300">Tư vấn {subject}</span><h2 className="mt-3 text-3xl font-extrabold">Để lại thông tin liên hệ</h2><p className="mt-4 max-w-lg leading-7 text-sky-100">Ban tổ chức sẽ liên hệ để hỗ trợ chọn cuộc thi, giải đáp thể lệ và hướng dẫn đăng ký.</p><div className="mt-8 space-y-4 text-sm">{contact.phone && <a className="flex items-center gap-3" href={`tel:${callNumber}`}><Phone className="h-5 w-5" />{contact.phone}</a>}{contact.email && <a className="flex items-center gap-3" href={`mailto:${contact.email}`}><Mail className="h-5 w-5" />{contact.email}</a>}{contact.address && <p className="flex items-center gap-3"><MapPin className="h-5 w-5 shrink-0" />{contact.address}</p>}</div></div>
        <form onSubmit={submitLead} className="grid gap-4 rounded-3xl bg-white p-6 text-[#0B3B60] shadow-xl sm:grid-cols-2" aria-label="Đăng ký tư vấn"><input aria-label="Họ và tên" required value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Họ và tên *" className="rounded-xl border border-slate-200 px-4 py-3 text-sm" /><input aria-label="Điện thoại hoặc Zalo" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Điện thoại / Zalo *" className="rounded-xl border border-slate-200 px-4 py-3 text-sm" /><input aria-label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email" className="rounded-xl border border-slate-200 px-4 py-3 text-sm" /><input aria-label="Trường hoặc thành phố" value={form.schoolCity} onChange={e => setForm({ ...form, schoolCity: e.target.value })} placeholder="Trường / Thành phố" className="rounded-xl border border-slate-200 px-4 py-3 text-sm" /><textarea aria-label="Lời nhắn" rows={4} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Lời nhắn" className="rounded-xl border border-slate-200 px-4 py-3 text-sm sm:col-span-2" /><input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} /><button disabled={formState === 'sending' || preview} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0284C7] px-5 py-3 font-bold text-white disabled:opacity-50 sm:col-span-2"><Send className="h-4 w-4" />{formState === 'sending' ? 'Đang gửi...' : 'Gửi yêu cầu tư vấn'}</button>{formState === 'sent' && <p role="status" className="flex items-center gap-2 text-sm font-semibold text-emerald-700 sm:col-span-2"><CheckCircle2 className="h-4 w-4" />Đã gửi thành công. Ban tổ chức sẽ liên hệ với bạn.</p>}{formState === 'error' && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{formError}</p>}</form></div></section>

      {crossEntry && <section className="lp-cross py-14" aria-label="Cuộc thi khác của FermatTech">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 md:flex-row md:items-center md:justify-between lg:px-8">
          <div><span className="text-xs font-bold uppercase tracking-[.22em]">Khám phá thêm tại FermatTech</span><h2 className="mt-2 text-2xl font-black">{crossEntry.title}</h2><p className="mt-2 max-w-2xl text-sm leading-6">{crossEntry.body}</p></div>
          <Action url={crossEntry.url} className="inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white">Đến trang {otherSubject} <ArrowRight className="h-4 w-4" /></Action>
        </div>
      </section>}
    </main>
    <footer className="lp-footer border-t border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500"><p className="font-extrabold text-[#0B3B60]">FermatTech</p><p className="mt-2">{contact.address || 'Eurowindow Multi Complex, 27 Trần Duy Hưng, Hà Nội'} · Hotline <a href={`tel:${callNumber}`} className="text-[#0284C7]">{contact.phone || '0969 627 162'}</a></p><p className="mt-3">© {new Date().getFullYear()} FermatTech</p></footer>
    <div className={`${preview ? 'absolute' : 'fixed'} bottom-5 right-5 z-50 flex flex-col gap-2`} aria-label="Liên hệ nhanh">
      <Action url={contact.zaloUrl} className="grid h-11 w-11 place-items-center rounded-full bg-[#0068FF] text-xs font-black text-white shadow-lg" >Zalo</Action>
      <div className="relative"><button type="button" aria-label="Facebook" aria-expanded={facebookOpen} onClick={() => setFacebookOpen(!facebookOpen)} className="grid h-11 w-11 place-items-center rounded-full bg-[#1877F2] text-white shadow-lg"><Facebook className="h-5 w-5" /></button>{facebookOpen && <div className="absolute bottom-0 right-14 min-w-36 rounded-xl border border-slate-200 bg-white p-2 text-sm shadow-lg">{subject === 'FIMO' ? <Action url={contact.facebookFimoUrl} className="block rounded-lg px-3 py-2 hover:bg-slate-50">FIMO fanpage</Action> : subject === 'FIEO' ? <Action url={contact.facebookFieoUrl} className="block rounded-lg px-3 py-2 hover:bg-slate-50">FIEO fanpage</Action> : <><Action url={contact.facebookFimoUrl} className="block rounded-lg px-3 py-2 hover:bg-slate-50">FIMO fanpage</Action><Action url={contact.facebookFieoUrl} className="block rounded-lg px-3 py-2 hover:bg-slate-50">FIEO fanpage</Action></>}</div>}</div>
      <a href={`tel:${callNumber}`} aria-label="Gọi hotline" className="grid h-11 w-11 place-items-center rounded-full bg-[#0B3B60] text-white shadow-lg"><Phone className="h-5 w-5" /></a>
      <a href="#dau-trang" aria-label="Về đầu trang" className="grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-[#0B3B60] shadow-lg"><ArrowUp className="h-5 w-5" /></a>
    </div>
  </div>;
}

function Heading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return <div className="mx-auto max-w-2xl text-center"><span className="text-xs font-extrabold uppercase tracking-[.2em] text-[#0284C7]">{eyebrow}</span><h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>{description && <p className="mt-4 leading-7 text-slate-600">{description}</p>}</div>;
}
