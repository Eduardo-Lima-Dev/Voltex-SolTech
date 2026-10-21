import type { OffgridSystemType } from '@voltex/shared';

export const SYSTEM_TYPE_LABELS: Record<OffgridSystemType, string> = {
  OFFGRID: 'Isolado (off-grid)',
  HYBRID: 'Híbrido (rede + bateria, sem injeção)',
};

export const RESULT_STATUS_LABELS = {
  INCOMPLETE: 'Incompleto',
  INVALID: 'Inválido',
  VALID_WITH_WARNINGS: 'Válido com avisos',
  VALID: 'Válido',
} as const;

export const RESULT_STATUS_BADGE = {
  INCOMPLETE: 'yellow',
  INVALID: 'red',
  VALID_WITH_WARNINGS: 'yellow',
  VALID: 'green',
} as const;

export const CHECK_BADGE = { OK: 'green', WARNING: 'yellow', ERROR: 'red' } as const;
export const CHECK_LABEL = { OK: 'OK', WARNING: 'Aviso', ERROR: 'Erro' } as const;

export const OFFGRID_EVENT_LABELS: Record<string, string> = {
  COMMENT: 'Comentário',
  STATUS: 'Estado',
  ASSIGNED: 'Atribuição',
  PRIORITY: 'Prioridade',
  PROJECT: 'Projeto',
};

export const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];
