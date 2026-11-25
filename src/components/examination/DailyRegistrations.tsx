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

function shiftDate(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}/${value.getUTCFullYear()}`;
}

function summarize(stats: DailyRegistrationStats, sessions: ExaminationSession[], which: 'today' | 'yesterday') {
  const day = stats[which];
  const ids = new Set(sessions.map(session => session.id));
  const byCode = new Map<string, number>();
  for (const session of sessions) {
    const count = day.bySession[session.id] || 0;
    if (count) byCode.set(session.code, (byCode.get(session.code) || 0) + count);
  }
  const lines = [...byCode.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'));
  return {
    date: shiftDate(stats.date, which === 'yesterday' ? -1 : 0),
    lines,
    total: lines.reduce((sum, [, count]) => sum + count, 0),
    newCandidates: day.newCandidateSessions.filter(list => list.some(id => ids.has(id))).length,
  };
}

/**
 * A card of its own beside the totals: "Thí sinh đăng ký mới ngày 25/11/2026",
 * the number of new FT codes, then "FIMO: 45 lượt · FIEO: 12 lượt · Tổng 57 lượt đăng ký".
 * `sessions` limits the count (the overview's contest filter).
 */
export function DailyRegistrationCard({ stats, sessions, day = 'today', className = '' }: { stats: DailyRegistrationStats; sessions: ExaminationSession[]; day?: 'today' | 'yesterday'; className?: string }) {
  const { date, lines, total, newCandidates } = summarize(stats, sessions, day);
  const number = (value: number) => value.toLocaleString('vi-VN');
  return <div className={`min-w-[260px] rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-4 ${className}`}>
    <p className="text-sm font-bold text-indigo-900">Thí sinh đăng ký mới ngày {date}</p>
    <p className="mt-1 text-3xl font-extrabold text-indigo-950">{number(newCandidates)}</p>
    <p className="mt-1 text-xs leading-5 text-indigo-800">
      {lines.length
        ? <>{lines.map(([code, count]) => <span key={code} className="mr-3 inline-block whitespace-nowrap"><b>{code}</b>: {number(count)} lượt</span>)}<span className="inline-block whitespace-nowrap font-semibold">Tổng {number(total)} lượt đăng ký</span></>
        : `Chưa có lượt đăng ký mới${day === 'today' ? ' hôm nay' : ''}.`}
    </p>
  </div>;
}
