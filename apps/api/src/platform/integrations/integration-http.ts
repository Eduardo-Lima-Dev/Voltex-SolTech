import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import {
  ExternalFetchError,
  ExternalRateLimitedError,
  assertPublicUrl,
} from '../data-hub/data-hub-http';

export { ExternalFetchError, ExternalRateLimitedError };

export interface IntegrationRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** Objeto vira JSON; string vai como está (ex.: formulário já codificado). */
  body?: unknown;
  timeoutMs?: number;
}

export interface IntegrationResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  /** `null` quando o corpo não é JSON. */
  json: unknown;
}

/**
 * Acesso HTTP dos adaptadores. É uma classe abstrata para os testes trocarem por **respostas gravadas** (a CI não usa
 * a internet nem credenciais reais). Em produção: `FetchIntegrationHttp`.
 */
export abstract class IntegrationHttp {
  abstract request(input: IntegrationRequest): Promise<IntegrationResponse>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BYTES = 10 * 1024 * 1024;
const USER_AGENT = 'VoltexSolTech-Integrations/1.0';

@Injectable()
export class FetchIntegrationHttp extends IntegrationHttp {
  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async request(input: IntegrationRequest): Promise<IntegrationResponse> {
    // A API do provedor é pública. Instâncias auto-hospedadas (ex.: assinatura) podem ficar numa rede privada:
    // só com a liberação explícita do servidor.
    if (!this.config.get('INTEGRATIONS_ALLOW_PRIVATE_HOSTS', { infer: true }))
      await assertPublicUrl(input.url);
    else if (!/^https?:\/\//i.test(input.url))
      throw new BadRequestException('Só endereços http e https são aceitos');
    const host = new URL(input.url).hostname;
    const hasBody = input.body !== undefined && input.method !== 'GET';
    const body = !hasBody
      ? undefined
      : typeof input.body === 'string'
        ? input.body
        : JSON.stringify(input.body);
    let response: Response;
    try {
      response = await fetch(input.url, {
        method: input.method ?? 'GET',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json, */*',
          ...(hasBody && typeof input.body !== 'string'
            ? { 'content-type': 'application/json' }
            : {}),
          ...input.headers,
        },
        body,
        signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        redirect: 'follow',
      });
    } catch (error) {
      throw new ExternalFetchError(
        `Não foi possível acessar ${host}: ${error instanceof Error ? error.message : 'erro de rede'}`,
      );
    }
    if (response.status === 429) throw new ExternalRateLimitedError(input.url);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw new ExternalFetchError('Resposta grande demais');
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > MAX_BYTES) throw new ExternalFetchError('Resposta grande demais');
    const text = raw.toString('utf8');
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      text,
      json,
    };
  }
}
