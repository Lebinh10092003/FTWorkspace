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
  currency: string;
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
  currency: 'VND',
  documentNumber: '', issuedOn: todayIso(), kind: 'new', submissionRound: '',
  proposer: '', department: '', project: '', departmentHead: '', purpose: '',
  approvalDeadline: '', items: [newItem(), newItem()], vatRate: '', otherCost: '',
  supplier: '', paymentMethod: 'transfer', advanceAmount: '', advanceDocument: '',
  advanceDate: '', previousApproval: '', comparison: { quantity: emptyRow(), total: emptyRow() },
  changeReason: '', adjustedTotal: '', committedAmount: '', remainingAmount: '',
  increaseAmount: '', attachments: [], attachmentOther: '', bndcLink: '',
  decision: '', approvedTotal: '', conditions: '',
});

export const CURRENCIES = [
  { code: 'VND', label: 'VND — Việt Nam đồng' },
  { code: 'USD', label: 'USD — Đô la Mỹ' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — Bảng Anh' },
  { code: 'JPY', label: 'JPY — Yên Nhật' },
  { code: 'CNY', label: 'CNY — Nhân dân tệ' },
  { code: 'SGD', label: 'SGD — Đô la Singapore' },
  { code: 'AUD', label: 'AUD — Đô la Úc' },
  { code: 'CAD', label: 'CAD — Đô la Canada' },
  { code: 'KRW', label: 'KRW — Won Hàn Quốc' },
] as const;

export const currencyCode = (value: string) => /^[A-Z]{3}$/.test(value) ? value : 'VND';
export const currencyUnit = (value: string) => value === 'VND' ? 'đồng' : currencyCode(value);
const SYMBOL_CURRENCIES: Record<string, string[]> = {
  '$': ['USD', 'CAD', 'AUD', 'SGD'], '€': ['EUR'], '£': ['GBP'],
  '¥': ['JPY', 'CNY'], '₫': ['VND'],
};
const NUMERIC_INPUT = /^-?(?:\d+(?:[.,]\d{1,2})?|\d{1,3}([.,])\d{3}(?:\1\d{3})*(?:[.,]\d{1,2})?)$/;

export const moneySymbolMismatch = (value: string, currency: string) => {
  const symbol = String(value).match(/[$€£¥₫]/)?.[0];
  return symbol ? !SYMBOL_CURRENCIES[symbol].includes(currencyCode(currency)) : false;
};

export const validMoneyInput = (value: string, currency: string) => {
  const compact = String(value).replace(/\s/g, '');
  if (!compact) return true;
  if (moneySymbolMismatch(value, currency)) return false;
  const symbols = compact.match(/[$€£¥₫]/g) || [];
  if (symbols.length > 1 || (symbols.length === 1 &&
    ![0, compact.length - 1].includes(compact.indexOf(symbols[0])))) return false;
  const number = String(value).replace(/[$€£¥₫\s]/g, '');
  return NUMERIC_INPUT.test(number);
};

export const toNumber = (value: string | number | undefined, currency?: string) => {
  if (value === undefined || value === null || value === '') return 0;
  const raw = String(value).trim();
  if (currency && !validMoneyInput(raw, currency)) return 0;
  const unsigned = raw.replace(/[$€£¥₫\s]/g, '');
  if (!NUMERIC_INPUT.test(unsigned)) return 0;
  const separators = [...unsigned.matchAll(/[.,]/g)];
  let canonical = unsigned;
  if (separators.length) {
    const last = separators[separators.length - 1].index!;
    const fractionLength = unsigned.length - last - 1;
    const decimal = fractionLength > 0 && fractionLength <= 2 ? last : -1;
    canonical = unsigned.split('').map((char, index) =>
      char === '.' || char === ',' ? (index === decimal ? '.' : '') : char).join('');
  }
  const parsed = Number(canonical);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 1234567 -> "1.234.567", matching the Vietnamese grouping used on the form. */
export const money = (value: number) =>
  value ? value.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '';

export const lineAmount = (item: ProposalItem, currency = 'VND') =>
  toNumber(item.quantity) * toNumber(item.unitPrice, currency);

export const totalsOf = (proposal: FundingProposal) => {
  const subtotal = proposal.items.reduce((sum, item) => sum + lineAmount(item, proposal.currency), 0);
  const vat = subtotal * toNumber(proposal.vatRate) / 100;
  const other = toNumber(proposal.otherCost, proposal.currency);
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
  currency: currencyCode(proposal.currency),
  documentNumber: formatProposalNumber(proposal.documentNumber),
  vatRate: toNumber(proposal.vatRate) || '',
  otherCost: toNumber(proposal.otherCost, proposal.currency) || '',
  advanceAmount: toNumber(proposal.advanceAmount, proposal.currency) || '',
  adjustedTotal: toNumber(proposal.adjustedTotal, proposal.currency) || '',
  committedAmount: toNumber(proposal.committedAmount, proposal.currency) || '',
  remainingAmount: toNumber(proposal.remainingAmount, proposal.currency) || '',
  increaseAmount: toNumber(proposal.increaseAmount, proposal.currency) || '',
  approvedTotal: toNumber(proposal.approvedTotal, proposal.currency) || '',
  items: proposal.items
    .filter(item => item.description.trim() || item.quantity || item.unitPrice)
    .map(item => ({
      description: item.description,
      unit: item.unit,
      quantity: toNumber(item.quantity) || '',
      unitPrice: toNumber(item.unitPrice, proposal.currency) || '',
      amount: lineAmount(item, proposal.currency) || '',
    })),
});
