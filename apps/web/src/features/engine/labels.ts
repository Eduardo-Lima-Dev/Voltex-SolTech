import type { EngineeringProjectStatus, EngineeringVersionStatus } from '@voltex/shared';

export const VERSION_STATUS_LABELS: Record<EngineeringVersionStatus, string> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Enviada para revisão',
  APPROVED: 'Aprovada',
  REJECTED: 'Recusada',
  SUPERSEDED: 'Substituída',
};

export const VERSION_STATUS_BADGE = {
  DRAFT: 'secondary',
  SUBMITTED: 'yellow',
  APPROVED: 'green',
  REJECTED: 'red',
  SUPERSEDED: 'outline',
} as const;

export const PROJECT_STATUS_LABELS: Record<EngineeringProjectStatus, string> = {
  IN_PROGRESS: 'Em andamento',
  APPROVED: 'Aprovado',
  CANCELLED: 'Cancelado',
};

export const PROJECT_STATUS_BADGE = {
  IN_PROGRESS: 'secondary',
  APPROVED: 'green',
  CANCELLED: 'outline',
} as const;
