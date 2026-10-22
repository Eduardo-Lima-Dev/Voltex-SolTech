import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateBranchInput,
  CreateTeamInput,
  UpdateBranchInput,
  UpdateTeamInput,
  UpdateTenantInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  // ---- Tenant ----
  getTenant() {
    return this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: this.context.requireTenantId() },
      select: {
        id: true,
        name: true,
        slug: true,
        document: true,
        status: true,
        settings: true,
        createdAt: true,
      },
    });
  }

  async updateTenant(input: UpdateTenantInput) {
    const id = this.context.requireTenantId();
    const before = await this.getTenant();
    const after = await this.prisma.db.tenant.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.document !== undefined ? { document: input.document } : {}),
        // `settings.plan` é do operador da plataforma e `settings.operations` tem endpoint próprio (prazos do
        // pós-venda): a edição geral das configurações não os altera nem os apaga.
        ...(input.settings !== undefined
          ? {
              settings: {
                ...input.settings,
                plan: (before.settings as Record<string, unknown> | null)?.plan,
                operations: (before.settings as Record<string, unknown> | null)?.operations,
              } as object,
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        document: true,
        status: true,
        settings: true,
        createdAt: true,
      },
    });
    await this.audit.record({
      action: 'tenant.updated',
      entity: 'Tenant',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  // ---- Filiais ----
  listBranches() {
    return this.prisma.db.branch.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async createBranch(input: CreateBranchInput) {
    return this.prisma.db.branch.create({
      data: {
        tenantId: this.context.requireTenantId(),
        name: input.name,
        city: input.city ?? null,
        state: input.state ?? null,
      },
    });
  }

  async updateBranch(id: string, input: UpdateBranchInput) {
    await this.findBranchOrThrow(id);
    return this.prisma.db.branch.update({ where: { id }, data: input });
  }

  async removeBranch(id: string) {
    await this.findBranchOrThrow(id);
    const inUse = await this.prisma.db.user.count({ where: { branchId: id, deletedAt: null } });
    if (inUse > 0) throw new ConflictException('A filial possui usuários vinculados');
    return this.prisma.db.branch.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async findBranchOrThrow(id: string) {
    const branch = await this.prisma.db.branch.findFirst({ where: { id, deletedAt: null } });
    if (!branch) throw new NotFoundException('Filial não encontrada');
    return branch;
  }

  // ---- Times ----
  listTeams() {
    return this.prisma.db.team.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async createTeam(input: CreateTeamInput) {
    if (input.branchId) await this.findBranchOrThrow(input.branchId);
    return this.prisma.db.team.create({
      data: {
        tenantId: this.context.requireTenantId(),
        name: input.name,
        branchId: input.branchId ?? null,
      },
    });
  }

  async updateTeam(id: string, input: UpdateTeamInput) {
    await this.findTeamOrThrow(id);
    if (input.branchId) await this.findBranchOrThrow(input.branchId);
    return this.prisma.db.team.update({ where: { id }, data: input });
  }

  async removeTeam(id: string) {
    await this.findTeamOrThrow(id);
    const inUse = await this.prisma.db.user.count({ where: { teamId: id, deletedAt: null } });
    if (inUse > 0) throw new ConflictException('O time possui usuários vinculados');
    return this.prisma.db.team.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async findTeamOrThrow(id: string) {
    const team = await this.prisma.db.team.findFirst({ where: { id, deletedAt: null } });
    if (!team) throw new NotFoundException('Time não encontrado');
    return team;
  }
}
