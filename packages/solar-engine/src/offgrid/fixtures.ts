import { offgridDesignSchema, type OffgridDesign } from '@voltex/shared';
import type { OffgridContext } from './project.js';

/** Casos de teste: chalé isolado em Goiás, banco de 48 V de lítio, MPPT e inversor off-grid de 5 kW. */
export const IDS = {
  module: '00000000-0000-4000-8000-000000000001',
  battery: '00000000-0000-4000-8000-000000000002',
  controller: '00000000-0000-4000-8000-000000000003',
  inverter: '00000000-0000-4000-8000-000000000004',
  generator: '00000000-0000-4000-8000-000000000005',
  hybridInverter: '00000000-0000-4000-8000-000000000006',
} as const;

const GHI = [5.6, 5.8, 5.4, 5.3, 4.9, 4.7, 5.0, 5.8, 5.6, 5.8, 5.4, 5.4];
const TMEAN = [24, 24, 24, 23, 22, 20, 20, 22, 24, 25, 24, 24];

export const siteGoias = {
  name: 'Chalé',
  latitude: -15.8,
  longitude: -47.9,
  designTminC: 5,
  designTmaxAmbientC: 35,
  climate: {
    source: 'nasa-power' as const,
    period: '2001-2020',
    fetchedAt: '2026-01-01',
    ghiKwhM2Day: GHI,
    tempMeanC: TMEAN,
    tempMinC: TMEAN.map((t) => t - 6),
    tempMaxC: TMEAN.map((t) => t + 6),
  },
};

export const baseLoads = [
  { id: 'l1', name: 'Geladeira', powerW: 120, hoursPerDay: 12, surgeFactor: 4, critical: true },
  {
    id: 'l2',
    name: 'Iluminação LED',
    powerW: 10,
    quantity: 10,
    hoursPerDay: 5,
    windowStartHour: 18,
    windowEndHour: 24,
  },
  {
    id: 'l3',
    name: 'TV e roteador',
    powerW: 120,
    hoursPerDay: 5,
    windowStartHour: 18,
    windowEndHour: 23,
  },
  {
    id: 'l4',
    name: 'Bomba d’água',
    powerW: 370,
    hoursPerDay: 1,
    windowStartHour: 8,
    windowEndHour: 12,
    surgeFactor: 5,
  },
];

export const baseDesign = (patch: Record<string, unknown> = {}): OffgridDesign =>
  offgridDesignSchema.parse({
    site: siteGoias,
    systemVoltageV: 48,
    loads: baseLoads,
    autonomyDays: 2,
    arrays: [
      {
        id: 'a1',
        name: 'Telhado',
        moduleId: IDS.module,
        modulesInSeries: 4,
        parallelStrings: 1,
        azimuthDegrees: 0,
        tiltDegrees: 16,
      },
    ],
    bank: { batteryId: IDS.battery, seriesCount: 1, parallelCount: 2 },
    controllerId: IDS.controller,
    inverterId: IDS.inverter,
    ...patch,
  });

export const baseContext = (patch: Partial<OffgridContext> = {}): OffgridContext => ({
  modules: {
    [IDS.module]: {
      technology: 'MONO_SI',
      pmaxWp: 550,
      vmppV: 41.5,
      imppA: 13.25,
      vocV: 49.5,
      iscA: 14,
      betaVocPctPerC: -0.27,
      alphaIscPctPerC: 0.05,
      gammaPmaxPctPerC: -0.35,
      betaVmppPctPerC: -0.3,
      noctC: 45,
      lengthMm: 2278,
      widthMm: 1134,
      bifacial: false,
    },
  },
  batteries: {
    [IDS.battery]: {
      chemistry: 'LFP',
      nominalVoltageV: 51.2,
      capacityAh: 100,
      capacityHours: 5,
      maxDodPct: 90,
      roundTripEfficiencyPct: 95,
      cycleLife: 6000,
      cycleDodPct: 80,
      calendarLifeYears: 15,
      maxChargeCurrentA: 50,
      maxDischargeCurrentA: 100,
      maxParallel: 8,
    },
  },
  controllers: {
    [IDS.controller]: {
      technology: 'MPPT',
      batteryVoltageV: 48,
      autoVoltage: true,
      ratedChargeCurrentA: 60,
      pvVocMaxV: 250,
      mpptMinV: 60,
      mpptMaxV: 230,
      pvPowerMaxW: 3200,
      efficiencyPct: 98,
      tempCompensation: true,
    },
  },
  inverters: {
    [IDS.inverter]: {
      topology: 'OFFGRID',
      batteryVoltageV: 48,
      pContinuousW: 3000,
      pSurgeW: 6000,
      surgeSeconds: 5,
      efficiencyPct: 93,
      standbyW: 25,
      vAcV: 220,
      phases: 1,
      sineWave: true,
      gridInput: false,
      generatorInput: true,
      mpptBuiltIn: false,
      chargerCurrentA: 40,
    },
    [IDS.hybridInverter]: {
      topology: 'HYBRID',
      batteryVoltageV: 48,
      pContinuousW: 3000,
      pSurgeW: 6000,
      efficiencyPct: 93,
      standbyW: 25,
      vAcV: 220,
      phases: 1,
      sineWave: true,
      gridInput: true,
      generatorInput: true,
      mpptBuiltIn: false,
      chargerCurrentA: 40,
    },
  },
  generators: {
    [IDS.generator]: {
      fuel: 'GASOLINE',
      pContinuousW: 3500,
      vAcV: 220,
      phases: 1,
      fuelLitersPerHour: 1.5,
      autoStart: true,
    },
  },
  status: Object.fromEntries(Object.values(IDS).map((id) => [id, 'APPROVED' as const])),
  prices: {
    [IDS.module]: { unitCostCents: 60_000 },
    [IDS.battery]: { unitCostCents: 1_200_000 },
    [IDS.controller]: { unitCostCents: 250_000 },
    [IDS.inverter]: { unitCostCents: 600_000 },
    [IDS.generator]: { unitCostCents: 400_000 },
    [IDS.hybridInverter]: { unitCostCents: 800_000 },
  },
  ...patch,
});
