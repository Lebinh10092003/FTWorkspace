export type GmailStatusResponse = {
  is_configured: boolean;
  connected: boolean;
  email?: string;
  ai_enabled?: boolean;
  notify_new?: boolean;
  morning_scan_enabled?: boolean;
  morning_time?: string;
  last_sync_at?: string | null;
  digest_count?: number;
  needs_reply_count?: number;
  allowed_domains?: string[];
};

export type MailDigestItem = {
  id: number;
  message_id: string;
  thread_id: string;
  sender: string;
  subject: string;
  received_at: string;
  priority: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
  needs_reply: boolean;
  reply_by?: string | null;
  summary: string;
  actions: string[];
  status: 'new' | 'replied' | 'ignored';
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
