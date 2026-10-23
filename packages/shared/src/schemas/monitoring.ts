import { z } from 'zod';

/** Monitoramento de inversores (11F). Os provedores vêm do Integration Hub (`GET /integrations/providers`). */

export const MONITORING_ALARM_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type MonitoringAlarmSeverity = (typeof MONITORING_ALARM_SEVERITIES)[number];

export const MONITORING_PLANT_STATUSES = ['ONLINE', 'OFFLINE', 'ALARM', 'UNKNOWN'] as const;
export type MonitoringPlantStatus = (typeof MONITORING_PLANT_STATUSES)[number];

export const linkPlantMonitoringSchema = z.object({
  connectionId: z.uuid(),
  /** Identificador da usina no provedor (ex.: id do site SolarEdge, `sid` da APsystems). */
  externalPlantId: z.string().trim().min(1).max(120),
});
export type LinkPlantMonitoringInput = z.infer<typeof linkPlantMonitoringSchema>;

export const MAX_MONITORING_CSV_BYTES = 512 * 1024;
/** Importação por planilha: colunas `data` e `kwh` (ver o guia). Vale para qualquer marca. */
export const importMonitoringCsvSchema = z.object({
  csv: z.string().min(1).max(MAX_MONITORING_CSV_BYTES),
});
export type ImportMonitoringCsvInput = z.infer<typeof importMonitoringCsvSchema>;

export const listExternalPlantsQuerySchema = z.object({ connectionId: z.uuid() });
export type ListExternalPlantsQuery = z.infer<typeof listExternalPlantsQuerySchema>;
