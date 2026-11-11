import CompetitionInformation from './CompetitionInformation';

export type LinkButton = { label: string; url: string };
export type LandingContent = {
  badge?: string; headline?: string; intro?: string; logoUrl?: string; subject?: string; season?: string;
  display?: { name?: string; area?: string; audience?: string; context?: string; topics?: string[]; hoverSummary?: string };
  paperSubjects?: string[];
  style?: { heroTitleSize?: number; introSize?: number; buttonSize?: number; buttonPadding?: number; sectionTitleSize?: number; accentColor?: string };
  buttons?: LinkButton[];
  highlights?: Array<{ value: string; label: string }>;
  overview?: Array<{ title: string; body: string; url: string }>;
  papers?: Record<string, Record<string, string>>;
  resources?: Array<{ category: string; title: string; body: string; url: string }>;
  timeline?: Array<{ title: string; date: string; mode: string; endDate?: string }>;
  awards?: Array<{ title: string; percent: string; description: string }>;
  registration?: { schoolUrl?: string; excelUrl?: string; individualUrl?: string; handbookUrl?: string };
  contact?: { email?: string; phone?: string; address?: string; zaloUrl?: string; facebookFimoUrl?: string; facebookFieoUrl?: string };
  customSections?: Array<{ title: string; body: string; buttonLabel: string; buttonUrl: string }>;
};
export type LandingSite = { id: number; slug: string; title: string; template: string; layout: string; content: LandingContent; published: boolean; updatedAt: string; updatedBy: string };

export default function LandingSiteView(props: { site: LandingSite; preview?: boolean }) {
  return <CompetitionInformation {...props} />;
}
