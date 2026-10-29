export type PostType = 'fb_training' | 'fb_meeting' | 'press_article';
export type PostStatus = 'draft' | 'generating' | 'completed' | 'failed';

export interface SessionItem {
  sessionId: string;
  sessionName: string;
  sessionDate: string;
  timeFrame?: string;
  location?: string;
  fermatParticipants: string[];
  unitParticipants: string[];
  agendaContent: string;
}

export interface UploadedDocFile {
  name: string;
  fileType: 'agenda' | 'material';
  size: number;
  text: string;
  charCount?: number;
  truncated?: boolean;
}

export interface SurveySourceFile {
  name: string;
  responses: number;
}

export interface SurveyCategory {
  name: string;
  total_ratings: number;
  good_or_very_good_count: number;
  good_or_very_good_percent: number;
  satisfaction_score: number;
  detail_counts: Record<string, number>;
}

export interface SurveySummary {
  has_survey: boolean;
  source_filename?: string;
  source_files?: SurveySourceFile[];
  total_responses: number;
  total_ratings: number;
  categories: SurveyCategory[];
  overall_satisfaction_percent: number;
  overall_good_or_very_good_percent: number;
  top_rated_criterion: string;
  notable_criterion: string;
  open_feedback_points: string[];
  allowed_numbers?: number[];
}

export interface ArticleSection {
  heading: string;
  body: string;
  bullets?: string[];
}

export interface ArticleSurveySection {
  heading: string;
  text: string;
  feedback_summary?: string;
}

export interface ContentPayload {
  headline?: string;
  lead_in?: string;
  sections?: ArticleSection[];
  survey_section?: ArticleSurveySection | null;
  closing?: string;
  slogan?: string;
  contact_info?: string;
  hashtags?: string[];
  raw_text?: string;
  warnings?: string[];
}

export interface InputPayload {
  unit_name?: string;
  unitName?: string;
  notes?: string;
  agenda_files?: UploadedDocFile[];
  agendaFiles?: UploadedDocFile[];
  material_files?: UploadedDocFile[];
  materialFiles?: UploadedDocFile[];
  sessions?: SessionItem[];
}

export interface NewsPostItem {
  id: number;
  ownerEmail: string;
  ownerName: string;
  postType: PostType;
  title: string;
  inputPayload: InputPayload;
  surveySummary: SurveySummary;
  contentPayload: ContentPayload;
  status: PostStatus;
  createdAt: string;
  updatedAt: string;
}
