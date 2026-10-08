export type TimedDuty = { id: string; startsAt: string; endsAt: string; enabled: boolean };

export function reminderKey(email: string, shift: TimedDuty): string {
  return `ft-exam-reminder:${email}:${shift.id}:${shift.startsAt}:${shift.endsAt}`;
}

export function reminderDue(shift: TimedDuty, now: number): boolean {
  const start = Date.parse(shift.startsAt), end = Date.parse(shift.endsAt);
  return shift.enabled && Number.isFinite(start) && end > start && now >= start - 15 * 60_000 && now < end;
}

// The floating "next duty" card is only useful on the day itself: it appears
// one hour before the start and stays until the duty ends. Earlier duties are
// announced by the Workspace notification sent when the duty is assigned.
export const CARD_LEAD_MS = 60 * 60_000;
export function cardVisible(shift: TimedDuty, now: number): boolean {
  const start = Date.parse(shift.startsAt), end = Date.parse(shift.endsAt);
  return shift.enabled && Number.isFinite(start) && end > start && now >= start - CARD_LEAD_MS && now < end;
}

// Scheduling uses server time advanced by a monotonic clock, never the computer's wall clock.
export class ServerClock {
  private anchor: { server: number; monotonic: number } | null = null;
  sync(serverNow: string, sent: number, received: number): void {
    const server = Date.parse(serverNow);
    if (!Number.isFinite(server) || received < sent) return;
    this.anchor = { server: server + (received - sent) / 2, monotonic: received };
  }
  now(monotonic: number): number | null {
    return this.anchor ? this.anchor.server + Math.max(0, monotonic - this.anchor.monotonic) : null;
  }
}

export const dutyTime = (iso: string) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso));

export const dutyDate = (iso: string) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
}).format(new Date(iso));
