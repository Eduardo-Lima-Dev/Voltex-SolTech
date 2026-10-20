import type {
  CableResult,
  CableRunResult,
  CableSpec,
  CompatibilityCheck,
  CompatibilityStatus,
  EngineeringDesign,
  InverterEntry,
  InverterSpec,
  ModuleSpec,
} from '@voltex/shared';
import { roundTo } from '../units/index.js';
import { makeCheck, moduleThermal } from './compatibility.js';
import type { Candidate } from './configurator.js';

/**
 * Cabos CC e CA (ENG-F13, F14): queda de tensão por fórmula física, capacidade de condução por **tabela da regra
 * `engine.cables`** (sem tabela, `PENDENTE`: nada é presumido) e seleção da menor seção do catálogo aprovado que atende.
 * Só condutor de **cobre**. Memorial: `docs/06-calculos/engine-protecoes-cabos.md`.
 */
export const CABLES_ALGORITHM_VERSION = 'cables-1.0.0';

/** Resistividade do cobre a 20 °C (Ω·mm²/m) e coeficiente de temperatura (1/°C): Manual CRESESB 2014, p. 340 (CR-10). */
export const COPPER_RESISTIVITY_20C = 0.01724;
export const COPPER_TEMPERATURE_COEFFICIENT = 0.0039;

export interface AmpacityRow {
  crossSectionMm2: number;
  method: string;
  ampacityA: number;
}

export interface CablesInput {
  design: EngineeringDesign;
  modules: Record<string, ModuleSpec | undefined>;
  inverters: Record<string, InverterSpec | undefined>;
  /** Cabos aprovados do catálogo. */
  catalog: Candidate<CableSpec>[];
  /** Parâmetros da regra `engine.cables`. */
  parameters: Record<string, number>;
  /** Parâmetros da regra `engine.design` (temperatura mínima de projeto entra no cálculo de tensão). */
  designParameters: Record<string, number>;
  /** Linhas da tabela `ampacity` da regra `engine.cables`. */
  ampacity: AmpacityRow[];
}

const SRC = {
  drop: 'Manual CRESESB 2014, Eq. 6.33 e 6.34 (p. 340); regra engine.cables',
  amp: 'Regra engine.cables (tabela de capacidade de condução, NBR 5410/16690 a cargo do responsável técnico)',
  length: 'Projeto',
  rating: 'Ficha do cabo',
};

export const copperResistivity = (temperatureC: number): number =>
  COPPER_RESISTIVITY_20C * (1 + COPPER_TEMPERATURE_COEFFICIENT * (temperatureC - 20));

/** Queda de tensão (V): CC e CA monofásico `2·ρ·L·I/S`; CA trifásico `√3·ρ·L·I/S` (cos φ = 1, sem reatância). */
export function voltageDropV(input: {
  resistivity: number;
  lengthM: number;
  currentA: number;
  sectionMm2: number;
  threePhase?: boolean;
}): number {
  const factor = input.threePhase ? Math.sqrt(3) : 2;
  return (factor * input.resistivity * input.lengthM * input.currentA) / input.sectionMm2;
}

function aggregate(checks: CompatibilityCheck[]): CompatibilityStatus {
  if (checks.some((c) => c.outcome === 'FAIL' && c.severity === 'ERROR')) return 'INVALID';
  if (checks.some((c) => c.outcome === 'PENDING')) return 'INCOMPLETE';
  if (checks.some((c) => c.outcome === 'FAIL')) return 'VALID_WITH_WARNINGS';
  return 'VALID';
}

const entryOf = (design: EngineeringDesign, id: string): InverterEntry | undefined =>
  design.inverters.find((e) => e.id === id);

interface RunContext {
  currentA: number | null;
  /** Fator aplicado à corrente de projeto: `Isc` para CC, corrente CA para CA. */
  designBaseA: number | null;
  referenceVoltageV: number | null;
  /** Tensão máxima que o cabo suporta (Voc frio da string ou tensão CA). */
  ratingVoltageV: number | null;
  threePhase: boolean;
  problem: string | null;
}

function contextOf(input: CablesInput, run: CablesInput['design']['cables'][number]): RunContext {
  const empty: RunContext = {
    currentA: null,
    designBaseA: null,
    referenceVoltageV: null,
    ratingVoltageV: null,
    threePhase: false,
    problem: null,
  };
  const { design } = input;
  const entry = entryOf(design, run.inverterEntryId);
  const inverter = entry ? input.inverters[entry.inverterId] : undefined;
  if (!entry || !inverter)
    return { ...empty, problem: 'O trecho aponta para um inversor que não está no projeto.' };

  if (run.kind === 'AC') {
    const units = inverter.topology === 'MICRO' ? (entry.micro?.units ?? 1) : 1;
    const power = inverter.pAcNomW * units;
    const iAc =
      inverter.iAcMaxA !== undefined && units === 1
        ? inverter.iAcMaxA
        : inverter.phases === 3
          ? power / (Math.sqrt(3) * inverter.vAcV)
          : power / inverter.vAcV;
    return {
      currentA: iAc,
      designBaseA: iAc,
      referenceVoltageV: inverter.vAcV,
      ratingVoltageV: inverter.vAcV,
      threePhase: inverter.phases === 3,
      problem: null,
    };
  }
  if (inverter.topology === 'MICRO')
    return { ...empty, problem: 'Microinversor não tem trecho CC de string: use só o trecho CA.' };
  if (run.mpptIndex === undefined) return { ...empty, problem: 'Informe o MPPT do trecho CC.' };
  const mppt = entry.mppts[run.mpptIndex];
  const group = mppt?.strings[0];
  if (!mppt || !group) return { ...empty, problem: `O MPPT ${run.mpptIndex + 1} não tem strings.` };
  const surface = design.surfaces.find((s) => s.id === group.surfaceId);
  const moduleId = surface ? (surface.moduleId ?? design.defaultModuleId) : undefined;
  const module = moduleId ? input.modules[moduleId] : undefined;
  if (!module) return { ...empty, problem: 'O módulo das strings do trecho não foi encontrado.' };
  const parallel = run.kind === 'DC_MAIN' ? mppt.strings.reduce((n, s) => n + s.parallel, 0) : 1;
  const t = moduleThermal(module, design, input.designParameters);
  return {
    currentA: module.imppA * parallel,
    designBaseA: module.iscA * parallel,
    referenceVoltageV: group.modulesInSeries * module.vmppV,
    ratingVoltageV: t.vocColdV === null ? null : group.modulesInSeries * t.vocColdV,
    threePhase: false,
    problem: null,
  };
}

export function evaluateCables(input: CablesInput): CableResult {
  const { design, parameters } = input;
  const pending: CableResult['pending'] = [];
  const addPending = (p: CableResult['pending'][number]) => {
    if (!pending.some((x) => x.code === p.code)) pending.push(p);
  };
  const runs: CableRunResult[] = [];

  const tempC = parameters.conductorTempC;
  if (design.cables.length > 0 && tempC === undefined)
    addPending({
      code: 'RULE_CONDUCTOR_TEMP',
      kind: 'RULE',
      message: 'A regra engine.cables não define a temperatura do condutor (conductorTempC).',
    });
  if (design.cables.length > 0 && input.ampacity.length === 0)
    addPending({
      code: 'RULE_AMPACITY_TABLE',
      kind: 'RULE',
      message:
        'A regra engine.cables não tem a tabela de capacidade de condução (ampacity): a capacidade dos cabos fica pendente.',
    });

  for (const run of design.cables) {
    const checks: CompatibilityCheck[] = [];
    const ctx = contextOf(input, run);
    const scope = run.id;
    const dc = run.kind !== 'AC';
    const limit = dc ? parameters.maxVoltageDropDcPct : parameters.maxVoltageDropAcPct;
    const factor = dc ? parameters.cableCurrentFactorDc : parameters.cableCurrentFactorAc;
    const base: Pick<CableRunResult, 'runId' | 'label' | 'kind' | 'lengthM' | 'count'> = {
      runId: run.id,
      label: run.label,
      kind: run.kind,
      lengthM: run.lengthM,
      count: run.count,
    };

    if (ctx.problem) {
      checks.push(
        makeCheck({
          code: 'RUN_REFERENCE_INVALID',
          severity: 'ERROR',
          scope,
          pass: false,
          unit: '',
          message: ctx.problem,
          formula: '—',
          source: SRC.length,
        }),
      );
      runs.push({
        ...base,
        currentA: null,
        designCurrentA: null,
        referenceVoltageV: null,
        resistivityOhmMm2PerM: null,
        minSectionByDropMm2: null,
        sectionMm2: null,
        voltageDropV: null,
        voltageDropPct: null,
        limitPct: limit ?? null,
        ampacityA: null,
        chosen: null,
        manual: false,
        checks,
        status: aggregate(checks),
      });
      continue;
    }
    if (limit === undefined)
      addPending({
        code: dc ? 'RULE_VDROP_DC' : 'RULE_VDROP_AC',
        kind: 'RULE',
        message: `A regra engine.cables não define a queda de tensão máxima do lado ${dc ? 'CC' : 'CA'} (${dc ? 'maxVoltageDropDcPct' : 'maxVoltageDropAcPct'}).`,
      });
    if (factor === undefined)
      addPending({
        code: dc ? 'RULE_CABLE_CURRENT_FACTOR_DC' : 'RULE_CABLE_CURRENT_FACTOR_AC',
        kind: 'RULE',
        message: `A regra engine.cables não define o fator de corrente do cabo ${dc ? 'CC' : 'CA'} (${dc ? 'cableCurrentFactorDc' : 'cableCurrentFactorAc'}).`,
      });

    const rho = tempC === undefined ? null : copperResistivity(tempC);
    const designCurrent =
      factor === undefined || ctx.designBaseA === null ? null : factor * ctx.designBaseA;
    const maxDropV =
      limit === undefined || ctx.referenceVoltageV === null
        ? null
        : (limit / 100) * ctx.referenceVoltageV;
    const minSection =
      rho === null || maxDropV === null || ctx.currentA === null
        ? null
        : roundTo(
            ((ctx.threePhase ? Math.sqrt(3) : 2) * rho * run.lengthM * ctx.currentA) / maxDropV,
            3,
          );

    if (run.lengthEstimated) {
      addPending({
        code: 'LENGTH_ESTIMATED',
        kind: 'DATA',
        message: 'Há trechos de cabo com comprimento estimado: confirme os comprimentos.',
      });
      checks.push(
        makeCheck({
          code: 'LENGTH_ESTIMATED',
          severity: 'ERROR',
          scope,
          pass: null,
          value: run.lengthM,
          unit: 'm',
          message: `O comprimento de "${run.label}" é uma estimativa: confirme.`,
          formula: '—',
          source: SRC.length,
        }),
      );
    }

    // Escolha: manual (conferida) ou a menor seção do catálogo que atende.
    const wantedKind = dc ? 'DC_SOLAR' : 'AC';
    let candidates = input.catalog
      .filter((c) => c.spec.cableKind === wantedKind && c.spec.conductor === 'CU')
      .sort((a, b) => a.spec.crossSectionMm2 - b.spec.crossSectionMm2 || a.id.localeCompare(b.id));
    const manual = run.cableId ? input.catalog.find((c) => c.id === run.cableId) : undefined;
    if (
      run.cableId &&
      (!manual || manual.spec.cableKind !== wantedKind || manual.spec.conductor !== 'CU')
    ) {
      checks.push(
        makeCheck({
          code: 'CABLE_NOT_SUITABLE',
          severity: 'ERROR',
          scope,
          pass: false,
          unit: '',
          message: 'O cabo escolhido não é um cabo de cobre aprovado do tipo deste trecho.',
          formula: '—',
          source: SRC.rating,
        }),
      );
      candidates = [];
    } else if (manual) candidates = [manual];

    const ampRow = (section: number) =>
      input.ampacity.find(
        (r) =>
          r.crossSectionMm2 === section &&
          run.installMethod !== undefined &&
          r.method.toLowerCase() === run.installMethod.toLowerCase(),
      );
    const evalCandidate = (c: Candidate<CableSpec>) => {
      const section = c.spec.crossSectionMm2;
      const dropV =
        rho === null || ctx.currentA === null
          ? null
          : voltageDropV({
              resistivity: rho,
              lengthM: run.lengthM,
              currentA: ctx.currentA,
              sectionMm2: section,
              threePhase: ctx.threePhase,
            });
      const dropPct =
        dropV === null || ctx.referenceVoltageV === null
          ? null
          : roundTo((dropV / ctx.referenceVoltageV) * 100, 3);
      const row = ampRow(section);
      return { section, dropV, dropPct, row };
    };
    const passesDrop = (d: ReturnType<typeof evalCandidate>) =>
      d.dropPct === null || limit === undefined || d.dropPct <= limit;
    const passesAmp = (d: ReturnType<typeof evalCandidate>) =>
      d.row === undefined || designCurrent === null || d.row.ampacityA >= designCurrent;
    const chosenCandidate =
      manual ??
      candidates.find((c) => {
        const d = evalCandidate(c);
        return (
          passesDrop(d) &&
          passesAmp(d) &&
          (c.spec.voltageRatingV === undefined ||
            ctx.ratingVoltageV === null ||
            c.spec.voltageRatingV >= ctx.ratingVoltageV)
        );
      });
    const shown = chosenCandidate ?? candidates[candidates.length - 1];
    const d = shown ? evalCandidate(shown) : null;

    if (
      !chosenCandidate &&
      !run.cableId &&
      candidates.length >= 0 &&
      !checks.some((c) => c.code === 'CABLE_NOT_SUITABLE')
    )
      checks.push(
        makeCheck({
          code: 'NO_CABLE_AVAILABLE',
          severity: 'ERROR',
          scope,
          pass: rho === null || limit === undefined ? null : false,
          unit: '',
          message:
            rho === null || limit === undefined
              ? 'Falta regra para escolher o cabo.'
              : `Nenhum cabo de cobre aprovado atende a queda de tensão e a capacidade deste trecho${minSection !== null ? ` (seção mínima pela queda: ${minSection} mm²)` : ''}. Cadastre e aprove um.`,
          formula: 'menor seção do catálogo que atende queda e capacidade',
          source: SRC.drop,
        }),
      );

    checks.push(
      makeCheck({
        code: 'VOLTAGE_DROP_EXCEEDED',
        severity: 'ERROR',
        scope,
        pass: d === null || d.dropPct === null || limit === undefined ? null : d.dropPct <= limit,
        value: d?.dropPct ?? null,
        limit: limit ?? null,
        unit: '%',
        message:
          d === null || d.dropPct === null || limit === undefined
            ? 'Queda de tensão pendente (falta regra, cabo ou dado).'
            : `Queda de ${d.dropPct}% em ${run.lengthM} m com ${d.section} mm² e ${roundTo(ctx.currentA ?? 0, 2)} A; limite ${limit}%.`,
        formula: ctx.threePhase
          ? 'ΔV = √3·ρ(T)·L·I / S'
          : 'ΔV = 2·ρ(T)·L·I / S;  ρ(T) = ρ20·(1 + 0,0039·(T − 20))',
        source: SRC.drop,
      }),
    );
    if (d && shown) {
      const ampacity = d.row?.ampacityA ?? null;
      const methodMissing = run.installMethod === undefined;
      checks.push(
        makeCheck({
          code: 'AMPACITY_EXCEEDED',
          severity: 'ERROR',
          scope,
          pass: ampacity === null || designCurrent === null ? null : ampacity >= designCurrent,
          value: designCurrent === null ? null : roundTo(designCurrent, 2),
          limit: ampacity,
          unit: 'A',
          message:
            ampacity === null
              ? methodMissing
                ? 'Informe o método de instalação do trecho para consultar a capacidade de condução.'
                : input.ampacity.length === 0
                  ? 'Capacidade de condução pendente: a regra não tem a tabela.'
                  : `A tabela de capacidade não tem a seção ${d.section} mm² no método "${run.installMethod}".`
              : designCurrent === null
                ? 'Capacidade pendente: falta o fator de corrente da regra.'
                : `Corrente de projeto ${roundTo(designCurrent, 2)} A; capacidade de ${d.section} mm² (${run.installMethod}) = ${ampacity} A.`,
          formula: 'I de projeto = fator × Isc (CC) ou × I CA ≤ capacidade de condução da tabela',
          source: SRC.amp,
        }),
      );
      if (shown.spec.voltageRatingV !== undefined && ctx.ratingVoltageV !== null)
        checks.push(
          makeCheck({
            code: 'CABLE_VOLTAGE_RATING_EXCEEDED',
            severity: 'ERROR',
            scope,
            pass: shown.spec.voltageRatingV >= ctx.ratingVoltageV,
            value: roundTo(ctx.ratingVoltageV, 1),
            limit: shown.spec.voltageRatingV,
            unit: 'V',
            message: `Tensão do circuito ${roundTo(ctx.ratingVoltageV, 1)} V; tensão nominal do cabo ${shown.spec.voltageRatingV} V.`,
            formula: 'tensão do circuito ≤ tensão nominal do cabo',
            source: SRC.rating,
          }),
        );
    }

    runs.push({
      ...base,
      currentA: ctx.currentA === null ? null : roundTo(ctx.currentA, 3),
      designCurrentA: designCurrent === null ? null : roundTo(designCurrent, 3),
      referenceVoltageV: ctx.referenceVoltageV === null ? null : roundTo(ctx.referenceVoltageV, 2),
      resistivityOhmMm2PerM: rho === null ? null : roundTo(rho, 6),
      minSectionByDropMm2: minSection,
      sectionMm2: d?.section ?? null,
      voltageDropV: d?.dropV === null || d === null ? null : roundTo(d.dropV as number, 4),
      voltageDropPct: d?.dropPct ?? null,
      limitPct: limit ?? null,
      ampacityA: d?.row?.ampacityA ?? null,
      chosen: chosenCandidate
        ? {
            equipmentId: chosenCandidate.id,
            label: chosenCandidate.label,
            crossSectionMm2: chosenCandidate.spec.crossSectionMm2,
            costCents: chosenCandidate.costCents,
          }
        : null,
      manual: manual !== undefined,
      checks,
      status: aggregate(checks),
    });
  }

  const all = runs.flatMap((r) => r.checks);
  let status: CompatibilityStatus = design.cables.length === 0 ? 'INCOMPLETE' : aggregate(all);
  if (design.cables.length === 0)
    addPending({
      code: 'NO_CABLE_RUNS',
      kind: 'DATA',
      message:
        'Nenhum trecho de cabo foi definido: informe os trechos CC e CA com os comprimentos.',
    });
  else if (status !== 'INVALID' && pending.some((p) => p.kind === 'RULE' || p.kind === 'DATA'))
    status = 'INCOMPLETE';
  return { status, runs, pending, algorithmVersion: CABLES_ALGORITHM_VERSION };
}
