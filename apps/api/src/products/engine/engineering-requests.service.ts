import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { EngineeringRequestListItemDto, ListEngineeringRequestsQuery } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { toRequestDto } from './engineering.mapper';

/** Fila de pedidos de engenharia abertos pelo CRM (semáforo amarelo). */
@Injectable()
export class EngineeringRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  private include = {
    opportunity: {
      select: { title: true, projectCode: true, account: { select: { name: true } } },
    },
  } as const;

  private async names(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  async list(query: ListEngineeringRequestsQuery): Promise<EngineeringRequestListItemDto[]> {
    const rows = await this.prisma.db.engineeringRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.mine && this.context.userId ? { assigneeId: this.context.userId } : {}),
      },
      include: this.include,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = await this.names(rows.map((r) => r.assigneeId));
    return rows.map((r) =>
      toRequestDto(r, r.assigneeId ? (names.get(r.assigneeId) ?? null) : null),
    );
  }

  private async require(id: string) {
    const row = await this.prisma.db.engineeringRequest.findFirst({
      where: { id },
      include: this.include,
    });
    if (!row) throw new NotFoundException('Pedido de engenharia não encontrado');
    return row;
  }

  /** Pega o pedido para si. Quem já pegou mantém; só o responsável técnico reatribui (rota própria da fase 9J). */
  async assign(id: string): Promise<EngineeringRequestListItemDto> {
    const row = await this.require(id);
    if (row.status === 'DONE' || row.status === 'CANCELLED')
      throw new ConflictException('Este pedido já foi encerrado');
    const userId = this.context.userId ?? null;
    if (row.assigneeId && row.assigneeId !== userId)
      throw new ConflictException('Este pedido já está com outro engenheiro');
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.engineeringRequest.update({
        where: { id },
        data: { assigneeId: userId, status: 'IN_PROGRESS' },
        include: this.include,
      });
      await this.audit.record(
        {
          action: 'engineering.request_assigned',
          entity: 'EngineeringRequest',
          entityId: id,
          after: { assigneeId: userId },
        },
        tx,
      );
      return result;
    });
    const names = await this.names([updated.assigneeId]);
    return toRequestDto(
      updated,
      updated.assigneeId ? (names.get(updated.assigneeId) ?? null) : null,
    );
  }

  async cancel(id: string, reason: string): Promise<EngineeringRequestListItemDto> {
    const row = await this.require(id);
    if (row.status === 'DONE' || row.status === 'CANCELLED')
      throw new ConflictException('Este pedido já foi encerrado');
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.engineeringRequest.update({
        where: { id },
        data: { status: 'CANCELLED', resolution: reason, resolvedAt: new Date() },
        include: this.include,
      });
      await this.audit.record(
        {
          action: 'engineering.request_cancelled',
          entity: 'EngineeringRequest',
          entityId: id,
          after: { reason },
        },
        tx,
      );
      return result;
    });
    const names = await this.names([updated.assigneeId]);
    return toRequestDto(
      updated,
      updated.assigneeId ? (names.get(updated.assigneeId) ?? null) : null,
    );
  }
}
