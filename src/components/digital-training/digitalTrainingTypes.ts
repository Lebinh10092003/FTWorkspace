// Kiểu dữ liệu dùng chung của phân hệ Đào tạo số (tách từ DigitalTraining.tsx).


export type Tab =
  | "overview"
  | "calendar"
  | "quanlybndc"
  | "sessions"
  | "partner-sessions"
  | "partners"
  | "leads"
  | "products"
  | "subscriptions"
  | "finance"
  | "survey"
  | "materials";
export type Mode = "week" | "month";
export type Modal =
  | "schedule-kind"
  | "session"
  | "meeting"
  | "other"
  | "partner"
  | "quick-partner"
  | "lead"
  | "class"
  | "material"
  | "survey"
  | "renewal"
  | null;
export type AdditionalContact = {
  contact_person: string;
  position: string;
  phone: string;
  email: string;
};
export type TrainingScheduleDraft = {
  date: string;
  start_time: string;
  location: string;
  unscheduled: boolean;
};
export type PartnerClassDraft = {
  id?: number;
  name: string;
  members: string;
  planned_sessions: string;
  training_contents: string[];
  training_schedule: TrainingScheduleDraft[];
  planned_sessions_custom?: boolean;
  training_contents_custom?: boolean;
};
export type PartnerDraft = {
  name: string;
  partner_type: string;
  partner_subtype: string;
  province: string;
  ward: string;
  contact_person: string;
  contact_position: string;
  phone: string;
  email: string;
  additional_contacts: AdditionalContact[];
  products: string[];
  contract_duration: string;
  contract_duration_unit: string;
  contract_signed_date: string;
  contract_status: string;
  budget: string;
  ai_account_count: string;
  training_location: string;
  class_count: string;
  shared_sessions: string;
  shared_training_schedule: TrainingScheduleDraft[];
  class_plans: PartnerClassDraft[];
  notes: string;
};
export type Partner = {
  id: number;
  name: string;
  address: string;
  contact_person: string;
  phone: string;
  email: string;
  additional_contacts?: AdditionalContact[];
  contract_start: string;
  contract_end: string;
  training_content: string;
  planned_sessions: number;
  completed_sessions: number;
  notes: string;
  partner_type?: string;
  partner_subtype?: string;
  province?: string;
  ward?: string;
  contact_position?: string;
  products?: string[];
  contract_duration?: number | null;
  contract_duration_unit?: string;
  contract_signed_date?: string | null;
  contract_status?: string;
  ai_account_count?: number;
  training_contents?: string[];
  training_schedule?: TrainingScheduleDraft[];
  training_location?: string;
  training_staff?: string;
  budget?: number | null;
  created_at?: string;
};
export type Session = {
  id: number;
  title: string;
  session_number?: number | null;
  date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  partner: string;
  partner_id?: number | null;
  partner_name?: string;
  class_group_id?: number | null;
  class_group_name?: string;
  category: string;
  contents?: string[];
  attendees: number;
  location: string;
  staff_name?: string;
  instructor_name?: string;
  support_staff_name?: string;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
  notes: string;
  has_materials: boolean;
};
export type Lead = {
  id: number;
  name: string;
  lead_type: string;
  address: string;
  representative: string;
  representative_position: string;
  phone: string;
  email: string;
  interested_products?: string[];
  stage: "discussion" | "meeting" | "proposal" | "negotiation" | "on_hold" | "lost" | "converted";
  notes: string;
  converted_partner?: number | null;
  converted_partner_name?: string;
  meeting_count: number;
  next_meeting_at?: { id: number; date: string; start_time?: string | null; title: string } | null;
};
export type CustomerMeeting = {
  id: number;
  title: string;
  schedule_type?: "meeting" | "other";
  activity_type?: string;
  customer_type: string;
  representative: string;
  phone: string;
  email: string;
  lead?: number | null;
  lead_name?: string;
  partner?: number | null;
  partner_name?: string;
  opportunity?: number | null;
  product_name?: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  location: string;
  content: string;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
  staff_name?: string;
  notes: string;
};
export type EmployeeOption = { name: string; email: string };
export type ProductOption = { id: number; name: string; active: boolean };
export type ProductOpportunity = { id: number; partner: number; partner_name: string; product: number; product_name: string; status: "negotiating" | "on_hold" | "won" | "lost"; notes: string; meeting_count: number };
export type CalendarItem = {
  id: string | number;
  title: string;
  date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  staff_name?: string | null;
  content?: string | null;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
  kind?: "training" | "meeting" | "other";
};
export type CalendarLayoutItem = {
  item: CalendarItem;
  start: number;
  end: number;
  column: number;
  columnCount: number;
};

export type CalendarDetail = {
  kind: "training" | "meeting" | "other";
  sourceId: number;
};
export type WorkActivity = {
  key: string;
  sourceId: number;
  kind: "training" | "meeting" | "other";
  title: string;
  date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  customerId?: number | null;
  customerName: string;
  className: string;
  activityLabel: string;
  content: string;
  location: string;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
  staffName: string;
  attendees?: number;
  instructorName?: string;
  supportStaffName?: string;
};
export type TrainingClass = {
  id: number;
  partner: number;
  partner_name?: string;
  name: string;
  members: string;
  planned_sessions: number;
  training_contents?: string[];
  completed_sessions: number;
  notes: string;
};
export type Material = {
  id: number;
  title: string;
  file_url: string;
  external_url: string;
  file_name: string;
  file_type: string;
  session?: number | null;
  session_name?: string;
  partner?: number | null;
  partner_name?: string;
  notes: string;
};
export type Survey = {
  id: number;
  title: string;
  form_type: "end_session" | "end_course";
  session?: number | null;
  session_name?: string;
  partner?: number | null;
  partner_name?: string;
  notes: string;
};
