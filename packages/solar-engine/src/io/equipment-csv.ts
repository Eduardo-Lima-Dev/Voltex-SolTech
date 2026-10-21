import type { EquipmentKind, FieldConfidence } from '@voltex/shared';
import { parseDelimited } from './delimited.js';
import { ImportParseError, missingFields, toNumber, type ParsedEquipment } from './import-types.js';

/**
 * Planilha do catálogo (CSV): um modelo por tipo de equipamento, com cabeçalhos em português. Números aceitam vírgula
 * ou ponto decimal. Células vazias significam "não informado" e aparecem em `missing`. Tudo o que vem de planilha
 * entra com confiança ALTA: a conferência é de quem preencheu (e da validação física na prévia).
 */
export const EQUIPMENT_CSV_VERSION = 'equipment-csv-1.0.0';

type Column =
  | { header: string; field: string; type: 'number' | 'int' | 'string' | 'bool' }
  | { header: string; field: string; type: 'enum'; values: Record<string, string | number> };

const BOOL: Record<string, boolean> = {
  sim: true,
  s: true,
  true: true,
  '1': true,
  nao: false,
  não: false,
  n: false,
  false: false,
  '0': false,
};

const MODULE_COLUMNS: Column[] = [
  {
    header: 'tecnologia',
    field: 'technology',
    type: 'enum',
    values: {
      mono: 'MONO_SI',
      monocristalino: 'MONO_SI',
      mono_si: 'MONO_SI',
      poli: 'POLY_SI',
      policristalino: 'POLY_SI',
      poly_si: 'POLY_SI',
      filme_fino: 'THIN_FILM',
      thin_film: 'THIN_FILM',
      outra: 'OTHER',
      other: 'OTHER',
    },
  },
  { header: 'pmax_wp', field: 'pmaxWp', type: 'number' },
  { header: 'vmpp_v', field: 'vmppV', type: 'number' },
  { header: 'impp_a', field: 'imppA', type: 'number' },
  { header: 'voc_v', field: 'vocV', type: 'number' },
  { header: 'isc_a', field: 'iscA', type: 'number' },
  { header: 'eficiencia_pct', field: 'efficiencyPct', type: 'number' },
  { header: 'beta_voc_pct_c', field: 'betaVocPctPerC', type: 'number' },
  { header: 'alpha_isc_pct_c', field: 'alphaIscPctPerC', type: 'number' },
  { header: 'gamma_pmax_pct_c', field: 'gammaPmaxPctPerC', type: 'number' },
  { header: 'beta_vmpp_pct_c', field: 'betaVmppPctPerC', type: 'number' },
  { header: 'noct_c', field: 'noctC', type: 'number' },
  { header: 'tensao_max_sistema_v', field: 'maxSystemVoltageV', type: 'number' },
  { header: 'fusivel_max_serie_a', field: 'maxSeriesFuseA', type: 'number' },
  { header: 'celulas_em_serie', field: 'cellsInSeries', type: 'int' },
  { header: 'comprimento_mm', field: 'lengthMm', type: 'number' },
  { header: 'largura_mm', field: 'widthMm', type: 'number' },
  { header: 'espessura_mm', field: 'thicknessMm', type: 'number' },
  { header: 'peso_kg', field: 'weightKg', type: 'number' },
  { header: 'bifacial', field: 'bifacial', type: 'bool' },
  { header: 'garantia_potencia_anos', field: 'powerWarrantyYears', type: 'int' },
  { header: 'garantia_potencia_final_pct', field: 'powerWarrantyEndPct', type: 'number' },
  { header: 'degradacao_primeiro_ano_pct', field: 'firstYearDegradationPct', type: 'number' },
  { header: 'degradacao_anual_pct', field: 'annualDegradationPct', type: 'number' },
];

const INVERTER_COLUMNS: Column[] = [
  {
    header: 'topologia',
    field: 'topology',
    type: 'enum',
    values: {
      string: 'STRING',
      micro: 'MICRO',
      microinversor: 'MICRO',
      hibrido: 'HYBRID',
      híbrido: 'HYBRID',
      hybrid: 'HYBRID',
    },
  },
  { header: 'potencia_ca_nominal_w', field: 'pAcNomW', type: 'number' },
  { header: 'potencia_ca_maxima_w', field: 'pAcMaxW', type: 'number' },
  { header: 'potencia_cc_maxima_w', field: 'pDcMaxW', type: 'number' },
  { header: 'tensao_cc_maxima_v', field: 'vDcMaxV', type: 'number' },
  { header: 'tensao_partida_v', field: 'vStartV', type: 'number' },
  { header: 'mppt_min_v', field: 'mpptMinV', type: 'number' },
  { header: 'mppt_max_v', field: 'mpptMaxV', type: 'number' },
  { header: 'numero_mppt', field: 'mpptCount', type: 'int' },
  { header: 'entradas_por_mppt', field: 'inputsPerMppt', type: 'int' },
  { header: 'corrente_max_por_mppt_a', field: 'iMaxPerMpptA', type: 'number' },
  { header: 'corrente_curto_por_mppt_a', field: 'iscMaxPerMpptA', type: 'number' },
  { header: 'tensao_ca_v', field: 'vAcV', type: 'number' },
  {
    header: 'fases',
    field: 'phases',
    type: 'enum',
    values: {
      '1': 1,
      '2': 2,
      '3': 3,
      mono: 1,
      monofasico: 1,
      monofásico: 1,
      bi: 2,
      bifasico: 2,
      bifásico: 2,
      tri: 3,
      trifasico: 3,
      trifásico: 3,
    },
  },
  { header: 'corrente_ca_maxima_a', field: 'iAcMaxA', type: 'number' },
  { header: 'eficiencia_maxima_pct', field: 'efficiencyMaxPct', type: 'number' },
  { header: 'eficiencia_europeia_pct', field: 'efficiencyEuroPct', type: 'number' },
  { header: 'limitacao_exportacao', field: 'exportLimitation', type: 'bool' },
];

const PROTECTION_COLUMNS: Column[] = [
  {
    header: 'tipo_protecao',
    field: 'protectionKind',
    type: 'enum',
    values: {
      fusivel_cc: 'FUSE_DC',
      fusível_cc: 'FUSE_DC',
      seccionadora_cc: 'DISCONNECTOR_DC',
      dps_cc: 'SURGE_DC',
      dps_ca: 'SURGE_AC',
      disjuntor_ca: 'BREAKER_AC',
      dr: 'RCD',
      string_box: 'STRING_BOX',
      fuse_dc: 'FUSE_DC',
      disconnector_dc: 'DISCONNECTOR_DC',
      surge_dc: 'SURGE_DC',
      surge_ac: 'SURGE_AC',
      breaker_ac: 'BREAKER_AC',
      rcd: 'RCD',
    },
  },
  { header: 'corrente_nominal_a', field: 'ratedCurrentA', type: 'number' },
  { header: 'tensao_nominal_v', field: 'ratedVoltageV', type: 'number' },
  { header: 'polos', field: 'poles', type: 'int' },
  { header: 'curva', field: 'curve', type: 'string' },
  { header: 'capacidade_interrupcao_ka', field: 'breakingCapacityKa', type: 'number' },
  { header: 'norma', field: 'standard', type: 'string' },
  { header: 'sensibilidade_ma', field: 'sensitivityMa', type: 'number' },
];

const CABLE_COLUMNS: Column[] = [
  {
    header: 'tipo_cabo',
    field: 'cableKind',
    type: 'enum',
    values: { solar_cc: 'DC_SOLAR', cc: 'DC_SOLAR', dc_solar: 'DC_SOLAR', ca: 'AC', ac: 'AC' },
  },
  { header: 'secao_mm2', field: 'crossSectionMm2', type: 'number' },
  {
    header: 'condutor',
    field: 'conductor',
    type: 'enum',
    values: { cobre: 'CU', cu: 'CU', aluminio: 'AL', alumínio: 'AL', al: 'AL' },
  },
  { header: 'isolacao', field: 'insulation', type: 'string' },
  { header: 'tensao_nominal_v', field: 'voltageRatingV', type: 'number' },
  { header: 'temperatura_max_condutor_c', field: 'maxConductorTempC', type: 'number' },
  { header: 'norma', field: 'standard', type: 'string' },
];

const PHASES_ENUM = { '1': 1, '2': 2, '3': 3, monofasico: 1, bifasico: 2, trifasico: 3 };

const BATTERY_COLUMNS: Column[] = [
  {
    header: 'quimica',
    field: 'chemistry',
    type: 'enum',
    values: {
      chumbo_aberto: 'LEAD_FLOODED',
      chumbo_acido: 'LEAD_FLOODED',
      agm: 'LEAD_AGM',
      gel: 'LEAD_GEL',
      opzs: 'OPZS',
      opzv: 'OPZV',
      lfp: 'LFP',
      litio: 'LFP',
      lifepo4: 'LFP',
      nmc: 'NMC',
      outra: 'OTHER',
    },
  },
  { header: 'tensao_nominal_v', field: 'nominalVoltageV', type: 'number' },
  { header: 'capacidade_ah', field: 'capacityAh', type: 'number' },
  { header: 'regime_horas', field: 'capacityHours', type: 'number' },
  { header: 'dod_maxima_pct', field: 'maxDodPct', type: 'number' },
  { header: 'eficiencia_ciclo_pct', field: 'roundTripEfficiencyPct', type: 'number' },
  { header: 'ciclos_de_vida', field: 'cycleLife', type: 'int' },
  { header: 'dod_dos_ciclos_pct', field: 'cycleDodPct', type: 'number' },
  { header: 'vida_calendario_anos', field: 'calendarLifeYears', type: 'number' },
  { header: 'corrente_carga_max_a', field: 'maxChargeCurrentA', type: 'number' },
  { header: 'corrente_descarga_max_a', field: 'maxDischargeCurrentA', type: 'number' },
  { header: 'max_paralelo', field: 'maxParallel', type: 'int' },
  { header: 'peso_kg', field: 'weightKg', type: 'number' },
];

const CHARGE_CONTROLLER_COLUMNS: Column[] = [
  {
    header: 'tecnologia',
    field: 'technology',
    type: 'enum',
    values: { mppt: 'MPPT', pwm: 'PWM' },
  },
  { header: 'tensao_banco_v', field: 'batteryVoltageV', type: 'number' },
  { header: 'tensao_automatica', field: 'autoVoltage', type: 'bool' },
  { header: 'corrente_carga_a', field: 'ratedChargeCurrentA', type: 'number' },
  { header: 'voc_max_v', field: 'pvVocMaxV', type: 'number' },
  { header: 'mppt_min_v', field: 'mpptMinV', type: 'number' },
  { header: 'mppt_max_v', field: 'mpptMaxV', type: 'number' },
  { header: 'potencia_fv_max_w', field: 'pvPowerMaxW', type: 'number' },
  { header: 'isc_max_a', field: 'pvIscMaxA', type: 'number' },
  { header: 'eficiencia_pct', field: 'efficiencyPct', type: 'number' },
  { header: 'compensacao_temperatura', field: 'tempCompensation', type: 'bool' },
];

const OFFGRID_INVERTER_COLUMNS: Column[] = [
  {
    header: 'topologia',
    field: 'topology',
    type: 'enum',
    values: { offgrid: 'OFFGRID', isolado: 'OFFGRID', hibrido: 'HYBRID', hybrid: 'HYBRID' },
  },
  { header: 'tensao_banco_v', field: 'batteryVoltageV', type: 'number' },
  { header: 'potencia_continua_w', field: 'pContinuousW', type: 'number' },
  { header: 'potencia_surto_w', field: 'pSurgeW', type: 'number' },
  { header: 'surto_segundos', field: 'surgeSeconds', type: 'number' },
  { header: 'eficiencia_pct', field: 'efficiencyPct', type: 'number' },
  { header: 'consumo_vazio_w', field: 'standbyW', type: 'number' },
  { header: 'tensao_ca_v', field: 'vAcV', type: 'number' },
  { header: 'fases', field: 'phases', type: 'enum', values: PHASES_ENUM },
  { header: 'onda_senoidal', field: 'sineWave', type: 'bool' },
  { header: 'carregador_a', field: 'chargerCurrentA', type: 'number' },
  { header: 'entrada_rede', field: 'gridInput', type: 'bool' },
  { header: 'entrada_gerador', field: 'generatorInput', type: 'bool' },
  { header: 'mppt_embutido', field: 'mpptBuiltIn', type: 'bool' },
  { header: 'mppt_quantidade', field: 'mpptCount', type: 'int' },
  { header: 'mppt_min_v', field: 'mpptMinV', type: 'number' },
  { header: 'mppt_max_v', field: 'mpptMaxV', type: 'number' },
  { header: 'voc_max_v', field: 'pvVocMaxV', type: 'number' },
  { header: 'potencia_fv_max_w', field: 'pvPowerMaxW', type: 'number' },
  { header: 'corrente_mppt_a', field: 'mpptCurrentA', type: 'number' },
];

const GENERATOR_COLUMNS: Column[] = [
  {
    header: 'combustivel',
    field: 'fuel',
    type: 'enum',
    values: { diesel: 'DIESEL', gasolina: 'GASOLINE', gas: 'GAS', etanol: 'ETHANOL' },
  },
  { header: 'potencia_continua_w', field: 'pContinuousW', type: 'number' },
  { header: 'potencia_emergencia_w', field: 'pStandbyW', type: 'number' },
  { header: 'tensao_ca_v', field: 'vAcV', type: 'number' },
  { header: 'fases', field: 'phases', type: 'enum', values: PHASES_ENUM },
  { header: 'consumo_l_h', field: 'fuelLitersPerHour', type: 'number' },
  { header: 'carga_minima_pct', field: 'minLoadPct', type: 'number' },
  { header: 'partida_automatica', field: 'autoStart', type: 'bool' },
];

const COLUMNS: Record<EquipmentKind, Column[]> = {
  MODULE: MODULE_COLUMNS,
  INVERTER: INVERTER_COLUMNS,
  PROTECTION: PROTECTION_COLUMNS,
  CABLE: CABLE_COLUMNS,
  BATTERY: BATTERY_COLUMNS,
  CHARGE_CONTROLLER: CHARGE_CONTROLLER_COLUMNS,
  OFFGRID_INVERTER: OFFGRID_INVERTER_COLUMNS,
  GENERATOR: GENERATOR_COLUMNS,
};

const COMMON = ['fabricante', 'modelo'];
const TRAILING = ['custo_referencia_reais'];

/** Cabeçalho do modelo de planilha de cada tipo (para o botão "baixar modelo"). */
export function equipmentCsvTemplate(kind: EquipmentKind): string {
  const headers = [...COMMON, ...COLUMNS[kind].map((c) => c.header), ...TRAILING];
  return `${headers.join(';')}\n`;
}

const stripAccents = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export interface EquipmentCsvResult {
  items: ParsedEquipment[];
  /** `row` é o número da linha na planilha (1 = cabeçalho). */
  errors: { row: number; message: string }[];
  /** Colunas do arquivo que o modelo não conhece (ignoradas). */
  ignoredColumns: string[];
}

export function parseEquipmentCsv(kind: EquipmentKind, text: string): EquipmentCsvResult {
  const rows = parseDelimited(text);
  const headerRow = rows[0];
  if (!headerRow) throw new ImportParseError('A planilha está vazia.');
  const headers = headerRow.map((h) => stripAccents(h));
  const index = new Map(headers.map((h, i) => [h, i]));
  if (!index.has('fabricante') || !index.has('modelo'))
    throw new ImportParseError('A planilha precisa das colunas "fabricante" e "modelo".');
  const known = new Set([...COMMON, ...COLUMNS[kind].map((c) => c.header), ...TRAILING]);
  const ignoredColumns = headerRow.filter((_, i) => !known.has(headers[i] as string));

  const items: ParsedEquipment[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.slice(1).forEach((cells, offset) => {
    const rowNumber = offset + 2;
    const cell = (header: string): string => (cells[index.get(header) ?? -1] ?? '').trim();
    const manufacturer = cell('fabricante');
    const model = cell('modelo');
    if (!manufacturer || !model) {
      errors.push({ row: rowNumber, message: 'Fabricante e modelo são obrigatórios.' });
      return;
    }
    const spec: Record<string, unknown> = {};
    const confidence: Record<string, FieldConfidence> = {};
    let failed = false;
    for (const column of COLUMNS[kind]) {
      const raw = cell(column.header);
      if (raw === '') continue;
      let value: unknown;
      if (column.type === 'number' || column.type === 'int') {
        const n = toNumber(raw);
        if (n === undefined || (column.type === 'int' && !Number.isInteger(n))) {
          errors.push({ row: rowNumber, message: `Valor inválido em "${column.header}": ${raw}` });
          failed = true;
          continue;
        }
        value = n;
      } else if (column.type === 'bool') {
        const b = BOOL[stripAccents(raw)];
        if (b === undefined) {
          errors.push({ row: rowNumber, message: `Use sim ou não em "${column.header}": ${raw}` });
          failed = true;
          continue;
        }
        value = b;
      } else if (column.type === 'enum') {
        const mapped = column.values[stripAccents(raw).replace(/[\s-]+/g, '_')];
        if (mapped === undefined) {
          errors.push({
            row: rowNumber,
            message: `Valor desconhecido em "${column.header}": ${raw}`,
          });
          failed = true;
          continue;
        }
        value = mapped;
      } else value = raw;
      spec[column.field] = value;
      confidence[column.field] = 'HIGH';
    }
    if (failed) return;
    const cost = toNumber(cell('custo_referencia_reais'));
    items.push({
      kind,
      manufacturer,
      model,
      spec,
      fieldConfidence: confidence,
      missing: missingFields(kind, spec),
      notes: [],
      ...(cost !== undefined ? { referenceCostCents: Math.round(cost * 100) } : {}),
    });
  });
  return { items, errors, ignoredColumns };
}
