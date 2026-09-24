/** Shape of the "Phiếu đề xuất kinh phí" form, shared by the editor and the
 *  A4 preview. The backend renders the .docx from this same payload, so the
 *  preview and the downloaded file are driven by one source. */

export type ProposalItem = {
  id: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
};

export type ComparisonRow = { previous: string; current: string; delta: string };

export type FundingProposal = {
  documentNumber: string;
  issuedOn: string;
  kind: 'new' | 'adjustment';
  submissionRound: string;
  proposer: string;
  department: string;
  project: string;
  departmentHead: string;
  purpose: string;
  approvalDeadline: string;
  items: ProposalItem[];
  vatRate: string;
  otherCost: string;
  supplier: string;
  paymentMethod: 'transfer' | 'cash';
  advanceAmount: string;
  advanceDocument: string;
  advanceDate: string;
  previousApproval: string;
  comparison: { quantity: ComparisonRow; total: ComparisonRow };
  changeReason: string;
  adjustedTotal: string;
  committedAmount: string;
  remainingAmount: string;
  increaseAmount: string;
  attachments: string[];
  attachmentOther: string;
  bndcLink: string;
  decision: string;
  approvedTotal: string;
  conditions: string;
};

export const ATTACHMENT_OPTIONS = [
  { value: 'quote', label: 'Báo giá đủ thuế/phí' },
  { value: 'quantity', label: 'Bảng/danh sách chốt số lượng' },
  { value: 'approval', label: 'Phê duyệt trước' },
  { value: 'spec', label: 'Quy cách/mẫu sản phẩm' },
];

export const DECISION_OPTIONS = [
  { value: 'approved', label: 'Đồng ý' },
  { value: 'conditional', label: 'Đồng ý có điều kiện' },
  { value: 'more', label: 'Yêu cầu bổ sung' },
  { value: 'rejected', label: 'Không đồng ý' },
];

export const emptyRow = (): ComparisonRow => ({ previous: '', current: '', delta: '' });

export const newItem = (): ProposalItem => ({
  id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  description: '', unit: '', quantity: '', unitPrice: '',
});

export const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const blankProposal = (): FundingProposal => ({
  documentNumber: '', issuedOn: todayIso(), kind: 'new', submissionRound: '',
  proposer: '', department: '', project: '', departmentHead: '', purpose: '',
  approvalDeadline: '', items: [newItem(), newItem()], vatRate: '', otherCost: '',
  supplier: '', paymentMethod: 'transfer', advanceAmount: '', advanceDocument: '',
  advanceDate: '', previousApproval: '', comparison: { quantity: emptyRow(), total: emptyRow() },
  changeReason: '', adjustedTotal: '', committedAmount: '', remainingAmount: '',
  increaseAmount: '', attachments: [], attachmentOther: '', bndcLink: '',
  decision: '', approvedTotal: '', conditions: '',
});

export const toNumber = (value: string | number | undefined) => {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(String(value).replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 1234567 -> "1.234.567", matching the Vietnamese grouping used on the form. */
export const money = (value: number) =>
  value ? value.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '';

export const lineAmount = (item: ProposalItem) => toNumber(item.quantity) * toNumber(item.unitPrice);

export const totalsOf = (proposal: FundingProposal) => {
  const subtotal = proposal.items.reduce((sum, item) => sum + lineAmount(item), 0);
  const vat = subtotal * toNumber(proposal.vatRate) / 100;
  const other = toNumber(proposal.otherCost);
  return { subtotal, vat, other, total: subtotal + vat + other };
};

/** Dotted leader used wherever the printed form leaves a blank to write on. */
export const dotted = (value: string | undefined, width = 30) =>
  value && value.trim() ? value.trim() : '…'.repeat(width);

export const dateWords = (value: string, prefix = 'Hà Nội, ngày') => {
  const parsed = value ? new Date(`${value}T00:00:00`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return `${prefix} … tháng … năm …`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix} ${pad(parsed.getDate())} tháng ${pad(parsed.getMonth() + 1)} năm ${parsed.getFullYear()}`;
};

export const shortDate = (value: string) => {
  const parsed = value ? new Date(`${value}T00:00:00`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '……/……/………';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
};

export const proposalNumberDigits = (value: string) =>
  value.split('/', 1)[0].replace(/\D/g, '');

export const formatProposalNumber = (value: string) => {
  const digits = proposalNumberDigits(value);
  return digits ? `${digits}/PĐXKP-FT` : '';
};

/** The payload the .docx endpoint expects. */
export const toPayload = (proposal: FundingProposal) => ({
  ...proposal,
  documentNumber: formatProposalNumber(proposal.documentNumber),
  items: proposal.items
    .filter(item => item.description.trim() || item.quantity || item.unitPrice)
    .map(item => ({
      description: item.description,
      unit: item.unit,
      quantity: toNumber(item.quantity) || '',
      unitPrice: toNumber(item.unitPrice) || '',
      amount: lineAmount(item) || '',
    })),
});
