import type { ZodType } from 'zod';
import type { IntegrationCredentialFieldDto, IntegrationKind } from '@voltex/shared';
import type { IntegrationHttp } from './integration-http';

/** O que o adaptador recebe a cada chamada: credenciais já decifradas e o acesso HTTP. */
export interface AdapterContext {
  tenantId: string;
  connectionId: string;
  credentials: Record<string, string>;
  config: Record<string, unknown>;
  http: IntegrationHttp;
}

export interface AdapterTestResult {
  ok: boolean;
  message: string;
}

export interface AdapterSyncResult {
  /** Resumo gravado na execução (ex.: usinas lidas, dias importados). */
  summary: Record<string, unknown>;
}

/**
 * Um provedor externo. O registro do código declara o que cada um é (oficial ou não, termos, limites); a empresa
 * só informa as credenciais. Todo adaptador nasce DESLIGADO no servidor (`INTEGRATIONS_ENABLED_PROVIDERS`).
 */
export interface IntegrationAdapter {
  key: string;
  kind: IntegrationKind;
  label: string;
  /** `false` = endpoint usado pelos apps do fabricante, sem contrato: pode violar os termos e parar sem aviso. */
  official: boolean;
  docsUrl?: string;
  licenseStatus: 'PENDING_REVIEW' | 'CLEARED' | 'BLOCKED';
  notes?: string;
  credentialFields: IntegrationCredentialFieldDto[];
  credentialSchema: ZodType<Record<string, string>>;
  /** Teto de chamadas por janela, somado às execuções da conexão. Sem teto declarado = sem controle local. */
  rateBudget?: { perDay?: number; perMonth?: number };
  /** Intervalo mínimo entre sincronizações agendadas. */
  minIntervalMinutes: number;
  test(ctx: AdapterContext): Promise<AdapterTestResult>;
  sync?(ctx: AdapterContext): Promise<AdapterSyncResult>;
}
