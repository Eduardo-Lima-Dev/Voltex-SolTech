import type { EngineeringRequestListItemDto } from '@voltex/shared';

export const REQUEST_STATUS_BADGE = {
  PENDING: 'yellow',
  IN_PROGRESS: 'secondary',
  WAITING_VISIT: 'yellow',
  WAITING_INFO: 'yellow',
  IN_REVIEW: 'secondary',
  DONE: 'green',
  CANCELLED: 'outline',
} as const;

export const PRIORITY_LABELS: Record<EngineeringRequestListItemDto['priority'], string> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

export const PRIORITY_BADGE = {
  LOW: 'outline',
  NORMAL: 'secondary',
  HIGH: 'yellow',
  URGENT: 'red',
} as const;

export const EVENT_LABELS: Record<string, string> = {
  COMMENT: 'Comentário',
  STATUS: 'Estado',
  ASSIGNED: 'Atribuição',
  INFO_REQUEST: 'Pedido de informação',
  INFO_ANSWER: 'Resposta',
  PRIORITY: 'Prazo e prioridade',
  SURVEY: 'Levantamento',
  DOCUMENT: 'Documento',
  PROJECT: 'Projeto',
};
