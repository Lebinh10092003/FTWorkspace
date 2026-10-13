/** Trang tổng /cuoc-thi: thông tin các cuộc thi sắp tổ chức, viết cho nhà trường và phụ huynh.
 *  Dữ liệu lấy từ các landing đã công bố, nên cuộc thi mới tự xuất hiện khi landing được bật. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, FileSpreadsheet, Mail, MapPin, Phone, Printer, School, Send, Sparkles, Trophy } from 'lucide-react';
import './LandingMotion.css';
import './CompetitionHub.css';
import { publicRegistrationLink } from './publicRegistrationLink';
import { countdownLabel, describeMilestones, parseLandingDate, type MilestoneSummary } from './landingTimeline';
import { usePointerTilt, useRevealScope, useScrollProgress } from './landingMotion';

type HubContent = {
  subject?: string; badge?: string; headline?: string; intro?: string; logoUrl?: string; accentColor?: string;
  highlights?: Array<{ value: string; label: string }>;
  timeline?: Array<{ title: string; date: string; mode: string }>;
  contact?: { email?: string; phone?: string; address?: string };
  registration?: { excelUrl?: string; handbookUrl?: string; schoolUrl?: string };
};
type HubSite = { slug: string; title: string; layout: string; content: HubContent };

type Competition = {
  slug: string;
  code: string;
  name: string;
  badge: string;
  intro: string;
  logoUrl: string;
  accent: string;
  highlights: Array<{ value: string; label: string }>;
  summary: MilestoneSummary;
  register: string;
  excelUrl: string;
  handbookUrl: string;
};

type SeasonEntry = { key: string; date: Date; iso: string; title: string; mode: string; code: string; accent: string; slug: string; past: boolean };

/** Màu riêng khi landing chưa chọn màu nhấn, để các cuộc thi không trùng màu nhau. */
const CODE_ACCENTS: Record<string, string> = { FIMO: '#2f6bff', FIEO: '#ff6b3d', SIAIO: '#8b5cf6', SIPHO: '#0ea5e9', SICHO: '#10b981', SIBO: '#22c55e', SILSO: '#f5b700' };
const FALLBACK_ACCENTS =['#2f80ff', '#ff6b3d', '#8b5cf6', '#10b981', '#f5b700', '#ec4899'];
const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
const DAY_MS = 86_400_000;
const HEX = /^#[0-9a-fA-F]{6}$/;
const safeLink = (url?: string) => (/^(https?:\/\/|\/(?!\/))/i.test((url || '').trim()) ? (url || '').trim() : '');

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const delay = (ms: number) => ({ '--reveal-delay': `${ms}ms` }) as CSSProperties;

function splitHeadline(site: HubSite) {
  const code = (site.content.subject || site.title.split(/[\s·—-]+/)[0] || site.title).trim();
  const headline = (site.content.headline || site.title).trim();
  const parts = headline.split(/\s+[—·–-]\s+/);
  const name = parts.length > 1 ? parts.slice(1).join(' · ') : headline;
  return { code, name: name.toUpperCase() === code.toUpperCase() ? site.title : name };
}

function toCompetition(site: HubSite, index: number): Competition {
  const { code, name } = splitHeadline(site);
  const accent = HEX.test(site.content.accentColor || '') ? site.content.accentColor! : CODE_ACCENTS[code.toUpperCase()] || FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length];
  return {
    slug: site.slug,
    code,
    name,
    badge: site.content.badge || '',
    intro: site.content.intro || '',
    logoUrl: site.content.logoUrl || '',
    accent,
    highlights: (site.content.highlights || []).filter(item => item?.value).slice(0, 3),
    summary: describeMilestones(site.content.timeline),
    register: publicRegistrationLink(site.slug, `${site.title} ${code}`),
    excelUrl: safeLink(site.content.registration?.excelUrl),
    handbookUrl: safeLink(site.content.registration?.handbookUrl),
  };
}

/** Cuộc thi có mốc gần nhất lên trước; mùa đã xong xuống cuối. */
function byNextMilestone(a: Competition, b: Competition) {
  const da = a.summary.next?.daysAway ?? Number.POSITIVE_INFINITY;
  const db = b.summary.next?.daysAway ?? Number.POSITIVE_INFINITY;
  return da - db || a.code.localeCompare(b.code);
}

/** Đếm ngược theo giây tới 0h ngày thi. */
function useCountdown(target: Date | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  if (!target) return null;
  const remaining = Math.max(0, target.getTime() - now);
  return {
    days: Math.floor(remaining / DAY_MS),
    hours: Math.floor(remaining / 3_600_000) % 24,
    minutes: Math.floor(remaining / 60_000) % 60,
    seconds: Math.floor(remaining / 1000) % 60,
  };
}

/** Số chạy từ 0 lên giá trị thật khi khối lọt vào khung nhìn. */
function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') { setShown(value); return; }
    let frame = 0;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const start = performance.now();
      const step = (time: number) => {
        const progress = Math.min(1, (time - start) / 1100);
        setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) frame = window.requestAnimationFrame(step);
      };
      frame = window.requestAnimationFrame(step);
    }, { threshold: 0.4 });
    observer.observe(element);
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); };
  }, [value]);
  return <span ref={ref}>{shown}</span>;
}

/** Chữ đổi lần lượt qua mã các cuộc thi, trượt lên như bảng lật. */
function RotatingCode({ items }: { items: Competition[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (items.length < 2 || reducedMotion()) return;
    const timer = window.setInterval(() => setIndex(value => (value + 1) % items.length), 2400);
    return () => window.clearInterval(timer);
  }, [items.length]);
  const current = items[index % Math.max(1, items.length)];
  if (!current) return null;
  return (
    <span className="hub-rotator" aria-hidden="true">
      <span key={current.code} className="hub-rotator-word" style={{ '--hub-accent': current.accent } as CSSProperties}>
        {current.code}
      </span>
    </span>
  );
}

/** Gộp các cuộc thi dùng chung một file (vd FIMO và FIEO chung mẫu Excel) thành một nút. */
function groupByLink(items: Competition[], pick: (item: Competition) => string) {
  const groups = new Map<string, { url: string; codes: string[]; accent: string }>();
  items.forEach(item => {
    const url = pick(item);
    if (!url) return;
    const group = groups.get(url) || { url, codes: [], accent: item.accent };
    group.codes.push(item.code);
    groups.set(url, group);
  });
  return [...groups.values()];
}

/** Đếm ngược tách riêng để chỉ khối này vẽ lại mỗi giây, không kéo theo cả trang. */
function NextRoundCard({ entry, competition }: { entry: SeasonEntry; competition: Competition }) {
  const countdown = useCountdown(entry.date);
  if (!countdown) return null;
  const days = Math.max(0, Math.round((entry.date.getTime() - new Date(new Date().toDateString()).getTime()) / DAY_MS));
  return (
    <a href={`/cuoc-thi/${encodeURIComponent(entry.slug)}`} className="hub-countdown" style={{ '--hub-accent': entry.accent, ...delay(200) } as CSSProperties} data-reveal="zoom">
      <span className="hub-countdown-ring" aria-hidden="true" />
      <small>Vòng thi gần nhất</small>
      <p className="hub-countdown-code">{entry.code}</p>
      <p className="hub-countdown-title">{entry.title}</p>
      <div className="hub-countdown-digits" role="timer" aria-label={countdownLabel(days)}>
        {([['Ngày', countdown.days], ['Giờ', countdown.hours], ['Phút', countdown.minutes], ['Giây', countdown.seconds]] as const).map(([label, value]) => (
          <span key={label}><b>{String(value).padStart(2, '0')}</b><small>{label}</small></span>
        ))}
      </div>
      <p className="hub-countdown-date">
        {competition.summary.items.find(item => item.date === entry.iso)?.full}
        {entry.mode ? ` · ${entry.mode}` : ''}
      </p>
    </a>
  );
}

function CompetitionCard({ item, order }: { item: Competition; order: number }) {
  const tilt = usePointerTilt<HTMLElement>(true, 5);
  const next = item.summary.next;
  const progress = item.summary.total ? item.summary.done / item.summary.total : 0;
  const ended = !next && item.summary.dated > 0 && item.summary.done === item.summary.dated;
  const href = `/cuoc-thi/${encodeURIComponent(item.slug)}`;
  const spotlight = (event: MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${event.clientX - box.left}px`);
    event.currentTarget.style.setProperty('--my', `${event.clientY - box.top}px`);
  };
  return (
    <article
      ref={tilt}
      onMouseMove={spotlight}
      className={`hub-card lp-tilt ${ended ? 'is-ended' : ''}`}
      style={{ '--hub-accent': item.accent, ...delay(order * 90) } as CSSProperties}
      data-reveal
    >
      <span className="hub-card-watermark" aria-hidden="true">{item.code}</span>
      <div className="hub-card-top">
        {item.logoUrl ? <img src={item.logoUrl} alt="" className="hub-card-logo" loading="lazy" /> : <span className="hub-card-logo is-empty"><Trophy className="h-5 w-5" /></span>}
        <span className={`hub-chip ${next?.daysAway !== null && next && next.daysAway <= 14 ? 'is-hot' : ''}`}>
          {ended ? 'Đã kết thúc mùa thi' : next ? countdownLabel(next.daysAway) : 'Lịch đang cập nhật'}
        </span>
      </div>
      <p className="hub-card-code">{item.code}</p>
      <h3 className="hub-card-name">{item.name}</h3>
      {item.badge && <p className="hub-card-badge">{item.badge}</p>}
      {item.intro && <p className="hub-card-intro">{item.intro}</p>}
      {item.highlights.length > 0 && (
        <dl className="hub-card-facts">
          {item.highlights.map(fact => <div key={`${fact.label}-${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
      )}
      {next && (
        <div className="hub-card-next">
          <span className="hub-card-date"><b>{next.day}</b><small>Th{Number(next.month)}</small></span>
          <span className="min-w-0">
            <small>Mốc kế tiếp</small>
            <strong>{next.title}</strong>
            <em>{[next.weekday, next.mode].filter(Boolean).join(' · ')}</em>
          </span>
        </div>
      )}
      {item.summary.total > 0 && (
        <div className="hub-card-progress" aria-label={`Đã qua ${item.summary.done}/${item.summary.total} mốc`}>
          <span style={{ transform: `scaleX(${progress})` }} />
          {item.summary.items.map(milestone => <i key={milestone.index} className={`is-${milestone.status}`} style={{ left: `${item.summary.total > 1 ? (milestone.index / (item.summary.total - 1)) * 100 : 0}%` }} />)}
        </div>
      )}
      <div className="hub-card-actions">
        <a href={href} className="hub-card-link">Xem chi tiết <ArrowRight className="h-4 w-4" /></a>
        {item.register && !ended && <a href={item.register} className="hub-card-register">Đăng ký <ArrowUpRight className="h-4 w-4" /></a>}
      </div>
      {item.excelUrl && !ended && (
        <a href={item.excelUrl} target="_blank" rel="noopener noreferrer" className="hub-card-file">
          <FileSpreadsheet className="h-4 w-4" /> Mẫu danh sách đăng ký của trường
        </a>
      )}
      <a href={href} className="hub-card-cover" aria-label={`Xem chi tiết ${item.code}`} tabIndex={-1} />
    </article>
  );
}

function SeasonStrip({ entries }: { entries: SeasonEntry[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const months = useMemo(() => {
    const groups = new Map<string, SeasonEntry[]>();
    entries.forEach(entry => {
      const key = `${entry.date.getFullYear()}-${String(entry.date.getMonth() + 1).padStart(2, '0')}`;
      groups.set(key, [...(groups.get(key) || []), entry]);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);
  const today = new Date();
  const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => {
    const element = scroller.current;
    const target = element?.querySelector<HTMLElement>('.hub-month.is-current, .hub-month.is-upcoming');
    if (element && target) element.scrollLeft = Math.max(0, target.offsetLeft - 24);
  }, [months]);

  const scrollBy = (direction: number) => scroller.current?.scrollBy({ left: direction * 320, behavior: reducedMotion() ? 'auto' : 'smooth' });

  if (!months.length) return null;
  return (
    <div className="hub-season">
      <div className="hub-season-controls">
        <button type="button" onClick={() => scrollBy(-1)} aria-label="Tháng trước"><ChevronLeft className="h-5 w-5" /></button>
        <button type="button" onClick={() => scrollBy(1)} aria-label="Tháng sau"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <div ref={scroller} className="hub-season-track">
        {months.map(([key, list]) => {
          const [year, month] = key.split('-').map(Number);
          const state = key === currentKey ? 'is-current' : key < currentKey ? 'is-past' : 'is-upcoming';
          return (
            <section key={key} className={`hub-month ${state}`}>
              <header>
                <span>{MONTHS[month - 1]}</span>
                <small>{year}</small>
                {state === 'is-current' && <em>Tháng này</em>}
              </header>
              <ol>
                {list.map(entry => (
                  <li key={entry.key} className={entry.past ? 'is-past' : ''} style={{ '--hub-accent': entry.accent } as CSSProperties}>
                    <a href={`/cuoc-thi/${encodeURIComponent(entry.slug)}`}>
                      <b>{String(entry.date.getDate()).padStart(2, '0')}</b>
                      <span>
                        <small>{entry.code}</small>
                        <strong>{entry.title}</strong>
                        {entry.mode && <em>{entry.mode}</em>}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function CompetitionHub() {
  const [sites, setSites] = useState<HubSite[] | null>(null);
  const [failed, setFailed] = useState(false);
  const progress = useScrollProgress();

  useEffect(() => {
    let active = true;
    fetch('/api/public/landing-sites')
      .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(data => { if (active) setSites(Array.isArray(data.items) ? data.items : []); })
      .catch(() => { if (active) { setFailed(true); setSites([]); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.title = 'Các cuộc thi FermatTech';
  }, []);

  const competitions = useMemo(() => (sites || []).map(toCompetition).sort(byNextMilestone), [sites]);
  const revealRef = useRevealScope<HTMLDivElement>(!reducedMotion(), competitions.length);

  const season = useMemo(() => {
    const entries: SeasonEntry[] = [];
    competitions.forEach(item => item.summary.items.forEach(milestone => {
      const date = parseLandingDate(milestone.date);
      if (!date) return;
      entries.push({
        key: `${item.slug}-${milestone.index}`, date, iso: milestone.date, title: milestone.title, mode: milestone.mode,
        code: item.code, accent: item.accent, slug: item.slug, past: milestone.status === 'done',
      });
    }));
    entries.sort((a, b) => a.date.getTime() - b.date.getTime() || a.code.localeCompare(b.code));
    const years = entries.map(entry => entry.date.getFullYear());
    const label = years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`) : '';
    return { entries, label };
  }, [competitions]);

  const upcoming = season.entries.find(entry => !entry.past) || null;
  const upcomingCompetition = upcoming ? competitions.find(item => item.slug === upcoming.slug) : null;
  const contact = competitions.map(item => (sites || []).find(site => site.slug === item.slug)?.content.contact).find(value => value && (value.email || value.phone)) || {};
  const active = competitions.filter(item => !(item.summary.dated > 0 && !item.summary.next));
  const schoolFiles = groupByLink(active, item => item.excelUrl);
  const handbooks = groupByLink(active, item => item.handbookUrl);
  const upcomingCount = season.entries.filter(entry => !entry.past).length;
  const nextDays = upcoming ? Math.max(0, Math.round((upcoming.date.getTime() - new Date(new Date().toDateString()).getTime()) / DAY_MS)) : 0;
  const orbs = competitions.slice(0, 4);

  return (
    <div ref={revealRef} className="competition-hub landing-motion">
      <header className="hub-header">
        <div className="hub-shell hub-header-row">
          <a href="/cuoc-thi" className="hub-brand">
            <img src="/logo.png" alt="" />
            <span><strong>FermatTech</strong><small>Các cuộc thi</small></span>
          </a>
          <nav className="hub-nav" aria-label="Điều hướng trang">
            <a href="#cuoc-thi">Cuộc thi</a>
            <a href="#lich-mua-thi">Lịch mùa thi</a>
            <a href="#nha-truong">Dành cho nhà trường</a>
            <a href="#lien-he">Liên hệ</a>
          </nav>
          <a href="/dang-ky-du-thi" className="hub-header-cta">Đăng ký dự thi <ArrowUpRight className="h-4 w-4" /></a>
        </div>
        <div className="lp-progress-rail"><span style={{ '--lp-progress': progress } as CSSProperties} /></div>
      </header>

      <section className="hub-hero">
        <div className="hub-hero-grid" aria-hidden="true" />
        <div className="hub-hero-orbs" aria-hidden="true">
          {orbs.map((item, index) => <span key={item.slug} style={{ '--hub-accent': item.accent, '--orb-index': index } as CSSProperties} />)}
        </div>
        <div className="hub-shell hub-hero-row">
          <div className="hub-hero-copy">
            <p className="hub-eyebrow" data-reveal="fade"><Sparkles className="h-4 w-4" /> FermatTech{season.label ? ` · Mùa thi ${season.label}` : ''}</p>
            <h1 data-reveal style={delay(80)}>
              Sân chơi trí tuệ
              <br />
              <span className="hub-hero-line">cho học sinh Việt</span>
              {competitions.length > 0 && <><br /><span className="hub-hero-prefix">Chinh phục </span><RotatingCode items={competitions} /></>}
            </h1>
            <p className="hub-hero-lead" data-reveal style={delay(160)}>
              Thông tin chính thức về các kỳ thi Olympic do FermatTech tổ chức và đồng hành: đối tượng dự thi, lịch từng vòng, đề mẫu, giải thưởng và cách đăng ký cho học sinh của trường.
            </p>
            <div className="hub-hero-actions" data-reveal style={delay(240)}>
              <a href="#cuoc-thi" className="hub-btn-primary">Khám phá cuộc thi <ArrowRight className="h-4 w-4" /></a>
              <a href="#nha-truong" className="hub-btn-ghost"><School className="h-4 w-4" /> Đăng ký theo trường</a>
            </div>
          </div>

          {upcoming && upcomingCompetition && <NextRoundCard entry={upcoming} competition={upcomingCompetition} />}
        </div>

        {competitions.length > 0 && (
          <div className="hub-marquee" aria-hidden="true">
            <div className="hub-marquee-track">
              {[0, 1].map(copy => (
                <span key={copy}>
                  {competitions.map(item => <span key={`${copy}-${item.slug}`} style={{ '--hub-accent': item.accent } as CSSProperties}><b>{item.code}</b>{item.name}</span>)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="hub-stats hub-shell" aria-label="Số liệu mùa thi">
        <div data-reveal><b><CountUp value={competitions.length} /></b><span>cuộc thi đang giới thiệu</span></div>
        <div data-reveal style={delay(90)}><b><CountUp value={season.entries.length} /></b><span>vòng thi trong mùa</span></div>
        <div data-reveal style={delay(180)}><b><CountUp value={upcomingCount} /></b><span>vòng thi sắp diễn ra</span></div>
        <div data-reveal style={delay(270)}><b>{upcoming ? <CountUp value={nextDays} /> : '—'}</b><span>ngày tới vòng thi gần nhất</span></div>
      </section>

      <section id="cuoc-thi" className="hub-section hub-shell">
        <div className="hub-heading" data-reveal>
          <p>Cuộc thi</p>
          <h2>Các cuộc thi{season.label ? ` mùa ${season.label}` : ''}</h2>
          <span>Mỗi cuộc thi có trang riêng với đề mẫu, thể lệ, lịch thi chi tiết và giải thưởng.</span>
        </div>
        {sites === null && <div className="hub-grid">{[0, 1, 2].map(index => <div key={index} className="hub-card is-loading" />)}</div>}
        {sites !== null && competitions.length === 0 && (
          <p className="hub-empty">{failed ? 'Không tải được danh sách cuộc thi. Vui lòng tải lại trang.' : 'Các cuộc thi mùa mới sẽ sớm được công bố.'}</p>
        )}
        {competitions.length > 0 && (
          <div className="hub-grid">
            {competitions.map((item, index) => <CompetitionCard key={item.slug} item={item} order={index} />)}
          </div>
        )}
      </section>

      {season.entries.length > 0 && (
        <section id="lich-mua-thi" className="hub-section hub-season-section">
          <div className="hub-shell">
            <div className="hub-heading" data-reveal>
              <p>Lịch mùa thi</p>
              <h2>Lịch cả mùa thi để nhà trường lên kế hoạch</h2>
              <span>Kéo ngang để xem từng tháng, bấm vào một vòng thi để mở trang cuộc thi đó. Có thể in lịch để dán bảng tin.</span>
              <button type="button" className="hub-print" onClick={() => window.print()}><Printer className="h-4 w-4" /> In lịch mùa thi</button>
            </div>
          </div>
          <div data-reveal="fade"><SeasonStrip entries={season.entries} /></div>
        </section>
      )}

      <section id="nha-truong" className="hub-section hub-shell hub-school">
        <div className="hub-heading" data-reveal>
          <p>Dành cho nhà trường</p>
          <h2>Đăng ký cho học sinh của trường trong ba bước</h2>
          <span>Nhà trường gửi một danh sách chung cho tất cả học sinh tham dự. Một học sinh có thể đăng ký nhiều cuộc thi trên cùng một dòng.</span>
        </div>
        <ol className="hub-steps">
          <li data-reveal>
            <b>01</b>
            <h3>Tải mẫu danh sách</h3>
            <p>Mỗi cuộc thi có một file Excel mẫu với đủ các cột thông tin cần điền.</p>
            {schoolFiles.length > 0 && (
              <div className="hub-step-links">
                {schoolFiles.map(group => (
                  <a key={group.url} href={group.url} target="_blank" rel="noopener noreferrer" style={{ '--hub-accent': group.accent } as CSSProperties}>
                    <FileSpreadsheet className="h-4 w-4" /> Mẫu {group.codes.join(', ')}
                  </a>
                ))}
              </div>
            )}
          </li>
          <li data-reveal style={delay(90)}>
            <b>02</b>
            <h3>Điền thông tin học sinh</h3>
            <p>Họ tên, ngày sinh, lớp và cuộc thi đăng ký của từng học sinh. Học sinh thi nhiều cuộc thi thì ghi chung một ô, ví dụ “FIMO &amp; FIEO”.</p>
            {handbooks.length > 0 && (
              <div className="hub-step-links">
                {handbooks.map(group => (
                  <a key={group.url} href={group.url} target="_blank" rel="noopener noreferrer" style={{ '--hub-accent': group.accent } as CSSProperties}>
                    <BookOpen className="h-4 w-4" /> Hướng dẫn {group.codes.join(', ')}
                  </a>
                ))}
              </div>
            )}
          </li>
          <li data-reveal style={delay(180)}>
            <b>03</b>
            <h3>Gửi cho Ban tổ chức</h3>
            <p>Ban tổ chức tiếp nhận danh sách, xác nhận với nhà trường và thông báo lịch thi khi đã xếp.</p>
            {contact.email && (
              <div className="hub-step-links">
                <a href={`mailto:${contact.email}?subject=${encodeURIComponent('Danh sách đăng ký dự thi của trường')}`}><Send className="h-4 w-4" /> Gửi tới {contact.email}</a>
              </div>
            )}
          </li>
        </ol>
      </section>

      <section id="lien-he" className="hub-cta hub-shell" data-reveal="zoom">
        <div>
          <p>Liên hệ Ban tổ chức</p>
          <h2>Cần trao đổi về việc tổ chức thi cho học sinh của trường?</h2>
          <ul>
            {contact.phone && <li><Phone className="h-4 w-4" /><a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>{contact.phone}</a></li>}
            {contact.email && <li><Mail className="h-4 w-4" /><a href={`mailto:${contact.email}`}>{contact.email}</a></li>}
            {contact.address && <li><MapPin className="h-4 w-4" /><span>{contact.address}</span></li>}
          </ul>
        </div>
        <div className="hub-cta-actions">
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="hub-btn-primary"><Phone className="h-4 w-4" /> Gọi {contact.phone}</a>}
          <a href="/dang-ky-du-thi" className="hub-btn-ghost">Đăng ký cá nhân <ArrowRight className="h-4 w-4" /></a>
        </div>
      </section>

      <footer className="hub-footer hub-shell">
        <span>© {new Date().getFullYear()} FermatTech</span>
        <span>Olympic học thuật cho học sinh Việt Nam</span>
      </footer>
    </div>
  );
}
