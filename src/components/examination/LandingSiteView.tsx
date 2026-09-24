import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUp, BookOpen, CalendarDays, CheckCircle2, ExternalLink, Facebook, FileText, Mail, MapPin, Menu, Phone, Send, Sparkles, Trophy, X } from 'lucide-react';
import './LandingSite.css';
import './LandingMotion.css';
import SiaioLandingView from './SiaioLandingView';
import { countdownLabel, describeMilestones, statusLabel, type MilestoneSummary, type MilestoneView } from './landingTimeline';
import { useActiveSection, usePointerTilt, useRevealScope, useScrollProgress, useScrolledPast } from './landingMotion';

export type LinkButton = { label: string; url: string };
export type LandingContent = {
  badge?: string; headline?: string; intro?: string; logoUrl?: string; subject?: string;
  paperSubjects?: string[];
  style?: { heroTitleSize?: number; introSize?: number; buttonSize?: number; buttonPadding?: number; sectionTitleSize?: number; accentColor?: string };
  buttons?: LinkButton[];
  highlights?: Array<{ value: string; label: string }>;
  overview?: Array<{ title: string; body: string; url: string }>;
  papers?: Record<string, Record<string, string>>;
  timeline?: Array<{ title: string; date: string; mode: string }>;
  awards?: Array<{ title: string; percent: string; description: string }>;
  registration?: { schoolUrl?: string; excelUrl?: string; individualUrl?: string; handbookUrl?: string };
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
const delay = (ms: number) => ({ '--reveal-delay': `${ms}ms` }) as CSSProperties;

function Action({ url, children, className = '', download, newTab = false }: { url?: string; children: ReactNode; className?: string; download?: string; newTab?: boolean }) {
  const href = safeUrl(url);
  if (!href) return <span title="Chưa gắn liên kết" className={`${className} cursor-not-allowed opacity-45`}>{children}</span>;
  const target = !download && (newTab || external(href)) ? '_blank' : undefined;
  return <a href={href} target={target} rel={target ? 'noopener noreferrer' : undefined} download={download} className={className}>{children}</a>;
}

export default function LandingSiteView(props: { site: LandingSite; preview?: boolean }) {
  if (props.site.layout === 'siaio' || props.site.content?.subject === 'SIAIO') {
    return <SiaioLandingView {...props} />;
  }
  return <OlympiadLandingView {...props} />;
}

/** Một mốc trên dòng thời gian mùa thi: số thứ tự, ngày lớn, tên vòng và trạng thái. */
function Milestone({ item, step }: { item: MilestoneView; step: number }) {
  const detail = [item.weekday, item.mode].filter(Boolean).join(' · ');
  return <li className={`lp-milestone is-${item.status}`} data-reveal style={delay(step * 80)}>
    <span className="lp-milestone-node" aria-hidden="true">{String(item.index + 1).padStart(2, '0')}</span>
    <div className="lp-milestone-date">
      <strong>{item.date ? item.dayMonth : '—'}</strong>
      <span>{item.year || 'chưa ấn định'}</span>
    </div>
    <div className="lp-milestone-body">
      <h3>{item.title}</h3>
      <p>{detail || 'Hình thức thi sẽ được Ban tổ chức thông báo'}</p>
    </div>
    <span className="lp-milestone-status">
      {statusLabel(item.status)}
      {item.status === 'next' && item.daysAway !== null && <b>{countdownLabel(item.daysAway)}</b>}
    </span>
  </li>;
}

/** Bảng tóm tắt mùa thi đặt cạnh dòng thời gian, luôn nêu rõ mốc kế tiếp. */
function Roadmap({ schedule }: { schedule: MilestoneSummary }) {
  const { items, next, done, total, season, range } = schedule;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return <div className="lp-roadmap">
    <aside className="lp-roadmap-summary" data-reveal="left">
      <span className="lp-roadmap-season"><CalendarDays className="h-4 w-4" />Mùa thi {season || 'đang cập nhật'}</span>
      {next ? <>
        <p className="lp-roadmap-label">Mốc kế tiếp</p>
        <h3>{next.title}</h3>
        <p className="lp-roadmap-date">{next.full}</p>
        <p className="lp-roadmap-count"><span className="lp-roadmap-dot" aria-hidden="true" />{countdownLabel(next.daysAway)}</p>
      </> : <>
        <p className="lp-roadmap-label">Trạng thái mùa thi</p>
        <h3>{schedule.dated ? 'Các mốc đã diễn ra' : 'Lịch thi đang được cập nhật'}</h3>
        <p className="lp-roadmap-date">{range || 'Ban tổ chức sẽ công bố mốc thời gian trong thời gian sớm nhất.'}</p>
      </>}
      <div className="lp-roadmap-progress" role="img" aria-label={`Đã qua ${done} trên ${total} mốc`}><span style={{ width: `${percent}%` }} /></div>
      <p className="lp-roadmap-meta">{done}/{total} mốc đã diễn ra{range ? ` · ${range}` : ''}</p>
    </aside>
    <ol className="lp-roadmap-track">{items.map((item, index) => <Milestone key={`${item.title}-${item.date}-${index}`} item={item} step={index} />)}</ol>
  </div>;
}

function OlympiadLandingView({ site, preview = false }: { site: LandingSite; preview?: boolean }) {
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
  const numericStyle = (value: number | undefined, fallback: number, min: number, max: number) => `${Math.max(min, Math.min(max, Number(value) || fallback))}px`;
  const pageStyle = {
    '--lp-hero-title-size': numericStyle(c.style?.heroTitleSize, 60, 30, 90),
    '--lp-intro-size': numericStyle(c.style?.introSize, 18, 14, 30),
    '--lp-button-size': numericStyle(c.style?.buttonSize, 14, 12, 28),
    '--lp-button-padding': numericStyle(c.style?.buttonPadding, 14, 8, 28),
    '--lp-section-title-size': numericStyle(c.style?.sectionTitleSize, 36, 24, 60),
    '--lp-accent': /^#[0-9a-fA-F]{6}$/.test(c.style?.accentColor || '') ? c.style!.accentColor : '#0284c7',
  } as CSSProperties;
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', schoolCity: '', message: '', website: '' });
  const [formState, setFormState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [formError, setFormError] = useState('');
  const reg = c.registration || {};
  const contact = c.contact || {};
  const heroButtons = c.buttons?.length ? c.buttons : [
    { label: 'Đăng ký ngay', url: reg.individualUrl || '#dang-ky' },
    { label: 'Khám phá đề mẫu', url: '#de-mau' },
  ];
  const schedule = useMemo(() => describeMilestones(c.timeline), [c.timeline]);
  const navItems = nav.filter(([id]) => id !== 'de-mau' || subject);
  /** Đánh số khối theo đúng thứ tự hiển thị, bỏ qua khối Đề mẫu khi trang chưa chọn cuộc thi. */
  const order = ['gioi-thieu', ...(subject ? ['de-mau'] : []), 'lo-trinh', 'giai-thuong', 'dang-ky'];
  const no = (id: string) => String(order.indexOf(id) + 1).padStart(2, '0');
  const motion = !preview;
  const rootRef = useRevealScope<HTMLDivElement>(motion, site.id);
  const heroArtRef = usePointerTilt<HTMLDivElement>(motion);
  const progress = useScrollProgress(motion);
  const activeSection = useActiveSection(navItems.map(([id]) => id), motion);
  const scrolled = useScrolledPast(600, motion);
  const facebookRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!facebookOpen) return;
    const away = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || !facebookRef.current?.contains(target)) setFacebookOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setFacebookOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [facebookOpen]);

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
  return <div ref={rootRef} style={pageStyle} className={`landing-site ${motion ? 'landing-motion' : ''} relative min-h-screen [scroll-behavior:smooth]`}>
    <header className="lp-header sticky top-0 z-40">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3 lg:px-8">
        <a href="#dau-trang" className="lp-brand flex min-w-0 items-center gap-3">
          {safeUrl(c.logoUrl) && <img src={safeUrl(c.logoUrl)} alt="FermatTech" decoding="async" className="h-10 w-auto max-w-[100px] rounded-lg bg-white p-1 object-contain" />}
          <span className="min-w-0"><strong className="block text-lg leading-none">{subject || site.slug.toUpperCase()}</strong><small className="block truncate text-[10px] font-semibold uppercase tracking-wider">FermatTech Olympiad</small></span>
        </a>
        <nav className="lp-nav ml-auto hidden items-center gap-1 lg:flex" aria-label="Điều hướng">
          {navItems.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'true' : undefined} className={activeSection === id ? 'is-active' : ''}>{label}</a>)}
        </nav>
        <Action url={reg.individualUrl || '#dang-ky'} className="lp-header-cta lp-sheen ml-auto hidden lg:ml-3 lg:inline-flex">Đăng ký ngay <ArrowRight className="ml-2 h-4 w-4" /></Action>
        <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Mở menu" aria-expanded={menuOpen} className="lp-menu-toggle ml-auto rounded-lg p-2 lg:hidden">{menuOpen ? <X /> : <Menu />}</button>
      </div>
      {menuOpen && <nav className="lp-mobile-nav grid px-5 py-3 lg:hidden">{navItems.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>{label}</a>)}</nav>}
      <span className="lp-progress-rail"><span style={{ '--lp-progress': progress } as CSSProperties} /></span>
    </header>

    <main id="dau-trang">
      <section className="lp-hero relative overflow-hidden">
        <div className="lp-hero-grid pointer-events-none absolute inset-0" />
        <div className="lp-hero-aurora lp-hero-aurora--one pointer-events-none absolute" />
        <div className="lp-hero-aurora lp-hero-aurora--two pointer-events-none absolute" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:px-8 lg:py-28">
          <div className="lp-hero-copy">
            <span className="lp-badge inline-flex items-center gap-2" data-reveal style={delay(40)}><Sparkles className="h-3.5 w-3.5" />{c.badge || 'Olympiad · FermatTech'}</span>
            <h1 className="lp-hero-title" data-reveal style={delay(110)}>{c.headline || site.title}</h1>
            <p className="lp-hero-intro" data-reveal style={delay(180)}>{c.intro}</p>
            <div className="lp-hero-actions" data-reveal style={delay(250)}>
              {heroButtons.map((button, index) => <Action key={index} url={button.url} className={`lp-cta lp-sheen ${index === 0 ? 'lp-cta--primary' : 'lp-cta--ghost'}`}>{button.label}<ArrowRight className="h-4 w-4" /></Action>)}
            </div>
            {!!(c.highlights || []).length && <div className="lp-hero-stats">{(c.highlights || []).map((item, i) => <div key={i} className="lp-stat" data-reveal style={delay(320 + i * 70)}><strong>{item.value}</strong><span>{item.label}</span></div>)}</div>}
          </div>
          <div ref={heroArtRef} className="lp-hero-art lp-tilt" data-reveal="zoom" style={delay(220)}>
            <span className="lp-hero-ring lp-hero-ring--one" aria-hidden="true" />
            <span className="lp-hero-ring lp-hero-ring--two" aria-hidden="true" />
            <p className="lp-hero-art-eyebrow">FermatTech</p>
            {schedule.season && <span className="lp-hero-art-chip">Mùa thi {schedule.season}</span>}
            <div className="lp-hero-art-mark"><BookOpen className="h-10 w-10" /><span>{subject || site.slug.toUpperCase()}</span></div>
            <p className="lp-hero-art-body">Tư duy học thuật. Năng lực toàn cầu. Hành trình khám phá bắt đầu từ hôm nay.</p>
            <div className="lp-hero-art-rule" />
            {!!subjectFeatures.length && <div className="lp-hero-art-tags">{subjectFeatures.map(feature => <span key={feature}>{feature}</span>)}</div>}
          </div>
        </div>
      </section>

      {!!schedule.items.length && <section className="lp-season-strip" aria-label="Các mốc chính của mùa thi">
        <div className="lp-season-inner">
          {schedule.items.map((item, index) => <a key={`${item.title}-${index}`} href="#lo-trinh" className={`lp-season-item is-${item.status}`} data-reveal style={delay(index * 60)}>
            <span className="lp-season-date">{item.date ? item.dayMonth : '—'}<i>{item.year || 'đang cập nhật'}</i></span>
            <span className="lp-season-title">{item.title}</span>
            <span className="lp-season-flag">{statusLabel(item.status)}</span>
          </a>)}
        </div>
      </section>}

      <section id="gioi-thieu" className="lp-overview scroll-mt-24 py-20"><div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Heading index={no('gioi-thieu')} eyebrow={`Về ${subject || 'cuộc thi'}`} title={`Một sân chơi dành cho ${subjectName}`} description={subject ? `Khám phá định hướng học thuật và trải nghiệm riêng của ${subject}.` : 'Khám phá định hướng học thuật của cuộc thi.'} />
        <div className="lp-about-panel mt-12 grid gap-8 p-8 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:p-12" data-reveal="zoom">
          <div>
            <span className="lp-about-index">FermatTech · {subject || 'Olympiad'}</span>
            <h3>{aboutEntries[0]?.title || c.headline || site.title}</h3>
            <p>{aboutEntries[0]?.body || c.intro}</p>
            {subject && <Action url="#de-mau" className="lp-about-cta lp-sheen">Khám phá đề mẫu <ArrowRight className="h-4 w-4" /></Action>}
          </div>
          <div className="grid gap-3">
            {subjectFeatures.map((feature, i) => <div key={feature} className="lp-feature" data-reveal="right" style={delay(i * 90)}><span>0{i + 1}</span><strong>{feature}</strong><CheckCircle2 className="ml-auto h-5 w-5" /></div>)}
            {!subjectFeatures.length && aboutEntries.slice(1).map((item, i) => <div key={i} className="lp-feature lp-feature--stacked" data-reveal="right" style={delay(i * 90)}><strong>{item.title}</strong><p>{item.body}</p></div>)}
          </div>
        </div>
      </div></section>

      {subject && <section id="de-mau" className="lp-papers scroll-mt-24 py-20"><div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Heading index={no('de-mau')} eyebrow={`Tài liệu ${subject}`} title={`Đề mẫu ${subjectName} · Lớp 1 đến lớp 9`} description="Chọn khối lớp để xem trực tuyến hoặc tải đề PDF." />
        <div className="lp-paper-grid mt-12">{Array.from({ length: 9 }, (_, i) => i + 1).map((grade, index) => {
          const url = c.papers?.[subject]?.[String(grade)] || '';
          return <article key={`${subject}-${grade}`} className="lp-paper-card" data-reveal style={delay(index * 55)}>
            <span className="lp-paper-watermark" aria-hidden="true">{grade}</span>
            <div className="lp-paper-head"><span className="lp-paper-icon"><FileText className="h-5 w-5" /></span><div><h3>Lớp {grade}</h3><p>Đề mẫu {subject} · PDF</p></div></div>
            <div className="lp-paper-actions">
              <Action url={url} newTab className="lp-paper-link"><ExternalLink className="h-3.5 w-3.5" />Đọc trực tuyến</Action>
              <Action url={url} download={pdfName(subject, grade)} className="lp-paper-link lp-paper-link--solid"><ArrowDownToLine className="h-3.5 w-3.5" />Tải về (.PDF)</Action>
            </div>
            {!url && <p className="lp-paper-empty">Đề mẫu đang được cập nhật</p>}
          </article>;
        })}</div>
      </div></section>}

      <section id="lo-trinh" className="lp-timeline scroll-mt-24 py-20"><div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Heading index={no('lo-trinh')} eyebrow={`Lộ trình ${subject}`} title="Các mốc của mùa thi" description="Ngày thi, hình thức và trạng thái của từng vòng, cập nhật theo thông báo của Ban tổ chức." />
        {schedule.items.length ? <Roadmap schedule={schedule} /> : <p className="lp-timeline-empty" data-reveal>Lịch thi đang được Ban tổ chức hoàn thiện và sẽ công bố tại đây.</p>}
      </div></section>

      <section id="giai-thuong" className="lp-awards scroll-mt-24 py-20"><div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Heading index={no('giai-thuong')} eyebrow={`Vinh danh ${subject}`} title="Cơ cấu giải thưởng" description="Tỷ lệ giải thưởng sẽ được công bố theo thể lệ chính thức." />
        <div className="lp-award-grid mt-12">{(c.awards || []).map((item, i) => <div key={i} className={`lp-award-card lp-award-card--${i < 3 ? i + 1 : 4}`} data-reveal style={delay(i * 90)}>
          <Trophy className="lp-award-icon" />
          <h3>{item.title}</h3>
          <p className="lp-award-percent">{item.percent || '—'}</p>
          <p className="lp-award-note">{item.description || 'Tỷ lệ đang cập nhật'}</p>
        </div>)}</div>
      </div></section>

      <section id="dang-ky" className="lp-registration scroll-mt-24 py-20"><div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Heading index={no('dang-ky')} eyebrow={`Tham gia ${subject}`} title="Đăng ký dự thi" description="Chọn hình thức đăng ký phù hợp với nhà trường hoặc gia đình." />
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <article className="lp-reg-card" data-reveal="left"><span className="lp-reg-index">01</span><span className="lp-reg-kicker">Dành cho nhà trường</span><h3>Đăng ký theo danh sách</h3><p>Tập hợp thông tin học sinh theo mẫu và gửi hồ sơ đăng ký tập thể.</p><div className="lp-reg-actions"><Action url={reg.excelUrl} download="Phu-luc-4-danh-sach-thi-sinh.xlsx" className="lp-reg-ghost"><ArrowDownToLine className="h-4 w-4" />Tải Excel Phụ lục 4</Action><Action url={reg.schoolUrl} className="lp-reg-solid lp-sheen">Đăng ký trường <ArrowRight className="h-4 w-4" /></Action></div></article>
          <article className="lp-reg-card" data-reveal="right"><span className="lp-reg-index">02</span><span className="lp-reg-kicker">Dành cho cá nhân</span><h3>Đăng ký trực tiếp</h3><p>Hoàn thành biểu mẫu đăng ký và xem cẩm nang dự thi.</p><div className="lp-reg-actions"><Action url={reg.individualUrl} className="lp-reg-solid lp-sheen">Mở form đăng ký <ArrowRight className="h-4 w-4" /></Action><Action url={reg.handbookUrl} className="lp-reg-ghost">Xem cẩm nang <BookOpen className="h-4 w-4" /></Action></div></article>
        </div>
      </div></section>

      {(c.customSections || []).map((item, i) => <section key={i} className="lp-custom py-16"><div className="mx-auto max-w-4xl px-5 text-center" data-reveal><h2>{item.title}</h2><p>{item.body}</p>{item.buttonLabel && <Action url={item.buttonUrl} className="lp-cta lp-cta--primary lp-sheen">{item.buttonLabel}<ArrowRight className="h-4 w-4" /></Action>}</div></section>)}

      <section id="lien-he" className="lp-contact scroll-mt-24 py-20"><div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-2 lg:px-8">
        <div data-reveal="left"><span className="lp-contact-kicker">Tư vấn {subject}</span><h2>Để lại thông tin liên hệ</h2><p>Ban tổ chức sẽ liên hệ để hỗ trợ chọn cuộc thi, giải đáp thể lệ và hướng dẫn đăng ký.</p><div className="lp-contact-details">{contact.phone && <a href={`tel:${callNumber}`}><Phone className="h-5 w-5" />{contact.phone}</a>}{contact.email && <a href={`mailto:${contact.email}`}><Mail className="h-5 w-5" />{contact.email}</a>}{contact.address && <p><MapPin className="h-5 w-5 shrink-0" />{contact.address}</p>}</div></div>
        <form onSubmit={submitLead} className="lp-form" aria-label="Đăng ký tư vấn" data-reveal="right">
          <input aria-label="Họ và tên" required value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Họ và tên *" />
          <input aria-label="Điện thoại hoặc Zalo" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Điện thoại / Zalo *" />
          <input aria-label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email" />
          <input aria-label="Trường hoặc thành phố" value={form.schoolCity} onChange={e => setForm({ ...form, schoolCity: e.target.value })} placeholder="Trường / Thành phố" />
          <textarea aria-label="Lời nhắn" rows={4} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Lời nhắn" className="lp-form-wide" />
          <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
          <button disabled={formState === 'sending' || preview} className="lp-form-submit lp-sheen"><Send className="h-4 w-4" />{formState === 'sending' ? 'Đang gửi...' : 'Gửi yêu cầu tư vấn'}</button>
          {formState === 'sent' && <p role="status" className="lp-form-ok"><CheckCircle2 className="h-4 w-4" />Đã gửi thành công. Ban tổ chức sẽ liên hệ với bạn.</p>}
          {formState === 'error' && <p role="alert" className="lp-form-bad">{formError}</p>}
        </form>
      </div></section>

      {crossEntry && <section className="lp-cross py-14" aria-label="Cuộc thi khác của FermatTech">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 md:flex-row md:items-center md:justify-between lg:px-8" data-reveal>
          <div><span>Khám phá thêm tại FermatTech</span><h2>{crossEntry.title}</h2><p>{crossEntry.body}</p></div>
          <Action url={crossEntry.url} className="lp-cross-cta lp-sheen">Đến trang {otherSubject} <ArrowRight className="h-4 w-4" /></Action>
        </div>
      </section>}
    </main>

    <footer className="lp-footer px-5 py-10 text-center"><p className="lp-footer-brand">FermatTech</p><p>{contact.address || 'Eurowindow Multi Complex, 27 Trần Duy Hưng, Hà Nội'} · Hotline <a href={`tel:${callNumber}`}>{contact.phone || '0969 627 162'}</a></p><p className="mt-3">© {new Date().getFullYear()} FermatTech</p></footer>

    <div className={`lp-dock ${preview ? 'absolute' : 'fixed'}`} aria-label="Liên hệ nhanh">
      <Action url={contact.zaloUrl} className="lp-dock-button lp-dock-button--zalo">Zalo</Action>
      <div className="relative" ref={facebookRef}>
        <button type="button" aria-label="Facebook" aria-expanded={facebookOpen} onClick={() => setFacebookOpen(!facebookOpen)} className="lp-dock-button lp-dock-button--facebook"><Facebook className="h-5 w-5" /></button>
        {facebookOpen && <div className="lp-dock-menu">{subject === 'FIMO' ? <Action url={contact.facebookFimoUrl}>FIMO fanpage</Action> : subject === 'FIEO' ? <Action url={contact.facebookFieoUrl}>FIEO fanpage</Action> : <><Action url={contact.facebookFimoUrl}>FIMO fanpage</Action><Action url={contact.facebookFieoUrl}>FIEO fanpage</Action></>}</div>}
      </div>
      <a href={`tel:${callNumber}`} aria-label="Gọi hotline" className="lp-dock-button lp-dock-button--call"><Phone className="h-5 w-5" /></a>
      <a href="#dau-trang" aria-label="Về đầu trang" className={`lp-dock-button lp-dock-button--top ${scrolled || preview ? 'is-visible' : ''}`}><ArrowUp className="h-5 w-5" /></a>
    </div>
  </div>;
}

function Heading({ index, eyebrow, title, description }: { index?: string; eyebrow: string; title: string; description?: string }) {
  return <div className="lp-heading mx-auto max-w-2xl text-center" data-reveal>
    <span className="lp-heading-eyebrow">{index && <b>{index}</b>}{eyebrow}</span>
    <h2>{title}</h2>
    <span className="lp-heading-rule" aria-hidden="true" />
    {description && <p>{description}</p>}
  </div>;
}
