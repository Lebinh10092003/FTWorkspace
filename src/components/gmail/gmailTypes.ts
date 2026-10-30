export type GmailStatusResponse = {
  is_configured: boolean;
  connected: boolean;
  email?: string;
  ai_enabled?: boolean;
  notify_new?: boolean;
  morning_scan_enabled?: boolean;
  morning_time?: string;
  superior_contacts?: string[];
  last_sync_at?: string | null;
  digest_count?: number;
  needs_reply_count?: number;
  allowed_domains?: string[];
};

export type ActionItem = {
  type: string;
  title: string;
  deadline?: string;
  required_preparations?: string[];
  priority?: string;
  completed?: boolean;
};

export type MailDigestItem = {
  id: number;
  message_id: string;
  thread_id: string;
  sender: string;
  sender_email?: string;
  subject: string;
  received_at: string;
  recipient_role?: 'to' | 'cc' | 'other';
  addressed_by_name?: boolean;
  match_reason?: string;
  priority: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW' | 'urgent' | 'high' | 'normal' | 'low';
  needs_reply: boolean;
  reply_by?: string | null;
  summary: string;
  actions: Array<ActionItem | string>;
  status: 'new' | 'replied' | 'ignored';
  is_from_me?: boolean;
};

export type DigestsCounts = {
  all: number;
  needs_reply: number;
  cc: number;
  today: number;
  unhandled: number;
  handled: number;
};

export type ListDigestsResponse = {
  total: number;
  page: number;
  page_size: number;
  counts?: DigestsCounts;
  results: MailDigestItem[];
};

export type MorningDigestResponse = {
  unreplied_count: number;
  recent_count: number;
  unreplied_threads: Array<{
    thread_id: string;
    subject: string;
    sender: string;
    date: string;
  }>;
  recent_messages: Array<{
    id: string;
    thread_id: string;
    subject: string;
    sender: string;
    date: string;
    snippet: string;
  }>;
};
