import type {
  FieldIssueType,
  InstallationStatus,
  MaterialItemStatus,
  WorkOrderStatus,
  WorkOrderType,
} from '@voltex/shared';

export const INSTALLATION_STATUS_LABELS: Record<InstallationStatus, string> = {
  AWAITING_ENGINEERING: 'Aguardando engenharia',
  AWAITING_MATERIAL: 'Aguardando material',
  MATERIAL_READY: 'Material separado',
  SCHEDULING: 'Agendamento',
  CREW_ASSIGNED: 'Equipe designada',
  IN_PROGRESS: 'Em instalação',
  FIELD_ISSUE: 'Pendência de campo',
  INSTALLED: 'Instalação concluída',
  COMMISSIONING: 'Comissionamento',
  CUSTOMER_ACCEPTANCE: 'Aceite do cliente',
  DONE: 'Finalizado',
  CANCELLED: 'Cancelado',
};

type Variant = 'green' | 'yellow' | 'red' | 'secondary' | 'outline';

export const INSTALLATION_STATUS_VARIANT: Record<InstallationStatus, Variant> = {
  AWAITING_ENGINEERING: 'outline',
  AWAITING_MATERIAL: 'yellow',
  MATERIAL_READY: 'secondary',
  SCHEDULING: 'yellow',
  CREW_ASSIGNED: 'secondary',
  IN_PROGRESS: 'secondary',
  FIELD_ISSUE: 'red',
  INSTALLED: 'secondary',
  COMMISSIONING: 'secondary',
  CUSTOMER_ACCEPTANCE: 'yellow',
  DONE: 'green',
  CANCELLED: 'outline',
};

export const MATERIAL_STATUS_LABELS: Record<MaterialItemStatus, string> = {
  PENDING: 'Pendente',
  ORDERED: 'Pedido feito',
  RECEIVED: 'Recebido',
  SEPARATED: 'Separado',
  CANCELLED: 'Cancelado',
};

export const WORK_ORDER_TYPE_LABELS: Record<WorkOrderType, string> = {
  VISIT: 'Visita técnica',
  SURVEY: 'Levantamento',
  INSTALLATION: 'Instalação',
  COMMISSIONING: 'Comissionamento',
  MAINTENANCE: 'Manutenção',
  CLEANING: 'Limpeza',
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  PENDING: 'Sem data',
  SCHEDULED: 'Agendada',
  IN_PROGRESS: 'Em execução',
  DONE: 'Concluída',
  CANCELLED: 'Cancelada',
};

export const FIELD_ISSUE_TYPE_LABELS: Record<FieldIssueType, string> = {
  MATERIAL: 'Material',
  ACCESS: 'Acesso',
  SAFETY: 'Segurança',
  TECHNICAL: 'Técnica',
  CUSTOMER: 'Cliente',
  OTHER: 'Outra',
};

/** Passos que exigem motivo (voltar uma etapa ou cancelar): espelha a regra do servidor. */
export const needsReason = (from: InstallationStatus, to: InstallationStatus): boolean =>
  to === 'CANCELLED' ||
  (
    [
      ['MATERIAL_READY', 'AWAITING_MATERIAL'],
      ['SCHEDULING', 'AWAITING_MATERIAL'],
      ['CREW_ASSIGNED', 'SCHEDULING'],
      ['INSTALLED', 'IN_PROGRESS'],
      ['COMMISSIONING', 'IN_PROGRESS'],
      ['CUSTOMER_ACCEPTANCE', 'COMMISSIONING'],
    ] as const
  ).some(([f, t]) => f === from && t === to);
