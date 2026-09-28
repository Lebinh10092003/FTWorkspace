const publicCodes = ['SIAIO', 'SIPHO', 'SICHO', 'SIBO', 'SILSO', 'FIMO', 'FIEO'];

export function publicRegistrationLink(slug: string, title = ''): string {
  const tokens = `${slug} ${title}`.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const code = publicCodes.find(item => tokens.includes(item));
  return code ? `/dang-ky-du-thi?cuoc-thi=${encodeURIComponent(code)}` : '';
}
