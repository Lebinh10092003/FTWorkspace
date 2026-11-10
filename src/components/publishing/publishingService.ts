import type { PostPlan, PublishChannel, PostVariant, TechTopicSuggestion } from './publishingTypes';

const API_BASE = '/api/publishing';

async function request<T>(url: string, idToken: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${idToken}`);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });
  if (res.status === 204) {
    return {} as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data.message || data.error || data.detail || `Yêu cầu thất bại (${res.status})`;
    throw new Error(errorMsg);
  }
  return data as T;
}

const normalizeChannel = (item: any): PublishChannel => ({
  ...item,
  is_active: item.is_active !== undefined ? Boolean(item.is_active) : (item.isActive !== undefined ? Boolean(item.isActive) : true),
  is_shared: item.is_shared !== undefined ? Boolean(item.is_shared) : (item.isShared !== undefined ? Boolean(item.isShared) : false),
  masked_config: item.masked_config || item.config || {},
  config: item.config || item.masked_config || {},
});

const normalizeVariant = (item: any): PostVariant => ({
  ...item,
  id: item.id,
  plan_id: item.plan_id ?? item.planId,
  channel_id: item.channel_id ?? item.channelId,
  channel_name: item.channel_name ?? item.channelName ?? '',
  channel_kind: item.channel_kind ?? item.channelKind ?? 'manual_other',
  title: item.title ?? '',
  content: item.content ?? '',
  link_url: item.link_url ?? item.linkUrl ?? '',
  scheduled_at: item.scheduled_at ?? item.scheduledAt ?? null,
  status: item.status ?? 'draft',
  external_post_id: item.external_post_id ?? item.externalPostId ?? '',
  external_post_url: item.external_post_url ?? item.externalPostUrl ?? '',
  retry_count: item.retry_count ?? item.retryCount ?? 0,
  error_message: item.error_message ?? item.errorMessage ?? '',
  published_at: item.published_at ?? item.publishedAt ?? null,
  manual_action_url: item.manual_action_url ?? item.manualActionUrl ?? '',
});

const normalizePlan = (item: any): PostPlan => ({
  ...item,
  id: item.id,
  title: item.title ?? '',
  base_content: item.base_content ?? item.baseContent ?? '',
  news_post_id: item.news_post_id ?? item.newsPostId ?? null,
  news_post_title: item.news_post_title ?? item.newsPostTitle,
  created_by_email: item.created_by_email ?? item.creatorEmail ?? '',
  approved_by_email: item.approved_by_email ?? item.approvedByEmail ?? null,
  status: item.status ?? 'draft',
  scheduled_at: item.scheduled_at ?? item.scheduledAt ?? null,
  created_at: item.created_at ?? item.createdAt ?? '',
  updated_at: item.updated_at ?? item.updatedAt ?? '',
  variants: Array.isArray(item.variants) ? item.variants.map(normalizeVariant) : [],
  active_job: item.active_job ?? item.activeJob ?? null,
});

export const publishingService = {
  // Channels
  async getChannels(idToken: string): Promise<PublishChannel[]> {
    const data = await request<any>(`${API_BASE}/channels/`, idToken);
    const list: any[] = Array.isArray(data) ? data : (data?.channels || []);
    return list.map(normalizeChannel);
  },

  async createChannel(idToken: string, payload: {
    name: string;
    kind: string;
    is_shared?: boolean;
    is_active?: boolean;
    config: Record<string, any>;
  }): Promise<PublishChannel> {
    const data = await request<any>(`${API_BASE}/channels/`, idToken, {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        isActive: payload.is_active,
        isShared: payload.is_shared,
      }),
    });
    return normalizeChannel(data?.channel || data);
  },

  async updateChannel(idToken: string, id: number, payload: {
    name?: string;
    is_shared?: boolean;
    is_active?: boolean;
    config?: Record<string, any>;
  }): Promise<PublishChannel> {
    const data = await request<any>(`${API_BASE}/channels/${id}/`, idToken, {
      method: 'PUT',
      body: JSON.stringify({
        ...payload,
        isActive: payload.is_active,
        isShared: payload.is_shared,
      }),
    });
    return normalizeChannel(data?.channel || data);
  },

  async deleteChannel(idToken: string, id: number): Promise<void> {
    await request<void>(`${API_BASE}/channels/${id}/`, idToken, {
      method: 'DELETE',
    });
  },

  async testChannel(idToken: string, id: number): Promise<{ success: boolean; message: string }> {
    return await request<{ success: boolean; message: string }>(`${API_BASE}/channels/${id}/test-connection/`, idToken, {
      method: 'POST',
    });
  },

  // Plans
  async getPlans(idToken: string, params?: { status?: string; start?: string; end?: string }): Promise<PostPlan[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.start) query.set('start', params.start);
    if (params?.end) query.set('end', params.end);
    const qs = query.toString() ? `?${query.toString()}` : '';
    const data = await request<any>(`${API_BASE}/plans/${qs}`, idToken);
    const list: any[] = Array.isArray(data) ? data : (data?.plans || []);
    return list.map(normalizePlan);
  },

  async getPlanDetail(idToken: string, id: number): Promise<PostPlan> {
    const data = await request<any>(`${API_BASE}/plans/${id}/`, idToken);
    return normalizePlan(data?.plan || data);
  },

  async createPlan(idToken: string, payload: {
    title: string;
    base_content: string;
    news_post_id?: number | null;
    scheduled_at?: string | null;
    channel_ids?: number[];
  }): Promise<PostPlan> {
    const data = await request<any>(`${API_BASE}/plans/`, idToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return normalizePlan(data?.plan || data);
  },

  async updatePlan(idToken: string, id: number, payload: {
    title?: string;
    base_content?: string;
    scheduled_at?: string | null;
    channel_ids?: number[];
    submit_for_approval?: boolean;
  }): Promise<PostPlan> {
    const data = await request<any>(`${API_BASE}/plans/${id}/`, idToken, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return normalizePlan(data?.plan || data);
  },

  async deletePlan(idToken: string, id: number): Promise<void> {
    await request<void>(`${API_BASE}/plans/${id}/`, idToken, {
      method: 'DELETE',
    });
  },

  async approvePlan(idToken: string, id: number, action: 'approve' | 'reject', reject_reason?: string): Promise<PostPlan> {
    const data = await request<any>(`${API_BASE}/plans/${id}/approve/`, idToken, {
      method: 'POST',
      body: JSON.stringify({ action, reject_reason }),
    });
    return normalizePlan(data?.plan || data);
  },

  async generateAiVariants(idToken: string, id: number, channel_ids: number[]): Promise<{ job_id: number; message: string }> {
    return await request<{ job_id: number; message: string }>(`${API_BASE}/plans/${id}/generate-variants/`, idToken, {
      method: 'POST',
      body: JSON.stringify({ channel_ids }),
    });
  },

  // Variants
  async updateVariant(idToken: string, id: number, payload: {
    title?: string;
    content?: string;
    link_url?: string;
    scheduled_at?: string | null;
  }): Promise<PostVariant> {
    const data = await request<any>(`${API_BASE}/variants/${id}/`, idToken, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return normalizeVariant(data?.variant || data);
  },

  async markVariantManualDone(idToken: string, id: number, external_post_url?: string): Promise<PostVariant> {
    const data = await request<any>(`${API_BASE}/variants/${id}/manual-done/`, idToken, {
      method: 'POST',
      body: JSON.stringify({ external_post_url }),
    });
    return normalizeVariant(data?.variant || data);
  },

  async publishPlanNow(
    idToken: string,
    id: number,
    options?: { republish?: boolean; variant_ids?: number[] }
  ): Promise<{
    success: boolean;
    dispatched_count?: number;
    results?: any[];
    message?: string;
  }> {
    return await request<any>(`${API_BASE}/plans/${id}/publish-now/`, idToken, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },

  async publishVariantNow(
    idToken: string,
    id: number
  ): Promise<{
    success: boolean;
    variant: PostVariant;
    error?: string;
  }> {
    const res = await request<any>(`${API_BASE}/variants/${id}/publish-now/`, idToken, {
      method: 'POST',
    });
    return {
      success: Boolean(res?.success),
      variant: normalizeVariant(res?.variant || res),
      error: res?.error,
    };
  },

  // Zalo Automation VPS API
  async getZaloAutomationStatus(idToken: string, channelId?: number): Promise<{
    status: string;
    is_authenticated: boolean;
    browser_available: boolean;
    message: string;
  }> {
    const qs = channelId ? `?channel_id=${channelId}` : '';
    return await request<any>(`${API_BASE}/zalo-automation/status/${qs}`, idToken);
  },

  async getZaloAutomationQr(idToken: string, channelId?: number, refresh: boolean = false): Promise<{
    status: string;
    qr_data?: string | null;
    message: string;
  }> {
    const params = new URLSearchParams();
    if (channelId) params.set('channel_id', String(channelId));
    if (refresh) params.set('refresh', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return await request<any>(`${API_BASE}/zalo-automation/qr/${qs}`, idToken);
  },

  // Fetch NewsPosts for quick link/selection
  async getNewsPosts(idToken: string): Promise<Array<{ id: number; title: string; post_type: string; excerpt?: string }>> {
    try {
      const res = await fetch('/api/news-posts/', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.posts || data || []).map((p: any) => ({
        id: p.id,
        title: p.title || 'Không tiêu đề',
        post_type: p.post_type || p.postType || 'tin_tuc',
        excerpt: p.content_payload?.meta_description || p.contentPayload?.metaDescription || '',
      }));
    } catch {
      return [];
    }
  },

  // Tech Discovery & Daily AI Topic Suggestions
  async getTechDiscoveryTopics(
    idToken: string,
    params?: { category?: string; source?: string; converted?: boolean; limit?: number }
  ): Promise<TechTopicSuggestion[]> {
    const sp = new URLSearchParams();
    if (params?.category) sp.set('category', params.category);
    if (params?.source) sp.set('source', params.source);
    if (params?.converted !== undefined) sp.set('converted', String(params.converted));
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return await request<TechTopicSuggestion[]>(`${API_BASE}/tech-discovery/topics/${qs}`, idToken);
  },

  async triggerTechDiscovery(
    idToken: string,
    params?: { limit_per_source?: number }
  ): Promise<{ message: string; topics: TechTopicSuggestion[] }> {
    return await request<{ message: string; topics: TechTopicSuggestion[] }>(
      `${API_BASE}/tech-discovery/trigger/`,
      idToken,
      {
        method: 'POST',
        body: JSON.stringify(params || {}),
      }
    );
  },

  async convertTechTopicToPlan(
    idToken: string,
    topicId: number,
    data?: { auto_generate_variants?: boolean; custom_instructions?: string }
  ): Promise<PostPlan> {
    return await request<PostPlan>(
      `${API_BASE}/tech-discovery/${topicId}/create-plan/`,
      idToken,
      {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }
    );
  },
};
