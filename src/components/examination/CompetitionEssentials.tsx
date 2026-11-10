import type { CSSProperties } from 'react';
import { ArrowUpRight, CalendarDays, GraduationCap } from 'lucide-react';
import type { MilestoneView } from './landingTimeline';
import { profileFor } from './competitionProfiles';
import './CompetitionEditorial.css';

export function AcademicFragments() {
  return <div className="academic-fragments" aria-hidden="true">
    <i className="academic-fragment academic-fragment--frame" />
    <i className="academic-fragment academic-fragment--tile" />
    <i className="academic-fragment academic-fragment--stripe" />
    <span className="academic-fragment academic-fragment--cross">+</span>
  </div>;
}

export default function CompetitionEssentials({ code, next, accent }: {
  code: string; next: MilestoneView | null; accent?: string;
}) {
  const profile = profileFor(code);
  if (!profile) return null;
  return <section className="competition-essentials" aria-label={`Thông tin nhanh ${code}`} style={{ '--editorial-accent': accent || 'var(--lp-accent, #2465cf)' } as CSSProperties}>
    <div className="competition-essentials-inner">
      <div className="competition-essential competition-essential--audience" data-reveal="left">
        <span className="competition-essential-index">01 / ĐỐI TƯỢNG</span>
        <GraduationCap size={27} strokeWidth={1.5} />
        <strong>{profile.grades}</strong><p>Học sinh yêu thích {profile.area.toLocaleLowerCase('vi-VN')}</p>
      </div>
      <div className="competition-essential competition-essential--focus" data-reveal="slice">
        <span className="competition-essential-index">02 / TRỌNG TÂM</span>
        <span className="competition-essential-glyph" aria-hidden="true">{profile.glyph}</span>
        <strong>{profile.area}</strong><p>{profile.focus}</p>
      </div>
      <a href="#lo-trinh" className="competition-essential competition-essential--date" data-reveal="right">
        <span className="competition-essential-index">03 / MỐC KẾ TIẾP <ArrowUpRight size={18} /></span>
        <CalendarDays size={26} strokeWidth={1.5} />
        <strong>{next ? `${next.dayMonth}/${next.year}` : 'Xem lộ trình'}</strong>
        <p>{next?.title || 'Theo dõi thông báo của Ban tổ chức'}</p>
      </a>
    </div>
  </section>;
}
