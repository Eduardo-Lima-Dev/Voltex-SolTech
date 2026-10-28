import type { PrivacyRequestStatus, PrivacySubjectType } from '../enums/index.js';
import type { RetentionPolicyInput } from '../schemas/privacy.js';

export interface PrivacyRequestDto {
  id: string;
  subjectType: PrivacySubjectType;
  subjectLabel: string;
  status: PrivacyRequestStatus;
  reason: string;
  blockedReason: string | null;
  retainedUntil: string | null;
  summary: Record<string, number>;
  requestedByName: string | null;
  /** `null` quando foi a política de retenção. */
  requestedById: string | null;
  createdAt: string;
}

export interface RetentionPolicyDto {
  policy: RetentionPolicyInput;
  floors: { signedContractsMonths: number };
  sources: {
    signedContractsMonths: string;
    fieldPhotosMonths: string;
    geolocationMonths: string;
    aiConversationsMonths: string;
    accessLogs: string;
  };
}
