import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { LandingContent } from './LandingSiteView';
import { competitionIdentity } from './competitionIdentity';
import { programmeCategories } from './programmeCategories';
import { publicRegistrationLink } from './publicRegistrationLink';
import { competitionContext } from './competitionEditorial';
import './CompetitionIntroDialog.css';

export default function CompetitionIntroDialog({ site, onClose }: {
  site: { slug: string; title: string; content: LandingContent }; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const identity = competitionIdentity(site.content.subject || site.slug, site.title);
  const code = identity.code.toUpperCase();
  const categories = programmeCategories[code];
  const topics = categories?.map(item => item.name) || identity.profile?.focus.split(' · ') || [];
  const intro = (site.content.intro || '').replace(/\s*Vòng loại Quốc gia đợt 2 diễn ra vào Chủ nhật, ngày \d{2}\/\d{2}\/\d{4}\./, '');
  const register = publicRegistrationLink(site.slug, `${site.title} ${identity.code}`);
  const grades = identity.profile?.grades;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const overflow = document.body.style.overflow;
    const padding = document.body.style.paddingRight;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + gap}px`;
    document.body.style.overflow = 'hidden';
    element.showModal();
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
    return () => {
      window.clearTimeout(timer.current);
      const dismissed = !element.open;
      element.close();
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = padding;
      if (dismissed && previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
        window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
      }
    };
  }, []);

  const close = () => {
    if (closing) return;
    setClosing(true);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = window.setTimeout(() => dialog.current?.close(), reducedMotion ? 0 : 180);
  };

  return <dialog ref={dialog} className={`ch-competition-dialog ${closing ? 'is-closing' : ''}`}
    style={{ '--cp-accent': identity.accent, '--cp-tint': identity.tint } as CSSProperties}
    aria-labelledby="ch-dialog-title" onClose={event => { if (!event.currentTarget.open) onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    }}>
    <div className="ch-dialog-bar"><span>{identity.family || 'Cuộc thi quốc tế'}</span><button type="button" onClick={close}>Đóng</button></div>
    <div className="ch-dialog-content">
      <div className="ch-dialog-heading"><div><p>{identity.code}</p><h2 ref={heading} id="ch-dialog-title" tabIndex={-1}>{identity.name}</h2></div>{identity.logo ? <img src={identity.logo} alt={identity.code} width="92" height="92" /> : <img src="/competition-logos/sco.png" alt="School Connect Olympiad" width="104" height="48" />}</div>
      {intro && <p className="ch-dialog-intro">{intro}</p>}
      {competitionContext[code] && <p className="ch-dialog-context">{competitionContext[code]}</p>}
      {!!topics.length && <section className="ch-dialog-topics"><h3>{categories ? 'Các hạng mục' : 'Chủ đề khám phá'}</h3><ul>{topics.map(topic => <li key={topic}>{topic}</li>)}</ul></section>}
      {grades && !/^Theo thể lệ/i.test(grades) && <p className="ch-dialog-audience"><span>Đối tượng tham gia</span><strong>{grades}</strong></p>}
    </div>
    <div className="ch-dialog-footer"><div><a href={register || '/dang-ky-du-thi'} className="ch-dialog-register">Đăng ký thi</a><a href={`/cuoc-thi/${encodeURIComponent(site.slug)}`} className="ch-dialog-more">Tìm hiểu thêm</a></div>{!register && <p>Biểu mẫu cập nhật các cuộc thi đang nhận đăng ký.</p>}</div>
  </dialog>;
}
