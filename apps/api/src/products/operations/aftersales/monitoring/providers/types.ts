import type { ZodType } from 'zod';
import type {
  IntegrationCredentialFieldDto,
  MonitoringAlarmSeverity,
  MonitoringPlantStatus,
} from '@voltex/shared';
import type {
  AdapterContext,
  AdapterTestResult,
} from '../../../../../platform/integrations/integration-adapter';

export interface ExternalPlant {
  id: string;
  name: string;
}

export interface DailyReading {
  /** `AAAA-MM-DD`. */
  date: string;
  kwh: number;
}

export interface NowReading {
  powerKw: number | null;
  status: MonitoringPlantStatus;
}

export interface ExternalAlarm {
  code: string;
  text: string;
  severity: MonitoringAlarmSeverity;
  openedAt: Date;
}

/**
 * Um provedor de monitoramento. As funções só falam com a API do provedor (por `ctx.http`) e devolvem dados já
 * normalizados (kWh, kW, `AAAA-MM-DD`); quem grava é o `MonitoringIngestService`. Testes trocam o `http` por
 * respostas gravadas da documentação pública.
 */
export interface MonitoringProvider {
  key: string;
  label: string;
  official: boolean;
  docsUrl?: string;
  licenseStatus: 'PENDING_REVIEW' | 'CLEARED' | 'BLOCKED';
  /** Da documentação: como obter a credencial, limites, custo, o que não foi validado. */
  notes: string;
  credentialFields: IntegrationCredentialFieldDto[];
  credentialSchema: ZodType<Record<string, string>>;
  rateBudget?: { perDay?: number; perMonth?: number };
  minIntervalMinutes: number;
  /** `false` = só catalogado (sem documentação ou contrato): não liga e não consulta. */
  implemented: boolean;
  test(ctx: AdapterContext): Promise<AdapterTestResult>;
  listPlants?(ctx: AdapterContext): Promise<ExternalPlant[]>;
  /** Geração diária entre duas datas (inclusive), em kWh. Dia sem leitura não entra. */
  readDaily(
    ctx: AdapterContext,
    externalPlantId: string,
    from: string,
    to: string,
  ): Promise<DailyReading[]>;
  readNow?(ctx: AdapterContext, externalPlantId: string): Promise<NowReading | null>;
  /** Alarmes ABERTOS no momento. Só para provedor que informa o que ainda está aberto. */
  readAlarms?(ctx: AdapterContext, externalPlantId: string): Promise<ExternalAlarm[]>;
}
