import type {
  CompatibilityResult,
  EngineeringDesign,
  InverterEntry,
  InverterSpec,
  ModuleSpec,
  SuggestConfigurationsResult,
  SuggestedConfiguration,
} from '@voltex/shared';
import { roundTo } from '../units/index.js';
import { evaluateCompatibility, moduleThermal } from './compatibility.js';
import { layoutSurface } from './layout.js';
import { stringLimits } from './strings.js';

/**
 * Gerador de configurações (ENG-F25): busca **determinística** no catálogo aprovado das combinações módulo × inversor ×
 * strings que passam em todas as verificações do Compatibility Engine, ordenadas por custo, proximidade da potência-alvo,
 * relação CC/CA e folga de tensão. É sugestão a confirmar, nunca decisão. Memorial: `docs/06-calculos/engine-configurador.md`.
 */
export const CONFIGURATOR_ALGORITHM_VERSION = 'configurator-1.0.0';

export interface Candidate<S> {
  id: string;
  spec: S;
  /** Preço vigente ou custo de referência (centavos). Nulo = sem preço. */
  costCents: number | null;
  label: string;
}

export interface ConfiguratorInput {
  design: EngineeringDesign;
  surfaceId: string;
  targetKwp: number;
  modules: Candidate<ModuleSpec>[];
  inverters: Candidate<InverterSpec>[];
  parameters: Record<string, number>;
  maxInverters: number;
  limit: number;
}

/** Quantas combinações (Ns × S) por inversor são avaliadas a fundo, as mais próximas da meta. */
const MAX_SHAPES = 8;

/** O que a geração precisa para rodar: sem isso não há como verificar nada. */
export function configuratorPending(
  design: EngineeringDesign,
  parameters: Record<string, number>,
): CompatibilityResult['pending'] {
  const pending: CompatibilityResult['pending'] = [];
  if (design.site.designTminC === null || design.site.designTminC === undefined)
    pending.push({
      code: 'TMIN_MISSING',
      kind: 'DATA',
      message: 'Falta a temperatura mínima de projeto do local.',
    });
  if (design.site.designTmaxAmbientC === null || design.site.designTmaxAmbientC === undefined)
    pending.push({
      code: 'TMAX_MISSING',
      kind: 'DATA',
      message: 'Falta a temperatura ambiente máxima de projeto do local.',
    });
  if (parameters.hotCellIrradianceWm2 === undefined)
    pending.push({
      code: 'RULE_HOT_CELL_IRRADIANCE',
      kind: 'RULE',
      message: 'A regra engine.design não define a irradiância da célula quente.',
    });
  if (parameters.dcAcRatioMin === undefined || parameters.dcAcRatioMax === undefined)
    pending.push({
      code: 'RULE_DC_AC_RATIO',
      kind: 'RULE',
      message: 'A regra engine.design não define a faixa de relação CC/CA.',
    });
  return pending;
}

/** Distribui `strings` pelos MPPT de `count` inversores: uma por MPPT primeiro, depois dobrando de forma equilibrada. */
function distribute(
  strings: number,
  count: number,
  inverter: InverterSpec,
  modulesInSeries: number,
  surfaceId: string,
): InverterEntry[] | null {
  const slots = count * inverter.mpptCount;
  const base = Math.floor(strings / slots);
  const extra = strings % slots;
  if (base + (extra > 0 ? 1 : 0) > inverter.inputsPerMppt) return null;
  const entries: InverterEntry[] = [];
  for (let j = 0; j < count; j++) {
    const mppts = [];
    for (let m = 0; m < inverter.mpptCount; m++) {
      const slot = j * inverter.mpptCount + m;
      const parallel = base + (slot < extra ? 1 : 0);
      mppts.push({
        strings:
          parallel > 0
            ? [{ id: `str-${j + 1}-${m + 1}`, surfaceId, modulesInSeries, parallel }]
            : [],
      });
    }
    entries.push({ id: `inv-${j + 1}`, inverterId: '', mppts });
  }
  return entries;
}

export function suggestConfigurations(input: ConfiguratorInput): SuggestConfigurationsResult {
  const { design, surfaceId, parameters } = input;
  const pending = configuratorPending(design, parameters);
  const discarded: SuggestConfigurationsResult['discarded'] = [];
  if (pending.length > 0) return { configurations: [], discarded, pending };

  const surface = design.surfaces.find((s) => s.id === surfaceId);
  if (!surface)
    return {
      configurations: [],
      discarded,
      pending: [
        { code: 'SURFACE_NOT_FOUND', kind: 'DATA', message: 'A superfície não existe no projeto.' },
      ],
    };

  const ratioMin = parameters.dcAcRatioMin as number;
  const ratioMax = parameters.dcAcRatioMax as number;
  const centre = (ratioMin + ratioMax) / 2;
  const found = new Map<
    string,
    SuggestedConfiguration & { sortRatio: number; sortPower: number }
  >();

  const evaluate = (
    module: Candidate<ModuleSpec>,
    inverter: Candidate<InverterSpec>,
    entries: InverterEntry[],
    shape: {
      modulesInSeries: number;
      totalStrings: number;
      moduleCount: number;
      inverterCount: number;
    },
    unitCount: number,
  ) => {
    const withIds = entries.map((e) => ({ ...e, inverterId: inverter.id }));
    const trial: EngineeringDesign = {
      ...design,
      surfaces: design.surfaces.map((s) =>
        s.id === surfaceId ? { ...s, moduleId: module.id } : s,
      ),
      inverters: withIds,
    };
    const result = evaluateCompatibility({
      design: trial,
      layoutCountBySurface: { [surfaceId]: shape.moduleCount },
      modules: { [module.id]: module.spec },
      inverters: { [inverter.id]: inverter.spec },
      status: { [module.id]: 'APPROVED', [inverter.id]: 'APPROVED' },
      parameters,
    });
    if (result.status !== 'VALID' && result.status !== 'VALID_WITH_WARNINGS') return;
    const thermal = moduleThermal(module.spec, design, parameters);
    const powerKwp = roundTo((shape.moduleCount * module.spec.pmaxWp) / 1000, 3);
    const unpriced: string[] = [];
    if (module.costCents === null) unpriced.push(module.label);
    if (inverter.costCents === null) unpriced.push(inverter.label);
    const costCents =
      unpriced.length > 0
        ? null
        : shape.moduleCount * (module.costCents as number) +
          unitCount * (inverter.costCents as number);
    const vocString =
      (thermal.vocColdV ?? 0) * (inverter.spec.topology === 'MICRO' ? 1 : shape.modulesInSeries);
    const ratio = result.inverters[0]?.metrics.dcAcRatio ?? null;
    const key = `${module.id}|${inverter.id}|${shape.inverterCount}|${shape.modulesInSeries}|${shape.totalStrings}`;
    found.set(key, {
      moduleId: module.id,
      inverterId: inverter.id,
      inverterCount: shape.inverterCount,
      modulesInSeries: shape.modulesInSeries,
      totalStrings: shape.totalStrings,
      moduleCount: shape.moduleCount,
      powerKwp,
      dcAcRatio: ratio,
      vocMarginPct: roundTo(((inverter.spec.vDcMaxV - vocString) / inverter.spec.vDcMaxV) * 100, 1),
      costCents,
      unpriced,
      entries: withIds,
      status: result.status,
      warnings: [
        ...result.inverters.flatMap((i) =>
          i.checks.filter((c) => c.outcome === 'FAIL').map((c) => c.message),
        ),
        ...result.allocation.filter((c) => c.outcome === 'FAIL').map((c) => c.message),
      ],
      sortRatio: ratio === null ? Number.POSITIVE_INFINITY : Math.abs(ratio - centre),
      sortPower: Math.abs(powerKwp - input.targetKwp),
    });
  };

  const sortedModules = [...input.modules].sort((a, b) => a.id.localeCompare(b.id));
  const sortedInverters = [...input.inverters].sort((a, b) => a.id.localeCompare(b.id));

  for (const module of sortedModules) {
    const layout = layoutSurface({
      surface: { ...surface, moduleCount: undefined as never },
      module: {
        lengthMm: module.spec.lengthMm,
        widthMm: module.spec.widthMm,
        pmaxWp: module.spec.pmaxWp,
      },
      latitudeDegrees: design.site.latitude,
    });
    if (layout.fitCount === 0) {
      for (const inverter of sortedInverters)
        discarded.push({
          moduleId: module.id,
          inverterId: inverter.id,
          reason: `${module.label} não cabe na superfície.`,
        });
      continue;
    }
    const targetModules = Math.max(1, Math.round((input.targetKwp * 1000) / module.spec.pmaxWp));
    const thermal = moduleThermal(module.spec, design, parameters);

    for (const inverter of sortedInverters) {
      const spec = inverter.spec;
      if (spec.topology === 'MICRO') {
        const inputs = spec.mpptCount * spec.inputsPerMppt;
        let any = false;
        for (let perUnit = 1; perUnit <= inputs; perUnit++) {
          const units = Math.max(1, Math.round(targetModules / perUnit));
          const modules = units * perUnit;
          if (modules > layout.fitCount) continue;
          const entry: InverterEntry = {
            id: 'micro-1',
            inverterId: inverter.id,
            mppts: [],
            micro: { surfaceId, units, modulesPerUnit: perUnit },
          };
          const before = found.size;
          evaluate(
            module,
            inverter,
            [entry],
            { modulesInSeries: 1, totalStrings: units, moduleCount: modules, inverterCount: 1 },
            units,
          );
          any = any || found.size > before;
        }
        if (!any)
          discarded.push({
            moduleId: module.id,
            inverterId: inverter.id,
            reason: `${module.label} com ${inverter.label}: nenhuma combinação de microinversores passa nas verificações.`,
          });
        continue;
      }

      if (thermal.vocColdV === null || thermal.vmppColdV === null || thermal.vmppHotV === null)
        continue;
      const limits = stringLimits({
        vocColdV: thermal.vocColdV,
        vmppColdV: thermal.vmppColdV,
        vmppHotV: thermal.vmppHotV,
        inverter: {
          maxDcVoltageV: spec.vDcMaxV,
          mpptMinV: spec.mpptMinV,
          mpptMaxV: spec.mpptMaxV,
          startVoltageV: spec.vStartV,
        },
        moduleMaxSystemVoltageV: module.spec.maxSystemVoltageV,
      });
      if (!limits.feasible) {
        discarded.push({
          moduleId: module.id,
          inverterId: inverter.id,
          reason: `${module.label} com ${inverter.label}: não existe nº de módulos em série que atenda a faixa de tensão (mínimo ${limits.minModules}, máximo ${limits.maxModules}).`,
        });
        continue;
      }
      // Quantidade de inversores compatível com a política de CC/CA.
      const dcWpTarget = targetModules * module.spec.pmaxWp;
      const kMin = Math.max(1, Math.ceil(dcWpTarget / (spec.pAcNomW * ratioMax)));
      const kMax = Math.min(
        input.maxInverters,
        Math.max(kMin, Math.floor(dcWpTarget / (spec.pAcNomW * ratioMin))),
      );
      const before = found.size;
      for (let k = kMin; k <= kMax; k++) {
        const shapes: { ns: number; s: number }[] = [];
        for (let ns = limits.minModules; ns <= limits.maxModules; ns++)
          for (const s of new Set([
            Math.floor(targetModules / ns),
            Math.ceil(targetModules / ns),
          ])) {
            if (s < k || ns * s > layout.fitCount) continue;
            shapes.push({ ns, s });
          }
        shapes.sort(
          (a, b) =>
            Math.abs(a.ns * a.s - targetModules) - Math.abs(b.ns * b.s - targetModules) ||
            a.ns - b.ns ||
            a.s - b.s,
        );
        for (const { ns, s } of shapes.slice(0, MAX_SHAPES)) {
          const entries = distribute(s, k, spec, ns, surfaceId);
          if (!entries) continue;
          evaluate(
            module,
            inverter,
            entries,
            { modulesInSeries: ns, totalStrings: s, moduleCount: ns * s, inverterCount: k },
            k,
          );
        }
      }
      if (found.size === before)
        discarded.push({
          moduleId: module.id,
          inverterId: inverter.id,
          reason: `${module.label} com ${inverter.label}: nenhuma combinação de strings passa nas verificações para ${input.targetKwp} kWp.`,
        });
    }
  }

  const all = [...found.values()];
  // Primeiro o que chega perto da meta (faixas de 5%), depois o mais barato por kWp, depois a proximidade exata da meta,
  // da relação CC/CA central e a folga de tensão; o desempate final é por id, para o resultado ser sempre o mesmo.
  const bucket = (c: { sortPower: number }) => Math.round((c.sortPower / input.targetKwp) * 20);
  const perKwp = (c: SuggestedConfiguration) =>
    c.costCents === null ? null : c.costCents / c.powerKwp;
  all.sort((a, b) => {
    const pa = perKwp(a);
    const pb = perKwp(b);
    return (
      bucket(a) - bucket(b) ||
      (pa === null ? 1 : 0) - (pb === null ? 1 : 0) ||
      (pa !== null && pb !== null ? pa - pb : 0) ||
      a.sortPower - b.sortPower ||
      a.sortRatio - b.sortRatio ||
      b.vocMarginPct - a.vocMarginPct ||
      a.inverterCount - b.inverterCount ||
      a.moduleId.localeCompare(b.moduleId) ||
      a.inverterId.localeCompare(b.inverterId) ||
      a.modulesInSeries - b.modulesInSeries ||
      a.totalStrings - b.totalStrings
    );
  });
  const configurations = all
    .slice(0, input.limit)
    .map(({ sortRatio: _r, sortPower: _p, ...rest }) => rest);
  return { configurations, discarded, pending: [] };
}
