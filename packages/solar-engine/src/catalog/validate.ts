import type {
  CableSpec,
  EquipmentKind,
  InverterSpec,
  ModuleSpec,
  ProtectionSpec,
  SpecIssue,
} from '@voltex/shared';

/**
 * Conferência física das fichas do catálogo (ADR-0017). Separa o que **impede a aprovação** (`ERROR`: valor
 * fisicamente impossível ou inconsistente) do que só **avisa** (`WARNING`: fora da faixa típica, confira na ficha).
 * Faixas típicas são de engenharia comum e servem para pegar erro de digitação ou de unidade, não são norma.
 */
export const CATALOG_VALIDATION_VERSION = 'catalog-1.0.0';

const err = (code: string, field: string, message: string): SpecIssue => ({
  code,
  severity: 'ERROR',
  field,
  message,
});
const warn = (code: string, field: string, message: string): SpecIssue => ({
  code,
  severity: 'WARNING',
  field,
  message,
});

const POWER_TOLERANCE_ERROR = 0.05;
const POWER_TOLERANCE_WARNING = 0.02;

export function validateModuleSpec(spec: ModuleSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  if (spec.vmppV >= spec.vocV)
    issues.push(err('VMPP_NOT_BELOW_VOC', 'vmppV', 'Vmpp deve ser menor que Voc.'));
  if (spec.imppA >= spec.iscA)
    issues.push(err('IMPP_NOT_BELOW_ISC', 'imppA', 'Impp deve ser menor que Isc.'));

  const electrical = spec.vmppV * spec.imppA;
  const gap = Math.abs(electrical - spec.pmaxWp) / spec.pmaxWp;
  if (gap > POWER_TOLERANCE_ERROR)
    issues.push(
      err(
        'PMAX_MISMATCH',
        'pmaxWp',
        `Pmax (${spec.pmaxWp} Wp) não bate com Vmpp × Impp (${electrical.toFixed(1)} W): confira as unidades.`,
      ),
    );
  else if (gap > POWER_TOLERANCE_WARNING)
    issues.push(
      warn(
        'PMAX_GAP',
        'pmaxWp',
        `Pmax difere ${(gap * 100).toFixed(1)}% de Vmpp × Impp (${electrical.toFixed(1)} W).`,
      ),
    );

  if (spec.betaVocPctPerC >= 0)
    issues.push(
      err('BETA_VOC_NOT_NEGATIVE', 'betaVocPctPerC', 'O coeficiente de Voc deve ser negativo.'),
    );
  else if (spec.betaVocPctPerC < -0.6 || spec.betaVocPctPerC > -0.1)
    issues.push(
      warn(
        'BETA_VOC_RANGE',
        'betaVocPctPerC',
        'Coeficiente de Voc fora da faixa típica (−0,6 a −0,1 %/°C): confira a unidade (%/°C, não mV/°C).',
      ),
    );
  if (spec.gammaPmaxPctPerC >= 0)
    issues.push(
      err('GAMMA_NOT_NEGATIVE', 'gammaPmaxPctPerC', 'O coeficiente de potência deve ser negativo.'),
    );
  else if (spec.gammaPmaxPctPerC < -0.6 || spec.gammaPmaxPctPerC > -0.2)
    issues.push(
      warn(
        'GAMMA_RANGE',
        'gammaPmaxPctPerC',
        'Coeficiente de potência fora da faixa típica (−0,6 a −0,2 %/°C).',
      ),
    );
  if (spec.alphaIscPctPerC < -0.1 || spec.alphaIscPctPerC > 0.2)
    issues.push(
      warn(
        'ALPHA_RANGE',
        'alphaIscPctPerC',
        'Coeficiente de Isc fora da faixa típica (−0,1 a +0,2 %/°C).',
      ),
    );
  if (spec.betaVmppPctPerC !== undefined && spec.betaVmppPctPerC >= 0)
    issues.push(
      err('BETA_VMPP_NOT_NEGATIVE', 'betaVmppPctPerC', 'O coeficiente de Vmpp deve ser negativo.'),
    );
  if (spec.noctC !== undefined && (spec.noctC < 35 || spec.noctC > 55))
    issues.push(warn('NOCT_RANGE', 'noctC', 'NOCT fora da faixa típica (35 a 55 °C).'));

  if (spec.maxSystemVoltageV !== undefined) {
    if (spec.maxSystemVoltageV < spec.vocV)
      issues.push(
        err(
          'SYSTEM_VOLTAGE_BELOW_VOC',
          'maxSystemVoltageV',
          'A tensão máxima do sistema é menor que a Voc de um módulo.',
        ),
      );
    else if (spec.maxSystemVoltageV < 600 || spec.maxSystemVoltageV > 1600)
      issues.push(
        warn(
          'SYSTEM_VOLTAGE_RANGE',
          'maxSystemVoltageV',
          'Tensão máxima do sistema fora de 600 a 1600 V.',
        ),
      );
  }
  if (spec.maxSeriesFuseA !== undefined && spec.maxSeriesFuseA < spec.iscA)
    issues.push(
      warn('FUSE_BELOW_ISC', 'maxSeriesFuseA', 'O fusível máximo é menor que a Isc do módulo.'),
    );

  const areaM2 = (spec.lengthMm * spec.widthMm) / 1_000_000;
  if (areaM2 < 0.3 || areaM2 > 4)
    issues.push(
      warn(
        'AREA_RANGE',
        'lengthMm',
        `Área de ${areaM2.toFixed(2)} m² fora do usual (0,3 a 4 m²): confira mm × mm.`,
      ),
    );
  if (spec.efficiencyPct !== undefined) {
    const computed = (spec.pmaxWp / (areaM2 * 1000)) * 100;
    if (Math.abs(computed - spec.efficiencyPct) > 1.5)
      issues.push(
        warn(
          'EFFICIENCY_MISMATCH',
          'efficiencyPct',
          `Eficiência informada (${spec.efficiencyPct}%) difere da calculada pela área (${computed.toFixed(1)}%).`,
        ),
      );
  }
  if (spec.cellsInSeries !== undefined) {
    const perCell = spec.vocV / spec.cellsInSeries;
    if (perCell < 0.45 || perCell > 0.8)
      issues.push(
        warn(
          'VOC_PER_CELL',
          'cellsInSeries',
          `Voc por célula de ${perCell.toFixed(2)} V fora do usual (0,45 a 0,8 V).`,
        ),
      );
  }
  if (spec.powerWarrantyYears !== undefined && spec.powerWarrantyEndPct === undefined)
    issues.push(
      warn(
        'WARRANTY_INCOMPLETE',
        'powerWarrantyEndPct',
        'Garantia de potência sem o percentual ao final.',
      ),
    );
  return issues;
}

export function validateInverterSpec(spec: InverterSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  if (spec.mpptMinV >= spec.mpptMaxV)
    issues.push(
      err(
        'MPPT_RANGE_INVERTED',
        'mpptMinV',
        'A tensão mínima do MPPT deve ser menor que a máxima.',
      ),
    );
  if (spec.mpptMaxV > spec.vDcMaxV)
    issues.push(
      err(
        'MPPT_ABOVE_VDC_MAX',
        'mpptMaxV',
        'A tensão máxima do MPPT não pode passar da tensão CC máxima.',
      ),
    );
  if (spec.vStartV !== undefined && spec.vStartV > spec.mpptMaxV)
    issues.push(
      err('START_ABOVE_MPPT_MAX', 'vStartV', 'A tensão de partida está acima da faixa do MPPT.'),
    );
  if (spec.pAcMaxW !== undefined && spec.pAcMaxW < spec.pAcNomW)
    issues.push(err('PAC_MAX_BELOW_NOM', 'pAcMaxW', 'A potência CA máxima é menor que a nominal.'));
  if (spec.pDcMaxW !== undefined && spec.pDcMaxW < spec.pAcNomW)
    issues.push(
      warn('PDC_BELOW_PAC', 'pDcMaxW', 'A potência CC máxima é menor que a potência CA nominal.'),
    );
  if (spec.iscMaxPerMpptA !== undefined && spec.iscMaxPerMpptA < spec.iMaxPerMpptA)
    issues.push(
      warn(
        'ISC_MAX_BELOW_IMAX',
        'iscMaxPerMpptA',
        'O curto-circuito admissível por MPPT é menor que a corrente máxima de entrada.',
      ),
    );
  if (
    spec.efficiencyEuroPct !== undefined &&
    spec.efficiencyMaxPct !== undefined &&
    spec.efficiencyEuroPct > spec.efficiencyMaxPct
  )
    issues.push(
      err(
        'EFFICIENCY_EURO_ABOVE_MAX',
        'efficiencyEuroPct',
        'A eficiência europeia não pode superar a máxima.',
      ),
    );
  if (
    spec.efficiencyMaxPct !== undefined &&
    (spec.efficiencyMaxPct < 90 || spec.efficiencyMaxPct > 99.9)
  )
    issues.push(
      warn('EFFICIENCY_RANGE', 'efficiencyMaxPct', 'Eficiência máxima fora de 90 a 99,9%.'),
    );
  if (spec.topology === 'MICRO' && spec.mpptCount > 4)
    issues.push(
      warn(
        'MICRO_MANY_MPPT',
        'mpptCount',
        'Microinversor com mais de 4 entradas: confira o modelo.',
      ),
    );
  if (spec.vAcV < 100 || spec.vAcV > 480)
    issues.push(warn('VAC_RANGE', 'vAcV', 'Tensão CA fora de 100 a 480 V.'));
  if (spec.iAcMaxA !== undefined) {
    const phases = spec.phases === 3 ? Math.sqrt(3) : 1;
    const apparent = spec.iAcMaxA * spec.vAcV * phases;
    const reference = spec.pAcMaxW ?? spec.pAcNomW;
    if (apparent < reference * 0.9)
      issues.push(
        warn(
          'IAC_BELOW_POWER',
          'iAcMaxA',
          `A corrente CA máxima (${spec.iAcMaxA} A) não sustenta a potência informada.`,
        ),
      );
  }
  return issues;
}

/** Campos obrigatórios por tipo de proteção: sem eles o dimensionamento não consegue escolher o item. */
const PROTECTION_REQUIRED: Record<ProtectionSpec['protectionKind'], (keyof ProtectionSpec)[]> = {
  FUSE_DC: ['ratedCurrentA', 'ratedVoltageV'],
  DISCONNECTOR_DC: ['ratedCurrentA', 'ratedVoltageV'],
  SURGE_DC: ['ratedVoltageV'],
  SURGE_AC: ['ratedVoltageV'],
  BREAKER_AC: ['ratedCurrentA', 'ratedVoltageV'],
  RCD: ['ratedCurrentA', 'sensitivityMa'],
  STRING_BOX: ['ratedCurrentA', 'ratedVoltageV'],
};

export function validateProtectionSpec(spec: ProtectionSpec): SpecIssue[] {
  return PROTECTION_REQUIRED[spec.protectionKind]
    .filter((field) => spec[field] === undefined)
    .map((field) =>
      err('PROTECTION_FIELD_REQUIRED', field, `Este tipo de proteção exige o campo ${field}.`),
    );
}

export function validateCableSpec(spec: CableSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  if (spec.crossSectionMm2 < 0.5 || spec.crossSectionMm2 > 630)
    issues.push(warn('CROSS_SECTION_RANGE', 'crossSectionMm2', 'Seção fora de 0,5 a 630 mm².'));
  if (spec.cableKind === 'DC_SOLAR' && spec.voltageRatingV === undefined)
    issues.push(
      warn(
        'CABLE_VOLTAGE_MISSING',
        'voltageRatingV',
        'Cabo solar sem a tensão nominal: o dimensionamento exige.',
      ),
    );
  return issues;
}

/** Valida a ficha pelo tipo. O formato (campos e tipos) já foi conferido pelo schema; aqui é a coerência física. */
export function validateSpec(kind: EquipmentKind, spec: unknown): SpecIssue[] {
  switch (kind) {
    case 'MODULE':
      return validateModuleSpec(spec as ModuleSpec);
    case 'INVERTER':
      return validateInverterSpec(spec as InverterSpec);
    case 'PROTECTION':
      return validateProtectionSpec(spec as ProtectionSpec);
    case 'CABLE':
      return validateCableSpec(spec as CableSpec);
  }
}

export const hasBlockingIssue = (issues: readonly SpecIssue[]): boolean =>
  issues.some((issue) => issue.severity === 'ERROR');
