import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CreateFieldIssueInput, FieldIssueDto, ResolveFieldIssueInput } from '@voltex/shared';
import type { RequestUser } from '../../common/context/request-user';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { InstallationsService } from './installations.service';
import { toFieldIssueDto } from './operations.mapper';

/** Estados da instalação em que faz sentido registrar uma pendência de campo. */
const REPORTABLE = ['CREW_ASSIGNED', 'IN_PROGRESS', 'FIELD_ISSUE', 'INSTALLED', 'COMMISSIONING'];

/**
 * Pendências de campo. Uma pendência que bloqueia pára a instalação ("pendência de campo") até ser resolvida; ao
 * resolver a última, a instalação volta sozinha a "em instalação".
 */
@Injectable()
export class FieldIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly installations: InstallationsService,
  ) {}

  async list(installationId: string): Promise<FieldIssueDto[]> {
    await this.installations.require(installationId);
    const rows = await this.prisma.db.fieldIssue.findMany({
      where: { installationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toFieldIssueDto);
  }

  /** Gestor age em qualquer instalação; técnico de campo só naquelas em que está escalado numa ordem em aberto. */
  private async assertCanAct(installationId: string, actor: RequestUser): Promise<void> {
    if (actor.permissions.includes('ops.workorder.write')) return;
    if (actor.permissions.includes('ops.field.execute')) {
      const memberships = await this.prisma.db.crewMember.findMany({
        where: { userId: actor.id },
        select: { crewId: true },
      });
      const order = await this.prisma.db.workOrder.findFirst({
        where: {
          installationId,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          OR: [{ assigneeId: actor.id }, { crewId: { in: memberships.map((m) => m.crewId) } }],
        },
        select: { id: true },
      });
      if (order) return;
    }
    throw new ForbiddenException('Você não está escalado para esta instalação.');
  }

  async create(
    installationId: string,
    input: CreateFieldIssueInput,
    actor: RequestUser,
  ): Promise<FieldIssueDto> {
    const inst = await this.installations.require(installationId);
    await this.assertCanAct(installationId, actor);
    if (!REPORTABLE.includes(inst.status))
      throw new UnprocessableEntityException(
        'Só é possível registrar pendência de campo com a equipe designada ou a instalação em andamento.',
      );
    if (input.workOrderId) {
      const order = await this.prisma.db.workOrder.findFirst({
        where: { id: input.workOrderId, installationId },
        select: { id: true },
      });
      if (!order)
        throw new UnprocessableEntityException('A ordem de serviço não é desta instalação.');
    }
    const issue = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.fieldIssue.create({
        data: {
          tenantId: inst.tenantId,
          installationId,
          workOrderId: input.workOrderId ?? null,
          type: input.type,
          description: input.description,
          blocking: input.blocking,
          reportedById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'field_issue.created',
          entity: 'FieldIssue',
          entityId: created.id,
          after: { type: created.type, blocking: created.blocking, installationId },
        },
        tx,
      );
      if (created.blocking && inst.status === 'IN_PROGRESS')
        await this.installations.transition(inst, 'FIELD_ISSUE', {
          tx,
          automatic: true,
          reason: `Pendência de campo: ${created.description}`,
        });
      return created;
    });
    return toFieldIssueDto(issue);
  }

  async resolve(
    id: string,
    input: ResolveFieldIssueInput,
    actor: RequestUser,
  ): Promise<FieldIssueDto> {
    const issue = await this.prisma.db.fieldIssue.findFirst({ where: { id } });
    if (!issue) throw new NotFoundException('Pendência não encontrada');
    await this.assertCanAct(issue.installationId, actor);
    if (issue.status === 'RESOLVED')
      throw new UnprocessableEntityException('A pendência já foi resolvida.');
    const inst = await this.installations.require(issue.installationId);
    const resolved = await this.prisma.db.$transaction(async (tx) => {
      const next = await tx.fieldIssue.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolution: input.resolution,
          resolvedById: this.context.userId ?? null,
          resolvedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          action: 'field_issue.resolved',
          entity: 'FieldIssue',
          entityId: id,
          after: { resolution: input.resolution },
        },
        tx,
      );
      if (inst.status === 'FIELD_ISSUE') {
        const stillBlocking = await tx.fieldIssue.count({
          where: { installationId: inst.id, status: 'OPEN', blocking: true },
        });
        if (stillBlocking === 0)
          await this.installations.transition(inst, 'IN_PROGRESS', {
            tx,
            automatic: true,
            reason: 'Todas as pendências de campo foram resolvidas',
          });
      }
      return next;
    });
    return toFieldIssueDto(resolved);
  }
}
