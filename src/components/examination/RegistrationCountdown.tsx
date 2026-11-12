import { useEffect, useState } from 'react';
import type { CompetitionOption } from './registrationConfig';
import { shortDate } from './registrationOffers';

/** Danh sách cuộc thi đang mở đăng ký; mỗi trang công khai chỉ tải một lần. */
let request: Promise<CompetitionOption[]> | null = null;
export function fetchOpenRegistrations() {
  request ||= fetch('/api/public/examination/registration')
    .then(response => response.ok ? response.json() : { competitions: [] })
    .then(data => (data.competitions || []) as CompetitionOption[])
    .catch(() => { request = null; return []; });
  return request;
}

export function useOpenRegistration(code: string) {
  const [offer, setOffer] = useState<CompetitionOption | null>(null);
  useEffect(() => {
    let active = true;
    const key = code.trim().toUpperCase();
    if (!key) { setOffer(null); return; }
    void fetchOpenRegistrations().then(rows => { if (active) setOffer(rows.find(row => row.code === key) || null); });
    return () => { active = false; };
  }, [code]);
  return offer;
}

/** Hạn đăng ký tính hết 23:59:59 giờ Việt Nam. */
const deadlineEnd = (deadline: string) => Date.parse(`${deadline}T23:59:59+07:00`);

function remaining(deadline: string, now: number) {
  const left = Math.max(0, deadlineEnd(deadline) - now);
  return { days: Math.floor(left / 86_400_000), hours: Math.floor(left / 3_600_000) % 24, minutes: Math.floor(left / 60_000) % 60, over: left === 0 };
}

/** Đếm ngược tới hạn đăng ký, lấy từ kỳ tổ chức trong Khảo thí. Không hiện lệ phí. */
export default function RegistrationCountdown({ code, href }: { code: string; href: string }) {
  const offer = useOpenRegistration(code);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!offer?.deadline) return null;
  const left = remaining(offer.deadline, now);
  if (left.over) return null;
  const urgent = left.days < 7;
  return <div className={`cp-countdown${urgent ? ' cp-countdown-urgent' : ''}`} role="timer" aria-label={`Còn ${left.days} ngày ${left.hours} giờ tới hạn đăng ký ${shortDate(offer.deadline)}`}>
    <div className="cp-countdown-copy"><span className="cp-countdown-label"><span aria-hidden="true" className="cp-countdown-dot" />Đang mở đăng ký{offer.entryRound ? ` · ${offer.entryRound}` : ''}</span><strong>Hạn đăng ký {shortDate(offer.deadline)}</strong></div>
    <dl className="cp-countdown-clock" aria-hidden="true">
      <div><dt>ngày</dt><dd>{left.days}</dd></div><div><dt>giờ</dt><dd>{String(left.hours).padStart(2, '0')}</dd></div><div><dt>phút</dt><dd>{String(left.minutes).padStart(2, '0')}</dd></div>
    </dl>
    <a href={href} className="cp-button">Đăng ký ngay</a>
  </div>;
}

/** Nhãn ngắn trên thẻ cuộc thi ở trang tổng quan. */
export function DeadlineChip({ code }: { code: string }) {
  const offer = useOpenRegistration(code);
  if (!offer?.deadline) return null;
  const days = remaining(offer.deadline, Date.now()).days;
  return <span className={`cp-deadline-chip${days < 7 ? ' cp-deadline-chip-urgent' : ''}`}>{days <= 0 ? 'Hạn đăng ký hôm nay' : `Còn ${days} ngày đăng ký`}</span>;
}
