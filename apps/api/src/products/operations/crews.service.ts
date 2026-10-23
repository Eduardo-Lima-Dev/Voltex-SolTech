import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@voltex/database';
import type { CreateCrewInput, CrewDto, UpdateCrewInput } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { toCrewDto } from './operations.mapper';

const WITH_MEMBERS = { members: { include: { user: { select: { name: true } } } } } as const;

@Injectable()
export class CrewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<CrewDto[]> {
    const rows = await this.prisma.db.crew.findMany({
      where: { deletedAt: null },
      include: WITH_MEMBERS,
      orderBy: { name: 'asc' },
    });
    return rows.map(toCrewDto);
  }

  private async assertMembers(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.prisma.db.user.count({
      where: { id: { in: ids }, isActive: true, deletedAt: null },
    });
    if (found !== new Set(ids).size)
      throw new UnprocessableEntityException('Há integrantes inexistentes ou inativos.');
  }

  async create(input: CreateCrewInput): Promise<CrewDto> {
    const memberIds = [...new Set(input.memberIds)];
    await this.assertMembers(memberIds);
    const tenantId = this.context.requireTenantId();
    try {
      const row = await this.prisma.db.$transaction(async (tx) => {
        const created = await tx.crew.create({
          data: {
            tenantId,
            name: input.name,
            members: { create: memberIds.map((userId) => ({ tenantId, userId })) },
          },
          include: WITH_MEMBERS,
        });
        await this.audit.record(
          {
            action: 'crew.created',
            entity: 'Crew',
            entityId: created.id,
            after: { name: created.name, members: memberIds.length },
          },
          tx,
        );
        return created;
      });
      return toCrewDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Já existe uma equipe com esse nome');
      throw error;
    }
  }

  async update(id: string, input: UpdateCrewInput): Promise<CrewDto> {
    const crew = await this.prisma.db.crew.findFirst({ where: { id, deletedAt: null } });
    if (!crew) throw new NotFoundException('Equipe não encontrada');
    const memberIds = input.memberIds ? [...new Set(input.memberIds)] : undefined;
    if (memberIds) await this.assertMembers(memberIds);
    const tenantId = this.context.requireTenantId();
    try {
      const row = await this.prisma.db.$transaction(async (tx) => {
        if (memberIds) {
          await tx.crewMember.deleteMany({ where: { crewId: id } });
          await tx.crewMember.createMany({
            data: memberIds.map((userId) => ({ tenantId, crewId: id, userId })),
          });
        }
        const next = await tx.crew.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
          },
          include: WITH_MEMBERS,
        });
        await this.audit.record(
          {
            action: 'crew.updated',
            entity: 'Crew',
            entityId: id,
            after: { name: next.name, active: next.active, members: next.members.length },
          },
          tx,
        );
        return next;
      });
      return toCrewDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Já existe uma equipe com esse nome');
      throw error;
    }
  }
}
