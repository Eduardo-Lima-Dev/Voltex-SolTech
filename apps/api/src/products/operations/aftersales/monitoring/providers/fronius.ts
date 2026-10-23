import { z } from 'zod';
import { inRange, monthsBetween, requestJson } from './http';
import type { DailyReading, MonitoringProvider } from './types';

const BASE = 'https://api.solarweb.com/swqapi';
const NAME = 'Fronius Solar.web';

const credentialSchema = z.object({
  accessKeyId: z.string().min(8),
  accessKeyValue: z.string().min(8),
});

const listSchema = z.object({
  pvSystems: z.array(z.object({ pvSystemId: z.string(), name: z.string() })).default([]),
});
const aggSchema = z.object({
  data: z.object({
    channels: z
      .array(z.object({ channelName: z.string(), unit: z.string(), values: z.unknown() }))
      .default([]),
  }),
});
const flowSchema = z.object({
  status: z.object({ isOnline: z.boolean().optional() }).optional(),
  data: z
    .object({
      channels: z
        .array(
          z.object({
            channelName: z.string(),
            unit: z.string().optional(),
            value: z.number().nullable(),
          }),
        )
        .default([]),
    })
    .optional(),
});

const headers = (ctx: { credentials: Record<string, string> }) => ({
  AccessKeyId: ctx.credentials.accessKeyId ?? '',
  AccessKeyValue: ctx.credentials.accessKeyValue ?? '',
});

/**
 * O swagger define `values` mas não o formato: aceita o mapa `{ "<dia>": valor }` (dia do mês ou data ISO) e a lista
 * de números (posição = dia). Qualquer outra forma é recusada com erro claro, em vez de gravar dado errado.
 */
export function parseFroniusValues(
  values: unknown,
  month: string,
): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const push = (day: string, raw: unknown) => {
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(value)) return;
    const date = /^\d{4}-\d{2}-\d{2}/.test(day)
      ? day.slice(0, 10)
      : `${month}-${day.padStart(2, '0')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out.push({ date, value });
  };
  if (Array.isArray(values)) values.forEach((v, i) => push(String(i + 1), v));
  else if (values && typeof values === 'object')
    for (const [day, v] of Object.entries(values)) push(day, v);
  else throw new Error(`${NAME}: formato de "values" inesperado`);
  return out;
}

export const fronius: MonitoringProvider = {
  key: 'fronius',
  label: 'Fronius Solar.web Query API',
  official: true,
  docsUrl: 'https://api.solarweb.com/swqapi/index.html',
  licenseStatus: 'PENDING_REVIEW',
  implemented: true,
  notes:
    'Chave de acesso (Key ID e valor) criada em Solar.web → Configurações → REST API. O acesso é pago por faixa de instalações (consulte a Fronius). Caminhos e cabeçalhos vêm do swagger oficial; o formato do campo "values" não é definido nele e a leitura diária deve ser validada com conta real.',
  credentialFields: [
    {
      name: 'accessKeyId',
      label: 'AccessKeyId',
      secret: false,
      required: true,
      hint: 'Solar.web → REST API Settings.',
    },
    {
      name: 'accessKeyValue',
      label: 'AccessKeyValue',
      secret: true,
      required: true,
      hint: 'Mostrado uma vez ao criar a chave.',
    },
  ],
  credentialSchema,
  minIntervalMinutes: 60,
  async test(ctx) {
    const plants = await fronius.listPlants!(ctx);
    return { ok: true, message: `Credencial aceita: ${plants.length} usina(s) na conta.` };
  },
  async listPlants(ctx) {
    const json = await requestJson(ctx, NAME, {
      url: `${BASE}/pvsystems?offset=0&limit=100`,
      headers: headers(ctx),
    });
    return listSchema.parse(json).pvSystems.map((p) => ({ id: p.pvSystemId, name: p.name }));
  },
  async readDaily(ctx, externalPlantId, from, to) {
    const out: DailyReading[] = [];
    for (const month of monthsBetween(from.slice(0, 7), to.slice(0, 7))) {
      const [year, mm] = month.split('-') as [string, string];
      const json = await requestJson(ctx, NAME, {
        url: `${BASE}/pvsystems/${encodeURIComponent(externalPlantId)}/AggData/years/${year}/months/${Number(mm)}/days?Channel=EnergyProductionTotal`,
        headers: headers(ctx),
      });
      const channel = aggSchema
        .parse(json)
        .data.channels.find((c) => c.channelName === 'EnergyProductionTotal');
      if (!channel) continue;
      const factor = channel.unit === 'Wh' ? 1000 : channel.unit === 'kWh' ? 1 : null;
      if (factor === null) throw new Error(`${NAME}: unidade inesperada (${channel.unit})`);
      for (const { date, value } of parseFroniusValues(channel.values, month))
        if (inRange(date, from, to)) out.push({ date, kwh: value / factor });
    }
    return out;
  },
  async readNow(ctx, externalPlantId) {
    const json = await requestJson(ctx, NAME, {
      url: `${BASE}/pvsystems/${encodeURIComponent(externalPlantId)}/flowdata`,
      headers: headers(ctx),
    });
    const flow = flowSchema.parse(json);
    const power = flow.data?.channels.find((c) => c.channelName === 'PowerPV')?.value ?? null;
    const online = flow.status?.isOnline;
    return {
      powerKw: power === null ? null : power / 1000,
      status: online === undefined ? 'UNKNOWN' : online ? 'ONLINE' : 'OFFLINE',
    };
  },
};
