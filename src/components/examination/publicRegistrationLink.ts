import { competitionOrder } from './competitionIdentity';

const publicCodes = competitionOrder;

export function publicRegistrationLink(slug: string, title = ''): string {
  const tokens = `${slug} ${title}`.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const code = publicCodes.find(item => tokens.includes(item));
  return code ? `/dang-ky-du-thi?cuoc-thi=${encodeURIComponent(code)}` : '';
}
