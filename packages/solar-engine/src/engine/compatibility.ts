import type {
  CompatibilityCheck,
  CompatibilityResult,
  CompatibilityStatus,
  EngineeringDesign,
  InverterCompatibility,
  InverterEntry,
  InverterSpec,
  ModuleSpec,
  Surface,
} from '@voltex/shared';
import { roundTo } from '../units/index.js';
import { cellTemperatureC, voltageAtTemperatureV } from './thermal.js';

/**
 * Compatibility Engine (ENG-F02 a F09): confere módulo × inversor × strings por MPPT. Física pura (tensão e corrente
 * com a temperatura) sobre a ficha dos equipamentos e a temperatura de projeto do local. O que depende de **regra**
 * (relação CC/CA, irradiância da célula quente) vem de `engine.design`; sem a regra a verificação fica **pendente** e
 * impede a aprovação (ADR-0016). Memorial: `docs/06-calculos/engine-compatibilidade.md`.
 */
export const COMPATIBILITY_ALGORITHM_VERSION = 'compat-1.0.0';

export type EquipmentStatusLite = 'DRAFT' | 'APPROVED' | 'RETIRED';

export interface CompatibilityInput {
  design: EngineeringDesign;
  /** Módulos que cabem em cada superfície (do layout). */
  layoutCountBySurface: Record<string, number>;
  modules: Record<string, ModuleSpec | undefined>;
  inverters: Record<string, InverterSpec | undefined>;
  /** Situação no catálogo (módulo e inversor). Ausente = não encontrado. */
  status: Record<string, EquipmentStatusLite | undefined>;
  /** Parâmetros da regra `engine.design` em vigor (vazio = sem regra). */
  parameters: Record<string, number>;
}

/** Kt padrão do Manual CRESESB (°C·m²/W) quando a ficha não traz o NOCT: equivale a NOCT = 44 °C. */
const KT_DEFAULT = 0.03;
const NOCT_FROM_KT = 20 + KT_DEFAULT * 800;
const ORIENTATION_TOLERANCE_DEG = 10;

const SRC = {
  voc: 'Manual CRESESB 2014, Eq. 6.30 e 4.2 (p. 333 e 150)',
  mppt: 'Manual CRESESB 2014, Eq. 6.31 (p. 334)',
  current: 'Manual CRESESB 2014, Eq. 6.32 (p. 335); ficha do inversor',
  ratio: 'Regra engine.design (política da empresa)',
  ef: 'EnergIF 2023, p. 41–42 (EF-M11) e p. 169 (EF-R13)',
};

export function makeCheck(
  base: Pick<
    CompatibilityCheck,
    'code' | 'severity' | 'message' | 'formula' | 'source' | 'unit' | 'scope'
  > & {
    /** `null` = não foi possível verificar. */
    pass: boolean | null;
    value?: number | null;
    limit?: number | null;
  },
): CompatibilityCheck {
  return {
    code: base.code,
    severity: base.severity,
    outcome: base.pass === null ? 'PENDING' : base.pass ? 'PASS' : 'FAIL',
    message: base.message,
    formula: base.formula,
    source: base.source,
    value: base.value ?? null,
    limit: base.limit ?? null,
    unit: base.unit,
    scope: base.scope,
  };
}

const surfaceModuleId = (design: EngineeringDesign, surface: Surface): string | undefined =>
  surface.moduleId ?? design.defaultModuleId;

function aggregate(checks: CompatibilityCheck[], pendingCount: number): CompatibilityStatus {
  if (checks.some((c) => c.outcome === 'FAIL' && c.severity === 'ERROR')) return 'INVALID';
  if (pendingCount > 0 || checks.some((c) => c.outcome === 'PENDING' && c.severity !== 'INFO'))
    return 'INCOMPLETE';
  if (checks.some((c) => c.outcome === 'FAIL' && c.severity === 'WARNING'))
    return 'VALID_WITH_WARNINGS';
  return 'VALID';
}

export interface Thermal {
  vocColdV: number | null;
  vmppColdV: number | null;
  vmppHotV: number | null;
  cellHotC: number | null;
  betaVmppSource: 'BETA_VMPP' | 'BETA_VOC_ASSUMED';
  noctSource: 'DATASHEET' | 'KT_DEFAULT';
}

export function moduleThermal(
  module: ModuleSpec,
  design: EngineeringDesign,
  parameters: Record<string, number>,
): Thermal {
  const tmin = design.site.designTminC;
  const tmax = design.site.designTmaxAmbientC;
  const irradiance = parameters.hotCellIrradianceWm2;
  const betaVmpp = module.betaVmppPctPerC ?? module.betaVocPctPerC;
  const at = (stc: number, beta: number, t: number) =>
    voltageAtTemperatureV({ stcVoltageV: stc, coefficientPctPerC: beta, cellTemperatureC: t });
  const noct = module.noctC ?? NOCT_FROM_KT;
  const cellHot =
    tmax !== null && tmax !== undefined && irradiance !== undefined
      ? cellTemperatureC({ ambientC: tmax, noctC: noct, irradianceWm2: irradiance })
      : null;
  return {
    vocColdV: tmin === null ? null : roundTo(at(module.vocV, module.betaVocPctPerC, tmin), 3),
    vmppColdV: tmin === null ? null : roundTo(at(module.vmppV, betaVmpp, tmin), 3),
    vmppHotV: cellHot === null ? null : roundTo(at(module.vmppV, betaVmpp, cellHot), 3),
    cellHotC: cellHot === null ? null : roundTo(cellHot, 2),
    betaVmppSource: module.betaVmppPctPerC === undefined ? 'BETA_VOC_ASSUMED' : 'BETA_VMPP',
    noctSource: module.noctC === undefined ? 'KT_DEFAULT' : 'DATASHEET',
  };
}

/** Verificações de tensão de um comprimento de string (ou de um módulo de microinversor, `ns = 1`). */
function voltageChecks(
  scope: string,
  ns: number,
  module: ModuleSpec,
  inverter: InverterSpec,
  t: Thermal,
): CompatibilityCheck[] {
  const checks: CompatibilityCheck[] = [];
  const vocString = t.vocColdV === null ? null : roundTo(ns * t.vocColdV, 2);
  checks.push(
    makeCheck({
      code: 'VOC_COLD_EXCEEDS_MAX',
      severity: 'ERROR',
      scope,
      pass: vocString === null ? null : vocString <= inverter.vDcMaxV,
      value: vocString,
      limit: inverter.vDcMaxV,
      unit: 'V',
      message:
        vocString === null
          ? 'Falta a temperatura mínima de projeto para calcular o Voc frio.'
          : `Voc frio da string (${ns} × ${t.vocColdV} V) = ${vocString} V; máximo do inversor ${inverter.vDcMaxV} V.`,
      formula: 'Ns × Voc(Tmín) ≤ Vdc máx. do inversor',
      source: SRC.voc,
    }),
  );
  if (module.maxSystemVoltageV !== undefined)
    checks.push(
      makeCheck({
        code: 'MODULE_SYSTEM_VOLTAGE_EXCEEDED',
        severity: 'ERROR',
        scope,
        pass: vocString === null ? null : vocString <= module.maxSystemVoltageV,
        value: vocString,
        limit: module.maxSystemVoltageV,
        unit: 'V',
        message:
          vocString === null
            ? 'Falta a temperatura mínima de projeto.'
            : `Voc frio ${vocString} V; tensão máxima do sistema do módulo ${module.maxSystemVoltageV} V.`,
        formula: 'Ns × Voc(Tmín) ≤ tensão máxima do sistema do módulo',
        source: SRC.voc,
      }),
    );
  const vmppCold = t.vmppColdV === null ? null : roundTo(ns * t.vmppColdV, 2);
  checks.push(
    makeCheck({
      code: 'VMPP_ABOVE_MPPT',
      severity: 'ERROR',
      scope,
      pass: vmppCold === null ? null : vmppCold <= inverter.mpptMaxV,
      value: vmppCold,
      limit: inverter.mpptMaxV,
      unit: 'V',
      message:
        vmppCold === null
          ? 'Falta a temperatura mínima de projeto.'
          : `Vmpp frio da string = ${vmppCold} V; máximo do MPPT ${inverter.mpptMaxV} V.`,
      formula: 'Ns × Vmpp(Tmín) ≤ V MPPT máx.',
      source: SRC.mppt,
    }),
  );
  const vmppHot = t.vmppHotV === null ? null : roundTo(ns * t.vmppHotV, 2);
  checks.push(
    makeCheck({
      code: 'VMPP_BELOW_MPPT',
      severity: 'ERROR',
      scope,
      pass: vmppHot === null ? null : vmppHot >= inverter.mpptMinV,
      value: vmppHot,
      limit: inverter.mpptMinV,
      unit: 'V',
      message:
        vmppHot === null
          ? 'Falta a temperatura máxima de projeto ou a regra da irradiância da célula quente.'
          : `Vmpp quente da string = ${vmppHot} V (célula a ${t.cellHotC} °C); mínimo do MPPT ${inverter.mpptMinV} V.`,
      formula: 'Ns × Vmpp(Tcél. máx.) ≥ V MPPT mín.',
      source: SRC.mppt,
    }),
  );
  if (inverter.vStartV !== undefined)
    checks.push(
      makeCheck({
        code: 'START_VOLTAGE_NOT_REACHED',
        severity: 'WARNING',
        scope,
        pass: vmppHot === null ? null : vmppHot >= inverter.vStartV,
        value: vmppHot,
        limit: inverter.vStartV,
        unit: 'V',
        message:
          vmppHot === null
            ? 'Falta a temperatura máxima de projeto ou a regra da irradiância da célula quente.'
            : `Vmpp quente ${vmppHot} V; tensão de partida do inversor ${inverter.vStartV} V: em dia quente o inversor pode partir tarde.`,
        formula: 'Ns × Vmpp(Tcél. máx.) ≥ V de partida',
        source: SRC.mppt,
      }),
    );
  return checks;
}

function evaluateStringEntry(
  input: CompatibilityInput,
  entry: InverterEntry,
  inverter: InverterSpec,
  thermals: Map<string, Thermal>,
): InverterCompatibility {
  const { design } = input;
  const checks: CompatibilityCheck[] = [];
  let dcWp = 0;
  let modulesConnected = 0;
  let mpptUsed = 0;

  if (entry.mppts.length > inverter.mpptCount)
    checks.push(
      makeCheck({
        code: 'MPPT_COUNT_EXCEEDED',
        severity: 'ERROR',
        scope: entry.id,
        pass: false,
        value: entry.mppts.length,
        limit: inverter.mpptCount,
        unit: 'MPPT',
        message: `O desenho usa ${entry.mppts.length} MPPT; o inversor tem ${inverter.mpptCount}.`,
        formula: 'MPPT usados ≤ nº de MPPT do inversor',
        source: SRC.current,
      }),
    );

  entry.mppts.forEach((mppt, index) => {
    const scope = `${entry.id}/MPPT${index + 1}`;
    if (mppt.strings.length === 0) return;
    mpptUsed += 1;
    const groups = mppt.strings.map((s) => {
      const surface = design.surfaces.find((x) => x.id === s.surfaceId);
      const moduleId = surface ? surfaceModuleId(design, surface) : undefined;
      return { s, surface, moduleId, module: moduleId ? input.modules[moduleId] : undefined };
    });

    // Todas as strings do MPPT precisam estar bem definidas.
    for (const g of groups) {
      if (!g.surface)
        checks.push(
          makeCheck({
            code: 'SURFACE_NOT_FOUND',
            severity: 'ERROR',
            scope,
            pass: false,
            unit: '',
            message: `A string "${g.s.id}" aponta para uma superfície que não existe.`,
            formula: '—',
            source: SRC.ef,
          }),
        );
      else if (!g.module)
        checks.push(
          makeCheck({
            code: 'MODULE_NOT_SELECTED',
            severity: 'ERROR',
            scope,
            pass: false,
            unit: '',
            message: `A superfície "${g.surface.name}" não tem módulo válido.`,
            formula: '—',
            source: SRC.ef,
          }),
        );
      else if (g.moduleId && input.status[g.moduleId] !== 'APPROVED')
        checks.push(
          makeCheck({
            code: 'MODULE_NOT_APPROVED',
            severity: 'ERROR',
            scope,
            pass: false,
            unit: '',
            message: `O módulo da superfície "${g.surface.name}" não está aprovado no catálogo.`,
            formula: '—',
            source: 'ADR-0017',
          }),
        );
    }
    const valid = groups.filter((g) => g.module);

    const inputsUsed = mppt.strings.reduce((n, s) => n + s.parallel, 0);
    checks.push(
      makeCheck({
        code: 'INPUTS_PER_MPPT_EXCEEDED',
        severity: 'ERROR',
        scope,
        pass: inputsUsed <= inverter.inputsPerMppt,
        value: inputsUsed,
        limit: inverter.inputsPerMppt,
        unit: 'entradas',
        message: `${inputsUsed} string(s) no MPPT; o inversor tem ${inverter.inputsPerMppt} entrada(s) por MPPT.`,
        formula: 'Σ strings em paralelo ≤ entradas por MPPT',
        source: SRC.current,
      }),
    );

    // Strings do mesmo MPPT devem ser iguais (EnergIF p. 169): mesmo comprimento, mesmo módulo, orientação parecida.
    const lengths = new Set(valid.map((g) => g.s.modulesInSeries));
    const moduleIds = new Set(valid.map((g) => g.moduleId));
    if (lengths.size > 1 || moduleIds.size > 1)
      checks.push(
        makeCheck({
          code: 'STRING_MISMATCH',
          severity: 'ERROR',
          scope,
          pass: false,
          unit: '',
          message:
            moduleIds.size > 1
              ? 'Módulos diferentes no mesmo MPPT: cada MPPT deve ter strings do mesmo módulo.'
              : `Strings com ${[...lengths].join(' e ')} módulos no mesmo MPPT: devem ter o mesmo comprimento.`,
          formula: 'strings do mesmo MPPT: mesmo módulo e mesmo nº de módulos em série',
          source: SRC.ef,
        }),
      );
    const surfaces = valid.map((g) => g.surface as Surface);
    const orientationGap = Math.max(
      0,
      ...surfaces.flatMap((a) =>
        surfaces.map((b) =>
          Math.max(
            Math.min(
              Math.abs(a.azimuthDegrees - b.azimuthDegrees),
              360 - Math.abs(a.azimuthDegrees - b.azimuthDegrees),
            ),
            Math.abs(a.tiltDegrees - b.tiltDegrees),
          ),
        ),
      ),
    );
    if (orientationGap > ORIENTATION_TOLERANCE_DEG)
      checks.push(
        makeCheck({
          code: 'STRING_MISMATCH',
          severity: 'WARNING',
          scope,
          pass: false,
          value: roundTo(orientationGap, 1),
          limit: ORIENTATION_TOLERANCE_DEG,
          unit: '°',
          message: `Strings em superfícies com orientação ou inclinação diferentes (até ${roundTo(orientationGap, 1)}°) no mesmo MPPT: há perda por descasamento.`,
          formula: 'diferença de azimute e inclinação entre as strings ≤ tolerância',
          source: SRC.ef,
        }),
      );

    // Tensões de cada comprimento de string distinto.
    const seen = new Set<string>();
    for (const g of valid) {
      const key = `${g.moduleId}:${g.s.modulesInSeries}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = thermals.get(g.moduleId as string);
      if (!t) continue;
      checks.push(
        ...voltageChecks(
          `${scope}/${g.s.modulesInSeries}M`,
          g.s.modulesInSeries,
          g.module as ModuleSpec,
          inverter,
          t,
        ),
      );
    }

    // Correntes do MPPT: Σ strings × Impp e × Isc.
    const impp = valid.reduce((sum, g) => sum + g.s.parallel * (g.module as ModuleSpec).imppA, 0);
    const isc = valid.reduce((sum, g) => sum + g.s.parallel * (g.module as ModuleSpec).iscA, 0);
    checks.push(
      makeCheck({
        code: 'MPPT_CURRENT_EXCEEDED',
        severity: 'ERROR',
        scope,
        pass: impp <= inverter.iMaxPerMpptA,
        value: roundTo(impp, 2),
        limit: inverter.iMaxPerMpptA,
        unit: 'A',
        message: `Corrente do MPPT = ${roundTo(impp, 2)} A (Σ strings × Impp); máximo ${inverter.iMaxPerMpptA} A.`,
        formula: 'Σ (strings em paralelo × Impp) ≤ corrente máx. por MPPT',
        source: SRC.current,
      }),
    );
    if (inverter.iscMaxPerMpptA !== undefined)
      checks.push(
        makeCheck({
          code: 'MPPT_SHORT_CIRCUIT_EXCEEDED',
          severity: 'ERROR',
          scope,
          pass: isc <= inverter.iscMaxPerMpptA,
          value: roundTo(isc, 2),
          limit: inverter.iscMaxPerMpptA,
          unit: 'A',
          message: `Curto-circuito do MPPT = ${roundTo(isc, 2)} A (Σ strings × Isc); máximo ${inverter.iscMaxPerMpptA} A.`,
          formula: 'Σ (strings em paralelo × Isc) ≤ Isc admissível por MPPT',
          source: SRC.current,
        }),
      );
    for (const g of valid) {
      const n = g.s.modulesInSeries * g.s.parallel;
      modulesConnected += n;
      dcWp += n * (g.module as ModuleSpec).pmaxWp;
    }
  });

  // Inversor sem aprovação no catálogo.
  if (input.status[entry.inverterId] !== 'APPROVED')
    checks.push(
      makeCheck({
        code: 'INVERTER_NOT_APPROVED',
        severity: 'ERROR',
        scope: entry.id,
        pass: false,
        unit: '',
        message: 'O inversor não está aprovado no catálogo.',
        formula: '—',
        source: 'ADR-0017',
      }),
    );

  return finishInverter(input, entry, inverter, checks, {
    dcWp,
    modulesConnected,
    mpptUsed,
  });
}

function evaluateMicroEntry(
  input: CompatibilityInput,
  entry: InverterEntry,
  inverter: InverterSpec,
  thermals: Map<string, Thermal>,
): InverterCompatibility {
  const { design } = input;
  const checks: CompatibilityCheck[] = [];
  const micro = entry.micro;
  let dcWp = 0;
  let modulesConnected = 0;
  if (!micro) {
    checks.push(
      makeCheck({
        code: 'MICRO_INPUT_MISMATCH',
        severity: 'ERROR',
        scope: entry.id,
        pass: null,
        unit: '',
        message: 'Defina a superfície, as unidades e os módulos por unidade do microinversor.',
        formula: '—',
        source: SRC.current,
      }),
    );
    return finishInverter(input, entry, inverter, checks, { dcWp, modulesConnected, mpptUsed: 0 });
  }
  const surface = design.surfaces.find((s) => s.id === micro.surfaceId);
  const moduleId = surface ? surfaceModuleId(design, surface) : undefined;
  const module = moduleId ? input.modules[moduleId] : undefined;
  if (!surface || !module || !moduleId) {
    checks.push(
      makeCheck({
        code: 'MODULE_NOT_SELECTED',
        severity: 'ERROR',
        scope: entry.id,
        pass: false,
        unit: '',
        message: 'A superfície do microinversor não existe ou não tem módulo.',
        formula: '—',
        source: SRC.ef,
      }),
    );
    return finishInverter(input, entry, inverter, checks, { dcWp, modulesConnected, mpptUsed: 0 });
  }
  if (input.status[moduleId] !== 'APPROVED')
    checks.push(
      makeCheck({
        code: 'MODULE_NOT_APPROVED',
        severity: 'ERROR',
        scope: entry.id,
        pass: false,
        unit: '',
        message: 'O módulo não está aprovado no catálogo.',
        formula: '—',
        source: 'ADR-0017',
      }),
    );
  const inputs = inverter.mpptCount * inverter.inputsPerMppt;
  checks.push(
    makeCheck({
      code: 'MICRO_INPUT_MISMATCH',
      severity: 'ERROR',
      scope: entry.id,
      pass: micro.modulesPerUnit <= inputs,
      value: micro.modulesPerUnit,
      limit: inputs,
      unit: 'módulos',
      message: `${micro.modulesPerUnit} módulo(s) por unidade; o microinversor tem ${inputs} entrada(s).`,
      formula: 'módulos por unidade ≤ entradas do microinversor',
      source: SRC.current,
    }),
  );
  const t = thermals.get(moduleId) as Thermal;
  checks.push(...voltageChecks(`${entry.id}/módulo`, 1, module, inverter, t));
  checks.push(
    makeCheck({
      code: 'MPPT_CURRENT_EXCEEDED',
      severity: 'ERROR',
      scope: entry.id,
      pass: module.imppA <= inverter.iMaxPerMpptA,
      value: module.imppA,
      limit: inverter.iMaxPerMpptA,
      unit: 'A',
      message: `Impp do módulo ${module.imppA} A; máximo por entrada ${inverter.iMaxPerMpptA} A.`,
      formula: 'Impp ≤ corrente máx. por entrada',
      source: SRC.current,
    }),
  );
  if (inverter.iscMaxPerMpptA !== undefined)
    checks.push(
      makeCheck({
        code: 'MPPT_SHORT_CIRCUIT_EXCEEDED',
        severity: 'ERROR',
        scope: entry.id,
        pass: module.iscA <= inverter.iscMaxPerMpptA,
        value: module.iscA,
        limit: inverter.iscMaxPerMpptA,
        unit: 'A',
        message: `Isc do módulo ${module.iscA} A; máximo por entrada ${inverter.iscMaxPerMpptA} A.`,
        formula: 'Isc ≤ Isc admissível por entrada',
        source: SRC.current,
      }),
    );
  const perUnitWp = micro.modulesPerUnit * module.pmaxWp;
  if (inverter.pDcMaxW !== undefined)
    checks.push(
      makeCheck({
        code: 'DC_POWER_EXCEEDED',
        severity: 'ERROR',
        scope: entry.id,
        pass: perUnitWp <= inverter.pDcMaxW,
        value: perUnitWp / 1000,
        limit: inverter.pDcMaxW / 1000,
        unit: 'kW',
        message: `Potência CC por unidade ${roundTo(perUnitWp / 1000, 3)} kW; máximo ${inverter.pDcMaxW / 1000} kW.`,
        formula: 'módulos por unidade × Pmax ≤ potência CC máxima',
        source: SRC.current,
      }),
    );
  modulesConnected = micro.units * micro.modulesPerUnit;
  dcWp = modulesConnected * module.pmaxWp;
  return finishInverter(
    input,
    entry,
    inverter,
    checks,
    { dcWp, modulesConnected, mpptUsed: 0 },
    micro.units,
  );
}

function finishInverter(
  input: CompatibilityInput,
  entry: InverterEntry,
  inverter: InverterSpec,
  checks: CompatibilityCheck[],
  totals: { dcWp: number; modulesConnected: number; mpptUsed: number },
  units = 1,
): InverterCompatibility {
  const acW = inverter.pAcNomW * units;
  const dcKwp = totals.dcWp / 1000;
  const ratio = acW > 0 && totals.dcWp > 0 ? roundTo(totals.dcWp / acW, 3) : null;
  if (inverter.pDcMaxW !== undefined && inverter.topology !== 'MICRO')
    checks.push(
      makeCheck({
        code: 'DC_POWER_EXCEEDED',
        severity: 'ERROR',
        scope: entry.id,
        pass: totals.dcWp <= inverter.pDcMaxW,
        value: roundTo(dcKwp, 3),
        limit: inverter.pDcMaxW / 1000,
        unit: 'kW',
        message: `Potência CC do arranjo ${roundTo(dcKwp, 3)} kWp; máximo do inversor ${inverter.pDcMaxW / 1000} kW.`,
        formula: 'Σ módulos × Pmax ≤ potência CC máxima',
        source: SRC.current,
      }),
    );
  const min = input.parameters.dcAcRatioMin;
  const max = input.parameters.dcAcRatioMax;
  const policyKnown = min !== undefined && max !== undefined;
  if (totals.dcWp > 0)
    checks.push(
      makeCheck({
        code: 'DC_AC_RATIO_OUT_OF_POLICY',
        severity: 'WARNING',
        scope: entry.id,
        pass: !policyKnown || ratio === null ? null : ratio >= min && ratio <= max,
        value: ratio,
        limit: policyKnown ? max : null,
        unit: '',
        message: !policyKnown
          ? 'A regra engine.design não define a faixa de relação CC/CA.'
          : `Relação CC/CA = ${ratio}; faixa da política ${min} a ${max}.`,
        formula: 'CC/CA = Σ Pmax dos módulos ÷ potência CA nominal',
        source: SRC.ratio,
      }),
    );
  const available = inverter.mpptCount;
  return {
    entryId: entry.id,
    inverterId: entry.inverterId,
    status: aggregate(checks, 0),
    checks,
    metrics: {
      dcPowerKwp: roundTo(dcKwp, 3),
      acPowerKw: roundTo(acW / 1000, 3),
      dcAcRatio: ratio,
      modulesConnected: totals.modulesConnected,
      mpptUsed: totals.mpptUsed,
      mpptAvailable: available,
    },
  };
}

/** Confere todos os inversores do projeto e a alocação dos módulos de cada superfície. */
export function evaluateCompatibility(input: CompatibilityInput): CompatibilityResult {
  const { design, parameters } = input;
  const pending: CompatibilityResult['pending'] = [];
  const inverters: InverterCompatibility[] = [];
  const thermals = new Map<string, Thermal>();
  const thermalList: CompatibilityResult['thermal'] = [];

  for (const surface of design.surfaces) {
    const id = surfaceModuleId(design, surface);
    const module = id ? input.modules[id] : undefined;
    if (id && module && typeof module.vocV === 'number' && !thermals.has(id)) {
      const t = moduleThermal(module, design, parameters);
      thermals.set(id, t);
      thermalList.push({ moduleId: id, ...t });
    }
  }

  const hasInverters = design.inverters.length > 0;
  if (hasInverters) {
    if (design.site.designTminC === null || design.site.designTminC === undefined)
      pending.push({
        code: 'TMIN_MISSING',
        kind: 'DATA',
        message:
          'Falta a temperatura mínima de projeto do local (etapa Local e clima): sem ela o Voc frio não é verificado.',
      });
    if (design.site.designTmaxAmbientC === null || design.site.designTmaxAmbientC === undefined)
      pending.push({
        code: 'TMAX_MISSING',
        kind: 'DATA',
        message:
          'Falta a temperatura ambiente máxima de projeto do local: sem ela a tensão mínima do MPPT não é verificada.',
      });
    if (parameters.hotCellIrradianceWm2 === undefined)
      pending.push({
        code: 'RULE_HOT_CELL_IRRADIANCE',
        kind: 'RULE',
        message:
          'A regra engine.design não define a irradiância da célula quente (hotCellIrradianceWm2). Peça ao responsável técnico para ativá-la.',
      });
    if (parameters.dcAcRatioMin === undefined || parameters.dcAcRatioMax === undefined)
      pending.push({
        code: 'RULE_DC_AC_RATIO',
        kind: 'RULE',
        message:
          'A regra engine.design não define a faixa de relação CC/CA (dcAcRatioMin e dcAcRatioMax). Peça ao responsável técnico para ativá-la.',
      });
  } else {
    pending.push({
      code: 'NO_INVERTERS',
      kind: 'DATA',
      message: 'Nenhum inversor foi definido no projeto.',
    });
  }

  for (const entry of design.inverters) {
    const inverter = input.inverters[entry.inverterId];
    if (!inverter) {
      inverters.push({
        entryId: entry.id,
        inverterId: entry.inverterId,
        status: 'INVALID',
        checks: [
          makeCheck({
            code: 'INVERTER_NOT_FOUND',
            severity: 'ERROR',
            scope: entry.id,
            pass: false,
            unit: '',
            message: 'O inversor não existe no catálogo.',
            formula: '—',
            source: 'ADR-0017',
          }),
        ],
        metrics: {
          dcPowerKwp: 0,
          acPowerKw: 0,
          dcAcRatio: null,
          modulesConnected: 0,
          mpptUsed: 0,
          mpptAvailable: 0,
        },
      });
      continue;
    }
    const result =
      inverter.topology === 'MICRO'
        ? evaluateMicroEntry(input, entry, inverter, thermals)
        : evaluateStringEntry(input, entry, inverter, thermals);
    inverters.push(result);
  }

  // Alocação: módulos ligados × módulos que cabem em cada superfície.
  const allocation: CompatibilityCheck[] = [];
  for (const surface of design.surfaces) {
    const available = input.layoutCountBySurface[surface.id] ?? 0;
    let allocated = 0;
    for (const entry of design.inverters) {
      for (const mppt of entry.mppts)
        for (const s of mppt.strings)
          if (s.surfaceId === surface.id) allocated += s.modulesInSeries * s.parallel;
      if (entry.micro?.surfaceId === surface.id)
        allocated += entry.micro.units * entry.micro.modulesPerUnit;
    }
    if (!hasInverters && allocated === 0) continue;
    if (allocated > available)
      allocation.push(
        makeCheck({
          code: 'MODULES_OVER_ALLOCATED',
          severity: 'ERROR',
          scope: surface.id,
          pass: false,
          value: allocated,
          limit: available,
          unit: 'módulos',
          message: `A superfície "${surface.name}" tem ${available} módulos no layout, mas ${allocated} ligados às strings.`,
          formula: 'módulos nas strings ≤ módulos do layout',
          source: SRC.ef,
        }),
      );
    else if (allocated < available)
      allocation.push(
        makeCheck({
          code: 'MODULES_NOT_ALLOCATED',
          severity: 'WARNING',
          scope: surface.id,
          pass: false,
          value: allocated,
          limit: available,
          unit: 'módulos',
          message: `A superfície "${surface.name}" tem ${available} módulos no layout e só ${allocated} ligados às strings.`,
          formula: 'módulos nas strings = módulos do layout',
          source: SRC.ef,
        }),
      );
  }

  const all = [...inverters.flatMap((i) => i.checks), ...allocation];
  const status = aggregate(all, pending.length);
  // Cada inversor leva também o status isolado, já calculado em `finishInverter`; aqui só o agregado do projeto.
  for (const inv of inverters)
    if (pending.length > 0 && inv.status === 'VALID') inv.status = 'INCOMPLETE';
  return {
    status,
    inverters,
    allocation,
    pending,
    thermal: thermalList,
    algorithmVersion: COMPATIBILITY_ALGORITHM_VERSION,
  };
}
