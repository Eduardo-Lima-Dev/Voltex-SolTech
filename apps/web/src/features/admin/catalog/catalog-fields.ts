import type {
  EquipmentKind,
  EquipmentOrigin,
  EquipmentStatus,
  FieldConfidence,
  InmetroStatus,
} from '@voltex/shared';

/** Campos de cada tipo de equipamento, na ordem em que aparecem no formulário. */
export type FieldType = 'number' | 'int' | 'text' | 'select' | 'bool';

export interface CatalogField {
  key: string;
  label: string;
  unit?: string;
  type: FieldType;
  required?: boolean;
  options?: readonly { value: string | number; label: string }[];
  hint?: string;
}

const TECHNOLOGIES = [
  { value: 'MONO_SI', label: 'Monocristalino' },
  { value: 'POLY_SI', label: 'Policristalino' },
  { value: 'THIN_FILM', label: 'Filme fino' },
  { value: 'OTHER', label: 'Outra' },
] as const;

export const CATALOG_FIELDS: Record<EquipmentKind, readonly CatalogField[]> = {
  MODULE: [
    {
      key: 'technology',
      label: 'Tecnologia',
      type: 'select',
      required: true,
      options: TECHNOLOGIES,
    },
    { key: 'pmaxWp', label: 'Potência máxima (Pmax)', unit: 'Wp', type: 'number', required: true },
    {
      key: 'vmppV',
      label: 'Tensão de máxima potência (Vmpp)',
      unit: 'V',
      type: 'number',
      required: true,
    },
    {
      key: 'imppA',
      label: 'Corrente de máxima potência (Impp)',
      unit: 'A',
      type: 'number',
      required: true,
    },
    {
      key: 'vocV',
      label: 'Tensão de circuito aberto (Voc)',
      unit: 'V',
      type: 'number',
      required: true,
    },
    {
      key: 'iscA',
      label: 'Corrente de curto-circuito (Isc)',
      unit: 'A',
      type: 'number',
      required: true,
    },
    {
      key: 'betaVocPctPerC',
      label: 'Coeficiente de Voc (β)',
      unit: '%/°C',
      type: 'number',
      required: true,
      hint: 'Negativo, ex.: −0,27',
    },
    {
      key: 'alphaIscPctPerC',
      label: 'Coeficiente de Isc (α)',
      unit: '%/°C',
      type: 'number',
      required: true,
    },
    {
      key: 'gammaPmaxPctPerC',
      label: 'Coeficiente de potência (γ)',
      unit: '%/°C',
      type: 'number',
      required: true,
      hint: 'Negativo, ex.: −0,34',
    },
    { key: 'betaVmppPctPerC', label: 'Coeficiente de Vmpp', unit: '%/°C', type: 'number' },
    { key: 'noctC', label: 'NOCT', unit: '°C', type: 'number' },
    { key: 'maxSystemVoltageV', label: 'Tensão máxima do sistema', unit: 'V', type: 'number' },
    { key: 'maxSeriesFuseA', label: 'Fusível máximo em série', unit: 'A', type: 'number' },
    { key: 'cellsInSeries', label: 'Células em série', type: 'int' },
    { key: 'lengthMm', label: 'Comprimento', unit: 'mm', type: 'number', required: true },
    { key: 'widthMm', label: 'Largura', unit: 'mm', type: 'number', required: true },
    { key: 'thicknessMm', label: 'Espessura', unit: 'mm', type: 'number' },
    { key: 'weightKg', label: 'Peso', unit: 'kg', type: 'number' },
    { key: 'efficiencyPct', label: 'Eficiência', unit: '%', type: 'number' },
    { key: 'bifacial', label: 'Bifacial', type: 'bool' },
    { key: 'powerWarrantyYears', label: 'Garantia de potência', unit: 'anos', type: 'int' },
    { key: 'powerWarrantyEndPct', label: 'Potência garantida ao final', unit: '%', type: 'number' },
    { key: 'firstYearDegradationPct', label: 'Degradação no 1º ano', unit: '%', type: 'number' },
    { key: 'annualDegradationPct', label: 'Degradação anual', unit: '%', type: 'number' },
  ],
  INVERTER: [
    {
      key: 'topology',
      label: 'Topologia',
      type: 'select',
      required: true,
      options: [
        { value: 'STRING', label: 'String' },
        { value: 'MICRO', label: 'Microinversor' },
        { value: 'HYBRID', label: 'Híbrido' },
      ],
    },
    { key: 'pAcNomW', label: 'Potência CA nominal', unit: 'W', type: 'number', required: true },
    { key: 'pAcMaxW', label: 'Potência CA máxima', unit: 'W', type: 'number' },
    { key: 'pDcMaxW', label: 'Potência CC máxima', unit: 'W', type: 'number' },
    { key: 'vDcMaxV', label: 'Tensão CC máxima', unit: 'V', type: 'number', required: true },
    { key: 'vStartV', label: 'Tensão de partida', unit: 'V', type: 'number' },
    { key: 'mpptMinV', label: 'MPPT mínima', unit: 'V', type: 'number', required: true },
    { key: 'mpptMaxV', label: 'MPPT máxima', unit: 'V', type: 'number', required: true },
    { key: 'mpptCount', label: 'Número de MPPT', type: 'int', required: true },
    { key: 'inputsPerMppt', label: 'Entradas por MPPT', type: 'int' },
    {
      key: 'iMaxPerMpptA',
      label: 'Corrente máxima por MPPT',
      unit: 'A',
      type: 'number',
      required: true,
    },
    {
      key: 'iscMaxPerMpptA',
      label: 'Curto-circuito admissível por MPPT',
      unit: 'A',
      type: 'number',
    },
    { key: 'vAcV', label: 'Tensão CA', unit: 'V', type: 'number', required: true },
    {
      key: 'phases',
      label: 'Fases',
      type: 'select',
      required: true,
      options: [
        { value: 1, label: 'Monofásico' },
        { value: 2, label: 'Bifásico' },
        { value: 3, label: 'Trifásico' },
      ],
    },
    { key: 'iAcMaxA', label: 'Corrente CA máxima', unit: 'A', type: 'number' },
    { key: 'efficiencyMaxPct', label: 'Eficiência máxima', unit: '%', type: 'number' },
    { key: 'efficiencyEuroPct', label: 'Eficiência europeia', unit: '%', type: 'number' },
    { key: 'exportLimitation', label: 'Aceita limitação de exportação (Grid Zero)', type: 'bool' },
  ],
  PROTECTION: [
    {
      key: 'protectionKind',
      label: 'Tipo de proteção',
      type: 'select',
      required: true,
      options: [
        { value: 'FUSE_DC', label: 'Fusível CC' },
        { value: 'DISCONNECTOR_DC', label: 'Seccionadora CC' },
        { value: 'SURGE_DC', label: 'DPS CC' },
        { value: 'SURGE_AC', label: 'DPS CA' },
        { value: 'BREAKER_AC', label: 'Disjuntor CA' },
        { value: 'RCD', label: 'DR (diferencial residual)' },
        { value: 'STRING_BOX', label: 'String box' },
      ],
    },
    { key: 'ratedCurrentA', label: 'Corrente nominal', unit: 'A', type: 'number' },
    { key: 'ratedVoltageV', label: 'Tensão nominal', unit: 'V', type: 'number' },
    { key: 'poles', label: 'Polos', type: 'int' },
    { key: 'curve', label: 'Curva', type: 'text' },
    { key: 'breakingCapacityKa', label: 'Capacidade de interrupção', unit: 'kA', type: 'number' },
    { key: 'sensitivityMa', label: 'Sensibilidade (DR)', unit: 'mA', type: 'number' },
    { key: 'standard', label: 'Norma do produto', type: 'text' },
  ],
  CABLE: [
    {
      key: 'cableKind',
      label: 'Tipo de cabo',
      type: 'select',
      required: true,
      options: [
        { value: 'DC_SOLAR', label: 'Cabo solar (CC)' },
        { value: 'AC', label: 'Cabo CA' },
      ],
    },
    { key: 'crossSectionMm2', label: 'Seção', unit: 'mm²', type: 'number', required: true },
    {
      key: 'conductor',
      label: 'Condutor',
      type: 'select',
      options: [
        { value: 'CU', label: 'Cobre' },
        { value: 'AL', label: 'Alumínio' },
      ],
    },
    { key: 'insulation', label: 'Isolação', type: 'text' },
    { key: 'voltageRatingV', label: 'Tensão nominal', unit: 'V', type: 'number' },
    {
      key: 'maxConductorTempC',
      label: 'Temperatura máxima do condutor',
      unit: '°C',
      type: 'number',
    },
    { key: 'standard', label: 'Norma', type: 'text' },
  ],
};

export const KIND_LABELS: Record<EquipmentKind, string> = {
  MODULE: 'Módulos',
  INVERTER: 'Inversores',
  PROTECTION: 'Proteções',
  CABLE: 'Cabos',
};

export const KIND_SINGULAR: Record<EquipmentKind, string> = {
  MODULE: 'módulo',
  INVERTER: 'inversor',
  PROTECTION: 'proteção',
  CABLE: 'cabo',
};

export const STATUS_LABELS: Record<EquipmentStatus, string> = {
  DRAFT: 'Rascunho',
  APPROVED: 'Aprovado',
  RETIRED: 'Aposentado',
};

export const ORIGIN_LABELS: Record<EquipmentOrigin, string> = {
  MANUAL: 'Manual',
  CSV: 'Planilha',
  PAN: 'Arquivo .PAN',
  OND: 'Arquivo .OND',
  DATASHEET_PDF: 'Ficha em PDF',
  CEC: 'Biblioteca CEC',
};

export const INMETRO_LABELS: Record<InmetroStatus, string> = {
  NOT_VERIFIED: 'INMETRO não conferido',
  VERIFIED: 'INMETRO conferido',
  NOT_FOUND: 'Sem registro no INMETRO',
  NOT_APPLICABLE: 'INMETRO não se aplica',
};

export const CONFIDENCE_LABELS: Record<FieldConfidence, string> = {
  HIGH: 'lido direto',
  MEDIUM: 'convertido: confira',
  LOW: 'presumido: confira',
};

/** Resumo de uma linha da ficha, para a lista. */
export function specSummary(kind: EquipmentKind, spec: Record<string, unknown>): string {
  const n = (key: string) => (typeof spec[key] === 'number' ? (spec[key] as number) : undefined);
  const fmt = (value: number | undefined, unit: string) =>
    value === undefined ? null : `${value.toLocaleString('pt-BR')} ${unit}`;
  const parts: (string | null)[] =
    kind === 'MODULE'
      ? [fmt(n('pmaxWp'), 'Wp'), fmt(n('vocV'), 'V (Voc)')]
      : kind === 'INVERTER'
        ? [
            n('pAcNomW') !== undefined ? fmt((n('pAcNomW') as number) / 1000, 'kW') : null,
            n('mpptCount') !== undefined ? `${n('mpptCount')} MPPT` : null,
          ]
        : kind === 'PROTECTION'
          ? [fmt(n('ratedCurrentA'), 'A'), fmt(n('ratedVoltageV'), 'V')]
          : [fmt(n('crossSectionMm2'), 'mm²')];
  return parts.filter(Boolean).join(' · ') || '—';
}
