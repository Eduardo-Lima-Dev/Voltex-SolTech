import type {
  AdapterContext,
  IntegrationAdapter,
} from '../../../../platform/integrations/integration-adapter';
import { PrismaService } from '../../../../platform/prisma/prisma.service';
import { CSV_SOURCE, type MonitoringIngestService } from './monitoring-ingest.service';
import type { MonitoringProvider } from './providers/types';

const DAY = 86_400_000;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Janela de busca: a primeira leitura de uma usina traz um mês; as seguintes, só os últimos dias (config: `lookbackDays`). */
const FIRST_SYNC_DAYS = 31;
const DEFAULT_LOOKBACK_DAYS = 3;

/** Transforma um provedor de monitoramento em adaptador do Integration Hub. */
export function buildMonitoringAdapter(
  provider: MonitoringProvider,
  deps: { prisma: PrismaService; ingest: MonitoringIngestService },
): IntegrationAdapter {
  const { prisma, ingest } = deps;
  const adapter: IntegrationAdapter = {
    key: provider.key,
    kind: 'MONITORING',
    label: provider.label,
    official: provider.official,
    ...(provider.docsUrl ? { docsUrl: provider.docsUrl } : {}),
    licenseStatus: provider.licenseStatus,
    available: provider.implemented,
    notes: provider.notes,
    credentialFields: provider.credentialFields,
    credentialSchema: provider.credentialSchema,
    ...(provider.rateBudget ? { rateBudget: provider.rateBudget } : {}),
    minIntervalMinutes: provider.minIntervalMinutes,
    test: (ctx) => provider.test(ctx),
    ...(provider.listPlants
      ? { listPlants: (ctx: AdapterContext) => provider.listPlants!(ctx) }
      : {}),
  };
  if (!provider.implemented) return adapter;

  adapter.sync = async (ctx) => {
    const links = await prisma.db.plantMonitoringLink.findMany({
      where: { connectionId: ctx.connectionId },
    });
    const lookback = Math.min(
      Math.max(Number(ctx.config.lookbackDays) || DEFAULT_LOOKBACK_DAYS, 1),
      FIRST_SYNC_DAYS,
    );
    const today = new Date();
    const to = isoDay(today);
    const summary = { plants: links.length, days: 0, tickets: 0, errors: [] as string[] };
    let succeeded = 0;
    for (const link of links) {
      try {
        const hasData = await prisma.db.monitoringDaily.count({
          where: { plantId: link.plantId, source: provider.key },
        });
        const from = isoDay(
          new Date(today.getTime() - (hasData ? lookback : FIRST_SYNC_DAYS) * DAY),
        );
        const readings = await provider.readDaily(ctx, link.externalPlantId, from, to);
        summary.days += await ingest.saveDaily(link.plantId, readings, provider.key);
        if (provider.readNow) {
          const now = await provider.readNow(ctx, link.externalPlantId);
          if (now) await ingest.saveNow(link.plantId, now);
        }
        if (provider.readAlarms)
          await ingest.syncAlarms(
            link.plantId,
            await provider.readAlarms(ctx, link.externalPlantId),
          );
        summary.tickets += (await ingest.evaluate(link.plantId)).tickets;
        succeeded += 1;
      } catch (error) {
        summary.errors.push(
          `${link.externalPlantId}: ${error instanceof Error ? error.message : 'falha'}`,
        );
      }
    }
    // Falhou em todas as usinas: a execução conta como falha (retentativa e saúde da conexão).
    if (links.length > 0 && succeeded === 0)
      throw new Error(summary.errors[0] ?? 'Falha na sincronização');
    return { summary };
  };
  return adapter;
}

export { CSV_SOURCE };
