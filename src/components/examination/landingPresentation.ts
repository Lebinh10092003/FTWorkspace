import { competitionIdentity } from './competitionIdentity';
import { competitionContext } from './competitionEditorial';
import type { LandingContent } from './LandingSiteView';
import { publicLink } from './CompetitionPublicLayout';

/** One editorial source for the overview card, introduction dialog and detail page. */
export function landingPresentation(site: { slug: string; title: string; content: LandingContent }) {
  const content = site.content || {};
  const base = competitionIdentity(content.subject || site.slug, site.title);
  const display = content.display || {};
  const accent = /^#[\da-f]{6}$/i.test(content.style?.accentColor || '') ? content.style!.accentColor! : base.accent;
  return {
    ...base,
    name: display.name?.trim() || base.name,
    area: display.area?.trim() || base.profile?.area || base.name,
    audience: display.audience?.trim() || base.profile?.grades || 'Theo thể lệ cuộc thi',
    context: display.context ?? competitionContext[base.code.toUpperCase()] ?? '',
    topics: display.topics ?? base.profile?.focus.split(' · ') ?? [],
    hoverSummary: display.hoverSummary?.trim() || base.profile?.focus || '',
    logo: publicLink(content.logoUrl !== '/logo.png' ? content.logoUrl : '') || base.logo,
    accent,
    tint: accent === base.accent ? base.tint : `${accent}12`,
  };
}
