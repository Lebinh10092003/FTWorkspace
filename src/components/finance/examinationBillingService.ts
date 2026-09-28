/** Persistent examination billing and unmatched transfer API. */
export type BillingTransferStatus = 'pending' | 'confirmed' | 'mismatch';
export type BillingInvoiceStatus = 'pending' | 'checked' | 'issue' | 'not_required';

export type ExaminationBillingRecord = {
  id: string; candidateName: string; candidateCode: string;
  competitionCode: string; competitionName: string; sessionCode: string;
  school: string; registeredAt: string; amount: number | null; paymentProof?: string; paymentProofId?: string;
  transferStatus: BillingTransferStatus; transferReference: string;
  transferConfirmedAt: string | null; transferConfirmedBy: string | null;
  invoiceStatus: BillingInvoiceStatus; invoiceNumber: string;
  invoiceCheckedAt: string | null; invoiceCheckedBy: string | null;
  seenByAccountant: boolean; note: string;
};

export type ExaminationBillingStats = {
  newCandidates: number; awaitingTransfer: number; awaitingInvoice: number;
  completed: number; totalAmount: number; collectedAmount: number;
};

export type UnmatchedTransfer = {
  id: string; amount: number; reference: string; note: string; hasImage: boolean;
  status: 'open' | 'reviewed' | 'matched'; resolutionNote: string;
  candidateCode: string; competitionCode: string; createdBy: string;
  resolvedBy: string; createdAt: string; updatedAt: string;
};

export const BILLING_TRANSFER_LABELS: Record<BillingTransferStatus, string> = {
  pending: 'Chờ chuyển khoản', confirmed: 'Đã chuyển khoản', mismatch: 'Lệch số tiền',
};
export const BILLING_INVOICE_LABELS: Record<BillingInvoiceStatus, string> = {
  pending: 'Chờ kiểm hóa đơn', checked: 'Đã kiểm hóa đơn',
  issue: 'Hóa đơn có vấn đề', not_required: 'Không cần hóa đơn',
};

const BASE = '/api/examination/billing';
export type BillingRequestOptions = { idToken?: string };

async function request<T>(path: string, options: RequestInit & BillingRequestOptions = {}): Promise<T> {
  const { idToken, headers, ...rest } = options;
  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}), ...(headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Không thể tải dữ liệu đối soát khảo thí.');
  }
  return response.json() as Promise<T>;
}

const post = <T>(path: string, data: unknown, options: BillingRequestOptions = {}) =>
  request<T>(path, { ...options, method: 'POST', body: JSON.stringify(data) });

export const examinationBillingService = {
  listRecords: (options: BillingRequestOptions = {}) => request<ExaminationBillingRecord[]>('/records', options),
  getStats: (options: BillingRequestOptions = {}) => request<ExaminationBillingStats>('/stats', options),
  markSeen: (ids: string[], options: BillingRequestOptions = {}) => post<{ seen: number }>('/seen', { ids }, options),
  setAmount: (id: string, amount: number, options: BillingRequestOptions = {}) => post<ExaminationBillingRecord>(`/records/${id}/amount`, { amount }, options),
  confirmTransfer: (id: string, input: { reference: string; actor: string }, options: BillingRequestOptions = {}) => post<ExaminationBillingRecord>(`/records/${id}/transfer`, input, options),
  flagTransferMismatch: (id: string, note: string, options: BillingRequestOptions = {}) => post<ExaminationBillingRecord>(`/records/${id}/transfer-mismatch`, { note }, options),
  checkInvoice: (id: string, input: { invoiceNumber: string; actor: string }, options: BillingRequestOptions = {}) => post<ExaminationBillingRecord>(`/records/${id}/invoice`, input, options),
  flagInvoiceIssue: (id: string, note: string, options: BillingRequestOptions = {}) => post<ExaminationBillingRecord>(`/records/${id}/invoice-issue`, { note }, options),
  skipInvoice: (id: string, options: BillingRequestOptions = {}) => post<ExaminationBillingRecord>(`/records/${id}/invoice-skip`, {}, options),
  listUnmatched: (options: BillingRequestOptions = {}) => request<UnmatchedTransfer[]>('/unmatched', options),
  async createUnmatched(input: { amount: number; reference: string; note: string; image?: File | null }, options: BillingRequestOptions = {}): Promise<UnmatchedTransfer> {
    const body = new FormData();
    body.append('amount', String(input.amount));
    body.append('reference', input.reference);
    body.append('note', input.note);
    if (input.image) body.append('image', input.image);
    const response = await fetch(`${BASE}/unmatched`, {
      method: 'POST', body, headers: options.idToken ? { Authorization: `Bearer ${options.idToken}` } : {},
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Không thể lưu khoản thu chưa xác định.');
    }
    return response.json();
  },
  resolveUnmatched: (id: string, input: { candidateCode: string; competitionCode: string; resolutionNote: string }, options: BillingRequestOptions = {}) =>
    post<UnmatchedTransfer>(`/unmatched/${id}/resolve`, input, options),
  async unmatchedImage(id: string, options: BillingRequestOptions = {}): Promise<string> {
    const response = await fetch(`${BASE}/unmatched/${id}/image`, {
      headers: options.idToken ? { Authorization: `Bearer ${options.idToken}` } : {},
    });
    if (!response.ok) throw new Error('Không thể tải ảnh chuyển khoản.');
    return URL.createObjectURL(await response.blob());
  },
  async registrationProof(id: string, options: BillingRequestOptions = {}): Promise<string> {
    const response = await fetch(`/api/examination/public-registrations/${encodeURIComponent(id)}/proof`, {
      headers: options.idToken ? { Authorization: `Bearer ${options.idToken}` } : {},
    });
    if (!response.ok) throw new Error('Không thể tải chứng từ đăng ký.');
    return URL.createObjectURL(await response.blob());
  },
};

export default examinationBillingService;
