import type { ExaminationPage } from './types';

export type ExaminationRoute = { page: ExaminationPage; id?: string };

const listRoutes: Record<string, ExaminationPage> = {
  '': 'overview',
  'competitions': 'competitions',
  'sessions': 'sessions',
  'candidates': 'candidates',
  'registration-forms': 'registration-forms',
  'unmatched-transfers': 'unmatched-transfers',
  'classes': 'classes',
  'teachers': 'teachers',
  'partners': 'partners',
  'import': 'import',
  'papers': 'papers',
  'blueprints': 'blueprints',
  'ai-config': 'ai-config',
};

const decodePart = (value?: string) => {
  try { return value ? decodeURIComponent(value) : ''; } catch { return value || ''; }
};

export function examinationRouteFromPath(pathname: string): ExaminationRoute {
  if (pathname === '/registration-forms' || pathname === '/registration-forms/') return { page: 'registration-forms' };
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts[0] !== 'examination') return { page: 'overview' };
  const section = parts[1] || '';
  const id = decodePart(parts[2]);
  if (section === 'papers' && parts[2] === 'new') return { page: 'paper-create' };
  if (section === 'blueprints' && id) return { page: 'blueprint-detail', id };
  if (section === 'papers' && id) return { page: 'paper-detail', id };
  if (section === 'sessions' && id) return { page: 'session-detail', id };
  if (section === 'competitions' && id) return { page: 'competition-detail', id };
  if (section === 'candidates' && id) return { page: 'candidate-detail', id };
  if (section === 'teachers' && id) return { page: 'teacher-detail', id };
  if (section === 'classes' && id) return { page: 'class-detail', id };
  if (section === 'partners' && id) return { page: 'partners', id };
  return { page: listRoutes[section] || 'overview' };
}

export function examinationPathFor(page: ExaminationPage, id = ''): string {
  const encoded = encodeURIComponent(id);
  switch (page) {
    case 'competitions': return '/examination/competitions';
    case 'competition-detail': return encoded ? `/examination/competitions/${encoded}` : '/examination/competitions';
    case 'sessions': return '/examination/sessions';
    case 'session-detail': return encoded ? `/examination/sessions/${encoded}` : '/examination/sessions';
    case 'candidates': return '/examination/candidates';
    case 'registration-forms': return '/examination/registration-forms';
    case 'unmatched-transfers': return '/examination/unmatched-transfers';
    case 'candidate-detail': return encoded ? `/examination/candidates/${encoded}` : '/examination/candidates';
    case 'classes': return '/examination/classes';
    case 'class-detail': return encoded ? `/examination/classes/${encoded}` : '/examination/classes';
    case 'teachers': return '/examination/teachers';
    case 'teacher-detail': return encoded ? `/examination/teachers/${encoded}` : '/examination/teachers';
    case 'partners': return encoded ? `/examination/partners/${encoded}` : '/examination/partners';
    case 'import': return '/examination/import';
    case 'papers': return '/examination/papers';
    case 'blueprints': return '/examination/blueprints';
    case 'blueprint-detail': return encoded ? '/examination/blueprints/' + encoded : '/examination/blueprints';
    case 'paper-create': return '/examination/papers/new';
    case 'paper-detail': return encoded ? '/examination/papers/' + encoded : '/examination/papers';
    case 'ai-config': return '/examination/ai-config';
    default: return '/examination';
  }
}
