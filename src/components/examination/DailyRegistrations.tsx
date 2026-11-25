import { useEffect, useState } from 'react';

/** New registrations per day, from /api/examination/registration-stats. */
export type DailyRegistrationStats = {
  date: string;
  today: { total: number; bySession: Record<string, number>; newCandidates: number };
  yesterday: { total: number; bySession: Record<string, number>; newCandidates: number };
};

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

/** "+12 hôm nay · hôm qua 8": a short line under a total. */
export function DailyIncrease({ today, yesterday, unit }: { today: number; yesterday: number; unit: string }) {
  return <p className="flex flex-wrap items-baseline gap-x-2 text-emerald-800">
    <span className={`rounded-md px-1.5 py-0.5 font-bold ${today ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>+{today.toLocaleString('vi-VN')}</span>
    <span>{unit} mới hôm nay</span>
    <span className="text-slate-500">· hôm qua {yesterday.toLocaleString('vi-VN')}</span>
  </p>;
}
