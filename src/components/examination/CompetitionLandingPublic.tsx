import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CalendarDays, ChevronRight, Mail, MapPin, Phone, Sparkles, Trophy, Users } from 'lucide-react';

type LandingRound = { id: string; name: string; label: string; mode: string; dates: string[] };
type LandingSession = { id: string; code: string; name: string; time: string; organizer: string; phase: string; candidates: number; rounds: LandingRound[] };
type LandingBlock = { title?: string; description?: string; question?: string; answer?: string; name?: string; role?: string };
export type CompetitionLanding = {
  slug: string;
  competition: { id: string; code: string; name: string; organizer: string };
  tagline: string;
  heroDescription: string;
  heroImageUrl: string;
  aboutTitle: string;
  aboutBody: string;
  registrationUrl: string;
  registrationNote: string;
  contact: { email: string; phone: string; address: string };
  highlights: LandingBlock[];
  prizes: LandingBlock[];
  faqs: LandingBlock[];
  organizers: LandingBlock[];
  sessions: LandingSession[];
  stats: { sessions: number; rounds: number; candidates: number; firstDate: string; lastDate: string };
};

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

export function formatLandingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `${WEEKDAYS[date.getDay()]}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

const shortDate = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value || '');

/** Mọi vòng thi của mọi bảng, gộp theo ngày để dựng dòng thời gian chung. */
export function landingTimeline(sessions: LandingSession[]) {
  const entries = sessions.flatMap(session =>
    session.rounds.flatMap(round =>
      (round.dates.length ? round.dates : ['']).map(date => ({
        date,
        sessionName: session.name,
        sessionCode: session.code,
        round,
      })),
    ),
  );
  return entries.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
}

const NAV = [
  { id: 'gioi-thieu', label: 'Giới thiệu' },
  { id: 'bang-thi', label: 'Bảng thi' },
  { id: 'lich-thi', label: 'Lịch thi' },
  { id: 'giai-thuong', label: 'Giải thưởng' },
  { id: 'hoi-dap', label: 'Hỏi đáp' },
  { id: 'lien-he', label: 'Liên hệ' },
];

function Stat({ icon: Icon, value, label }: { icon: React.ElementType; value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 backdrop-blur">
      <Icon className="h-5 w-5 text-sky-200" />
      <p className="mt-3 text-2xl font-extrabold leading-none text-white">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-sky-200">{label}</p>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#0055DA]">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-[#001E40] sm:text-4xl">{title}</h2>
      {description && <p className="mt-3 text-base leading-7 text-slate-600">{description}</p>}
    </div>
  );
}

export function CompetitionLandingView({ data }: { data: CompetitionLanding }) {
  const timeline = useMemo(() => landingTimeline(data.sessions), [data.sessions]);
  const period = data.stats.firstDate && data.stats.lastDate
    ? `${shortDate(data.stats.firstDate)} – ${shortDate(data.stats.lastDate)}`
    : 'Đang cập nhật';
  const register = data.registrationUrl;

  return (
    <div className="min-h-dvh bg-white font-sans text-slate-800">
      <header className="sticky top-0 z-30 border-b border-[#0055DA]/15 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3 sm:px-8">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#0055DA]">{data.competition.code}</p>
            <p className="truncate text-sm font-extrabold text-[#001E40]">{data.competition.name}</p>
          </div>
          <nav className="ml-auto hidden items-center gap-1 lg:flex">
            {NAV.map(item => (
              <a key={item.id} href={`#${item.id}`} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 transition hover:bg-sky-50 hover:text-[#0055DA]">
                {item.label}
              </a>
            ))}
          </nav>
          {register && (
            <a href={register} target="_blank" rel="noreferrer" className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#0055DA] px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-blue-200 transition hover:bg-[#0042AD] lg:ml-0">
              Đăng ký ngay <ArrowUpRight className="h-4 w-4" />
            </a>
          )}
        </div>
      </header>

      <section className="relative overflow-hidden bg-gradient-to-br from-[#001E40] via-[#00347A] to-[#0055DA]">
        {data.heroImageUrl && (
          <img src={data.heroImageUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-20" />
        )}
        <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-sky-100">
            <Sparkles className="h-3.5 w-3.5" />{data.competition.organizer || 'FermatTech'}
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
            {data.competition.name}
          </h1>
          {data.tagline && <p className="mt-4 max-w-2xl text-lg font-semibold text-sky-100">{data.tagline}</p>}
          {data.heroDescription && <p className="mt-5 max-w-2xl text-base leading-7 text-sky-100/90">{data.heroDescription}</p>}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {register && (
              <a href={register} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-extrabold text-[#0055DA] shadow-xl transition hover:bg-sky-50">
                Đăng ký tham dự <ChevronRight className="h-4 w-4" />
              </a>
            )}
            <a href="#lich-thi" className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-6 py-3.5 text-sm font-extrabold text-white transition hover:bg-white/10">
              Xem lịch thi
            </a>
          </div>
          {data.registrationNote && <p className="mt-4 text-sm font-semibold text-sky-200">{data.registrationNote}</p>}
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={Trophy} value={String(data.stats.sessions)} label="Bảng thi" />
            <Stat icon={ChevronRight} value={String(data.stats.rounds)} label="Vòng thi" />
            <Stat icon={Users} value={data.stats.candidates.toLocaleString('vi-VN')} label="Thí sinh" />
            <Stat icon={CalendarDays} value={period} label="Thời gian" />
          </div>
        </div>
      </section>

      {(data.aboutBody || data.highlights.length > 0) && (
        <section id="gioi-thieu" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8">
          <SectionHeading eyebrow="Giới thiệu" title={data.aboutTitle || 'Về cuộc thi'} />
          {data.aboutBody && (
            <div className="mx-auto mt-8 max-w-3xl space-y-4">
              {data.aboutBody.split('\n').filter(Boolean).map((paragraph, index) => (
                <p key={index} className="text-base leading-7 text-slate-600">{paragraph}</p>
              ))}
            </div>
          )}
          {data.highlights.length > 0 && (
            <div className="mt-12 grid gap-5 sm:grid-cols-2">
              {data.highlights.map((item, index) => (
                <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6 transition hover:border-[#0055DA]/40 hover:bg-white hover:shadow-lg">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0055DA] text-sm font-extrabold text-white">{index + 1}</span>
                  <h3 className="mt-4 text-lg font-extrabold text-[#001E40]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {data.sessions.length > 0 && (
        <section id="bang-thi" className="scroll-mt-20 bg-slate-50 py-20">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <SectionHeading eyebrow="Nội dung thi" title="Các bảng thi" description="Số liệu thí sinh và vòng thi được lấy trực tiếp từ hệ thống khảo thí." />
            <div className="mt-12 grid gap-5 lg:grid-cols-2">
              {data.sessions.map(session => (
                <article key={session.id} className="flex flex-col rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold uppercase tracking-wider text-[#0055DA]">{session.code}</p>
                      <h3 className="mt-1 text-xl font-extrabold text-[#001E40]">{session.name}</h3>
                      {session.time && <p className="mt-1 text-sm font-semibold text-slate-500">{session.time}</p>}
                    </div>
                    <span className="shrink-0 rounded-full bg-sky-50 px-3 py-1 text-xs font-extrabold text-[#0055DA]">{session.phase}</span>
                  </div>
                  <dl className="mt-5 flex flex-wrap gap-5 border-y border-slate-100 py-4">
                    <div><dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Thí sinh</dt><dd className="text-lg font-extrabold text-[#001E40]">{session.candidates.toLocaleString('vi-VN')}</dd></div>
                    <div><dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Vòng thi</dt><dd className="text-lg font-extrabold text-[#001E40]">{session.rounds.length}</dd></div>
                  </dl>
                  <ul className="mt-4 space-y-2">
                    {session.rounds.map(round => (
                      <li key={round.id || round.name} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-bold text-slate-700">{round.name}</span>
                        {round.label && <span className="text-slate-500">· {round.label}</span>}
                        {round.dates.length > 0 && <span className="ml-auto font-semibold text-[#0055DA]">{round.dates.map(shortDate).join(', ')}</span>}
                      </li>
                    ))}
                    {session.rounds.length === 0 && <li className="text-sm text-slate-400">Lịch vòng thi đang được cập nhật.</li>}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {timeline.length > 0 && (
        <section id="lich-thi" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8">
          <SectionHeading eyebrow="Lịch thi" title="Dòng thời gian mùa giải" />
          <ol className="mx-auto mt-12 max-w-3xl border-l-2 border-sky-100">
            {timeline.map((entry, index) => (
              <li key={`${entry.sessionCode}-${entry.round.id}-${entry.date}-${index}`} className="relative pb-8 pl-8 last:pb-0">
                <span className="absolute -left-[9px] top-1.5 h-4 w-4 rounded-full border-4 border-white bg-[#0055DA]" />
                <p className="text-sm font-extrabold text-[#0055DA]">{entry.date ? formatLandingDate(entry.date) : 'Chưa ấn định ngày'}</p>
                <h3 className="mt-1 text-lg font-extrabold text-[#001E40]">{entry.round.name}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {entry.sessionName}
                  {entry.round.label && ` · ${entry.round.label}`}
                  {entry.round.mode && ` · ${entry.round.mode}`}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.prizes.length > 0 && (
        <section id="giai-thuong" className="scroll-mt-20 bg-gradient-to-b from-white to-sky-50 py-20">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <SectionHeading eyebrow="Giải thưởng" title="Cơ cấu giải thưởng" />
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {data.prizes.map((prize, index) => (
                <div key={index} className="rounded-2xl border border-sky-100 bg-white p-6 text-center shadow-sm">
                  <Trophy className="mx-auto h-8 w-8 text-[#0055DA]" />
                  <h3 className="mt-4 text-base font-extrabold text-[#001E40]">{prize.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{prize.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {data.organizers.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <SectionHeading eyebrow="Ban tổ chức" title="Đơn vị đồng hành" />
          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {data.organizers.map((item, index) => (
              <div key={index} className="rounded-2xl border border-slate-200 p-6">
                <h3 className="text-base font-extrabold text-[#001E40]">{item.name}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.role}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.faqs.length > 0 && (
        <section id="hoi-dap" className="scroll-mt-20 bg-slate-50 py-20">
          <div className="mx-auto max-w-3xl px-5 sm:px-8">
            <SectionHeading eyebrow="Hỏi đáp" title="Câu hỏi thường gặp" />
            <div className="mt-12 space-y-3">
              {data.faqs.map((faq, index) => (
                <details key={index} className="group rounded-2xl border border-slate-200 bg-white p-5 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer items-center justify-between gap-4 text-base font-extrabold text-[#001E40]">
                    {faq.question}
                    <ChevronRight className="h-5 w-5 shrink-0 text-[#0055DA] transition group-open:rotate-90" />
                  </summary>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      <section id="lien-he" className="scroll-mt-20 bg-[#001E40] py-20 text-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.2em] text-sky-300">Liên hệ</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Cần thêm thông tin?</h2>
              <p className="mt-3 max-w-md text-base leading-7 text-sky-100/80">
                Ban tổ chức tiếp nhận câu hỏi về điều kiện dự thi, lịch thi và thủ tục đăng ký.
              </p>
              {register && (
                <a href={register} target="_blank" rel="noreferrer" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-extrabold text-[#0055DA] transition hover:bg-sky-50">
                  Đăng ký tham dự <ChevronRight className="h-4 w-4" />
                </a>
              )}
            </div>
            <dl className="space-y-4 self-center">
              {data.contact.email && (
                <div className="flex items-center gap-3"><Mail className="h-5 w-5 shrink-0 text-sky-300" /><a href={`mailto:${data.contact.email}`} className="font-semibold hover:underline">{data.contact.email}</a></div>
              )}
              {data.contact.phone && (
                <div className="flex items-center gap-3"><Phone className="h-5 w-5 shrink-0 text-sky-300" /><span className="font-semibold">{data.contact.phone}</span></div>
              )}
              {data.contact.address && (
                <div className="flex items-center gap-3"><MapPin className="h-5 w-5 shrink-0 text-sky-300" /><span className="font-semibold">{data.contact.address}</span></div>
              )}
            </dl>
          </div>
          <p className="mt-14 border-t border-white/10 pt-6 text-xs text-sky-200/70">
            © {new Date().getFullYear()} {data.competition.organizer || 'FermatTech'} · Trang thông tin được tạo từ FermatTech Workspace.
          </p>
        </div>
      </section>
    </div>
  );
}

export default function CompetitionLandingPublic({ slug }: { slug: string }) {
  const [data, setData] = useState<CompetitionLanding | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    (async () => {
      try {
        const response = await fetch(`/api/public/competitions/${encodeURIComponent(slug)}`);
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          setError(payload?.error || 'Không tải được trang giới thiệu cuộc thi.');
          return;
        }
        setData(payload as CompetitionLanding);
      } catch {
        if (active) setError('Không kết nối được máy chủ. Vui lòng thử lại.');
      }
    })();
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (data?.competition.name) document.title = data.competition.name;
  }, [data]);

  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-extrabold text-[#001E40]">Không mở được trang</h1>
          <p className="mt-3 text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="grid min-h-dvh place-items-center bg-slate-50 text-sm font-semibold text-slate-500">Đang tải trang giới thiệu...</div>;
  return <CompetitionLandingView data={data} />;
}
