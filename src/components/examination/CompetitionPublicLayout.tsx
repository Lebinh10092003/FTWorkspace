import type { ReactNode } from 'react';
import type { LandingContent } from './LandingSiteView';
import { displayLandingDate } from './landingTimeline';
import './CompetitionPublic.css';

export function publicLink(value?: string) {
  const url = (value || '').trim();
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(url) ? url : '';
}

export function PublicLink({ href, children, className = '', newTab = false }: { href?: string; children: ReactNode; className?: string; newTab?: boolean }) {
  const url = publicLink(href);
  if (!url) return null;
  const external = newTab || /^https?:\/\//i.test(url);
  return <a href={url} className={className} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>{children}</a>;
}

export function PublicHeader({ detail = false, preview = false, activeSection = '', registrationHref = '', hasSchedule = true }: { detail?: boolean; preview?: boolean; activeSection?: string; registrationHref?: string; hasSchedule?: boolean }) {
  return <header className={`cp-header ${preview ? 'cp-header-preview' : ''}`}>
    <div className="cp-shell cp-header-inner">
      <a href="/cuoc-thi" className="cp-brand" aria-label="FermatTech — Các cuộc thi"><img src="/logo.png" alt="FermatTech" /><span>Cuộc thi quốc tế</span></a>
      <nav aria-label="Điều hướng trang"><a href={detail ? (hasSchedule ? '#lich-thi' : '#noi-dung') : '#tong-quan'} aria-current={activeSection === 'tong-quan' ? 'location' : undefined}>{detail ? (hasSchedule ? 'Lịch thi' : 'Giới thiệu') : 'Về FermatTech'}</a><a href={detail ? '#tai-lieu' : '#cuoc-thi'} aria-current={activeSection === 'cuoc-thi' ? 'location' : undefined}>{detail ? 'Tài liệu' : 'Cuộc thi'}</a><a href="#lien-he" aria-current={activeSection === 'lien-he' ? 'location' : undefined}>Liên hệ</a></nav>
      {(detail || registrationHref) && <a className="cp-button cp-button-small" href={detail ? '#dang-ky' : registrationHref}>Đăng ký dự thi</a>}
    </div>
  </header>;
}

export function PublicFooter({ contact = {} }: { contact?: LandingContent['contact'] }) {
  return <footer id="lien-he" className="cp-footer"><div className="cp-shell">
    <div className="cp-footer-main"><div><strong>FermatTech</strong><p>Thông tin các cuộc thi quốc tế</p></div><div className="cp-contact-links">
      {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>{contact.phone}</a>}
      {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
      {publicLink(contact.zaloUrl) && <PublicLink href={contact.zaloUrl}>Zalo</PublicLink>}
    </div></div>
    <div className="cp-footer-bottom"><span>© {new Date().getFullYear()} FermatTech</span>{contact.address && <span>{contact.address}</span>}</div>
  </div></footer>;
}

export type PublicExamDate = { date: string; endDate?: string; title: string; codes?: Array<{ code: string; slug: string }>; mode?: string; past?: boolean };

export function PublicDateTable({ entries, detail = false }: { entries: PublicExamDate[]; detail?: boolean }) {
  return <div className={`cp-date-table ${detail ? 'cp-date-table-detail' : ''}`} role="table" aria-label="Lịch thi">
    <div role="row" className="cp-date-table-head"><span role="columnheader">Ngày thi</span>{!detail && <span role="columnheader">Cuộc thi</span>}<span role="columnheader">Vòng thi</span></div>
    {entries.map((entry, index) => <div role="row" key={`${entry.date}-${entry.title}-${index}`} className={`cp-date-row ${entry.past ? 'cp-date-past' : ''} ${detail ? 'cp-date-detail' : ''}`}>
      <div role="cell"><time dateTime={/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : undefined}>{displayLandingDate(entry.date) || 'Chưa công bố'}</time>{entry.endDate && <small className="cp-date-end">đến {displayLandingDate(entry.endDate)}</small>}{entry.past && <small>Đã diễn ra</small>}</div>
      {!detail && <div role="cell" className="cp-date-codes">{entry.codes?.map(item => <a href={`/cuoc-thi/${encodeURIComponent(item.slug)}`} key={item.slug}>{item.code}</a>)}</div>}
      <div role="cell"><span>{entry.title}</span>{entry.mode && !/theo thông báo/i.test(entry.mode) && <small>{entry.mode}</small>}</div>
    </div>)}
  </div>;
}

type SchoolFile = { title: string; url: string };
export function PublicRegistration({ code, registerUrl, excelFiles = [], handbooks = [], schoolUrl, email }: {
  code?: string; registerUrl?: string; excelFiles?: SchoolFile[]; handbooks?: SchoolFile[]; schoolUrl?: string; email?: string;
}) {
  return <section id="dang-ky" className="cp-registration cp-section" data-reveal>
    <div className="cp-section-heading"><div><p className="cp-overline">Đăng ký</p><h2>Tham dự {code || 'cuộc thi'}</h2></div></div>
    <div className="cp-registration-grid">
      <div className="cp-registration-personal"><span className="cp-registration-label">Học sinh & phụ huynh</span><h3>Thông tin đăng ký</h3><p>{registerUrl?.startsWith('#') || registerUrl?.startsWith('mailto:') ? 'Liên hệ Ban tổ chức để nhận thông tin về đợt đăng ký và điều kiện tham gia.' : 'Điền thông tin thí sinh và chọn cuộc thi trong biểu mẫu.'}</p><PublicLink href={registerUrl || '/dang-ky-du-thi'} className="cp-button">{registerUrl?.startsWith('#') || registerUrl?.startsWith('mailto:') ? 'Liên hệ Ban tổ chức' : 'Mở biểu mẫu đăng ký'}</PublicLink></div>
      <div className="cp-registration-school"><span className="cp-registration-label">Nhà trường</span><h3>Đăng ký theo danh sách</h3><p>{excelFiles.length ? 'Tổng hợp học sinh theo mẫu Excel và gửi tới Ban tổ chức.' : 'Liên hệ Ban tổ chức để nhận mẫu danh sách và hướng dẫn tham gia.'}</p><div className="cp-file-links">
        {excelFiles.map(file => <PublicLink href={file.url} key={file.url}>{file.title}</PublicLink>)}
        {handbooks.map(file => <PublicLink href={file.url} key={file.url}>{file.title}</PublicLink>)}
        <PublicLink href={schoolUrl || (email ? `mailto:${email}?subject=${encodeURIComponent(`Danh sách đăng ký ${code || 'dự thi'} của trường`)}` : '')}>Gửi danh sách</PublicLink>
      </div></div>
    </div>
  </section>;
}
