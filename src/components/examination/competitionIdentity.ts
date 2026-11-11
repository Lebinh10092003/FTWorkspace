import { profileFor } from './competitionProfiles';
import { scoCatalogue } from './scoCatalogue';

const identities: Record<string, { code: string; name: string; accent: string; tint: string; logo?: string }> = {
  ...Object.fromEntries(scoCatalogue.map(item => [item.code, { code: item.code, name: item.name, accent: item.accent, tint: item.tint }])),
  WAICY: { code: 'WAICY', name: 'Cuộc thi Trí tuệ nhân tạo Thế giới dành cho Thanh thiếu niên', accent: '#0086a8', tint: '#e7f5fb', logo: '/competition-logos/waicy.webp' },
  AYSBC: { code: 'AYSBC', name: 'Cuộc thi Huy hiệu Nhà khoa học trẻ Châu Á', accent: '#c44827', tint: '#fff0e6', logo: '/competition-logos/aysbc.png' },
  FIMO: { code: 'FIMO', name: 'Olympic Toán học Quốc tế FermatTech', accent: '#1967d2', tint: '#eaf2ff', logo: '/competition-logos/fimo-light.png' },
  FIEO: { code: 'FIEO', name: 'Olympic Tiếng Anh Quốc tế FermatTech', accent: '#007f8d', tint: '#e5f6f6', logo: '/competition-logos/fieo-light.png' },
  FIAIO: { code: 'FIAIO', name: 'Olympic Trí tuệ nhân tạo Quốc tế FermatTech', accent: '#7624ce', tint: '#f3eaff', logo: '/competition-logos/fiaio-light.png' },
  FISO: { code: 'FISO', name: 'Olympic Khoa học Quốc tế FermatTech', accent: '#cb4a12', tint: '#fff0e4', logo: '/competition-logos/fiso-light.png' },
  SIAIO: { code: 'SIAIO', name: 'Olympic Trí tuệ nhân tạo Quốc tế', accent: '#6e4acb', tint: '#f1edfc' },
  SIPHO: { code: 'SIPhO', name: 'Olympic Vật lí Quốc tế', accent: '#1a73e8', tint: '#edf3fe' },
  SICHO: { code: 'SIChO', name: 'Olympic Hóa học Quốc tế', accent: '#008579', tint: '#e6f5ef' },
  SIBO: { code: 'SIBO', name: 'Olympic Sinh học Quốc tế', accent: '#188038', tint: '#eaf5e9' },
  SILSO: { code: 'SILSO', name: 'Olympic Kỹ năng sống Quốc tế', accent: '#9a6700', tint: '#fff6dc' },
};

export function competitionIdentity(value: string, fallback = '') {
  const key = value.trim().toUpperCase();
  return {
    ...(identities[key] || { code: value.toUpperCase(), name: fallback || value, accent: '#1a73e8', tint: '#edf3fe' }),
    profile: profileFor(key),
    family: key.startsWith('FI') ? 'FermatTech' : key.startsWith('SI') ? 'School Connect Olympiad' : key === 'WAICY' ? 'WAICY · ReadyAI' : key === 'AYSBC' ? 'Science Centre Singapore Global' : '',
  };
}

export const competitionOrder = ['FIMO', 'FIEO', 'FIAIO', 'FISO', 'SIMO', 'SIEO', 'SISO', 'SIAIO', 'SICO', 'SIPHO', 'SICHO', 'SIBO', 'SIGKO', 'SIMAO', 'SIFKO', 'SIEIO', 'SISSO', 'SILSO', 'WAICY', 'AYSBC'];
