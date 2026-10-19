import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateDistributorInput,
  CreateSolarResourceData,
  CreateTariffData,
  ImportSolarResourcesData,
  UpdateDistributorInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

type SolarResourceRow = {
  id: string;
  tenantId: string;
  name: string;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  hspMonthly: unknown;
  source: string;
  plane: string;
  createdAt: Date;
};

/** Concessionárias, tarifas com vigência e recurso solar (HSP): dados de referência do tenant. */
@Injectable()
export class ReferenceDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  // ---- Concessionárias ----
  listDistributors() {
    return this.prisma.db.distributor.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async createDistributor(input: CreateDistributorInput) {
    return this.prisma.db.distributor.create({
      data: {
        tenantId: this.context.requireTenantId(),
        name: input.name,
        state: input.state ?? null,
      },
    });
  }

  async updateDistributor(id: string, input: UpdateDistributorInput) {
    await this.getDistributor(id);
    return this.prisma.db.distributor.update({ where: { id }, data: input });
  }

  async removeDistributor(id: string) {
    await this.getDistributor(id);
    const inUse = await this.prisma.db.tariff.count({
      where: { distributorId: id, deletedAt: null },
    });
    if (inUse > 0) throw new ConflictException('A concessionária possui tarifas cadastradas');
    return this.prisma.db.distributor.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async getDistributor(id: string) {
    const row = await this.prisma.db.distributor.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Concessionária não encontrada');
    return row;
  }

  // ---- Tarifas ----
  listTariffs(filter: { distributorId?: string; customerGroup?: 'A' | 'B' }) {
    return this.prisma.db.tariff.findMany({
      where: {
        deletedAt: null,
        ...(filter.distributorId ? { distributorId: filter.distributorId } : {}),
        ...(filter.customerGroup ? { customerGroup: filter.customerGroup } : {}),
      },
      orderBy: [{ distributorId: 'asc' }, { validFrom: 'desc' }],
    });
  }

  async createTariff(input: CreateTariffData) {
    await this.getDistributor(input.distributorId);
    const validFrom = input.validFrom;
    const validTo = input.validTo ?? null;
    if (validTo && validTo.getTime() <= validFrom.getTime()) {
      throw new BadRequestException('O fim da vigência deve ser depois do início');
    }
    return this.prisma.db.$transaction(async (tx) => {
      const created = await tx.tariff.create({
        data: {
          tenantId: this.context.requireTenantId(),
          distributorId: input.distributorId,
          customerGroup: input.customerGroup,
          modality: input.modality ?? null,
          energyCentsPerKwh: input.energyCentsPerKwh,
          validFrom,
          validTo,
          source: input.source,
        },
      });
      await this.audit.record(
        { action: 'tariff.created', entity: 'Tariff', entityId: created.id, after: created },
        tx,
      );
      return created;
    });
  }

  async removeTariff(id: string) {
    const row = await this.prisma.db.tariff.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Tarifa não encontrada');
    // Exclusão lógica: cálculos antigos guardam o valor usado, mas o registro continua rastreável.
    await this.prisma.db.$transaction(async (tx) => {
      await tx.tariff.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(
        { action: 'tariff.deleted', entity: 'Tariff', entityId: id, before: row },
        tx,
      );
    });
    return { id };
  }

  // ---- Recurso solar ----
  async listSolarResources(query: { page: number; pageSize: number; search?: string | undefined }) {
    const where = {
      deletedAt: null,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.solarResource.findMany({
        where,
        orderBy: { name: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.db.solarResource.count({ where }),
    ]);
    return toPaginated(
      rows.map((r) => this.toSolarResource(r)),
      total,
      query,
    );
  }

  async getSolarResource(id: string) {
    const row = await this.prisma.db.solarResource.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Local de irradiação não encontrado');
    return this.toSolarResource(row);
  }

  async upsertSolarResource(
    input: CreateSolarResourceData,
  ): Promise<{ resource: ReturnType<ReferenceDataService['toSolarResource']>; created: boolean }> {
    const state = input.state ?? null;
    const existing = await this.prisma.db.solarResource.findFirst({
      where: { name: input.name, state, deletedAt: null },
    });
    const data = {
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      hspMonthly: input.hspMonthly as unknown as object,
      source: input.source,
      plane: input.plane,
    };
    const row = existing
      ? await this.prisma.db.solarResource.update({ where: { id: existing.id }, data })
      : await this.prisma.db.solarResource.create({
          data: { tenantId: this.context.requireTenantId(), name: input.name, state, ...data },
        });
    return { resource: this.toSolarResource(row), created: !existing };
  }

  async importSolarResources(input: ImportSolarResourcesData) {
    let created = 0;
    let updated = 0;
    for (const row of input.rows) {
      const result = await this.upsertSolarResource(row);
      if (result.created) created++;
      else updated++;
    }
    await this.audit.record({
      action: 'solar_resource.imported',
      entity: 'SolarResource',
      after: { created, updated, total: input.rows.length },
    });
    return { created, updated };
  }

  async removeSolarResource(id: string) {
    await this.getSolarResource(id);
    await this.prisma.db.solarResource.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id };
  }

  private toSolarResource(row: SolarResourceRow) {
    return { ...row, hspMonthly: row.hspMonthly as number[] };
  }
}
