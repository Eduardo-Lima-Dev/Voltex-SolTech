import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import {
  ANEEL_CSV_URL,
  ANEEL_LICENSE,
  ANEEL_TARIFF_MODALITY,
  AneelSource,
  parseAneelCsv,
  type ParsedAneel,
} from '../reference-data/aneel-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { DataSourcesService } from './data-sources.service';
import { UpdateProposalsService } from './update-proposals.service';

export interface TariffScanResult {
  proposed: number;
  alreadyProposed: number;
  unchanged: number;
  distributorsChecked: number;
}

const empty = (): TariffScanResult => ({
  proposed: 0,
  alreadyProposed: 0,
  unchanged: 0,
  distributorsChecked: 0,
});

/**
 * Procura tarifas novas ou alteradas nos Dados Abertos da ANEEL e abre **propostas** na caixa de atualizações das
 * empresas que têm aquela concessionária. A tarifa só vira dado da empresa quando uma pessoa aprova (ADR-0018).
 * O arquivo (mais de 150 MB) é lido uma vez e comparado com cada empresa.
 */
@Injectable()
export class TariffScanService {
  private readonly logger = new Logger(TariffScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly sources: DataSourcesService,
    private readonly proposals: UpdateProposalsService,
    private readonly aneel: AneelSource,
  ) {}

  /** Para a empresa da requisição (botão "Buscar tarifas novas"). */
  async scanCurrentTenant(): Promise<TariffScanResult> {
    return this.withCollection(async (parsed) => this.compareCurrentTenant(parsed), {
      scope: 'tenant',
    });
  }

  /** Para todas as empresas que têm concessionárias cadastradas (agendamento mensal). */
  async scanAllTenants(): Promise<TariffScanResult> {
    return this.withCollection(
      async (parsed) => {
        const tenants = await this.prisma.system.tenant.findMany({
          where: { status: 'ACTIVE', distributors: { some: { deletedAt: null } } },
          select: { id: true },
        });
        const total = empty();
        for (const { id } of tenants) {
          const r = await this.context.run({ tenantId: id }, () =>
            this.compareCurrentTenant(parsed),
          );
          total.proposed += r.proposed;
          total.alreadyProposed += r.alreadyProposed;
          total.unchanged += r.unchanged;
          total.distributorsChecked += r.distributorsChecked;
        }
        return total;
      },
      { scope: 'all' },
    );
  }

  private async withCollection(
    run: (parsed: ParsedAneel) => Promise<TariffScanResult>,
    summary: Record<string, unknown>,
  ): Promise<TariffScanResult> {
    this.sources.requireEnabled('aneel-tariffs');
    const collection = await this.sources.startCollection('aneel-tariffs', summary);
    try {
      const parsed = await parseAneelCsv(await this.aneel.open());
      const result = await run(parsed);
      await this.sources.finishCollection(collection.id, 'SUCCEEDED', {
        contentHash: createHash('sha256').update(JSON.stringify(parsed.tariffs)).digest('hex'),
        summary: { ...summary, rowsRead: parsed.rowsRead, ...result },
      });
      this.logger.log(`Tarifas ANEEL: ${result.proposed} proposta(s) nova(s)`);
      return result;
    } catch (error) {
      await this.sources.finishCollection(collection.id, 'FAILED', {
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      });
      throw error;
    }
  }

  private async compareCurrentTenant(parsed: ParsedAneel): Promise<TariffScanResult> {
    const result = empty();
    const distributors = await this.prisma.db.distributor.findMany({ where: { deletedAt: null } });
    const byName = new Map(distributors.map((d) => [d.name, d]));
    const seenDistributors = new Set<string>();
    const collectedAt = new Date().toISOString();

    for (const tariff of parsed.tariffs) {
      const distributor = byName.get(tariff.agent);
      if (!distributor) continue;
      seenDistributors.add(distributor.id);
      const existing = await this.prisma.db.tariff.findFirst({
        where: {
          distributorId: distributor.id,
          customerGroup: 'B',
          modality: ANEEL_TARIFF_MODALITY,
          validFrom: tariff.validFrom,
          deletedAt: null,
        },
      });
      if (
        existing &&
        existing.energyCentsPerKwh === tariff.energyCentsPerKwh &&
        existing.validTo?.getTime() === tariff.validTo?.getTime()
      ) {
        result.unchanged += 1;
        continue;
      }
      const source = `ANEEL Dados Abertos — ${tariff.resolution} (TUSD R$ ${tariff.tusdPerMwh.toFixed(2)}/MWh + TE R$ ${tariff.tePerMwh.toFixed(2)}/MWh, sem impostos)`;
      const created = await this.proposals.create({
        type: 'TARIFF',
        title: `${distributor.name}: tarifa residencial ${tariff.energyCentsPerKwh.toFixed(3)} ¢/kWh desde ${tariff.validFrom.toISOString().slice(0, 10)}`,
        target: { distributorId: distributor.id, existingTariffId: existing?.id ?? null },
        proposed: {
          distributorId: distributor.id,
          modality: ANEEL_TARIFF_MODALITY,
          energyCentsPerKwh: tariff.energyCentsPerKwh,
          validFrom: tariff.validFrom.toISOString(),
          validTo: tariff.validTo?.toISOString() ?? null,
          source,
          resolution: tariff.resolution,
        },
        diff: existing
          ? {
              previousEnergyCentsPerKwh: existing.energyCentsPerKwh,
              previousValidTo: existing.validTo?.toISOString() ?? null,
            }
          : null,
        origin: {
          source: 'aneel-tariffs',
          url: ANEEL_CSV_URL,
          collectedAt,
          license: ANEEL_LICENSE,
          attribution:
            'ANEEL, Dados Abertos: tarifas das distribuidoras de energia elétrica (ODbL).',
        },
        dedupeKey: `tariff:${distributor.id}:${tariff.validFrom.toISOString()}:${tariff.energyCentsPerKwh}`,
      });
      if (created) result.proposed += 1;
      else result.alreadyProposed += 1;
    }
    result.distributorsChecked = seenDistributors.size;
    return result;
  }
}
