import type { InstallationStatus } from '@voltex/shared';

/**
 * Máquina de estados da instalação (docs/03-diagramas/estados/instalacao.md). A regra mora aqui, no servidor; a tela
 * só pergunta quais passos são permitidos.
 */
export const INSTALLATION_TRANSITIONS: Record<InstallationStatus, readonly InstallationStatus[]> = {
  AWAITING_ENGINEERING: ['AWAITING_MATERIAL', 'CANCELLED'],
  AWAITING_MATERIAL: ['MATERIAL_READY', 'CANCELLED'],
  MATERIAL_READY: ['SCHEDULING', 'AWAITING_MATERIAL', 'CANCELLED'],
  SCHEDULING: ['CREW_ASSIGNED', 'AWAITING_MATERIAL', 'CANCELLED'],
  CREW_ASSIGNED: ['IN_PROGRESS', 'SCHEDULING', 'CANCELLED'],
  IN_PROGRESS: ['FIELD_ISSUE', 'INSTALLED', 'CANCELLED'],
  FIELD_ISSUE: ['IN_PROGRESS', 'CANCELLED'],
  INSTALLED: ['COMMISSIONING', 'IN_PROGRESS'],
  COMMISSIONING: ['CUSTOMER_ACCEPTANCE', 'IN_PROGRESS'],
  CUSTOMER_ACCEPTANCE: ['DONE', 'COMMISSIONING'],
  DONE: [],
  CANCELLED: [],
};

/** Voltar uma etapa (ou cancelar) exige o motivo. */
const BACKWARD: readonly (readonly [InstallationStatus, InstallationStatus])[] = [
  ['MATERIAL_READY', 'AWAITING_MATERIAL'],
  ['SCHEDULING', 'AWAITING_MATERIAL'],
  ['CREW_ASSIGNED', 'SCHEDULING'],
  ['INSTALLED', 'IN_PROGRESS'],
  ['COMMISSIONING', 'IN_PROGRESS'],
  ['CUSTOMER_ACCEPTANCE', 'COMMISSIONING'],
];

export const canTransition = (from: InstallationStatus, to: InstallationStatus): boolean =>
  INSTALLATION_TRANSITIONS[from].includes(to);

export const requiresReason = (from: InstallationStatus, to: InstallationStatus): boolean =>
  to === 'CANCELLED' || BACKWARD.some(([f, t]) => f === from && t === to);

export const isFinal = (status: InstallationStatus): boolean =>
  INSTALLATION_TRANSITIONS[status].length === 0;

/** Rótulos para a linha do tempo e o histórico. */
export const INSTALLATION_STATUS_LABEL: Record<InstallationStatus, string> = {
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
