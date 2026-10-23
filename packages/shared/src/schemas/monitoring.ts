import { z } from 'zod';

export type MonitoringKind = 'MONITORING' | 'SIGNATURE';

export const MONITORING_PROVIDERS = [
  'solaredge',
  'huawei-fusionsolar',
  'growatt',
  'sungrow',
  'deye',
  'solarman',
  'soliscloud',
  'goodwe',
  'apsystems',
  'enphase',
  'sma',
  'fronius',
  'growatt-portal',
  'goodwe-sems',
  'hoymiles-smiles',
  'solarman-portal',
  'huawei-kiosk',
] as const;

export const MONITORING_PROVIDER_LABELS: Record<(typeof MONITORING_PROVIDERS)[number], string> = {
  solaredge: 'SolarEdge Monitoring API',
  'huawei-fusionsolar': 'Huawei FusionSolar Northbound',
  growatt: 'Growatt OpenAPI v1',
  sungrow: 'Sungrow iSolarCloud OpenAPI',
  deye: 'Deye Cloud OpenAPI',
  solarman: 'Solarman OpenAPI',
  soliscloud: 'SolisCloud API',
  goodwe: 'GoodWe SEMS OpenAPI',
  apsystems: 'APsystems OpenAPI',
  enphase: 'Enphase API v4',
  sma: 'SMA Monitoring API',
  fronius: 'Fronius Solar.web Query API',
  'growatt-portal': 'Growatt Portal (não oficial)',
  'goodwe-sems': 'GoodWe SEMS (não oficial)',
  'hoymiles-smiles': 'Hoymiles S-Miles (não oficial)',
  'solarman-portal': 'Solarman Portal (não oficial)',
  'huawei-kiosk': 'Huawei Kiosk (não oficial)',
};

export const MONITORING_PROVIDER_OFFICIAL: Record<(typeof MONITORING_PROVIDERS)[number], boolean> =
  {
    solaredge: true,
    'huawei-fusionsolar': true,
    growatt: true,
    sungrow: true,
    deye: true,
    solarman: true,
    soliscloud: true,
    goodwe: true,
    apsystems: true,
    enphase: true,
    sma: true,
    fronius: true,
    'growatt-portal': false,
    'goodwe-sems': false,
    'hoymiles-smiles': false,
    'solarman-portal': false,
    'huawei-kiosk': false,
  };

export const LinkPlantMonitoringInput = z.object({
  connectionId: z.string().uuid('Conexão inválida'),
  externalPlantId: z.string().min(1, 'ID externo obrigatório'),
});
export type LinkPlantMonitoringInput = z.infer<typeof LinkPlantMonitoringInput>;

export const PlantMonitoringLinkDto = z.object({
  id: z.string().uuid(),
  plantId: z.string().uuid(),
  connectionId: z.string().uuid(),
  externalPlantId: z.string(),
  addedAt: z.string().datetime(),
});
export type PlantMonitoringLinkDto = z.infer<typeof PlantMonitoringLinkDto>;

export const MonitoringDailyDto = z.object({
  id: z.string().uuid(),
  date: z.string(),
  kwhGenerated: z.number().positive('Geração deve ser positiva'),
  source: z.string(),
  receivedAt: z.string().datetime(),
});
export type MonitoringDailyDto = z.infer<typeof MonitoringDailyDto>;

export const MonitoringSnapshotDto = z.object({
  kwhPower: z.number().nonnegative('Potência não pode ser negativa'),
  status: z.enum(['ONLINE', 'OFFLINE', 'ALARM', 'UNKNOWN']),
  receivedAt: z.string().datetime(),
});
export type MonitoringSnapshotDto = z.infer<typeof MonitoringSnapshotDto>;

export const MonitoringAlarmDto = z.object({
  id: z.string().uuid(),
  code: z.string(),
  text: z.string(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
});
export type MonitoringAlarmDto = z.infer<typeof MonitoringAlarmDto>;

export const MonitoringPerformanceDto = z.object({
  date: z.string(),
  expectedKwh: z.number().nonnegative('Geração esperada não pode ser negativa'),
  actualKwh: z.number().nonnegative('Geração real não pode ser negativa'),
  performanceIndex: z.number(),
  deviationPct: z.number(),
  status: z.enum(['GOOD', 'WARNING', 'CRITICAL']).default('GOOD'),
});
export type MonitoringPerformanceDto = z.infer<typeof MonitoringPerformanceDto>;

export const PlantMonitoringPageDto = z.object({
  links: z.array(PlantMonitoringLinkDto),
  dailyData: z.array(MonitoringDailyDto),
  snapshot: MonitoringSnapshotDto.nullable(),
  recentAlarms: z.array(MonitoringAlarmDto),
  performanceThisMonth: z.array(MonitoringPerformanceDto),
  performanceLastMonth: z.array(MonitoringPerformanceDto),
  comparisonThisMonth: z.object({
    expectedKwh: z.number(),
    actualKwh: z.number(),
    performanceIndex: z.number(),
    deviationPct: z.number(),
  }),
});
export type PlantMonitoringPageDto = z.infer<typeof PlantMonitoringPageDto>;

export const ImportMonitoringCsvInput = z.object({
  connectionId: z.string().uuid('Conexão inválida'),
  file: z.instanceof(File),
});
export type ImportMonitoringCsvInput = z.infer<typeof ImportMonitoringCsvInput>;
