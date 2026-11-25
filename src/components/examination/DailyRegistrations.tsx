import { useEffect, useState } from 'react';
import type { ExaminationSession } from './types';

type DayStats = { total: number; bySession: Record<string, number>; newCandidates: number; newCandidateSessions: string[][] };

/** New registrations per day, from /api/examination/registration-stats. */
export type DailyRegistrationStats = { date: string; today: DayStats; yesterday: DayStats };

const REFRESH_MS = 5 * 60 * 1000;

/** Loads today's/yesterday's counts and refreshes every 5 minutes while the page is open. */
export function useDailyRegistrations(idToken?: string | null, refreshKey?: unknown) {
  const [stats, setStats] = useState<DailyRegistrationStats | null>(null);
  useEffect(() => {
    if (!idToken) return;
    let active = true;
    const load = () => fetch('/api/examination/registration-stats', { headers: { Authorization: `Bearer ${idToken}` } })
      .then(response => (response.ok ? response.json() : null))
      .then(body => { if (active && body) setStats(body); })
      .catch(() => { /* The card simply keeps its total when the count cannot load. */ });
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [idToken, refreshKey]);
  return stats;
}

/**
 * "Ngày 25/11/2026: 45 thí sinh mới · FIMO: 45 lượt đăng ký mới · … · Tổng: N lượt đăng ký mới".
 * `sessions` limits the count (the overview's contest filter); `layout` is
 * "row" for the wide overview card and "stack" (one line each) for the narrow one.
 */
export function DailyRegistrationSummary({ stats, sessions, layout }: { stats: DailyRegistrationStats; sessions: ExaminationSession[]; layout: 'row' | 'stack' }) {
  const day = stats.today;
  const ids = new Set(sessions.map(session => session.id));
  const byCode = new Map<string, number>();
  for (const session of sessions) {
    const count = day.bySession[session.id] || 0;
    if (count) byCode.set(session.code, (byCode.get(session.code) || 0) + count);
  }
  const lines = [...byCode.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'));
  const total = lines.reduce((sum, [, count]) => sum + count, 0);
  const newCandidates = day.newCandidateSessions.filter(list => list.some(id => ids.has(id))).length;
  const date = stats.date.split('-').reverse().join('/');
  const number = (value: number) => value.toLocaleString('vi-VN');
  const items = [
    <span key="new"><b className="text-emerald-800">{number(newCandidates)}</b> thí sinh mới</span>,
    ...lines.map(([code, count]) => <span key={code}>{code}: <b>{number(count)}</b> lượt đăng ký mới</span>),
    <span key="total" className="font-semibold">Tổng: <b className="text-emerald-800">{number(total)}</b> lượt đăng ký mới</span>,
  ];
  if (layout === 'stack') {
    return <div className="text-sm text-slate-700">
      <p className="font-bold text-emerald-900">Ngày {date}:</p>
      <ul className="mt-1 space-y-0.5">{items.map(item => <li key={item.key}>{item}</li>)}</ul>
    </div>;
  }
  return <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-700">
    <span className="font-bold text-emerald-900">Ngày {date}:</span>
    {items.map((item, index) => <span key={item.key} className="inline-flex items-baseline gap-3">{index > 0 && <span aria-hidden="true" className="text-slate-300">·</span>}{item}</span>)}
  </div>;
}
