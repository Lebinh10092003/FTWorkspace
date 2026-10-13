import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUp, ArrowUpRight, BookOpen, CalendarDays, Check, ChevronDown, FileText, Mail, MapPin, Menu, Phone, Send, Sparkles, X } from 'lucide-react';
import type { LandingSite } from './LandingSiteView';
import './SiaioLanding.css';
import './LandingMotion.css';
import { countdownLabel, describeMilestones, statusLabel, type MilestoneSummary } from './landingTimeline';
import { useActiveSection, usePointerTilt, useRevealScope, useScrollProgress, useScrolledPast } from './landingMotion';
import ScoArt, { type ScoArtKind } from './ScoArt';

/** Bố cục chung cho các cuộc thi SCO. Mỗi môn có hình minh họa, màu nhấn và vài câu chữ riêng;
 *  phần còn lại (đề mẫu, lộ trình, đăng ký, liên hệ) dùng chung. */
type ScoTheme = { art: ScoArtKind; accent: string; discover: string; about: [string, string]; glyph: string; tags: [string, string, string] };
const SCO_THEMES: Record<string, ScoTheme> = {
  SIAIO: { art: 'ai', accent: '#aabaff', discover: 'Khám phá trí tuệ nhân tạo', about: ['Không gian cho', 'tư duy tương lai.'], glyph: 'AI', tags: ['EXPLORE_01', 'CREATE_02', 'FUTURE_READY'] },
  SIPHO: { art: 'physics', accent: '#7dd3fc', discover: 'Khám phá thế giới Vật lí', about: ['Hiểu thế giới qua', 'những định luật.'], glyph: 'Ph', tags: ['F = m·a', 'E = mc²', 'WAVE_LAB'] },
  SICHO: { art: 'chemistry', accent: '#5eead4', discover: 'Khám phá thế giới Hóa học', about: ['Mỗi phản ứng là', 'một câu hỏi.'], glyph: 'Ch', tags: ['H₂O', 'C₆H₆', 'REACTION_LAB'] },
  SIBO: { art: 'biology', accent: '#a3e635', discover: 'Khám phá thế giới Sinh học', about: ['Tò mò về', 'sự sống quanh ta.'], glyph: 'Bio', tags: ['DNA_HELIX', 'CELL_01', 'ECOSYSTEM'] },
  SILSO: { art: 'sdg', accent: '#fcd34d', discover: 'Kỹ năng sống vì phát triển bền vững', about: ['Kỹ năng sống cho', 'một thế giới bền vững.'], glyph: 'SDGs', tags: ['17 GOALS', 'ACT_LOCAL', 'THINK_GLOBAL'] },
};

const navigation = [
  ['gioi-thieu', 'Khám phá'], ['de-mau', 'Đề mẫu'], ['tai-lieu', 'Tài liệu'], ['lo-trinh', 'Lộ trình'],
  ['dang-ky', 'Đăng ký'], ['lien-he', 'Liên hệ'],
];

function safeUrl(url?: string) {
  const value = (url || '').trim();
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value) ? value : '';
}

const delay = (ms: number) => ({ '--reveal-delay': `${ms}ms` }) as CSSProperties;

function Action({ url, children, className = '', newTab = false }: { url?: string; children: ReactNode; className?: string; newTab?: boolean }) {
  const href = safeUrl(url);
  if (!href) return <span className={`${className} siaio-disabled`} title="Chưa gắn liên kết">{children}</span>;
  const target = newTab || /^https?:\/\//i.test(href) ? '_blank' : undefined;
  return <a className={className} href={href} target={target} rel={target ? 'noopener noreferrer' : undefined}>{children}</a>;
}

/** Lộ trình mùa thi: bảng tóm tắt mùa thi bên trái, các mốc xếp theo trục dọc bên phải. */
function SiaioRoadmap({ schedule }: { schedule: MilestoneSummary }) {
  const { items, next, done, total, season, range } = schedule;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return <div className="siaio-roadmap">
    <aside className="siaio-roadmap-panel" data-reveal="left">
      <span className="siaio-section-code">// MÙA THI {season || 'ĐANG CẬP NHẬT'}</span>
      {next ? <>
        <span className="siaio-roadmap-label">Mốc kế tiếp</span>
        <h3>{next.title}</h3>
        <p className="siaio-roadmap-date"><CalendarDays size={17} />{next.full}</p>
        <p className="siaio-roadmap-count"><span className="siaio-roadmap-dot" aria-hidden="true" />{countdownLabel(next.daysAway)}</p>
      </> : <>
        <span className="siaio-roadmap-label">Trạng thái</span>
        <h3>{schedule.dated ? 'Các mốc đã diễn ra' : 'Lịch thi đang được cập nhật'}</h3>
        <p className="siaio-roadmap-date"><CalendarDays size={17} />{range || 'Ban tổ chức sẽ công bố mốc thời gian sớm nhất.'}</p>
      </>}
      <div className="siaio-roadmap-progress" role="img" aria-label={`Đã qua ${done} trên ${total} mốc`}><span style={{ width: `${percent}%` }} /></div>
      <p className="siaio-roadmap-meta">{done}/{total} mốc đã diễn ra{range ? ` · ${range}` : ''}</p>
    </aside>
    <ol className="siaio-roadmap-track">
      {items.map((item, index) => <li key={`${item.title}-${index}`} className={`siaio-milestone is-${item.status}`} data-reveal style={delay(index * 90)}>
        <span className="siaio-milestone-rail" aria-hidden="true"><i /></span>
        <span className="siaio-milestone-index">{String(item.index + 1).padStart(2, '0')}</span>
        <div className="siaio-milestone-date"><strong>{item.date ? item.dayMonth : '—'}</strong><span>{item.year || 'chưa ấn định'}</span></div>
        <div className="siaio-milestone-body">
          <h3>{item.title}</h3>
          <p>{[item.weekday, item.mode].filter(Boolean).join(' · ') || 'Hình thức thi sẽ được Ban tổ chức thông báo'}</p>
        </div>
        <span className="siaio-milestone-status">{statusLabel(item.status)}{item.status === 'next' && item.daysAway !== null ? ` · ${countdownLabel(item.daysAway)}` : ''}</span>
      </li>)}
    </ol>
  </div>;
}

export default function SiaioLandingView({ site, preview = false }: { site: LandingSite; preview?: boolean }) {
  const c = site.content || {};
  const code = (c.subject || 'SIAIO').trim();
  const theme = SCO_THEMES[code.toUpperCase()] || SCO_THEMES.SIAIO;
  const reg = { ...(c.registration || {}), ...(!preview ? { individualUrl: `/dang-ky-du-thi?cuoc-thi=${encodeURIComponent(code.toUpperCase())}` } : {}) };
  const contact = c.contact || {};
  const [menuOpen, setMenuOpen] = useState(false);
  const subjects = (c.paperSubjects?.length ? c.paperSubjects : Object.keys(c.papers || {})).filter(Boolean);
  const [chosenSubject, setChosenSubject] = useState('');
  const [grade, setGrade] = useState(1);
  const subject = subjects.includes(chosenSubject) ? chosenSubject : subjects[0] || '';
  const paperUrl = c.papers?.[subject]?.[String(grade)] || '';
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', schoolCity: '', message: '', website: '' });
  const [formState, setFormState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [formError, setFormError] = useState('');
  const numeric = (value: number | undefined, fallback: number, min: number, max: number) => `${Math.max(min, Math.min(max, Number(value) || fallback))}px`;
  const pageStyle = {
    '--siaio-hero-size': numeric(c.style?.heroTitleSize, 78, 30, 100),
    '--siaio-intro-size': numeric(c.style?.introSize, 19, 14, 30),
    '--siaio-button-size': numeric(c.style?.buttonSize, 14, 12, 28),
    '--siaio-button-padding': numeric(c.style?.buttonPadding, 15, 8, 28),
    '--siaio-heading-size': numeric(c.style?.sectionTitleSize, 44, 24, 64),
    '--siaio-accent': /^#[0-9a-fA-F]{6}$/.test(c.style?.accentColor || '') ? c.style!.accentColor : theme.accent,
  } as CSSProperties;
  const buttons = c.buttons?.length ? c.buttons.map(button => !preview && /đăng ký|tham gia/i.test(button.label) ? { ...button, url: reg.individualUrl || '#dang-ky' } : button) : [
    { label: 'Đăng ký dự thi', url: '#dang-ky' }, { label: 'Xem đề mẫu', url: '#de-mau' },
  ];
  const headline = c.headline || `${code} · ${theme.discover}`;
  const headlineParts = headline.match(/^([A-Za-z]{3,8})\s*[·—:-]\s*(.+)$/);
  const overview = c.overview || [];
  const highlights = c.highlights || [];
  const phoneHref = (contact.phone || '').replace(/\D/g, '');
  const schedule = useMemo(() => describeMilestones(c.timeline), [c.timeline]);
  const motion = !preview;
  const rootRef = useRevealScope<HTMLDivElement>(motion, site.id);
  const artRef = usePointerTilt<HTMLDivElement>(motion, 6);
  const progress = useScrollProgress(motion);
  const navItems = navigation.filter(([id]) => id !== 'tai-lieu' || !!c.resources?.length);
  const activeSection = useActiveSection(navItems.map(([id]) => id), motion);
  const scrolled = useScrolledPast(600, motion);

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

  const paperFolder = c.resources?.find(item => /^đề/i.test(item.category || '') && safeUrl(item.url))?.url || '';

  return <div ref={rootRef} className={`siaio-site ${motion ? 'landing-motion' : ''}`} data-sco={theme.art} style={pageStyle}>
    <header className={`siaio-header ${preview ? '' : 'is-sticky'}`}>
      <a href="#dau-trang" className="siaio-brand" aria-label={`${code} về đầu trang`}><span className="siaio-brand-mark">S<span>✳</span></span><span><strong>{code}</strong><small>FermatTech · SCO</small></span></a>
      <nav className="siaio-nav" aria-label={`Điều hướng ${code}`}>{navItems.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'true' : undefined} className={activeSection === id ? 'is-active' : ''}>{label}</a>)}{!preview && <a href="/cuoc-thi">Các cuộc thi</a>}</nav>
      <Action url={reg.individualUrl || '#dang-ky'} className="siaio-header-cta">Tham gia ngay <ArrowUpRight size={16} /></Action>
      <button className="siaio-menu-toggle" type="button" aria-label="Mở menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      {menuOpen && <nav className="siaio-mobile-nav" aria-label="Điều hướng di động">{navItems.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>{label}</a>)}{!preview && <a href="/cuoc-thi">Các cuộc thi khác</a>}</nav>}
      <span className="lp-progress-rail siaio-progress"><span style={{ '--lp-progress': progress } as CSSProperties} /></span>
    </header>

    <main id="dau-trang">
      <section className="siaio-hero">
        <div className="siaio-grid-overlay" aria-hidden="true" />
        <div className="siaio-hero-aurora" aria-hidden="true" />
        <div className="siaio-hero-inner">
          <div className="siaio-hero-copy">
            <span className="siaio-kicker" data-reveal style={delay(40)}><span className="siaio-pulse" />{c.badge || `SCO · ${code}`}</span>
            <p className="siaio-hero-overline" data-reveal style={delay(110)}>THE NEXT GENERATION / 2026—2027</p>
            <h1 data-reveal style={delay(170)}>{headlineParts ? <><span className="siaio-title-code">{headlineParts[1]}</span><span className="siaio-title-rest">{headlineParts[2]}</span></> : headline}</h1>
            <p className="siaio-hero-intro" data-reveal style={delay(240)}>{c.intro}</p>
            <div className="siaio-hero-actions" data-reveal style={delay(310)}>{buttons.map((button, index) => <Action key={index} url={button.url} className={`siaio-button lp-sheen ${index ? 'siaio-button--outline' : 'siaio-button--primary'}`}>{button.label} {index ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}</Action>)}</div>
            <div className="siaio-hero-caption" data-reveal style={delay(380)}><span>01 / 04</span><span>KHÁM PHÁ · THỬ THÁCH · SÁNG TẠO</span></div>
          </div>
          <div ref={artRef} className="siaio-neural-wrap lp-tilt" data-reveal="zoom" style={delay(260)}><ScoArt kind={theme.art} animated={motion} tags={theme.tags} /></div>
        </div>
        {!!highlights.length && <div className="siaio-signal-strip">{highlights.map((item, index) => <div key={index} className="siaio-signal" data-reveal style={delay(index * 70)}><span className="siaio-signal-index">0{index + 1}</span><strong>{item.value}</strong><span>{item.label}</span></div>)}</div>}
      </section>

      <section id="gioi-thieu" className="siaio-about siaio-section">
        <div className="siaio-section-lead" data-reveal><span className="siaio-section-code">// 01 · GIỚI THIỆU</span><h2>{theme.about[0]} <em>{theme.about[1]}</em></h2><p>{c.intro}</p></div>
        <div className="siaio-about-grid">
          <div className="siaio-about-feature" data-reveal="left"><span className="siaio-feature-orb" aria-hidden="true"><Sparkles size={52} /></span><span className="siaio-card-code">{code.toUpperCase()} / DISCOVER</span><h3>{overview[0]?.title || theme.discover}</h3><p>{overview[0]?.body || c.intro}</p><Action url={overview[0]?.url || '#de-mau'} className="siaio-text-link">Khám phá đề mẫu <ArrowUpRight size={18} /></Action></div>
          <div className="siaio-about-stack">{overview.slice(1).map((item, index) => <article className="siaio-about-tile" key={index} data-reveal="right" style={delay(index * 90)}><span>0{index + 2} / EXPLORE</span><h3>{item.title}</h3><p>{item.body}</p>{item.url && <Action url={item.url} className="siaio-text-link">Tìm hiểu thêm <ArrowUpRight size={18} /></Action>}</article>)}<div className="siaio-about-tile siaio-about-tile--graphic" data-reveal="right" style={delay(overview.length * 90)}><span>IDEA → IMPACT</span><strong>{theme.glyph}<span>∞</span></strong><p>Học hỏi qua thử thách và khám phá khả năng của bản thân.</p></div></div>
        </div>
      </section>

      <section id="de-mau" className="siaio-paper-section siaio-section">
        <div className="siaio-paper-heading" data-reveal><div><span className="siaio-section-code">// 02 · TÀI LIỆU</span><h2>Chọn môn.<br /><em>Chọn lớp.</em> Xem đề.</h2></div><p>Một khu vực tra cứu gọn cho các môn thi và khối lớp. Chọn thông tin phù hợp để mở đúng đề mẫu.</p></div>
        <div className="siaio-paper-console" data-reveal="zoom"><div className="siaio-console-bar"><div><i /><i /><i /></div><span>{code.toUpperCase()} / PAPER_EXPLORER</span><span>● ONLINE</span></div><div className="siaio-console-body"><div className="siaio-console-prompt"><span>01 / CONFIGURE</span><h3>Thiết lập đề mẫu</h3><p>Chọn môn thi và lớp muốn xem.</p></div><div className="siaio-console-controls"><label>Môn thi<span className="siaio-select-wrap"><select aria-label="Chọn môn thi" value={subject} onChange={event => setChosenSubject(event.target.value)} disabled={!subjects.length}>{subjects.length ? subjects.map(item => <option key={item} value={item}>{item}</option>) : <option>Chưa có môn thi</option>}</select><ChevronDown size={18} /></span></label><label>Lớp<span className="siaio-select-wrap"><select aria-label="Chọn lớp xem đề mẫu" value={grade} onChange={event => setGrade(Number(event.target.value))}>{Array.from({ length: 12 }, (_, i) => i + 1).map(value => <option value={value} key={value}>Lớp {value}</option>)}</select><ChevronDown size={18} /></span></label></div><div className="siaio-paper-result"><div className="siaio-document-icon"><FileText size={30} /></div><div><span>02 / RESULT</span><h4>{subject || 'Môn thi'} · Lớp {grade}</h4><p>{paperUrl ? 'Đề mẫu PDF đã sẵn sàng' : paperFolder ? 'Xem đề tham khảo trong thư mục chung của SCO' : 'Đề mẫu đang được cập nhật'}</p></div><Action url={paperUrl || paperFolder} newTab className="siaio-button siaio-button--primary lp-sheen">{paperUrl ? 'Xem đề mẫu' : 'Mở thư mục đề'} <ArrowUpRight size={18} /></Action></div></div></div>
      </section>

      {!!c.resources?.length && <section id="tai-lieu" className="siaio-resources siaio-section"><div className="siaio-resource-heading" data-reveal><span className="siaio-section-code">// TÀI LIỆU CHÍNH THỨC</span><h2>Học liệu và <em>hồ sơ tổ chức.</em></h2><p>Tra cứu thể lệ {code}, thông tin Ban tổ chức và học liệu các môn trong hệ SCO.</p></div><div className="siaio-resource-grid">{c.resources.filter(item => safeUrl(item.url)).map((item, index) => <article key={`${item.title}-${index}`} className="siaio-resource-card" data-reveal style={delay(index * 70)}><span>{item.category}</span><h3>{item.title}</h3><p>{item.body}</p><Action url={item.url} newTab className="siaio-text-link">Xem tài liệu <ArrowUpRight size={17} /></Action></article>)}</div></section>}

      <section id="lo-trinh" className="siaio-timeline-section siaio-section">
        <div className="siaio-timeline-head" data-reveal><div><span className="siaio-section-code">// 03 · LỘ TRÌNH</span><h2>Những cột mốc<br /><em>trên hành trình.</em></h2></div><p>Ngày thi, hình thức và trạng thái của từng vòng, cập nhật theo thông báo của Ban tổ chức.</p></div>
        {schedule.items.length ? <SiaioRoadmap schedule={schedule} /> : <p className="siaio-timeline-empty" data-reveal>Lịch thi đang được Ban tổ chức hoàn thiện và sẽ công bố tại đây.</p>}
      </section>

      {!!c.awards?.length && <section id="giai-thuong" className="siaio-awards siaio-section"><div data-reveal><span className="siaio-section-code">// VINH DANH</span><h2>Ghi dấu hành trình.</h2></div><div className="siaio-award-grid">{c.awards.map((award, index) => <article key={index} data-reveal style={delay(index * 80)}><span>0{index + 1}</span><h3>{award.title}</h3><strong>{award.percent || '—'}</strong><p>{award.description}</p></article>)}</div></section>}

      <section id="dang-ky" className="siaio-registration siaio-section"><div className="siaio-registration-head" data-reveal><span className="siaio-section-code">// 04 · THAM GIA</span><h2>Sẵn sàng bước vào<br /><em>hành trình {code}?</em></h2><p>Chọn cách đăng ký phù hợp với nhà trường hoặc cá nhân.</p></div><div className="siaio-registration-grid"><article data-reveal="left"><span className="siaio-reg-no">01 / NHÀ TRƯỜNG</span><h3>Đăng ký theo danh sách</h3><p>Tập hợp thông tin học sinh theo mẫu và gửi hồ sơ đăng ký tập thể.</p><div className="siaio-reg-actions"><Action url={reg.schoolUrl} className="siaio-button siaio-button--primary lp-sheen">Đăng ký trường <ArrowUpRight size={18} /></Action><Action url={reg.excelUrl} className="siaio-text-link">Mở mẫu Excel <ArrowRight size={17} /></Action></div></article><article data-reveal="right"><span className="siaio-reg-no">02 / CÁ NHÂN</span><h3>Đăng ký trực tiếp</h3><p>Hoàn thành biểu mẫu đăng ký và xem hướng dẫn dự thi.</p><div className="siaio-reg-actions"><Action url={reg.individualUrl} className="siaio-button siaio-button--outline">Mở form đăng ký <ArrowUpRight size={18} /></Action><Action url={reg.handbookUrl} className="siaio-text-link">Xem hướng dẫn <BookOpen size={17} /></Action></div></article></div></section>

      {(c.customSections || []).map((item, index) => <section className="siaio-custom siaio-section" key={index}><div data-reveal><span className="siaio-section-code">// {code.toUpperCase()} · THÔNG TIN</span><h2>{item.title}</h2><p>{item.body}</p>{item.buttonLabel && <Action url={item.buttonUrl} className="siaio-button siaio-button--outline">{item.buttonLabel} <ArrowUpRight size={18} /></Action>}</div></section>)}

      <section id="lien-he" className="siaio-contact siaio-section"><div className="siaio-contact-copy" data-reveal="left"><span className="siaio-section-code">// KẾT NỐI</span><h2>Cần thêm<br /><em>thông tin?</em></h2><p>Để lại thông tin, Ban tổ chức sẽ liên hệ và hỗ trợ đăng ký.</p><div className="siaio-contact-details">{contact.phone && <a href={`tel:${phoneHref}`}><Phone size={18} />{contact.phone}</a>}{contact.email && <a href={`mailto:${contact.email}`}><Mail size={18} />{contact.email}</a>}{contact.address && <span><MapPin size={18} />{contact.address}</span>}</div></div><form className="siaio-form" onSubmit={submitLead} aria-label="Đăng ký tư vấn" data-reveal="right"><div className="siaio-form-top"><span>LET'S CONNECT</span><Sparkles size={24} /></div><label>Họ và tên *<input required value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} placeholder="Nhập họ và tên" /></label><div className="siaio-form-split"><label>Điện thoại / Zalo *<input required value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} placeholder="Số điện thoại" /></label><label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="Email liên hệ" /></label></div><label>Trường / Thành phố<input value={form.schoolCity} onChange={event => setForm({ ...form, schoolCity: event.target.value })} placeholder="Trường hoặc thành phố" /></label><label>Lời nhắn<textarea rows={3} value={form.message} onChange={event => setForm({ ...form, message: event.target.value })} placeholder="Bạn cần hỗ trợ điều gì?" /></label><input tabIndex={-1} autoComplete="off" aria-hidden="true" className="siaio-honeypot" value={form.website} onChange={event => setForm({ ...form, website: event.target.value })} /><button type="submit" disabled={preview || formState === 'sending'} className="siaio-button siaio-button--primary lp-sheen"><Send size={17} />{formState === 'sending' ? 'Đang gửi...' : 'Gửi yêu cầu tư vấn'}</button>{formState === 'sent' && <p role="status" className="siaio-form-success"><Check size={17} />Đã gửi thành công. Ban tổ chức sẽ liên hệ với bạn.</p>}{formState === 'error' && <p role="alert" className="siaio-form-error">{formError}</p>}</form></section>
    </main>
    <footer className="siaio-footer"><a href="#dau-trang" className="siaio-footer-logo">{code}<span>✳</span></a><span>FermatTech · SCO</span><span>© {new Date().getFullYear()} FermatTech</span><a href="#dau-trang">Về đầu trang <ArrowUpRight size={15} /></a></footer>
    {!preview && <a href="#dau-trang" aria-label="Về đầu trang" className={`siaio-to-top ${scrolled ? 'is-visible' : ''}`}><ArrowUp size={19} /></a>}
  </div>;
}
