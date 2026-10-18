import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, type ListUsersQuery, type UpdateUserInput } from '@voltex/shared';
import type { RequestUser } from '../../common/context/request-user';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService, type ScopedPrismaClient } from '../prisma/prisma.service';
import { canManageRole } from './role-policy';

/** Campos públicos do usuário. Nunca inclui hash de senha nem segredo de MFA. */
export const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  branchId: true,
  teamId: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list(query: ListUsersQuery) {
    const where = {
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.user.findMany({
        where,
        select: userSelect,
        orderBy: { name: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.db.user.count({ where }),
    ]);
    return toPaginated(data, total, query);
  }

  async get(id: string) {
    const user = await this.prisma.db.user.findFirst({
      where: { id, deletedAt: null },
      select: userSelect,
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }

  async update(id: string, input: UpdateUserInput, actor: RequestUser) {
    const before = await this.get(id);
    this.assertCanManage(actor, before.role);
    if (id === actor.id && (input.role !== undefined || input.isActive === false)) {
      throw new ForbiddenException('Você não pode alterar o próprio perfil nem se desativar');
    }
    if (input.role !== undefined && !canManageRole(actor.role, input.role)) {
      throw new ForbiddenException('Você não pode conceder este perfil');
    }
    const losesOwner =
      before.role === Role.OWNER &&
      ((input.role !== undefined && input.role !== Role.OWNER) || input.isActive === false);
    if (losesOwner) await this.assertAnotherOwner(id);
    await this.assertBranchAndTeam(input.branchId, input.teamId);

    const after = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: input, select: userSelect });
      await this.audit.record(
        { action: 'user.updated', entity: 'User', entityId: id, before, after: updated },
        tx,
      );
      return updated;
    });
    if (input.isActive === false) await this.auth.revokeAllForUser(id);
    return after;
  }

  async remove(id: string, actor: RequestUser) {
    const before = await this.get(id);
    this.assertCanManage(actor, before.role);
    if (id === actor.id) throw new ForbiddenException('Você não pode excluir a si mesmo');
    if (before.role === Role.OWNER) await this.assertAnotherOwner(id);

    await this.prisma.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
      await this.audit.record({ action: 'user.deleted', entity: 'User', entityId: id, before }, tx);
    });
    await this.auth.revokeAllForUser(id);
    return { id };
  }

  private assertCanManage(actor: RequestUser, targetRole: Role): void {
    if (!canManageRole(actor.role, targetRole)) {
      throw new ForbiddenException('Você não pode gerenciar usuários com este perfil');
    }
  }

  /** O tenant nunca pode ficar sem um OWNER ativo. */
  private async assertAnotherOwner(excludingUserId: string): Promise<void> {
    const others = await this.prisma.db.user.count({
      where: { role: Role.OWNER, isActive: true, deletedAt: null, id: { not: excludingUserId } },
    });
    if (others === 0)
      throw new ConflictException('O tenant precisa manter ao menos um OWNER ativo');
  }

  async assertBranchAndTeam(
    branchId?: string | null,
    teamId?: string | null,
    client: Pick<ScopedPrismaClient, 'branch' | 'team'> = this.prisma.db,
  ) {
    if (
      branchId &&
      !(await client.branch.findFirst({ where: { id: branchId, deletedAt: null } }))
    ) {
      throw new BadRequestException('Filial inexistente');
    }
    if (teamId && !(await client.team.findFirst({ where: { id: teamId, deletedAt: null } }))) {
      throw new BadRequestException('Time inexistente');
    }
  }
}
