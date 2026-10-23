import type { MonitoringAlarmSeverity, MonitoringPlantStatus } from '../schemas/monitoring.js';

export interface PlantMonitoringLinkDto {
  id: string;
  plantId: string;
  connectionId: string;
  provider: string;
  providerLabel: string;
  externalPlantId: string;
  addedAt: string;
}

export interface MonitoringDailyDto {
  /** `AAAA-MM-DD`. */
  date: string;
  kwh: number;
  /** Chave do provedor ou `CSV`. */
  source: string;
}

export interface MonitoringSnapshotDto {
  powerKw: number | null;
  status: MonitoringPlantStatus;
  receivedAt: string;
}

export interface MonitoringAlarmDto {
  id: string;
  code: string;
  text: string;
  severity: MonitoringAlarmSeverity;
  openedAt: string;
  closedAt: string | null;
}

export interface MonitoringMonthDto {
  /** `AAAA-MM`. */
  month: string;
  expectedKwh: number | null;
  expectedToDateKwh: number | null;
  actualKwh: number;
  daysWithData: number;
  daysInMonth: number;
  /** Real ÷ esperada até a data. */
  performanceIndex: number | null;
  deviationPct: number | null;
}

export interface MonitoringDeviationDto {
  streak: number;
  alert: boolean;
  days: { date: string; actualKwh: number; expectedKwh: number; deviationPct: number }[];
}

export interface PlantMonitoringPageDto {
  links: PlantMonitoringLinkDto[];
  /** Últimos 60 dias, uma leitura por dia (a de API vale mais que a da planilha). */
  daily: MonitoringDailyDto[];
  snapshot: MonitoringSnapshotDto | null;
  openAlarms: MonitoringAlarmDto[];
  /** Mês atual e os 5 anteriores. */
  months: MonitoringMonthDto[];
  /** `null` sem regra `ops.monitoring` ativa: o sistema compara, mas não avalia nem abre chamado. */
  deviationRule: { thresholdPct: number; consecutiveDays: number; ref: string } | null;
  deviation: MonitoringDeviationDto | null;
  /** Sem projeto técnico aprovado não há geração esperada. */
  hasExpected: boolean;
}

export interface ExternalPlantDto {
  id: string;
  name: string;
}

export interface MonitoringImportResultDto {
  imported: number;
  rejected: { line: number; reason: string }[];
}
