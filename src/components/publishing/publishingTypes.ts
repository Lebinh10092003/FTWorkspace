export type ChannelKind =
  | 'web_webhook'
  | 'web_wordpress'
  | 'facebook_page'
  | 'manual_facebook_group'
  | 'manual_zalo_group'
  | 'manual_other'
  | 'zalo_oa';

export type PlanStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type VariantStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'awaiting_manual'
  | 'failed'
  | 'cancelled';

export interface PublishChannel {
  id: number;
  name: string;
  kind: ChannelKind;
  is_active: boolean;
  is_shared: boolean;
  created_by_email: string;
  masked_config: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface PostVariant {
  id: number;
  plan_id: number;
  channel_id: number;
  channel_name: string;
  channel_kind: ChannelKind;
  title: string;
  content: string;
  link_url: string;
  scheduled_at: string | null;
  status: VariantStatus;
  external_post_id: string;
  external_post_url: string;
  retry_count: number;
  error_message: string;
  published_at: string | null;
  manual_action_url: string;
}

export interface PublishAiJob {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  error_message: string;
  channels: string[];
  created_at: string;
}

export interface PostPlan {
  id: number;
  title: string;
  base_content: string;
  news_post_id: number | null;
  news_post_title?: string;
  created_by_email: string;
  approved_by_email: string | null;
  status: PlanStatus;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  variants: PostVariant[];
  active_job: PublishAiJob | null;
}

export interface ChannelKindInfo {
  label: string;
  description: string;
  category: 'api' | 'manual';
  color: string;
}

export const CHANNEL_KIND_MAP: Record<ChannelKind, ChannelKindInfo> = {
  facebook_page: {
    label: 'Facebook Fanpage',
    description: 'Đăng trực tiếp hoặc hẹn giờ qua Meta Pages Graph API',
    category: 'api',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-900',
  },
  web_webhook: {
    label: 'Webhook tự động',
    description: 'Bắn payload JSON kèm chữ ký HMAC qua HTTP POST',
    category: 'api',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-900',
  },
  web_wordpress: {
    label: 'WordPress REST API',
    description: 'Đăng bài viết hoặc tin tức lên website WordPress tự động',
    category: 'api',
    color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900',
  },
  manual_facebook_group: {
    label: 'Nhóm Facebook (Thủ công)',
    description: 'Nhắc việc trong app + copy nội dung + mở nhóm khi đến giờ',
    category: 'manual',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  },
  manual_zalo_group: {
    label: 'Nhóm Zalo (Thủ công)',
    description: 'Nhắc việc trong app + copy nội dung + mở link nhóm khi đến giờ',
    category: 'manual',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  },
  manual_other: {
    label: 'Kênh khác (Thủ công)',
    description: 'Nhắc việc và link thao tác thủ công',
    category: 'manual',
    color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  },
  zalo_oa: {
    label: 'Zalo Official Account',
    description: 'Tích hợp tài khoản doanh nghiệp Zalo OA',
    category: 'api',
    color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300 border-cyan-200 dark:border-cyan-900',
  },
};

export const PLAN_STATUS_MAP: Record<PlanStatus, { label: string; color: string }> = {
  draft: {
    label: 'Bản nháp',
    color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  pending_approval: {
    label: 'Chờ duyệt',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  },
  approved: {
    label: 'Đã duyệt',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  },
  scheduled: {
    label: 'Đã lên lịch',
    color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
  },
  published: {
    label: 'Đã đăng xong',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  partial: {
    label: 'Đăng một phần',
    color: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300',
  },
  failed: {
    label: 'Thất bại',
    color: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
  },
  cancelled: {
    label: 'Đã huỷ',
    color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  },
};

export const VARIANT_STATUS_MAP: Record<VariantStatus, { label: string; color: string }> = {
  draft: {
    label: 'Bản nháp',
    color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  pending_approval: {
    label: 'Chờ duyệt',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  },
  approved: {
    label: 'Đã duyệt',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  },
  scheduled: {
    label: 'Đã lên lịch',
    color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
  },
  publishing: {
    label: 'Đang phát lệnh',
    color: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  },
  published: {
    label: 'Đã xuất bản',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  awaiting_manual: {
    label: 'Cần đăng thủ công',
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 font-bold animate-pulse',
  },
  failed: {
    label: 'Thất bại',
    color: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
  },
  cancelled: {
    label: 'Đã huỷ',
    color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  },
};
