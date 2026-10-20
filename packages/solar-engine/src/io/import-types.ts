import type { EquipmentKind, FieldConfidence } from '@voltex/shared';

/**
 * Resultado comum dos leitores de arquivo do catálogo: valores já no formato da ficha, a confiança de cada campo e
 * o que o arquivo não trouxe. Nada daqui vai para o catálogo sem a conferência de uma pessoa.
 */
export interface ParsedEquipment {
  kind: EquipmentKind;
  manufacturer: string;
  model: string;
  spec: Record<string, unknown>;
  fieldConfidence: Record<string, FieldConfidence>;
  /** Campos obrigatórios da ficha que o arquivo não trouxe. */
  missing: string[];
  /** O que o leitor assumiu ou converteu (unidade, divisão por MPPT...). */
  notes: string[];
  /** Custo de referência (centavos), quando a planilha traz. */
  referenceCostCents?: number;
}

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportParseError';
  }
}

/** Campos obrigatórios por tipo (os que `createEquipmentSchema` exige). */
export const REQUIRED_SPEC_FIELDS: Record<EquipmentKind, readonly string[]> = {
  MODULE: [
    'technology',
    'pmaxWp',
    'vmppV',
    'imppA',
    'vocV',
    'iscA',
    'betaVocPctPerC',
    'alphaIscPctPerC',
    'gammaPmaxPctPerC',
    'lengthMm',
    'widthMm',
  ],
  INVERTER: [
    'topology',
    'pAcNomW',
    'vDcMaxV',
    'mpptMinV',
    'mpptMaxV',
    'mpptCount',
    'iMaxPerMpptA',
    'vAcV',
    'phases',
  ],
  PROTECTION: ['protectionKind'],
  CABLE: ['cableKind', 'crossSectionMm2'],
};

export const missingFields = (kind: EquipmentKind, spec: Record<string, unknown>): string[] =>
  REQUIRED_SPEC_FIELDS[kind].filter((field) => spec[field] === undefined);

/** Número de um texto com vírgula ou ponto decimal; `undefined` se não for número. */
export function toNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const text = raw.trim().replace(/\s/g, '');
  if (text === '') return undefined;
  const normalized =
    text.includes(',') && !text.includes('.') ? text.replace(',', '.') : text.replace(/,/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}
