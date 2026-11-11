import { useMemo, useState, type CSSProperties } from 'react';
import type { LandingSite } from './LandingSiteView';
import { competitionIdentity } from './competitionIdentity';
import { describeMilestones } from './landingTimeline';
import { useRevealScope } from './landingMotion';
import { publicRegistrationLink } from './publicRegistrationLink';
import { PublicDateTable, PublicFooter, PublicHeader, PublicLink, PublicRegistration, publicLink } from './CompetitionPublicLayout';
import { competitionContext } from './competitionEditorial';

export default function CompetitionInformation({ site, preview = false }: { site: LandingSite; preview?: boolean }) {
  const content = site.content || {};
  const identity = competitionIdentity(content.subject || site.slug, site.title);
  const root = useRevealScope<HTMLDivElement>(!preview, site.id);
  const schedule = useMemo(() => describeMilestones(content.timeline), [content.timeline]);
  const subjects = content.paperSubjects?.length ? content.paperSubjects : Object.keys(content.papers || {});
  const [chosenSubject, setSubject] = useState('');
  const subject = subjects.includes(chosenSubject) ? chosenSubject : subjects[0] || '';
  const [chosenGrade, setGrade] = useState(identity.profile?.minGrade || 1);
  const minGrade = identity.profile?.minGrade || 1;
  const maxGrade = identity.profile?.maxGrade || 12;
  const grade = Math.max(minGrade, Math.min(maxGrade, chosenGrade));
  const paper = publicLink(content.papers?.[subject]?.[String(grade)]);
  const folder = content.resources?.find(item => /^đề/i.test(item.category || '') && publicLink(item.url))?.url;
  const reg = content.registration || {};
  const registration = publicRegistrationLink(site.slug, `${site.title} ${identity.code}`) || publicLink(reg.individualUrl);
  const resources = (content.resources || []).filter(item => publicLink(item.url));
  const contact = content.contact || {};
  const intro = (content.intro || '').replace(/\s*Vòng loại Quốc gia đợt 2 diễn ra vào Chủ nhật, ngày \d{2}\/\d{2}\/\d{4}\./, '');
  const logo = identity.logo || (content.logoUrl !== '/logo.png' ? publicLink(content.logoUrl) : '');
  const hasPapers = subjects.length > 0 || !!folder;
  const context = competitionContext[identity.code.toUpperCase()];
  const topics = identity.profile?.focus.split(' · ') || [];

  return <div ref={root} className="competition-public cp-detail" style={{ '--cp-accent': identity.accent, '--cp-tint': identity.tint } as CSSProperties}>
    <a href="#noi-dung" className="cp-skip">Đến nội dung cuộc thi</a>
    <PublicHeader detail preview={preview} hasSchedule={!!schedule.items.length} />
    <main className="cp-shell" id="noi-dung">
      <div className="cp-breadcrumb"><a href="/cuoc-thi">Các cuộc thi</a><span aria-hidden="true">/</span><span>{identity.code}</span></div>
      <section className="cp-detail-hero">
        <div data-reveal>
          <p className="cp-overline">{identity.family || 'Cuộc thi quốc tế'}{content.season || schedule.season ? ` · ${content.season || schedule.season}` : ''}</p>
          <h1>{identity.code}<span>{identity.name}</span></h1>
          {intro && <p className="cp-detail-intro">{intro}</p>}
          <dl className="cp-hero-facts"><div><dt>Đối tượng</dt><dd>{identity.profile?.grades || 'Theo thể lệ cuộc thi'}</dd></div>{identity.profile && <div><dt>Lĩnh vực</dt><dd>{identity.profile.area}</dd></div>}</dl>
        </div>
        <div className="cp-logo-panel" data-reveal>
          {logo ? <img src={logo} alt={`Logo ${identity.code}`} width="320" height="320" decoding="async" /> : <div className="cp-sco-wordmark"><img src="/competition-logos/sco.png" alt="School Connect Olympiad" /><strong>{identity.code}</strong><p>{identity.profile?.area}</p></div>}
        </div>
      </section>

      {context && <section className="cp-section cp-focus-overview" data-reveal>
        <div className="cp-section-heading"><div><p className="cp-overline">{identity.code}</p><h2>Nội dung khám phá</h2></div></div>
        <p>{context}</p><ul>{topics.map(topic => <li key={topic}>{topic}</li>)}</ul>
      </section>}

      {!!schedule.items.length && <section id="lich-thi" className="cp-section" data-reveal>
        <div className="cp-section-heading"><div><p className="cp-overline">{identity.code}</p><h2>Lịch thi</h2></div><span className="cp-section-note">{schedule.season}</span></div>
        <PublicDateTable detail entries={schedule.items.map(item => ({ date: item.date, endDate: content.timeline?.[item.index]?.endDate, title: item.title, mode: item.mode, past: item.status === 'done' }))} />
      </section>}

      {hasPapers && <section id="de-mau" className="cp-section" data-reveal>
        <div className="cp-section-heading"><div><p className="cp-overline">Tài liệu tham khảo</p><h2>Đề mẫu</h2></div></div>
        <div className="cp-paper-panel">
          <div className="cp-paper-copy"><h3>{subject || identity.profile?.area || identity.code}</h3><p>Đề tham khảo theo khối lớp.</p></div>
          <div className="cp-paper-controls">
            {subjects.length > 1 && <label>Môn thi<select value={subject} onChange={event => setSubject(event.target.value)}>{subjects.map(value => <option value={value} key={value}>{value}</option>)}</select></label>}
            <label>Khối lớp<select value={grade} aria-label="Chọn khối lớp xem đề mẫu" onChange={event => setGrade(Number(event.target.value))}>{Array.from({ length: maxGrade - minGrade + 1 }, (_, index) => minGrade + index).map(value => <option value={value} key={value}>Lớp {value}</option>)}</select></label>
            {paper || folder ? <PublicLink href={paper || folder} className="cp-document-link">{paper ? 'Xem đề mẫu PDF' : 'Mở thư mục đề mẫu'}</PublicLink> : <span className="cp-paper-unavailable">Đề mẫu đang cập nhật</span>}
          </div>
        </div>
      </section>}

      <section id="tai-lieu" className="cp-section" data-reveal>
        <div className="cp-section-heading"><div><p className="cp-overline">Thông tin chính thức</p><h2>Thể lệ & tài liệu</h2></div></div>
        {resources.length ? <div className="cp-resource-list">{resources.map((resource, index) => <PublicLink href={resource.url} className="cp-resource" key={`${resource.url}-${index}`}><span>{resource.category}</span><strong>{resource.title}</strong></PublicLink>)}</div> : <p className="cp-empty">Thể lệ và tài liệu sẽ được cập nhật tại đây.</p>}
      </section>

      {!!content.awards?.length && <section className="cp-section cp-awards" data-reveal><h2>Giải thưởng</h2><div>{content.awards.map((award, index) => <article key={index}><h3>{award.title}</h3>{award.percent && <strong>{award.percent}</strong>}{award.description && <p>{award.description}</p>}</article>)}</div></section>}

      {(content.customSections || []).filter(section => section.title || section.body).map((section, index) => <section className="cp-section cp-custom" key={index} data-reveal><h2>{section.title}</h2><p>{section.body}</p>{section.buttonLabel && <PublicLink href={section.buttonUrl} className="cp-text-link">{section.buttonLabel}</PublicLink>}</section>)}

      <PublicRegistration code={identity.code} registerUrl={registration || '#lien-he'} schoolUrl={publicLink(reg.schoolUrl)} email={contact.email} excelFiles={publicLink(reg.excelUrl) ? [{ title: 'Mẫu danh sách Excel', url: reg.excelUrl! }] : []} handbooks={publicLink(reg.handbookUrl) ? [{ title: 'Hướng dẫn đăng ký', url: reg.handbookUrl! }] : []} />


    </main>
    <PublicFooter contact={contact} />
  </div>;
}
