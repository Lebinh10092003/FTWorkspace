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
  competitionCodes: string[]; fields: RegistrationField[];
};
export type CompetitionOption = { code: string; displayCode?: string; name: string; sessionId: string; time: string };
