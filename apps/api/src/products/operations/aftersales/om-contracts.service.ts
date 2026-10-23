import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { OmContract } from '@voltex/database';
import type { CreateOmContractInput, OmContractDto, UpdateOmContractInput } from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { dateOnly, daysLeft, isoDay } from './dates';

export const toContractDto = (c: OmContract, plantName: string): OmContractDto => ({
  id: c.id,
  plantId: c.plantId,
  plantName,
  accountId: c.accountId,
  title: c.title,
  status: c.status,
  startsOn: isoDay(c.startsOn),
  endsOn: isoDay(c.endsOn),
  daysLeft: daysLeft(c.endsOn),
  monthlyCents: c.monthlyCents,
  billing: c.billing,
  autoRenew: c.autoRenew,
  notes: c.notes,
  renewalOpportunityId: c.renewalOpportunityId,
});

/** Contratos de O&M da planta. Valor, cobrança e documento são informados à mão: não há cobrança integrada. */
@Injectable()
export class OmContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async list(status?: 'ACTIVE' | 'EXPIRED' | 'CANCELLED'): Promise<OmContractDto[]> {
    const rows = await this.prisma.db.omContract.findMany({
      where: status ? { status } : {},
      orderBy: { endsOn: 'asc' },
      take: 500,
    });
    const plants = await this.prisma.db.plant.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.plantId))] } },
      select: { id: true, name: true },
    });
    return rows.map((c) => toContractDto(c, plants.find((p) => p.id === c.plantId)?.name ?? '—'));
  }

  async create(input: CreateOmContractInput): Promise<OmContractDto> {
    const plant = await this.prisma.db.plant.findFirst({ where: { id: input.plantId } });
    if (!plant) throw new NotFoundException('Planta não encontrada');
    if (input.documentId) {
      const doc = await this.prisma.db.document.findFirst({
        where: { id: input.documentId, deletedAt: null },
        select: { id: true },
      });
      if (!doc) throw new UnprocessableEntityException('O documento do contrato não existe.');
    }
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.omContract.create({
        data: {
          tenantId: this.context.requireTenantId(),
          plantId: plant.id,
          accountId: plant.accountId,
          title: input.title,
          startsOn: dateOnly(input.startsOn),
          endsOn: dateOnly(input.endsOn),
          monthlyCents: input.monthlyCents,
          billing: input.billing ?? null,
          autoRenew: input.autoRenew ?? false,
          notes: input.notes ?? null,
          documentId: input.documentId ?? null,
        },
      });
      await tx.plantEvent.create({
        data: {
          tenantId: plant.tenantId,
          plantId: plant.id,
          type: 'OM_CONTRACT',
          text: `Contrato de O&M cadastrado: ${created.title} (até ${isoDay(created.endsOn)}).`,
          data: { contractId: created.id },
          actorId: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'om_contract.created',
          entity: 'OmContract',
          entityId: created.id,
          after: { plantId: plant.id, monthlyCents: created.monthlyCents },
        },
        tx,
      );
      return created;
    });
    return toContractDto(row, plant.name);
  }

  async update(id: string, input: UpdateOmContractInput): Promise<OmContractDto> {
    const contract = await this.prisma.db.omContract.findFirst({ where: { id } });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (input.endsOn && dateOnly(input.endsOn) <= contract.startsOn)
      throw new UnprocessableEntityException('O fim deve ser depois do início.');
    const row = await this.prisma.db.$transaction(async (tx) => {
      const next = await tx.omContract.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.endsOn !== undefined
            ? {
                endsOn: dateOnly(input.endsOn),
                // Prazo estendido: o contrato volta a valer e o aviso de renovação pode vir de novo.
                ...(dateOnly(input.endsOn) > contract.endsOn
                  ? { status: 'ACTIVE' as const, renewalNotifiedAt: null }
                  : {}),
              }
            : {}),
          ...(input.monthlyCents !== undefined ? { monthlyCents: input.monthlyCents } : {}),
          ...(input.billing !== undefined ? { billing: input.billing } : {}),
          ...(input.autoRenew !== undefined ? { autoRenew: input.autoRenew } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await this.audit.record(
        { action: 'om_contract.updated', entity: 'OmContract', entityId: id, after: input },
        tx,
      );
      return next;
    });
    const plant = await this.prisma.db.plant.findFirst({
      where: { id: row.plantId },
      select: { name: true },
    });
    return toContractDto(row, plant?.name ?? '—');
  }
}
