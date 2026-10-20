import {
  offgridGridSchema,
  type OffgridCheck,
  type OffgridDesign,
  type OffgridEconomicsResult,
  type OffgridResults,
  type OffgridScenarioResult,
  type OffgridSimulationResult,
  type OffgridSizing,
} from '@voltex/shared';
import { roundTo } from '../units/index.js';
import { cellTemperatureC } from '../engine/thermal.js';
import type { HourlySeries } from '../io/weather.js';
import {
  OFFGRID_ECONOMICS_VERSION,
  evaluateOffgridEconomics,
  type OffgridLine,
  type OffgridPrice,
} from './economics.js';
import {
  OFFGRID_DISPATCH_VERSION,
  runDispatch,
  type DispatchConfig,
  type DispatchTimeline,
} from './dispatch.js';
import { OFFGRID_LOAD_VERSION, loadsAt, profileLoads } from './load.js';
import { resolveParameters, type OffgridParams } from './parameters.js';
import {
  OFFGRID_RESOURCE_VERSION,
  buildYear,
  describeResource,
  orientationsOf,
  type YearTimeline,
} from './resource.js';
import {
  OFFGRID_SELECTION_VERSION,
  evaluateSelection,
  type DispatchEquipment,
  type OffgridEquipmentContext,
  type SelectionResult,
} from './selection.js';
import {
  OFFGRID_SIZING_VERSION,
  batteriesInParallel,
  batteriesInSeries,
  batteryLifeYears,
  bankCapacity,
  controllerCurrentA,
  dailyBatteryEnergyWh,
  inverterRequirement,
  pvPeakPowerWp,
  ruleDodLimitPct,
  suggestedAutonomyDays,
} from './sizing.js';
import { OFFGRID_STRESS_VERSION, stressTest } from './stress.js';

/**
 * Orquestra o cálculo do projeto off-grid/híbrido: carga → recurso solar → dimensionamento (mês crítico) →
 * verificação do que foi escolhido → despacho horário → estresse → custo → cenários. Puro e determinístico: roda no
 * navegador (prévia) e no servidor (oficial). Memorial: `docs/06-calculos/offgrid-*.md`.
 */
export const OFFGRID_RESULTS_VERSION = 'offgrid-results-1.0.0';

export interface OffgridContext extends OffgridEquipmentContext {
  /** Parâmetros da regra `offgrid.design` em vigor (vazio = sem regra: valores provisórios e pendência). */
  parameters?: Record<string, number>;
  series?: HourlySeries;
  prices?: Record<string, OffgridPrice | undefined>;
  labels?: Record<string, string | undefined>;
}

const errorCheck = (code: string, message: string): OffgridCheck => ({
  code,
  severity: 'ERROR',
  message,
});

interface Evaluated {
  selection: SelectionResult;
  simulation: OffgridSimulationResult | null;
  economics: OffgridEconomicsResult | null;
  timeline: DispatchTimeline | null;
  config: DispatchConfig | null;
  extraChecks: OffgridCheck[];
}

function buildDispatch(
  design: OffgridDesign,
  eq: DispatchEquipment,
  params: OffgridParams,
  year: YearTimeline,
  loads: OffgridDesign['loads'],
  red2: number,
): { timeline: DispatchTimeline; config: DispatchConfig } {
  const n = year.monthIndex.length;
  const pvW = new Array<number>(n).fill(0);
  eq.arrays.forEach((array, a) => {
    const plane = year.planeWm2[a] as number[];
    for (let h = 0; h < n; h++) {
      const g = plane[h] as number;
      if (g <= 0) continue;
      const tc = cellTemperatureC({
        ambientC: year.ambientC[h] as number,
        noctC: array.noctC,
        irradianceWm2: g,
      });
      const temperature = Math.max(0, 1 + (array.gammaPctPerC / 100) * (tc - 25));
      pvW[h] =
        (pvW[h] as number) +
        array.modules *
          array.pmaxWp *
          (g / 1000) *
          temperature *
          (1 - array.lossFraction) *
          params.pvOtherLossFactor *
          red2;
    }
  });
  const acWh = new Array<number>(n).fill(0);
  const dcWh = new Array<number>(n).fill(0);
  for (let h = 0; h < n; h++) {
    const at = loadsAt(
      loads,
      year.monthIndex[h] as number,
      year.weekday[h] as number,
      year.hourOfDay[h] as number,
    );
    acWh[h] = at.acWh;
    dcWh[h] = at.dcWh;
  }
  const grid =
    design.systemType === 'HYBRID' ? (design.grid ?? offgridGridSchema.parse({})) : undefined;
  const config: DispatchConfig = {
    nominalWh: eq.nominalWh,
    socMinFrac: 1 - eq.designDodFraction,
    roundTripEfficiency: eq.roundTripEfficiency,
    maxChargeW: eq.maxChargeW,
    maxDischargeW: eq.maxDischargeW,
    controllerEfficiency: eq.controllerEfficiency,
    controllerLimitW: eq.controllerLimitW,
    inverterContinuousW: eq.inverterContinuousW,
    inverterEfficiency: eq.inverterEfficiency,
    inverterStandbyW: eq.inverterStandbyW,
    generator:
      design.generator.enabled && eq.generator
        ? {
            powerW: eq.generator.pContinuousW,
            startSocFrac: design.generator.startSocPct / 100,
            stopSocFrac: design.generator.stopSocPct / 100,
            minRunHours: design.generator.minRunHours,
            fromHour: design.generator.allowedFromHour,
            toHour: design.generator.allowedToHour,
            fuelLitersPerHour: eq.generator.fuelLitersPerHour ?? null,
            chargerW: eq.inverterChargerW,
          }
        : undefined,
    grid: grid
      ? {
          mode: grid.mode,
          dailyOutageStartHour: grid.dailyOutageStartHour,
          dailyOutageHours: grid.dailyOutageHours,
          extendedOutages: grid.extendedOutages,
          reserveSocFrac: grid.reserveSocPct / 100,
          chargeBelowSocFrac: grid.gridChargeBelowSocPct / 100,
          chargerW: eq.inverterChargerW,
        }
      : undefined,
  };
  return {
    timeline: {
      hourOfDay: year.hourOfDay,
      dayOfYear: year.dayOfYear,
      monthIndex: year.monthIndex,
      pvW,
      acWh,
      dcWh,
    },
    config,
  };
}

function simulationResult(
  run: ReturnType<typeof runDispatch>,
  eq: DispatchEquipment,
  year: YearTimeline,
  params: OffgridParams,
): OffgridSimulationResult {
  const battery = eq.battery;
  const lolp = (run.unmetHours / Math.max(1, run.hours)) * 100;
  return {
    source: year.source,
    hours: run.hours,
    pvKwh: run.pvKwh,
    loadKwh: run.loadKwh,
    servedKwh: run.servedKwh,
    unmetKwh: run.unmetKwh,
    lolpPct: roundTo(lolp, 3),
    coveragePct: run.loadKwh > 0 ? roundTo((run.servedKwh / run.loadKwh) * 100, 2) : 100,
    curtailedKwh: run.curtailedKwh,
    generatorKwh: run.generatorKwh,
    generatorHours: run.generatorHours,
    fuelLiters: run.fuelLiters,
    gridKwh: run.gridKwh,
    batteryCycles: roundTo(run.dischargedWh / Math.max(1, eq.usableWh), 1),
    batteryLifeYears: batteryLifeYears({
      cycleLife: battery?.cycleLife,
      cycleDodPct: battery?.cycleDodPct,
      nominalWh: eq.nominalWh,
      annualThroughputWh: run.dischargedWh,
      calendarLifeYears: battery?.calendarLifeYears,
    }),
    minSocPct: roundTo(run.minSocFrac * 100, 1),
    monthly: {
      pvKwh: run.monthly.pvKwh,
      loadKwh: run.monthly.loadKwh,
      unmetKwh: run.monthly.unmetKwh,
      generatorKwh: run.monthly.generatorKwh,
      gridKwh: run.monthly.gridKwh,
      minSocPct: run.monthly.minSocFrac.map((v) => roundTo(v * 100, 1)),
    },
    typicalDay: {
      pvKw: run.typicalDay.pvKw,
      loadKw: run.typicalDay.loadKw,
      socPct: run.typicalDay.socFrac.map((v) => roundTo(v * 100, 1)),
    },
    dailyMinSocPct: run.dailyMinSocFrac.map((v) => roundTo(v * 100, 1)),
    longestOutageHours: run.longestUnmetRunHours,
    warnings: [
      ...year.warnings,
      ...(params.lolpMaxPct < lolp
        ? [`Perda de carga de ${roundTo(lolp, 2)}% acima do limite (${params.lolpMaxPct}%).`]
        : []),
    ],
  };
}

function linesOf(design: OffgridDesign, ctx: OffgridContext): OffgridLine[] {
  const label = (id: string, fallback: string): string => ctx.labels?.[id] ?? fallback;
  const lines: OffgridLine[] = [];
  const byModule = new Map<string, number>();
  for (const array of design.arrays)
    if (array.moduleId)
      byModule.set(
        array.moduleId,
        (byModule.get(array.moduleId) ?? 0) + array.modulesInSeries * array.parallelStrings,
      );
  for (const [id, quantity] of byModule)
    lines.push({ id, description: label(id, 'Módulo'), quantity, category: 'MODULE' });
  if (design.bank.batteryId)
    lines.push({
      id: design.bank.batteryId,
      description: label(design.bank.batteryId, 'Bateria'),
      quantity: design.bank.seriesCount * design.bank.parallelCount,
      category: 'BATTERY',
    });
  if (design.controllerId)
    lines.push({
      id: design.controllerId,
      description: label(design.controllerId, 'Controlador de carga'),
      quantity: design.controllerCount,
      category: 'CONTROLLER',
    });
  if (design.inverterId)
    lines.push({
      id: design.inverterId,
      description: label(design.inverterId, 'Inversor'),
      quantity: design.inverterCount,
      category: 'INVERTER',
    });
  if (design.generator.enabled && design.generator.generatorId)
    lines.push({
      id: design.generator.generatorId,
      description: label(design.generator.generatorId, 'Gerador'),
      quantity: 1,
      category: 'GENERATOR',
    });
  return lines;
}

function evaluateConfiguration(input: {
  design: OffgridDesign;
  ctx: OffgridContext;
  params: OffgridParams;
  load: ReturnType<typeof profileLoads>;
  dailyBatteryWh: number;
  year: YearTimeline | null;
  red2: number;
}): Evaluated {
  const { design, ctx, params, year } = input;
  const climate = design.site.climate;
  const minC =
    design.site.designTminC ??
    (climate ? Math.min(...climate.tempMinC.filter((v): v is number => v !== null)) : null);
  const maxC =
    design.site.designTmaxAmbientC ??
    (climate ? Math.max(...climate.tempMaxC.filter((v): v is number => v !== null)) : null);
  const selection = evaluateSelection({
    design,
    equipment: ctx,
    params,
    load: input.load,
    dailyBatteryWh: input.dailyBatteryWh,
    minAmbientC: Number.isFinite(minC) ? minC : null,
    maxAmbientC: Number.isFinite(maxC) ? maxC : null,
  });
  if (!selection.equipment || !year)
    return {
      selection,
      simulation: null,
      economics: null,
      timeline: null,
      config: null,
      extraChecks: [],
    };

  const { timeline, config } = buildDispatch(
    design,
    selection.equipment,
    params,
    year,
    design.loads,
    input.red2,
  );
  const run = runDispatch(config, timeline);
  const simulation = simulationResult(run, selection.equipment, year, params);
  const extraChecks: OffgridCheck[] = [];
  if (simulation.lolpPct > params.lolpMaxPct)
    extraChecks.push(
      errorCheck(
        'LOLP_EXCEEDS',
        `A perda de carga anual (${simulation.lolpPct}%) passa do limite da regra (${params.lolpMaxPct}%).`,
      ),
    );
  else
    extraChecks.push({
      code: 'LOLP_OK',
      severity: 'OK',
      message: `Perda de carga de ${simulation.lolpPct}% dentro do limite.`,
      value: simulation.lolpPct,
      limit: params.lolpMaxPct,
      unit: '%',
    });
  const economics = evaluateOffgridEconomics({
    lines: linesOf(design, ctx),
    prices: ctx.prices ?? {},
    economics: design.economics,
    servedKwhPerYear: simulation.servedKwh,
    fuelLitersPerYear: simulation.fuelLiters,
    fuelPriceCentsPerLiter: design.generator.fuelPriceCentsPerLiter,
    gridKwhPerYear: simulation.gridKwh,
    gridTariffCentsPerKwh: design.grid?.tariffCentsPerKwh ?? 0,
    batteryLifeYears: simulation.batteryLifeYears,
  });
  return { selection, simulation, economics, timeline, config, extraChecks };
}

export function computeOffgridResults(design: OffgridDesign, ctx: OffgridContext): OffgridResults {
  const pending: OffgridResults['pending'] = [];
  const warnings: string[] = [];
  const { params, missing } = resolveParameters(ctx.parameters);
  if (missing.length > 0) {
    pending.push({
      code: 'RULE_PARAMETERS_MISSING',
      message: `A regra offgrid.design não traz: ${missing.join(', ')}. Foram usados valores provisórios; a aprovação fica travada até a regra ser ativada e revisada.`,
    });
  }

  const load = profileLoads(design.loads);
  if (design.loads.length === 0)
    pending.push({ code: 'NO_LOADS', message: 'Nenhuma carga foi cadastrada.' });
  if (design.systemType === 'HYBRID' && !design.grid)
    warnings.push('Sistema híbrido sem dados da rede: usando o modo reserva (backup) sem quedas.');

  const red1 = design.red1 ?? params.red1Default;
  const red2 = design.red2 ?? params.red2Default;
  const etaBat = design.batteryEfficiency ?? params.batteryEfficiencyDefault;
  const inverter = design.inverterId ? ctx.inverters[design.inverterId] : undefined;
  const etaInv =
    design.inverterEfficiency ??
    (inverter?.efficiencyPct ? inverter.efficiencyPct / 100 : params.inverterEfficiencyMin);

  // Recurso solar no plano dos arranjos.
  const moduleWp = (arrayId: string): number => {
    const array = design.arrays.find((a) => a.id === arrayId);
    const module = array?.moduleId ? ctx.modules[array.moduleId] : undefined;
    return module && array ? module.pmaxWp * array.modulesInSeries * array.parallelStrings : 1;
  };
  const orientations = orientationsOf(design, moduleWp);
  const year = buildYear(design, orientations, ctx.series);
  const resource = describeResource(year, orientations, load.monthlyDailyWh);
  if (!year)
    pending.push({
      code: 'NO_SOLAR_RESOURCE',
      message: 'Sem recurso solar: busque o clima do local (Central de Dados) ou a série horária.',
    });
  else warnings.push(...year.warnings);

  // Dimensionamento (CRESESB 6.2–6.9 e 6.10–6.17).
  const monthlyEnergy = load.monthlyDailyAcWh.map((ac, m) =>
    dailyBatteryEnergyWh({
      acWh: ac,
      dcWh: load.monthlyDailyDcWh[m] as number,
      batteryEfficiency: etaBat,
      inverterEfficiency: etaInv,
    }),
  );
  const dailyBatteryWh = Math.max(...monthlyEnergy, 0);
  const pv = pvPeakPowerWp({
    monthlyEnergyWh: monthlyEnergy,
    monthlyHsp: resource.hspMonthly,
    red1,
    red2,
  });
  const firstModule = design.arrays
    .map((a) => (a.moduleId ? ctx.modules[a.moduleId] : undefined))
    .find(Boolean);
  const battery = design.bank.batteryId ? ctx.batteries[design.bank.batteryId] : undefined;
  const autonomy = Math.max(design.autonomyDays, params.autonomyMinDays);
  if (design.autonomyDays < params.autonomyMinDays)
    warnings.push(
      `A autonomia de projeto (${design.autonomyDays} dia[s]) está abaixo do mínimo da regra (${params.autonomyMinDays}); o dimensionamento usou o mínimo.`,
    );
  const dodPct = battery
    ? Math.min(
        design.bank.designDodPct ?? battery.maxDodPct,
        battery.maxDodPct,
        ruleDodLimitPct(battery.chemistry, params) ?? 100,
      )
    : (design.bank.designDodPct ?? null);
  const bank =
    dodPct !== null && dailyBatteryWh > 0
      ? bankCapacity({
          dailyEnergyWh: dailyBatteryWh,
          autonomyDays: autonomy,
          dodFraction: dodPct / 100,
          systemVoltageV: design.systemVoltageV,
        })
      : null;
  const need = inverterRequirement({
    peakW: load.peakW,
    surgeW: load.surgeW,
    margin: params.inverterSurgeMargin,
  });
  const sizing: OffgridSizing = {
    energyRequiredWh: roundTo(dailyBatteryWh, 1),
    red1,
    red2,
    batteryEfficiency: etaBat,
    inverterEfficiency: etaInv,
    pvPowerWp: pv.wp,
    moduleCount:
      firstModule && Number.isFinite(pv.wp) ? Math.ceil(pv.wp / firstModule.pmaxWp) : null,
    autonomyDays: autonomy,
    suggestedAutonomyDays: resource.hspMin > 0 ? suggestedAutonomyDays(resource.hspMin) : null,
    dodPct,
    bankWhRequired: bank?.wh ?? null,
    bankAhRequired: bank?.ah ?? null,
    batterySeries: battery
      ? batteriesInSeries(design.systemVoltageV, battery.nominalVoltageV)
      : null,
    batteryParallel: battery && bank ? batteriesInParallel(bank.ah, battery.capacityAh) : null,
    controllerCurrentA: Number.isFinite(pv.wp)
      ? roundTo(
          controllerCurrentA(params.controllerCurrentFactor, pv.wp / design.systemVoltageV, 1),
          1,
        )
      : null,
    inverterContinuousW: need.continuousW,
    inverterSurgeW: need.surgeW,
    systemVoltageV: design.systemVoltageV,
  };

  const main = evaluateConfiguration({ design, ctx, params, load, dailyBatteryWh, year, red2 });
  pending.push(...main.selection.pending);
  const checks = [...main.selection.checks, ...main.extraChecks];

  // Teste de estresse.
  let stress: OffgridResults['stress'] = null;
  if (design.stress.enabled && main.timeline && main.config && main.selection.equipment && year) {
    stress = stressTest({
      config: main.config,
      timeline: main.timeline,
      monthIndex: resource.designMonthIndex,
      cloudyDays: design.stress.cloudyDays,
      irradianceFactor: design.stress.irradianceFactor,
      loadGrowthPct: design.stress.loadGrowthPct,
      autonomyDaysEffective:
        dailyBatteryWh > 0 ? main.selection.equipment.usableWh / dailyBatteryWh : 0,
    });
    if (stress) {
      checks.push(
        stress.survives
          ? {
              code: 'STRESS_OK',
              severity: 'OK',
              message: `Suporta ${stress.cloudyDays} dia(s) nublados seguidos com a carga ${stress.loadGrowthPct}% maior.`,
            }
          : {
              code: 'STRESS_FAILED',
              severity: 'WARNING',
              message: `Em ${stress.cloudyDays} dia(s) nublados seguidos (${stress.irradianceFactor * 100}% do sol), faltam ${stress.unmetKwh} kWh e o SOC mínimo é ${stress.minSocPct}%.`,
            },
      );
    }
  }
  if (main.economics && main.economics.missingPrices.length > 0)
    warnings.push(`Sem preço para: ${main.economics.missingPrices.join(', ')}.`);
  if (main.selection.equipment?.battery?.chemistry === 'OTHER')
    warnings.push('Química da bateria "outra": confira DoD e vida em ciclos na ficha.');

  // Cenários: sobrescrevem banco, strings, gerador; recalculam despacho e custo.
  const scenarios: OffgridScenarioResult[] = [];
  for (const scenario of design.scenarios) {
    const variant: OffgridDesign = {
      ...design,
      bank: { ...design.bank, ...(scenario.bank ?? {}) },
      arrays: design.arrays.map((a, i) =>
        i === 0 && scenario.parallelStrings
          ? { ...a, parallelStrings: scenario.parallelStrings }
          : a,
      ),
      generator: {
        ...design.generator,
        enabled: scenario.generatorEnabled ?? design.generator.enabled,
      },
    };
    const variantOrientations = orientationsOf(variant, (id) => {
      const array = variant.arrays.find((a) => a.id === id);
      const module = array?.moduleId ? ctx.modules[array.moduleId] : undefined;
      return module && array ? module.pmaxWp * array.modulesInSeries * array.parallelStrings : 1;
    });
    const variantYear = buildYear(variant, variantOrientations, ctx.series);
    const evaluated = evaluateConfiguration({
      design: variant,
      ctx,
      params,
      load,
      dailyBatteryWh,
      year: variantYear,
      red2,
    });
    scenarios.push({
      id: scenario.id,
      name: scenario.name,
      pvPowerWp: evaluated.selection.selected?.pvPowerWp ?? 0,
      bankNominalWh: evaluated.selection.selected?.bankNominalWh ?? 0,
      generator: variant.generator.enabled,
      lolpPct: evaluated.simulation?.lolpPct ?? 0,
      unmetKwh: evaluated.simulation?.unmetKwh ?? 0,
      generatorKwh: evaluated.simulation?.generatorKwh ?? 0,
      fuelLiters: evaluated.simulation?.fuelLiters ?? 0,
      capexCents: evaluated.economics?.capexCents ?? 0,
      lcoeCentsPerKwh: evaluated.economics?.lcoeCentsPerKwh ?? null,
      batteryLifeYears: evaluated.simulation?.batteryLifeYears ?? null,
    });
  }

  const hasError = checks.some((c) => c.severity === 'ERROR');
  const hasWarning =
    checks.some((c) => c.severity === 'WARNING') ||
    warnings.length > 0 ||
    (main.simulation?.warnings.length ?? 0) > 0;
  const status: OffgridResults['status'] =
    pending.length > 0 || !main.simulation
      ? 'INCOMPLETE'
      : hasError
        ? 'INVALID'
        : hasWarning
          ? 'VALID_WITH_WARNINGS'
          : 'VALID';
  // Erro de verificação prevalece sobre incompleto quando já há erro certo.
  const finalStatus = hasError ? 'INVALID' : status;

  return {
    algorithmVersions: {
      results: OFFGRID_RESULTS_VERSION,
      load: OFFGRID_LOAD_VERSION,
      resource: OFFGRID_RESOURCE_VERSION,
      sizing: OFFGRID_SIZING_VERSION,
      selection: OFFGRID_SELECTION_VERSION,
      dispatch: OFFGRID_DISPATCH_VERSION,
      stress: OFFGRID_STRESS_VERSION,
      economics: OFFGRID_ECONOMICS_VERSION,
    },
    systemType: design.systemType,
    load,
    resource,
    sizing,
    selected: main.selection.selected,
    checks,
    simulation: main.simulation,
    stress,
    economics: main.economics,
    scenarios,
    pending,
    warnings,
    status: finalStatus,
  };
}
