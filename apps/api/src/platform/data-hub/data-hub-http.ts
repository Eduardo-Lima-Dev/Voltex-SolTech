import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** A fonte pediu para reduzir o ritmo (HTTP 429): a coleta para e tenta de novo no próximo ciclo. */
export class ExternalRateLimitedError extends Error {
  constructor(url: string) {
    super(`A fonte limitou as requisições (HTTP 429): ${new URL(url).hostname}`);
    this.name = 'ExternalRateLimitedError';
  }
}

export class ExternalFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ExternalFetchError';
  }
}

export interface FetchedBody {
  body: Buffer;
  contentType: string | null;
}

/**
 * Acesso HTTP da Central de Dados. É uma classe abstrata para os testes trocarem por **respostas gravadas** (a CI não
 * usa a internet). Em produção: `FetchDataHubHttp`.
 */
export abstract class DataHubHttp {
  abstract getJson(url: string): Promise<unknown>;
  abstract getBuffer(url: string, options?: { maxBytes?: number }): Promise<FetchedBody>;
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return PRIVATE_V4.some((re) => re.test(address));
  const a = address.toLowerCase();
  return (
    a === '::1' ||
    a === '::' ||
    a.startsWith('fe80:') ||
    a.startsWith('fc') ||
    a.startsWith('fd') ||
    a.startsWith('::ffff:127.')
  );
}

/**
 * Só endereços públicos: a Central busca URLs informadas por pessoas (páginas vigiadas) e não pode virar um caminho
 * para a rede interna (SSRF). Recusa localhost, IPs privados e nomes que resolvem para eles.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Endereço inválido');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new BadRequestException('Só endereços http e https são aceitos');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    throw new BadRequestException('Endereço interno não é permitido');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new BadRequestException('Endereço interno não é permitido');
    return url;
  }
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.some((a) => isPrivateAddress(a.address)))
      throw new BadRequestException('Endereço interno não é permitido');
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Não foi possível resolver o endereço');
  }
  return url;
}

/** Só ASCII e sem parênteses: o firewall do PVGIS (JRC) responde 403 a um User-Agent com acentos ou o sufixo entre parênteses. */
const USER_AGENT = 'VoltexSolTech-DataHub/1.0';
const TIMEOUT_MS = 90_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

@Injectable()
export class FetchDataHubHttp extends DataHubHttp {
  async getJson(url: string): Promise<unknown> {
    const { body } = await this.getBuffer(url, { maxBytes: 60 * 1024 * 1024 });
    try {
      return JSON.parse(body.toString('utf8')) as unknown;
    } catch {
      throw new ExternalFetchError(`Resposta de ${new URL(url).hostname} não é JSON`);
    }
  }

  async getBuffer(url: string, options: { maxBytes?: number } = {}): Promise<FetchedBody> {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      });
    } catch (error) {
      throw new ExternalFetchError(
        `Não foi possível acessar ${new URL(url).hostname}: ${error instanceof Error ? error.message : 'erro de rede'}`,
      );
    }
    if (response.status === 429) throw new ExternalRateLimitedError(url);
    if (!response.ok)
      throw new ExternalFetchError(
        `${new URL(url).hostname} respondeu ${response.status}`,
        response.status,
      );
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new ExternalFetchError('Resposta grande demais');
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) throw new ExternalFetchError('Resposta grande demais');
    return { body, contentType: response.headers.get('content-type') };
  }
}
