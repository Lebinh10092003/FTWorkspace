export type RegistrationReceipt = {
  registrationId: string; candidateCode: string; candidateName: string; contestCodes: string[];
  createdAt: string; status: string; paymentToken: string; paymentUrl: string;
  presentation?: { paymentEnabled: boolean; paymentTitle: string; paymentDescription: string; paymentDeclaration: string; successTitle: string; successMessage: string };
  payment: {
    items: Array<{ code: string; fee: number | null; sessionId: string }>;
    total: number | null; memo: string; qrPayload: string; proofReceived: boolean;
    paymentStatus: 'pending' | 'review' | 'confirmed';
    bank: { name: string; bin: string; account: string; accountName: string } | null;
  };
};
