import type { PostPlan, PublishChannel, PostVariant } from './publishingTypes';

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
    const errorMsg = data.error || data.detail || `Yêu cầu thất bại (${res.status})`;
    throw new Error(errorMsg);
  }
  return data as T;
}

export const publishingService = {
  // Channels
  async getChannels(idToken: string): Promise<PublishChannel[]> {
    const data = await request<{ channels: PublishChannel[] }>(`${API_BASE}/channels/`, idToken);
    return data.channels || [];
  },

  async createChannel(idToken: string, payload: {
    name: string;
    kind: string;
    is_shared?: boolean;
    is_active?: boolean;
    config: Record<string, any>;
  }): Promise<PublishChannel> {
    const data = await request<{ channel: PublishChannel }>(`${API_BASE}/channels/`, idToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data.channel;
  },

  async updateChannel(idToken: string, id: number, payload: {
    name?: string;
    is_shared?: boolean;
    is_active?: boolean;
    config?: Record<string, any>;
  }): Promise<PublishChannel> {
    const data = await request<{ channel: PublishChannel }>(`${API_BASE}/channels/${id}/`, idToken, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return data.channel;
  },

  async deleteChannel(idToken: string, id: number): Promise<void> {
    await request<void>(`${API_BASE}/channels/${id}/`, idToken, {
      method: 'DELETE',
    });
  },

  async testChannel(idToken: string, id: number): Promise<{ success: boolean; message: string }> {
    return await request<{ success: boolean; message: string }>(`${API_BASE}/channels/${id}/test/`, idToken, {
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
    const data = await request<{ plans: PostPlan[] }>(`${API_BASE}/plans/${qs}`, idToken);
    return data.plans || [];
  },

  async getPlanDetail(idToken: string, id: number): Promise<PostPlan> {
    const data = await request<{ plan: PostPlan }>(`${API_BASE}/plans/${id}/`, idToken);
    return data.plan;
  },

  async createPlan(idToken: string, payload: {
    title: string;
    base_content: string;
    news_post_id?: number | null;
    scheduled_at?: string | null;
    channel_ids?: number[];
  }): Promise<PostPlan> {
    const data = await request<{ plan: PostPlan }>(`${API_BASE}/plans/`, idToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data.plan;
  },

  async updatePlan(idToken: string, id: number, payload: {
    title?: string;
    base_content?: string;
    scheduled_at?: string | null;
    channel_ids?: number[];
    submit_for_approval?: boolean;
  }): Promise<PostPlan> {
    const data = await request<{ plan: PostPlan }>(`${API_BASE}/plans/${id}/`, idToken, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return data.plan;
  },

  async deletePlan(idToken: string, id: number): Promise<void> {
    await request<void>(`${API_BASE}/plans/${id}/`, idToken, {
      method: 'DELETE',
    });
  },

  async approvePlan(idToken: string, id: number, action: 'approve' | 'reject', reject_reason?: string): Promise<PostPlan> {
    const data = await request<{ plan: PostPlan }>(`${API_BASE}/plans/${id}/approve/`, idToken, {
      method: 'POST',
      body: JSON.stringify({ action, reject_reason }),
    });
    return data.plan;
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
    const data = await request<{ variant: PostVariant }>(`${API_BASE}/variants/${id}/`, idToken, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return data.variant;
  },

  async markVariantManualDone(idToken: string, id: number, external_post_url?: string): Promise<PostVariant> {
    const data = await request<{ variant: PostVariant }>(`${API_BASE}/variants/${id}/manual-done/`, idToken, {
      method: 'POST',
      body: JSON.stringify({ external_post_url }),
    });
    return data.variant;
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
};
