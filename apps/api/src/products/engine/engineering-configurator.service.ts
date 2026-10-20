import { Injectable } from '@nestjs/common';
import type {
  EngineeringDesign,
  InverterSpec,
  ModuleSpec,
  SuggestConfigurationsResult,
} from '@voltex/shared';
import { suggestConfigurations, type Candidate } from '@voltex/solar-engine';
import { PriceListService } from '../../platform/catalog/price-list.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { EngineeringVersionsService } from './engineering-versions.service';

export interface SuggestRequest {
  surfaceId: string;
  targetKwp: number;
  moduleIds?: string[] | undefined;
  inverterIds?: string[] | undefined;
  maxInverters: number;
  limit: number;
  design?: EngineeringDesign | undefined;
}

/** Gerador de configurações (ENG-F25) sobre o catálogo **aprovado**, com preço vigente ou custo de referência. */
@Injectable()
export class EngineeringConfiguratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: EngineeringVersionsService,
    private readonly prices: PriceListService,
  ) {}

  async suggest(versionId: string, input: SuggestRequest): Promise<SuggestConfigurationsResult> {
    const version = await this.versions.require(versionId);
    const design = input.design ?? (version.design as unknown as EngineeringDesign);
    const rules = await this.versions.designRules(design);

    const approved = (kind: 'MODULE' | 'INVERTER', ids: string[] | undefined) =>
      this.prisma.db.equipmentItem.findMany({
        where: { kind, status: 'APPROVED', ...(ids?.length ? { id: { in: ids } } : {}) },
        orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
        take: 40,
      });
    const [modules, inverters] = await Promise.all([
      approved('MODULE', input.moduleIds),
      approved('INVERTER', input.inverterIds),
    ]);

    const cost = async (id: string, reference: number | null): Promise<number | null> =>
      (await this.prices.currentPrice(id))?.priceCents ?? reference;
    const moduleCandidates: Candidate<ModuleSpec>[] = await Promise.all(
      modules.map(async (m) => ({
        id: m.id,
        spec: m.spec as unknown as ModuleSpec,
        costCents: await cost(m.id, m.referenceCostCents),
        label: `${m.manufacturer} ${m.model}`,
      })),
    );
    const inverterCandidates: Candidate<InverterSpec>[] = await Promise.all(
      inverters.map(async (i) => ({
        id: i.id,
        spec: i.spec as unknown as InverterSpec,
        costCents: await cost(i.id, i.referenceCostCents),
        label: `${i.manufacturer} ${i.model}`,
      })),
    );

    return suggestConfigurations({
      design,
      surfaceId: input.surfaceId,
      targetKwp: input.targetKwp,
      modules: moduleCandidates,
      inverters: inverterCandidates,
      parameters: rules.parameters,
      maxInverters: input.maxInverters,
      limit: input.limit,
    });
  }
}
