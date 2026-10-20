import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@voltex/database';
import {
  DomainEvent,
  type DecideProposalInput,
  type ListProposalsQuery,
  type UpdateProposalDto,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus.service';
import { PrismaService, type ScopedPrismaClient } from '../prisma/prisma.service';

export interface NewProposal {
  type: UpdateProposalDto['type'];
  title: string;
  target?: Record<string, unknown> | null;
  proposed: Record<string, unknown>;
  diff?: Record<string, unknown> | null;
  origin: UpdateProposalDto['origin'];
  dedupeKey: string;
}

type ProposalRow = Awaited<ReturnType<ScopedPrismaClient['updateProposal']['findFirstOrThrow']>>;

export const toProposalDto = (row: ProposalRow): UpdateProposalDto => ({
  id: row.id,
  type: row.type,
  status: row.status,
  title: row.title,
  target: row.target as UpdateProposalDto['target'],
  proposed: row.proposed as UpdateProposalDto['proposed'],
  diff: row.diff as UpdateProposalDto['diff'],
  origin: row.origin as UpdateProposalDto['origin'],
  decidedById: row.decidedById,
  decidedAt: row.decidedAt?.toISOString() ?? null,
  decisionReason: row.decisionReason,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Caixa de atualizações: tudo que vem de fora espera aqui por uma decisão humana (ADR-0018). Aprovar aplica a
 * proposta como dado versionado da empresa; descartar exige motivo. Nada é aplicado sem decisão registrada.
 */
@Injectable()
export class UpdateProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Cria a proposta, uma só por fato (`dedupeKey`). Devolve `null` se já existia. */
  async create(
    input: NewProposal,
    tx: Pick<ScopedPrismaClient, 'updateProposal'> = this.prisma.db,
  ): Promise<ProposalRow | null> {
    try {
      return await tx.updateProposal.create({
        data: {
          tenantId: this.context.requireTenantId(),
          type: input.type,
          title: input.title,
          target: (input.target ?? undefined) as Prisma.InputJsonValue | undefined,
          proposed: input.proposed as Prisma.InputJsonValue,
          diff: (input.diff ?? undefined) as Prisma.InputJsonValue | undefined,
          origin: input.origin as unknown as Prisma.InputJsonValue,
          dedupeKey: input.dedupeKey,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return null;
      throw error;
    }
  }

  async list(query: ListProposalsQuery): Promise<UpdateProposalDto[]> {
    const rows = await this.prisma.db.updateProposal.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toProposalDto);
  }

  async get(id: string): Promise<UpdateProposalDto> {
    const row = await this.prisma.db.updateProposal.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Proposta não encontrada');
    return toProposalDto(row);
  }

  async decide(id: string, input: DecideProposalInput): Promise<UpdateProposalDto> {
    const row = await this.prisma.db.updateProposal.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Proposta não encontrada');
    if (row.status !== 'PENDING') throw new ConflictException('Esta proposta já foi decidida');
    const approve = input.decision === 'APPROVE';
    if (approve && row.type !== 'TARIFF' && row.type !== 'WATCH_CHANGE')
      throw new ConflictException('Este tipo de proposta ainda não tem aplicação automática');

    const decided = await this.prisma.db.$transaction(async (tx) => {
      if (approve && row.type === 'TARIFF') await this.applyTariff(tx, row);
      const updated = await tx.updateProposal.update({
        where: { id },
        data: {
          status: approve ? 'APPROVED' : 'DISCARDED',
          decidedById: this.context.userId ?? null,
          decidedAt: new Date(),
          decisionReason: input.reason ?? null,
        },
      });
      await this.audit.record(
        {
          action: approve ? 'update_proposal.approved' : 'update_proposal.discarded',
          entity: 'UpdateProposal',
          entityId: id,
          before: { status: 'PENDING', type: row.type },
          after: { status: updated.status, reason: input.reason ?? null, title: row.title },
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.UPDATE_PROPOSAL_DECIDED,
          payload: {
            proposalId: id,
            type: row.type,
            decision: input.decision,
            origin: row.origin,
          },
        },
        tx,
      );
      return updated;
    });
    return toProposalDto(decided);
  }

  /** Aprovar uma tarifa proposta cria ou atualiza a tarifa da distribuidora, com a fonte da proposta. */
  private async applyTariff(
    tx: Pick<ScopedPrismaClient, 'tariff' | 'distributor'>,
    row: ProposalRow,
  ): Promise<void> {
    const p = row.proposed as {
      distributorId: string;
      modality: string;
      energyCentsPerKwh: number;
      validFrom: string;
      validTo: string | null;
      source: string;
    };
    const distributor = await tx.distributor.findFirst({
      where: { id: p.distributorId, deletedAt: null },
    });
    if (!distributor)
      throw new ConflictException('A concessionária desta proposta não existe mais');
    const validFrom = new Date(p.validFrom);
    const existing = await tx.tariff.findFirst({
      where: {
        distributorId: p.distributorId,
        customerGroup: 'B',
        modality: p.modality,
        validFrom,
        deletedAt: null,
      },
    });
    const data = {
      energyCentsPerKwh: p.energyCentsPerKwh,
      validTo: p.validTo ? new Date(p.validTo) : null,
      source: p.source,
    };
    if (existing) await tx.tariff.update({ where: { id: existing.id }, data });
    else
      await tx.tariff.create({
        data: {
          tenantId: this.context.requireTenantId(),
          distributorId: p.distributorId,
          customerGroup: 'B',
          modality: p.modality,
          validFrom,
          ...data,
        },
      });
  }
}
