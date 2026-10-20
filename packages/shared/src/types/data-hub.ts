import type {
  UpdateProposalStatus,
  UpdateProposalType,
  WeatherSourceKey,
} from '../schemas/data-hub.js';

/** Contratos JSON da Central de Dados Externos (datas em ISO 8601). */

export interface DataSourceDto {
  key: string;
  label: string;
  baseUrl: string;
  license: string;
  attribution: string;
  /** `PENDING_REVIEW`: termos não conferidos; `CLEARED`: conferidos; `BLOCKED`: não usar. */
  licenseStatus: 'PENDING_REVIEW' | 'CLEARED' | 'BLOCKED';
  termsCheckedAt: string | null;
  termsCheckedBy: string | null;
  /** A fonte só consulta a internet quando ligada na configuração do servidor (`DATA_HUB_ENABLED_SOURCES`). */
  enabled: boolean;
  notes: string | null;
  lastCollection: {
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
  } | null;
}

export interface WeatherSummaryDto {
  /** kWh/m²·dia, jan a dez (plano horizontal). */
  ghiKwhM2Day: (number | null)[];
  tempMeanC: (number | null)[];
  /** Mínima e máxima mensais conforme a fonte: não são a temperatura de projeto. */
  tempMinC: (number | null)[] | number | null;
  tempMaxC: (number | null)[] | number | null;
  elevationM: number | null;
  /** Presente quando a série é horária. */
  hours?: number;
  missingHours?: number;
}

export interface WeatherResultDto {
  source: WeatherSourceKey;
  kind: 'CLIMATOLOGY' | 'HOURLY';
  latitude: number;
  longitude: number;
  period: string;
  summary: WeatherSummaryDto;
  fetchedAt: string;
  /** `true` quando veio do cache, sem consultar a internet agora. */
  cached: boolean;
  attribution: string;
  license: string;
  licenseStatus: DataSourceDto['licenseStatus'];
  /** Avisos que a tela deve mostrar (termos não conferidos, tempo em hora solar local...). */
  warnings: string[];
}

export interface HorizonResultDto {
  source: 'pvgis';
  latitude: number;
  longitude: number;
  elevationM: number | null;
  points: { azimuthDegrees: number; heightDegrees: number }[];
  fetchedAt: string;
  cached: boolean;
  attribution: string;
  licenseStatus: DataSourceDto['licenseStatus'];
  warnings: string[];
}

export interface SourceWatchDto {
  id: string;
  label: string;
  url: string;
  kind: 'NORM' | 'LAW' | 'OTHER';
  enabled: boolean;
  checkedAt: string | null;
  changedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface UpdateProposalDto {
  id: string;
  type: UpdateProposalType;
  status: UpdateProposalStatus;
  title: string;
  target: Record<string, unknown> | null;
  proposed: Record<string, unknown>;
  diff: Record<string, unknown> | null;
  origin: {
    source: string;
    url?: string;
    collectedAt: string;
    contentHash?: string;
    license?: string;
    attribution?: string;
  };
  decidedById: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
}

export interface TariffScanResultDto {
  proposed: number;
  alreadyProposed: number;
  unchanged: number;
  distributorsChecked: number;
}
