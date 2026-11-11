import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { LandingContent } from './LandingSiteView';
import { useActiveSection, useRevealScope } from './landingMotion';
import { competitionOrder } from './competitionIdentity';
import { landingPresentation } from './landingPresentation';
import { resolveHubContent, type HubContent } from './landingHubContent';
import { additionalPublicCompetitions, withAdditionalCompetitions } from './additionalPublicCompetitions';
import { PublicFooter, PublicHeader, publicLink } from './CompetitionPublicLayout';
import './CompetitionHub.css';
import { programmeCategories } from './programmeCategories';
import CompetitionIntroDialog from './CompetitionIntroDialog';

export type HubSite = { slug: string; title: string; layout: string; content: LandingContent };
const codeFor = (site: HubSite) => (site.content.subject || site.title.split(/[\s·—-]+/)[0] || site.slug).trim();
const summaries: Record<string, string> = {
  FIMO: 'Đề thi song ngữ Việt – Anh, chú trọng tư duy logic và giải quyết vấn đề.',
  FIEO: 'Đọc hiểu, kiến thức ngôn ngữ và vận dụng tiếng Anh theo định hướng CEFR.',
};
const identityStyle = (site: HubSite) => {
  const identity = landingPresentation(site);
  return { '--cp-accent': identity.accent, '--cp-tint': identity.tint } as CSSProperties;
};

export default function CompetitionHub({ previewSites, overview, preview = false }: { previewSites?: HubSite[]; overview?: Partial<HubContent>; preview?: boolean } = {}) {
  const [sites, setSites] = useState<HubSite[] | null>(previewSites || null);
  const [savedOverview, setSavedOverview] = useState<Partial<HubContent>>({});
  const hub = resolveHubContent(overview || savedOverview);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<HubSite | null>(null);
  const closeIntro = useCallback(() => setSelected(null), []);
  const root = useRevealScope<HTMLDivElement>(!preview, sites?.map(site => site.slug).join('|'));
  const active = useActiveSection(['tong-quan', 'cuoc-thi', 'tham-gia', 'lien-he']);

  useEffect(() => {
    if (previewSites) { setSites(previewSites); return; }
    const controller = new AbortController();
    setFailed(false);
    fetch('/api/public/landing-sites', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Không tải được danh sách.'); return response.json(); })
      .then(data => { setSites(withAdditionalCompetitions(Array.isArray(data.items) ? data.items : [], data.hiddenSlugs || []) as HubSite[]); setSavedOverview(data.overview || {}); })
      .catch(() => { if (!controller.signal.aborted) { setFailed(true); setSites(additionalPublicCompetitions); } });
    return () => controller.abort();
  }, [reload, previewSites]);

  useEffect(() => { if (!preview) document.title = 'Các cuộc thi quốc tế | FermatTech'; }, [preview]);

  const competitions = useMemo(() => [...(sites || [])].sort((a, b) => {
    const rank = (item: HubSite) => { const index = competitionOrder.indexOf(codeFor(item).toUpperCase()); return index < 0 ? 99 : index; };
    return rank(a) - rank(b) || a.title.localeCompare(b.title);
  }), [sites]);
  const inheritedContact = competitions.map(site => site.content.contact).find(item => item?.email || item?.phone) || {};
  const contact = { ...inheritedContact, email: hub.email || inheritedContact.email, phone: hub.phone || inheritedContact.phone, address: hub.address || inheritedContact.address };
  const registrationUrl = publicLink(hub.individualUrl) || '/dang-ky-du-thi';
  const featured = competitions.filter(site => codeFor(site).toUpperCase().startsWith('FI'));
  const sco = competitions.filter(site => codeFor(site).toUpperCase().startsWith('SI'));
  const projects = ['AYSBC', 'WAICY'].map(code => competitions.find(site => codeFor(site).toUpperCase() === code)).filter((site): site is HubSite => !!site);
  const others = competitions.filter(site => !featured.includes(site) && !sco.includes(site) && !projects.includes(site));

  return <div ref={root} className="competition-public cp-hub cp-hub-discovery">
    <a href="#cuoc-thi" className="cp-skip">Đến danh sách cuộc thi</a>
    <PublicHeader activeSection={active} registrationHref={registrationUrl} preview={preview} />
    <main>
      <section className="ch-intro" id="tong-quan">
        <div className="ch-intro-decoration" aria-hidden="true"><i /><i /><i /></div>
        <div className="cp-shell ch-intro-inner">
          <div className="ch-intro-copy" data-reveal>
            <p className="cp-overline">{hub.eyebrow}</p>
            <h1>{hub.title}<br /><span>{hub.emphasis}</span></h1>
            <p className="ch-ft-intro">{hub.intro}</p>
            <a className="ch-explore" href="#cuoc-thi">Khám phá các cuộc thi</a>
          </div>
          <div className="ch-learning-art" aria-hidden="true">
            <div className="ch-art-orbit" />
            <div className="ch-art-shape ch-art-square" />
            <div className="ch-art-shape ch-art-arch" />
            <div className="ch-art-shape ch-art-circle" />
            <div className="ch-art-note ch-note-math"><span>Tư duy</span><strong>Toán & ngôn ngữ</strong></div>
            <div className="ch-art-note ch-note-ai"><span>Sáng tạo</span><strong>AI & dự án</strong></div>
            <div className="ch-art-note ch-note-science"><span>Khám phá</span><strong>Khoa học thực hành</strong></div>
          </div>
        </div>
      </section>

      <section id="cuoc-thi" className="cp-shell ch-discovery">
        <div className="ch-discovery-heading" data-reveal><p className="cp-overline">Cùng FermatTech</p><h2>{hub.discoveryTitle}</h2></div>
        {failed && <p className="cp-load-note">Chưa tải được đầy đủ danh sách. <button type="button" onClick={() => { setSites(null); setReload(value => value + 1); }}>Tải lại</button></p>}
        {sites === null && <p className="cp-empty" role="status">Đang tải danh sách cuộc thi…</p>}
        <div className="ch-programmes">
          {!!featured.length && <section id="he-fermat" className="ch-programme ch-fermat" data-reveal>
            <div className="ch-programme-heading"><p className="ch-family-label">FermatTech</p><h3>{hub.fermatTitle}</h3></div>
            <div className="ch-fermat-competitions">{featured.map(site => {
              const identity = landingPresentation(site);
              return <button type="button" onClick={() => setSelected(site)} aria-haspopup="dialog" key={site.slug} className="ch-fermat-link" style={identityStyle(site)} aria-label={`${identity.area} · ${identity.code}`}>
                <img src={identity.logo} alt={identity.code} width="110" height="110" decoding="async" />
                <span><span className="ch-fermat-title">{identity.area} <small>· {identity.code}</small></span><span className="ch-hover-topics" aria-hidden="true"><span>{site.content.display?.hoverSummary || summaries[identity.code.toUpperCase()] || identity.hoverSummary}</span></span></span>
              </button>;
            })}</div>
          </section>}
          {!!sco.length && <section id="he-sco" className="ch-programme ch-sco" data-reveal>
            <div className="ch-programme-heading ch-heading-with-logo"><div><p className="ch-family-label">SCO · School Connect Olympiad</p><h3>{hub.scoTitle}</h3><p className="ch-programme-description ch-sco-intro">{hub.scoIntro}</p></div><img src="/competition-logos/sco.png" alt="School Connect Olympiad" width="110" height="49" /></div>
            <div className="ch-sco-competitions">{sco.map(site => {
              const identity = landingPresentation(site);
              return <button type="button" onClick={() => setSelected(site)} aria-haspopup="dialog" aria-label={`${identity.code} · ${identity.area}`} key={site.slug} className="ch-subject-link" style={identityStyle(site)}><span className="ch-subject-code">{identity.code}</span><strong>{identity.area}</strong><span className="ch-hover-topics" aria-hidden="true"><span>{identity.hoverSummary}</span></span></button>;
            })}</div>
          </section>}
          {projects.map(site => {
            const identity = landingPresentation(site);
            const isAi = identity.code === 'WAICY';
            return <section id={`he-${identity.code.toLowerCase()}`} key={site.slug} className={`ch-programme ch-project ${isAi ? 'ch-waicy' : 'ch-aysbc'}`} style={identityStyle(site)} data-reveal>
              <div className="ch-programme-heading ch-heading-with-logo"><div><p className="ch-family-label">{isAi ? 'WAICY · Trí tuệ nhân tạo' : 'AYSBC · Khoa học thực hành'}</p><h3>{isAi ? hub.waicyTitle : hub.aysbcTitle}</h3><p className="ch-programme-description">{isAi ? hub.waicyIntro : hub.aysbcIntro}</p></div><img src={identity.logo} alt={identity.code} width="128" height="80" decoding="async" /></div>
              <ul className={`ch-category-grid ${isAi ? 'ch-category-four' : ''}`} aria-label={`Các hạng mục ${identity.code}`}>
                {programmeCategories[identity.code].map(category => <li key={category.name}>
                  <div className="ch-category-art">{category.image ? <img src={category.image} alt="" width="110" height="110" loading="lazy" decoding="async" /> : <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="57" fill="#f5ba67" /><rect x="19" y="28" width="82" height="62" rx="5" fill="white" stroke="#202124" strokeWidth="5" /><path d="M22 41h76M22 77h76M34 29v11m17-11v11m18-11v11m17-11v11M34 78v11m17-11v11m18-11v11m17-11v11" fill="none" stroke="#202124" strokeWidth="4" /><path d="m52 48 20 12-20 12Z" fill="#202124" /></svg>}</div>
                  <h4>{category.name}</h4><p>{category.description}</p>
                </li>)}
              </ul>
              <button type="button" className="ch-frame-link" aria-haspopup="dialog" onClick={() => setSelected(site)}>Giới thiệu {identity.code}</button>
            </section>;
          })}
        </div>
        {!!others.length && <div className="ch-other-competitions">{others.map(site => {
          const identity = landingPresentation(site);
          return <button type="button" onClick={() => setSelected(site)} aria-haspopup="dialog" key={site.slug}>{identity.name}</button>;
        })}</div>}
      </section>
      <section id="tham-gia" className="ch-join cp-shell" data-reveal>
        <div className="ch-join-heading"><p className="cp-overline">Tham gia cùng FermatTech</p><h2>{hub.joinTitle}</h2></div>
        <div className="ch-registration-paths">
          <div className="ch-personal-path"><span className="ch-path-label">Học sinh & phụ huynh</span><h3>Đăng ký dự thi</h3><p>{hub.personalIntro}</p><a href={registrationUrl} className="cp-button">Mở biểu mẫu đăng ký</a></div>
          <div className="ch-school-path"><span className="ch-path-label">Dành cho nhà trường</span><h3>Cùng học sinh tham gia</h3><p>{hub.schoolIntro}</p><a href={`mailto:${contact.email || 'khaothi@fermat.vn'}?subject=${encodeURIComponent('Nhận hướng dẫn đăng ký dự thi dành cho nhà trường')}`} className="ch-school-cta">Nhận hướng dẫn cho trường</a></div>
        </div>
        <ol className="ch-preparation" aria-label="Chuẩn bị trước khi đăng ký">
          <li><span aria-hidden="true">01</span><div><h3>Tìm hiểu cuộc thi</h3><p>Nội dung và đối tượng tham gia tại từng trang giới thiệu.</p></div></li>
          <li><span aria-hidden="true">02</span><div><h3>Xem lịch & tài liệu</h3><p>Kiểm tra mốc thi, thể lệ và tài liệu đã được công bố.</p></div></li>
          <li><span aria-hidden="true">03</span><div><h3>Hoàn tất đăng ký</h3><p>Cá nhân qua biểu mẫu; nhà trường theo danh sách hướng dẫn.</p></div></li>
        </ol>
      </section>
    </main>
    <PublicFooter contact={contact} />
    {selected && <CompetitionIntroDialog key={selected.slug} site={selected} onClose={closeIntro} />}
  </div>;
}
