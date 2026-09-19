/**
 * Đối soát khảo thí — the accounting side of candidate registrations.
 *
 * Khảo thí owns the candidates; accounting needs to know when a new one shows
 * up, then record two independent facts about it: the money arrived, and the
 * invoice was checked. The two are tracked separately because in practice they
 * happen days apart and by different people.
 *
 * Every screen talks to this module only. While `BILLING_USE_MOCK` is true the
 * calls resolve against the demo dataset below; pointing them at the Django
 * endpoints later is a change of function bodies, not of screens.
 */

export type BillingTransferStatus = 'pending' | 'confirmed' | 'mismatch';
export type BillingInvoiceStatus = 'pending' | 'checked' | 'issue' | 'not_required';

export type ExaminationBillingRecord = {
  id: string;
  candidateName: string;
  candidateCode: string;
  competitionCode: string;
  competitionName: string;
  sessionCode: string;
  school: string;
  /** When Khảo thí registered the candidate; drives the "thí sinh mới" alert. */
  registeredAt: string;
  amount: number;
  transferStatus: BillingTransferStatus;
  transferReference: string;
  transferConfirmedAt: string | null;
  transferConfirmedBy: string | null;
  invoiceStatus: BillingInvoiceStatus;
  invoiceNumber: string;
  invoiceCheckedAt: string | null;
  invoiceCheckedBy: string | null;
  /** False until accounting opens the row; the unseen count is the notification. */
  seenByAccountant: boolean;
  note: string;
};

export type ExaminationBillingStats = {
  newCandidates: number;
  awaitingTransfer: number;
  awaitingInvoice: number;
  completed: number;
  totalAmount: number;
  collectedAmount: number;
};

export const BILLING_TRANSFER_LABELS: Record<BillingTransferStatus, string> = {
  pending: 'Chờ chuyển khoản',
  confirmed: 'Đã chuyển khoản',
  mismatch: 'Lệch số tiền',
};

export const BILLING_INVOICE_LABELS: Record<BillingInvoiceStatus, string> = {
  pending: 'Chờ kiểm hóa đơn',
  checked: 'Đã kiểm hóa đơn',
  issue: 'Hóa đơn có vấn đề',
  not_required: 'Không cần hóa đơn',
};

export const BILLING_API_BASE = '/api/examination/billing';
export const BILLING_USE_MOCK = true;

export type BillingRequestOptions = { idToken?: string };

/** Shared fetch helper kept ready for the real endpoints. */
async function request<T>(path: string, options: RequestInit & BillingRequestOptions = {}): Promise<T> {
  const { idToken, headers, ...rest } = options;
  const response = await fetch(`${BILLING_API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as any)?.error || 'Không thể tải dữ liệu đối soát khảo thí.');
  }
  return response.json() as Promise<T>;
}

const delay = <T>(value: T, ms = 140): Promise<T> =>
  new Promise(resolve => window.setTimeout(() => resolve(value), ms));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const MOCK_RECORDS: ExaminationBillingRecord[] = [
  {
    id: 'bill-001', candidateName: 'Nguyễn Minh Khôi', candidateCode: 'FIMO-2026-0187',
    competitionCode: 'FIMO', competitionName: 'FermatTech International Mathematics Olympiad',
    sessionCode: 'FIMO 2026', school: 'TH Trung Văn', registeredAt: '2026-09-18T08:20:00+07:00',
    amount: 650000, transferStatus: 'pending', transferReference: '', transferConfirmedAt: null, transferConfirmedBy: null,
    invoiceStatus: 'pending', invoiceNumber: '', invoiceCheckedAt: null, invoiceCheckedBy: null,
    seenByAccountant: false, note: '',
  },
  {
    id: 'bill-002', candidateName: 'Trần Gia Hân', candidateCode: 'FIMO-2026-0188',
    competitionCode: 'FIMO', competitionName: 'FermatTech International Mathematics Olympiad',
    sessionCode: 'FIMO 2026', school: 'TH Trung Văn', registeredAt: '2026-09-18T08:24:00+07:00',
    amount: 650000, transferStatus: 'pending', transferReference: '', transferConfirmedAt: null, transferConfirmedBy: null,
    invoiceStatus: 'pending', invoiceNumber: '', invoiceCheckedAt: null, invoiceCheckedBy: null,
    seenByAccountant: false, note: '',
  },
  {
    id: 'bill-003', candidateName: 'Lê Bảo Nam', candidateCode: 'IEO-2026-0432',
    competitionCode: 'IEO', competitionName: 'International English Olympiad',
    sessionCode: 'IEO 2026', school: 'THCS A', registeredAt: '2026-09-17T15:40:00+07:00',
    amount: 720000, transferStatus: 'confirmed', transferReference: 'VCB 0918.221540',
    transferConfirmedAt: '2026-09-18T09:05:00+07:00', transferConfirmedBy: 'Kế toán',
    invoiceStatus: 'pending', invoiceNumber: '', invoiceCheckedAt: null, invoiceCheckedBy: null,
    seenByAccountant: true, note: '',
  },
  {
    id: 'bill-004', candidateName: 'Phạm Khánh Chi', candidateCode: 'IEO-2026-0433',
    competitionCode: 'IEO', competitionName: 'International English Olympiad',
    sessionCode: 'IEO 2026', school: 'THCS A', registeredAt: '2026-09-16T10:12:00+07:00',
    amount: 720000, transferStatus: 'confirmed', transferReference: 'VCB 0917.100233',
    transferConfirmedAt: '2026-09-17T08:30:00+07:00', transferConfirmedBy: 'Kế toán',
    invoiceStatus: 'checked', invoiceNumber: 'HD-2026-00871',
    invoiceCheckedAt: '2026-09-17T14:10:00+07:00', invoiceCheckedBy: 'Kế toán',
    seenByAccountant: true, note: '',
  },
  {
    id: 'bill-005', candidateName: 'Đỗ Hoàng Long', candidateCode: 'ISO-2026-0119',
    competitionCode: 'ISO', competitionName: 'International Science Olympiad',
    sessionCode: 'ISO 2026', school: 'MN Đại Mỗ', registeredAt: '2026-09-15T09:05:00+07:00',
    amount: 680000, transferStatus: 'mismatch', transferReference: 'TCB 0916.090010',
    transferConfirmedAt: null, transferConfirmedBy: null,
    invoiceStatus: 'pending', invoiceNumber: '', invoiceCheckedAt: null, invoiceCheckedBy: null,
    seenByAccountant: true, note: 'Phụ huynh chuyển 600.000đ, thiếu 80.000đ.',
  },
  {
    id: 'bill-006', candidateName: 'Vũ Thanh Thảo', candidateCode: 'FIEO-2026-0301',
    competitionCode: 'FIEO', competitionName: 'FermatTech International English Olympiad',
    sessionCode: 'FIEO 2026', school: 'THCS A', registeredAt: '2026-09-18T07:55:00+07:00',
    amount: 700000, transferStatus: 'pending', transferReference: '', transferConfirmedAt: null, transferConfirmedBy: null,
    invoiceStatus: 'pending', invoiceNumber: '', invoiceCheckedAt: null, invoiceCheckedBy: null,
    seenByAccountant: false, note: '',
  },
  {
    id: 'bill-007', candidateName: 'Ngô Quang Huy', candidateCode: 'FIMO-2026-0175',
    competitionCode: 'FIMO', competitionName: 'FermatTech International Mathematics Olympiad',
    sessionCode: 'FIMO 2026', school: 'TH Trung Văn', registeredAt: '2026-09-12T11:30:00+07:00',
    amount: 650000, transferStatus: 'confirmed', transferReference: 'MB 0913.113002',
    transferConfirmedAt: '2026-09-13T09:00:00+07:00', transferConfirmedBy: 'Kế toán',
    invoiceStatus: 'issue', invoiceNumber: 'HD-2026-00844',
    invoiceCheckedAt: '2026-09-14T16:20:00+07:00', invoiceCheckedBy: 'Kế toán',
    seenByAccountant: true, note: 'Sai mã số thuế đơn vị, cần phát hành lại.',
  },
  {
    id: 'bill-008', candidateName: 'Bùi Ngọc Ánh', candidateCode: 'ISO-2026-0120',
    competitionCode: 'ISO', competitionName: 'International Science Olympiad',
    sessionCode: 'ISO 2026', school: 'MN Đại Mỗ', registeredAt: '2026-09-11T14:00:00+07:00',
    amount: 680000, transferStatus: 'confirmed', transferReference: 'VCB 0912.140511',
    transferConfirmedAt: '2026-09-12T10:15:00+07:00', transferConfirmedBy: 'Kế toán',
    invoiceStatus: 'not_required', invoiceNumber: '', invoiceCheckedAt: null, invoiceCheckedBy: null,
    seenByAccountant: true, note: 'Phụ huynh không lấy hóa đơn.',
  },
];

let records: ExaminationBillingRecord[] = clone(MOCK_RECORDS);

function statsFrom(items: ExaminationBillingRecord[]): ExaminationBillingStats {
  const invoiceSettled = (item: ExaminationBillingRecord) =>
    item.invoiceStatus === 'checked' || item.invoiceStatus === 'not_required';
  return {
    newCandidates: items.filter(item => !item.seenByAccountant).length,
    awaitingTransfer: items.filter(item => item.transferStatus !== 'confirmed').length,
    awaitingInvoice: items.filter(item => item.transferStatus === 'confirmed' && !invoiceSettled(item)).length,
    completed: items.filter(item => item.transferStatus === 'confirmed' && invoiceSettled(item)).length,
    totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
    collectedAmount: items.filter(item => item.transferStatus === 'confirmed').reduce((sum, item) => sum + item.amount, 0),
  };
}

function patch(id: string, changes: Partial<ExaminationBillingRecord>) {
  records = records.map(item => (item.id === id ? { ...item, ...changes } : item));
  return records.find(item => item.id === id) || null;
}

export const examinationBillingService = {
  async listRecords(options: BillingRequestOptions = {}): Promise<ExaminationBillingRecord[]> {
    if (!BILLING_USE_MOCK) return request<ExaminationBillingRecord[]>('/records', options);
    return delay(clone(records));
  },

  async getStats(options: BillingRequestOptions = {}): Promise<ExaminationBillingStats> {
    if (!BILLING_USE_MOCK) return request<ExaminationBillingStats>('/stats', options);
    return delay(statsFrom(records));
  },

  /** Clears the "thí sinh mới" notification once accounting has looked. */
  async markSeen(ids: string[], options: BillingRequestOptions = {}): Promise<{ seen: number }> {
    if (!BILLING_USE_MOCK) {
      return request<{ seen: number }>('/seen', { ...options, method: 'POST', body: JSON.stringify({ ids }) });
    }
    const wanted = new Set(ids);
    records = records.map(item => (wanted.has(item.id) ? { ...item, seenByAccountant: true } : item));
    return delay({ seen: ids.length });
  },

  async confirmTransfer(
    id: string,
    input: { reference: string; actor: string },
    options: BillingRequestOptions = {},
  ): Promise<ExaminationBillingRecord | null> {
    if (!BILLING_USE_MOCK) {
      return request<ExaminationBillingRecord>(`/records/${id}/transfer`, { ...options, method: 'POST', body: JSON.stringify(input) });
    }
    return delay(patch(id, {
      transferStatus: 'confirmed',
      transferReference: input.reference,
      transferConfirmedAt: new Date().toISOString(),
      transferConfirmedBy: input.actor,
      seenByAccountant: true,
    }));
  },

  async flagTransferMismatch(id: string, note: string, options: BillingRequestOptions = {}): Promise<ExaminationBillingRecord | null> {
    if (!BILLING_USE_MOCK) {
      return request<ExaminationBillingRecord>(`/records/${id}/transfer-mismatch`, { ...options, method: 'POST', body: JSON.stringify({ note }) });
    }
    return delay(patch(id, { transferStatus: 'mismatch', note, seenByAccountant: true }));
  },

  async checkInvoice(
    id: string,
    input: { invoiceNumber: string; actor: string },
    options: BillingRequestOptions = {},
  ): Promise<ExaminationBillingRecord | null> {
    if (!BILLING_USE_MOCK) {
      return request<ExaminationBillingRecord>(`/records/${id}/invoice`, { ...options, method: 'POST', body: JSON.stringify(input) });
    }
    return delay(patch(id, {
      invoiceStatus: 'checked',
      invoiceNumber: input.invoiceNumber,
      invoiceCheckedAt: new Date().toISOString(),
      invoiceCheckedBy: input.actor,
      seenByAccountant: true,
    }));
  },

  async flagInvoiceIssue(id: string, note: string, options: BillingRequestOptions = {}): Promise<ExaminationBillingRecord | null> {
    if (!BILLING_USE_MOCK) {
      return request<ExaminationBillingRecord>(`/records/${id}/invoice-issue`, { ...options, method: 'POST', body: JSON.stringify({ note }) });
    }
    return delay(patch(id, { invoiceStatus: 'issue', note, seenByAccountant: true }));
  },

  async skipInvoice(id: string, options: BillingRequestOptions = {}): Promise<ExaminationBillingRecord | null> {
    if (!BILLING_USE_MOCK) {
      return request<ExaminationBillingRecord>(`/records/${id}/invoice-skip`, { ...options, method: 'POST' });
    }
    return delay(patch(id, { invoiceStatus: 'not_required', seenByAccountant: true }));
  },
};

export default examinationBillingService;
