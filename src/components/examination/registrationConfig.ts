export type RegistrationField = {
  key: string; label: string; type: 'text' | 'textarea' | 'email' | 'tel' | 'date' | 'select';
  required: boolean; enabled: boolean; section: 'candidate' | 'contact' | 'extra'; options: string[];
};
export type RegistrationContent = {
  brand: string; academicYear: string; title: string; intro: string;
  competitionTitle: string; competitionDescription: string;
  candidateTitle: string; candidateDescription: string; contactTitle: string; contactDescription: string;
  extraTitle: string; paymentTitle: string; paymentDescription: string; paymentEnabled: boolean;
  paymentDeclaration: string; confirmationTitle: string; consent: string; submitLabel: string; submitNote: string;
  successTitle: string; successMessage: string; blocks: { title: string; body: string }[];
  /** Mã cuộc thi tạm ẩn khỏi form; các cuộc thi khác tự hiện theo kỳ trong Khảo thí. */
  hiddenCodes: string[]; fields: RegistrationField[];
};
/** Cuộc thi đang nhận đăng ký. `fee` là lệ phí vòng đầu; null khi chưa công bố. */
export type CompetitionOption = {
  code: string; displayCode?: string; name: string; sessionId: string; time: string; fee?: number | null;
  deadline?: string; entryRound?: string; laterRounds?: { name: string; fee: number | null }[];
  requiredFields?: string[]; proofRequired?: boolean; minGrade?: number; maxGrade?: number;
};
export type SessionRegistrationStatus = {
  code: string; sessionId: string; sessionName: string; name: string; phase: string; hidden: boolean;
  status: 'open' | 'not-yet' | 'missing-deadline' | 'superseded'; deadline: string; opensOn: string; deadlineIsExplicit: boolean;
  entryRound: string; fee: number | null; laterRounds: { name: string; fee: number | null }[];
};
