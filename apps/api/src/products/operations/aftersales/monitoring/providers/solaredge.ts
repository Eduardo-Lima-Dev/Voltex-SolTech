import { z } from 'zod';
import { inRange, requestJson } from './http';
import type { DailyReading, MonitoringProvider } from './types';

const BASE = 'https://monitoringapi.solaredge.com';
const NAME = 'SolarEdge';

const sitesSchema = z.object({
  sites: z.object({
    site: z
      .array(z.object({ id: z.union([z.number(), z.string()]), name: z.string() }))
      .default([]),
  }),
});
const energySchema = z.object({
  energy: z.object({
    unit: z.string(),
    values: z.array(z.object({ date: z.string(), value: z.number().nullable() })),
  }),
});
const overviewSchema = z.object({
  overview: z.object({ currentPower: z.object({ power: z.number().nullable() }).optional() }),
});

const credentialSchema = z.object({ apiKey: z.string().min(8) });
const keyOf = (ctx: { credentials: Record<string, string> }) =>
  encodeURIComponent(ctx.credentials.apiKey ?? '');

/**
 * SolarEdge Monitoring API. Contrato montado a partir de wrappers abertos (o PDF oficial não pôde ser lido):
 * os nomes de campo precisam ser conferidos com uma conta real antes de uso em produção.
 */
export const solaredge: MonitoringProvider = {
  key: 'solaredge',
  label: 'SolarEdge Monitoring API',
  official: true,
  docsUrl: 'https://developers.solaredge.com/docs/monitoring/',
  licenseStatus: 'PENDING_REVIEW',
  implemented: true,
  notes:
    'Chave de API gerada pelo administrador no portal SolarEdge (Admin → Acesso à API). Gratuito. Limite: 300 chamadas por dia por conta e por usina; a sincronização usa 2 chamadas por usina a cada 2 horas. Formato das respostas baseado em material de terceiros: validar com conta real.',
  credentialFields: [
    {
      name: 'apiKey',
      label: 'Chave da API',
      secret: true,
      required: true,
      hint: 'Portal SolarEdge → Admin → Acesso à API.',
    },
  ],
  credentialSchema,
  rateBudget: { perDay: 300 },
  minIntervalMinutes: 120,
  async test(ctx) {
    const plants = await solaredge.listPlants!(ctx);
    return { ok: true, message: `Credencial aceita: ${plants.length} usina(s) na conta.` };
  },
  async listPlants(ctx) {
    const json = await requestJson(ctx, NAME, {
      url: `${BASE}/sites/list?size=100&api_key=${keyOf(ctx)}`,
    });
    const parsed = sitesSchema.parse(json);
    return parsed.sites.site.map((s) => ({ id: String(s.id), name: s.name }));
  },
  async readDaily(ctx, externalPlantId, from, to) {
    const json = await requestJson(ctx, NAME, {
      url: `${BASE}/site/${encodeURIComponent(externalPlantId)}/energy?timeUnit=DAY&startDate=${from}&endDate=${to}&api_key=${keyOf(ctx)}`,
    });
    const { energy } = energySchema.parse(json);
    const factor = energy.unit === 'Wh' ? 1000 : energy.unit === 'kWh' ? 1 : null;
    if (factor === null) throw new Error(`${NAME}: unidade de energia inesperada (${energy.unit})`);
    const out: DailyReading[] = [];
    for (const v of energy.values) {
      if (v.value === null) continue;
      const date = v.date.slice(0, 10);
      if (inRange(date, from, to)) out.push({ date, kwh: v.value / factor });
    }
    return out;
  },
  async readNow(ctx, externalPlantId) {
    const json = await requestJson(ctx, NAME, {
      url: `${BASE}/site/${encodeURIComponent(externalPlantId)}/overview?api_key=${keyOf(ctx)}`,
    });
    const power = overviewSchema.parse(json).overview.currentPower?.power ?? null;
    return {
      powerKw: power === null ? null : power / 1000,
      status: power !== null && power > 0 ? 'ONLINE' : 'UNKNOWN',
    };
  },
};
