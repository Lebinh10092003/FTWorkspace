import type { Candidate } from './types';

/** An explicit empty membership list means the candidate was removed. */
export function candidateBelongsToSession(candidate: Candidate, sessionId: string, sessionCode: string) {
  if (candidate.sessionIds || candidate.participations) {
    return Boolean(candidate.sessionIds?.includes(sessionId) || candidate.participations?.some(item => item.sessionId === sessionId));
  }
  return (candidate.contests || '').split(/[,;]/).some(code => code.trim().toUpperCase() === sessionCode.toUpperCase());
}
