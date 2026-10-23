import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AdapterContext } from '../../../../../platform/integrations/integration-adapter';
import { monthsBetween, inRange, requestJson } from './http';
import type { DailyReading, MonitoringProvider, NowReading } from './types';

const BASE = 'https://api.apsystemsema.com:9282';
const NAME = 'APsystems';
const METHOD = 'HmacSHA256';

const credentialSchema = z.object({
  appId: z.string().min(8),
  appSecret: z.string().min(6),
  systemId: z.string().optional().default(''),
});

const envelope = z.object({ code: z.number(), data: z.unknown() });
const detailsSchema = z.object({ light: z.number().optional() });

/** Assinatura do manual v1.8: só o ÚLTIMO segmento do caminho entra na string assinada. */
export function apsystemsHeaders(
  appId: string,
  appSecret: string,
  path: string,
  now: Date = new Date(),
  nonce: string = randomUUID().replace(/-/g, ''),
): Record<string, string> {
  const timestamp = String(now.getTime());
  const lastSegment = path.split('/').filter(Boolean).at(-1) ?? '';
  const toSign = [timestamp, nonce, appId, lastSegment, 'GET', METHOD].join('/');
  const signature = createHmac('sha256', appSecret).update(toSign, 'utf8').digest('base64');
  return {
    'X-CA-AppId': appId,
    'X-CA-Timestamp': timestamp,
    'X-CA-Nonce': nonce,
    'X-CA-Signature-Method': METHOD,
    'X-CA-Signature': signature,
  };
}

async function call(ctx: AdapterContext, path: string): Promise<unknown> {
  const json = await requestJson(ctx, NAME, {
    url: `${BASE}${path}`,
    headers: apsystemsHeaders(
      ctx.credentials.appId ?? '',
      ctx.credentials.appSecret ?? '',
      path.split('?')[0] ?? '',
    ),
  });
  // O provedor responde HTTP 200 mesmo com erro: quem vale é o `code`.
  const body = envelope.parse(json);
  if (body.code !== 0) throw new Error(`${NAME}: erro ${body.code} do provedor`);
  return body.data;
}

function mapLight(light: number | undefined): NowReading['status'] {
  // 1 verde, 2 amarelo (alarmes), 3 vermelho (ECU sem rede), 4 cinza (nunca enviou dados).
  if (light === 1) return 'ONLINE';
  if (light === 2) return 'ALARM';
  if (light === 3) return 'OFFLINE';
  return 'UNKNOWN';
}

/**
 * APsystems OpenAPI (manual oficial v1.8, 2025-07-18). Não há listagem de usinas nem alarmes na API: o ID da usina
 * (`sid` do EMA) é informado pela empresa. Potência instantânea só existe por ECU e não é usada aqui.
 */
export const apsystems: MonitoringProvider = {
  key: 'apsystems',
  label: 'APsystems OpenAPI',
  official: true,
  docsUrl:
    'https://file.apsystemsema.com:8083/apsystems/resource/openapi/Apsystems_OpenAPI_User_Manual_End_User_EN.pdf',
  licenseStatus: 'PENDING_REVIEW',
  implemented: true,
  notes:
    'App Id e App Secret pedidos por e-mail ao suporte da APsystems (explicando o uso); o manual diz que há cobrança conforme volume de acessos. A API não lista usinas: informe o ID (SID) de cada usina do EMA. Limite numérico não documentado.',
  credentialFields: [
    {
      name: 'appId',
      label: 'App Id',
      secret: false,
      required: true,
      hint: 'Recebido por e-mail da APsystems (32 caracteres).',
    },
    {
      name: 'appSecret',
      label: 'App Secret',
      secret: true,
      required: true,
      hint: 'Recebido junto com o App Id.',
    },
    {
      name: 'systemId',
      label: 'ID de uma usina (opcional)',
      secret: false,
      required: false,
      hint: 'Só para testar a credencial: a API não lista usinas.',
    },
  ],
  credentialSchema,
  minIntervalMinutes: 120,
  async test(ctx) {
    const sid = ctx.credentials.systemId;
    if (!sid)
      return {
        ok: false,
        message:
          'A APsystems não lista usinas: informe o ID de uma usina (campo opcional) para validar a credencial.',
      };
    const data = await call(ctx, `/user/api/v2/systems/details/${encodeURIComponent(sid)}`);
    detailsSchema.parse(data);
    return { ok: true, message: 'Credencial aceita: usina encontrada.' };
  },
  async readDaily(ctx, externalPlantId, from, to) {
    const out: DailyReading[] = [];
    for (const month of monthsBetween(from.slice(0, 7), to.slice(0, 7))) {
      const data = await call(
        ctx,
        `/user/api/v2/systems/energy/${encodeURIComponent(externalPlantId)}?energy_level=daily&date_range=${month}`,
      );
      const values = z.array(z.string()).parse(data);
      // A resposta não traz as datas: o índice é o dia do mês (dia 1 = posição 0).
      values.forEach((text, index) => {
        const kwh = Number(text);
        if (!Number.isFinite(kwh)) return;
        const date = `${month}-${String(index + 1).padStart(2, '0')}`;
        if (inRange(date, from, to)) out.push({ date, kwh });
      });
    }
    return out;
  },
  async readNow(ctx, externalPlantId) {
    const data = await call(
      ctx,
      `/user/api/v2/systems/details/${encodeURIComponent(externalPlantId)}`,
    );
    return { powerKw: null, status: mapLight(detailsSchema.parse(data).light) };
  },
};
