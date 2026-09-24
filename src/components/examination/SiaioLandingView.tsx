import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, ChevronDown, FileText, Mail, MapPin, Menu, Phone, Send, Sparkles, X } from 'lucide-react';
import type { LandingSite } from './LandingSiteView';
import './SiaioLanding.css';

const navigation = [
  ['gioi-thieu', 'Khám phá'], ['de-mau', 'Đề mẫu'], ['lo-trinh', 'Lộ trình'],
  ['dang-ky', 'Đăng ký'], ['lien-he', 'Liên hệ'],
];

function safeUrl(url?: string) {
  const value = (url || '').trim();
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value) ? value : '';
}

function Action({ url, children, className = '', newTab = false }: { url?: string; children: ReactNode; className?: string; newTab?: boolean }) {
  const href = safeUrl(url);
  if (!href) return <span className={`${className} siaio-disabled`} title="Chưa gắn liên kết">{children}</span>;
  const target = newTab || /^https?:\/\//i.test(href) ? '_blank' : undefined;
  return <a className={className} href={href} target={target} rel={target ? 'noopener noreferrer' : undefined}>{children}</a>;
}

function displayDate(date?: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date!.split('-').reverse().join('/') : date || 'Đang cập nhật';
}

function NeuralArt() {
  const nodes = [
    [92, 72], [241, 45], [369, 105], [476, 46], [53, 218], [166, 188],
    [321, 221], [503, 211], [89, 366], [235, 340], [397, 373], [518, 335],
  ];
  const edges = [[0, 1], [0, 4], [1, 2], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5],
    [4, 8], [5, 6], [5, 9], [6, 7], [6, 10], [7, 11], [8, 9], [9, 10], [10, 11]];
  return <div className="siaio-neural" aria-hidden="true">
    <div className="siaio-neural-halo" />
    <svg viewBox="0 0 570 430" className="siaio-neural-svg">
      <defs><linearGradient id="siaio-line"><stop stopColor="#38e5ff" /><stop offset="1" stopColor="#a481ff" /></linearGradient></defs>
      {edges.map(([a, b], index) => <line key={index} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke="url(#siaio-line)" strokeWidth="1.1" opacity={index % 3 === 0 ? '.66' : '.32'} />)}
      {nodes.map(([x, y], index) => <g key={index}><circle cx={x} cy={y} r={index === 6 ? 8 : 4} fill={index % 3 === 0 ? '#b5ff6d' : '#46dffc'} /><circle cx={x} cy={y} r={index === 6 ? 23 : 13} fill="none" stroke="#8eeaff" opacity=".25" /></g>)}
      <circle cx="285" cy="213" r="104" fill="none" stroke="#55dff5" strokeDasharray="3 8" opacity=".42" />
      <circle cx="285" cy="213" r="75" fill="#0e2038" stroke="#70d5f5" strokeWidth="1" opacity=".92" />
      <text x="285" y="232" textAnchor="middle" fontSize="70" fontWeight="900" fill="#e8fbff" letterSpacing="-8">AI</text>
    </svg>
    <span className="siaio-neural-tag siaio-neural-tag--one">EXPLORE_01</span>
    <span className="siaio-neural-tag siaio-neural-tag--two">CREATE_02</span>
    <span className="siaio-neural-tag siaio-neural-tag--three">FUTURE_READY</span>
  </div>;
}

export default function SiaioLandingView({ site, preview = false }: { site: LandingSite; preview?: boolean }) {
  const c = site.content || {};
  const reg = c.registration || {};
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
    '--siaio-accent': /^#[0-9a-fA-F]{6}$/.test(c.style?.accentColor || '') ? c.style!.accentColor : '#54e8f5',
  } as CSSProperties;
  const buttons = c.buttons?.length ? c.buttons : [
    { label: 'Đăng ký dự thi', url: '#dang-ky' }, { label: 'Xem đề mẫu', url: '#de-mau' },
  ];
  const timeline = c.timeline || [];
  const overview = c.overview || [];
  const highlights = c.highlights || [];
  const phoneHref = (contact.phone || '').replace(/\D/g, '');

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

  return <div className="siaio-site" style={pageStyle}>
    <header className="siaio-header">
      <a href="#dau-trang" className="siaio-brand" aria-label="SIAIO về đầu trang"><span className="siaio-brand-mark">S<span>✳</span></span><span><strong>SIAIO</strong><small>FermatTech · SCO</small></span></a>
      <nav className="siaio-nav" aria-label="Điều hướng SIAIO">{navigation.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
      <Action url={reg.individualUrl || '#dang-ky'} className="siaio-header-cta">Tham gia ngay <ArrowUpRight size={16} /></Action>
      <button className="siaio-menu-toggle" type="button" aria-label="Mở menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      {menuOpen && <nav className="siaio-mobile-nav" aria-label="Điều hướng di động">{navigation.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>{label}</a>)}</nav>}
    </header>

    <main id="dau-trang">
      <section className="siaio-hero">
        <div className="siaio-grid-overlay" aria-hidden="true" />
        <div className="siaio-hero-inner">
          <div className="siaio-hero-copy">
            <span className="siaio-kicker"><span className="siaio-pulse" />{c.badge || 'SCO · Olympiad trí tuệ nhân tạo'}</span>
            <p className="siaio-hero-overline">THE NEXT GENERATION / 2026—2027</p>
            <h1>{c.headline || 'SIAIO · Khám phá trí tuệ nhân tạo'}</h1>
            <p className="siaio-hero-intro">{c.intro}</p>
            <div className="siaio-hero-actions">{buttons.map((button, index) => <Action key={index} url={button.url} className={`siaio-button ${index ? 'siaio-button--outline' : 'siaio-button--primary'}`}>{button.label} {index ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}</Action>)}</div>
            <div className="siaio-hero-caption"><span>01 / 04</span><span>KHÁM PHÁ · THỬ THÁCH · SÁNG TẠO</span></div>
          </div>
          <NeuralArt />
        </div>
        {!!highlights.length && <div className="siaio-signal-strip">{highlights.map((item, index) => <div key={index} className="siaio-signal"><span className="siaio-signal-index">0{index + 1}</span><strong>{item.value}</strong><span>{item.label}</span></div>)}</div>}
      </section>

      <section id="gioi-thieu" className="siaio-about siaio-section">
        <div className="siaio-section-lead"><span className="siaio-section-code">// 01 · GIỚI THIỆU</span><h2>Không gian cho <em>tư duy tương lai.</em></h2><p>{c.intro}</p></div>
        <div className="siaio-about-grid">
          <div className="siaio-about-feature"><span className="siaio-feature-orb" aria-hidden="true"><Sparkles size={52} /></span><span className="siaio-card-code">SIAIO / DISCOVER</span><h3>{overview[0]?.title || 'Khám phá trí tuệ nhân tạo'}</h3><p>{overview[0]?.body || c.intro}</p><Action url={overview[0]?.url || '#de-mau'} className="siaio-text-link">Khám phá đề mẫu <ArrowUpRight size={18} /></Action></div>
          <div className="siaio-about-stack">{overview.slice(1).map((item, index) => <article className="siaio-about-tile" key={index}><span>0{index + 2} / EXPLORE</span><h3>{item.title}</h3><p>{item.body}</p>{item.url && <Action url={item.url} className="siaio-text-link">Tìm hiểu thêm <ArrowUpRight size={18} /></Action>}</article>)}<div className="siaio-about-tile siaio-about-tile--graphic"><span>IDEA → IMPACT</span><strong>AI<span>∞</span></strong><p>Học hỏi qua thử thách và khám phá khả năng của bản thân.</p></div></div>
        </div>
      </section>

      <section id="de-mau" className="siaio-paper-section siaio-section">
        <div className="siaio-paper-heading"><div><span className="siaio-section-code">// 02 · TÀI LIỆU</span><h2>Chọn môn.<br /><em>Chọn lớp.</em> Xem đề.</h2></div><p>Một khu vực tra cứu gọn cho các môn thi và khối lớp. Chọn thông tin phù hợp để mở đúng đề mẫu.</p></div>
        <div className="siaio-paper-console"><div className="siaio-console-bar"><div><i /><i /><i /></div><span>SIAIO / PAPER_EXPLORER</span><span>● ONLINE</span></div><div className="siaio-console-body"><div className="siaio-console-prompt"><span>01 / CONFIGURE</span><h3>Thiết lập đề mẫu</h3><p>Chọn môn thi và lớp muốn xem.</p></div><div className="siaio-console-controls"><label>Môn thi<span className="siaio-select-wrap"><select aria-label="Chọn môn thi" value={subject} onChange={event => setChosenSubject(event.target.value)} disabled={!subjects.length}>{subjects.length ? subjects.map(item => <option key={item} value={item}>{item}</option>) : <option>Chưa có môn thi</option>}</select><ChevronDown size={18} /></span></label><label>Lớp<span className="siaio-select-wrap"><select aria-label="Chọn lớp xem đề mẫu" value={grade} onChange={event => setGrade(Number(event.target.value))}>{Array.from({ length: 12 }, (_, i) => i + 1).map(value => <option value={value} key={value}>Lớp {value}</option>)}</select><ChevronDown size={18} /></span></label></div><div className="siaio-paper-result"><div className="siaio-document-icon"><FileText size={30} /></div><div><span>02 / RESULT</span><h4>{subject || 'Môn thi'} · Lớp {grade}</h4><p>{paperUrl ? 'Đề mẫu PDF đã sẵn sàng' : 'Đề mẫu đang được cập nhật'}</p></div><Action url={paperUrl} newTab className="siaio-button siaio-button--primary">Xem đề mẫu <ArrowUpRight size={18} /></Action></div></div></div>
      </section>

      <section id="lo-trinh" className="siaio-timeline-section siaio-section"><div className="siaio-timeline-head"><div><span className="siaio-section-code">// 03 · LỘ TRÌNH</span><h2>Những cột mốc<br /><em>trên hành trình.</em></h2></div><p>Các mốc của mùa thi được cập nhật theo thông tin từ Ban tổ chức.</p></div><div className="siaio-timeline-list">{timeline.map((item, index) => <article className="siaio-timeline-row" key={index}><span className="siaio-timeline-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{item.title}</h3><p>{item.mode}</p></div><span className="siaio-timeline-date"><CalendarDays size={18} />{displayDate(item.date)}</span><ArrowUpRight className="siaio-timeline-arrow" size={23} /></article>)}</div></section>

      {!!c.awards?.length && <section id="giai-thuong" className="siaio-awards siaio-section"><span className="siaio-section-code">// VINH DANH</span><h2>Ghi dấu hành trình.</h2><div className="siaio-award-grid">{c.awards.map((award, index) => <article key={index}><span>0{index + 1}</span><h3>{award.title}</h3><strong>{award.percent || '—'}</strong><p>{award.description}</p></article>)}</div></section>}

      <section id="dang-ky" className="siaio-registration siaio-section"><div className="siaio-registration-head"><span className="siaio-section-code">// 04 · THAM GIA</span><h2>Sẵn sàng bước vào<br /><em>hành trình SIAIO?</em></h2><p>Chọn cách đăng ký phù hợp với nhà trường hoặc cá nhân.</p></div><div className="siaio-registration-grid"><article><span className="siaio-reg-no">01 / NHÀ TRƯỜNG</span><h3>Đăng ký theo danh sách</h3><p>Tập hợp thông tin học sinh theo mẫu và gửi hồ sơ đăng ký tập thể.</p><div className="siaio-reg-actions"><Action url={reg.schoolUrl} className="siaio-button siaio-button--primary">Đăng ký trường <ArrowUpRight size={18} /></Action><Action url={reg.excelUrl} className="siaio-text-link">Tải mẫu Excel <ArrowRight size={17} /></Action></div></article><article><span className="siaio-reg-no">02 / CÁ NHÂN</span><h3>Đăng ký trực tiếp</h3><p>Hoàn thành biểu mẫu đăng ký và xem cẩm nang dự thi.</p><div className="siaio-reg-actions"><Action url={reg.individualUrl} className="siaio-button siaio-button--outline">Mở form đăng ký <ArrowUpRight size={18} /></Action><Action url={reg.handbookUrl} className="siaio-text-link">Xem cẩm nang <BookOpen size={17} /></Action></div></article></div></section>

      {(c.customSections || []).map((item, index) => <section className="siaio-custom siaio-section" key={index}><span className="siaio-section-code">// SIAIO · THÔNG TIN</span><h2>{item.title}</h2><p>{item.body}</p>{item.buttonLabel && <Action url={item.buttonUrl} className="siaio-button siaio-button--outline">{item.buttonLabel} <ArrowUpRight size={18} /></Action>}</section>)}

      <section id="lien-he" className="siaio-contact siaio-section"><div className="siaio-contact-copy"><span className="siaio-section-code">// KẾT NỐI</span><h2>Cần thêm<br /><em>thông tin?</em></h2><p>Để lại thông tin, Ban tổ chức sẽ liên hệ và hỗ trợ đăng ký.</p><div className="siaio-contact-details">{contact.phone && <a href={`tel:${phoneHref}`}><Phone size={18} />{contact.phone}</a>}{contact.email && <a href={`mailto:${contact.email}`}><Mail size={18} />{contact.email}</a>}{contact.address && <span><MapPin size={18} />{contact.address}</span>}</div></div><form className="siaio-form" onSubmit={submitLead} aria-label="Đăng ký tư vấn"><div className="siaio-form-top"><span>LET'S CONNECT</span><Sparkles size={24} /></div><label>Họ và tên *<input required value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} placeholder="Nhập họ và tên" /></label><div className="siaio-form-split"><label>Điện thoại / Zalo *<input required value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} placeholder="Số điện thoại" /></label><label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="Email liên hệ" /></label></div><label>Trường / Thành phố<input value={form.schoolCity} onChange={event => setForm({ ...form, schoolCity: event.target.value })} placeholder="Trường hoặc thành phố" /></label><label>Lời nhắn<textarea rows={3} value={form.message} onChange={event => setForm({ ...form, message: event.target.value })} placeholder="Bạn cần hỗ trợ điều gì?" /></label><input tabIndex={-1} autoComplete="off" aria-hidden="true" className="siaio-honeypot" value={form.website} onChange={event => setForm({ ...form, website: event.target.value })} /><button type="submit" disabled={preview || formState === 'sending'} className="siaio-button siaio-button--primary"><Send size={17} />{formState === 'sending' ? 'Đang gửi...' : 'Gửi yêu cầu tư vấn'}</button>{formState === 'sent' && <p role="status" className="siaio-form-success"><Check size={17} />Đã gửi thành công. Ban tổ chức sẽ liên hệ với bạn.</p>}{formState === 'error' && <p role="alert" className="siaio-form-error">{formError}</p>}</form></section>
    </main>
    <footer className="siaio-footer"><a href="#dau-trang" className="siaio-footer-logo">SIAIO<span>✳</span></a><span>FermatTech · SCO</span><span>© {new Date().getFullYear()} FermatTech</span><a href="#dau-trang">Về đầu trang <ArrowUpRight size={15} /></a></footer>
  </div>;
}
