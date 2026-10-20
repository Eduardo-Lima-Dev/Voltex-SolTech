import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@voltex/database';
import {
  TimelineEventType,
  newDesign,
  type CreateEngineeringProjectInput,
  type EngineeringProjectDetailDto,
  type EngineeringProjectDto,
  type ListEngineeringProjectsQuery,
  type Paginated,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { toPaginated, toSkipTake } from '../../common/pagination';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService, type ScopedPrismaClient } from '../../platform/prisma/prisma.service';
import { toProjectDto } from './engineering.mapper';
import { fingerprintOf } from './engineering-versions.service';

type ProjectRow = Awaited<ReturnType<ScopedPrismaClient['engineeringProject']['findFirstOrThrow']>>;

@Injectable()
export class EngineeringProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  private async toDtos(rows: ProjectRow[]): Promise<EngineeringProjectDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [versions, requests, users] = await Promise.all([
      this.prisma.db.engineeringVersion.findMany({
        where: { projectId: { in: ids } },
        orderBy: { number: 'desc' },
        select: { id: true, projectId: true, number: true, status: true },
      }),
      this.prisma.db.engineeringRequest.findMany({
        where: { projectId: { in: ids } },
        select: { id: true, projectId: true },
      }),
      this.prisma.db.user.findMany({
        where: { id: { in: rows.map((r) => r.responsibleId).filter((v): v is string => !!v) } },
        select: { id: true, name: true },
      }),
    ]);
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((row) => {
      const own = versions.filter((v) => v.projectId === row.id);
      return toProjectDto(row, {
        requestId: requests.find((r) => r.projectId === row.id)?.id ?? null,
        responsibleName: row.responsibleId ? (names.get(row.responsibleId) ?? null) : null,
        latest: own[0] ?? null,
        approvedVersionId: own.find((v) => v.status === 'APPROVED')?.id ?? null,
      });
    });
  }

  async list(query: ListEngineeringProjectsQuery): Promise<Paginated<EngineeringProjectDto>> {
    const where: Prisma.EngineeringProjectWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.mine && this.context.userId ? { responsibleId: this.context.userId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.engineeringProject.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.db.engineeringProject.count({ where }),
    ]);
    return toPaginated(await this.toDtos(rows), total, query);
  }

  async get(id: string): Promise<EngineeringProjectDetailDto> {
    const row = await this.prisma.db.engineeringProject.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Projeto não encontrado');
    const [dto] = await this.toDtos([row]);
    const [versions, opportunity, request] = await Promise.all([
      this.prisma.db.engineeringVersion.findMany({
        where: { projectId: id },
        orderBy: { number: 'desc' },
        select: {
          id: true,
          number: true,
          status: true,
          stale: true,
          createdAt: true,
          decidedAt: true,
        },
      }),
      row.opportunityId
        ? this.prisma.db.opportunity.findFirst({
            where: { id: row.opportunityId },
            include: { account: { select: { name: true } } },
          })
        : null,
      this.prisma.db.engineeringRequest.findFirst({ where: { projectId: id } }),
    ]);
    const calculation = request?.calculationSessionId
      ? await this.prisma.db.calculationSession.findFirst({
          where: { id: request.calculationSessionId },
        })
      : null;
    const result = (calculation?.result ?? null) as {
      annualGenerationKwh?: number;
      installedPowerKwp?: number;
    } | null;
    return {
      ...(dto as EngineeringProjectDto),
      versions: versions.map((v) => ({
        id: v.id,
        number: v.number,
        status: v.status,
        stale: v.stale,
        createdAt: v.createdAt.toISOString(),
        decidedAt: v.decidedAt?.toISOString() ?? null,
      })),
      opportunity: opportunity
        ? {
            id: opportunity.id,
            title: opportunity.title,
            projectCode: opportunity.projectCode,
            customerName: opportunity.account.name,
          }
        : null,
      calculation: calculation
        ? {
            id: calculation.id,
            generationKwhYear: result?.annualGenerationKwh ?? null,
            systemKwp: result?.installedPowerKwp ?? null,
            createdAt: calculation.createdAt.toISOString(),
          }
        : null,
    };
  }

  /** Código do projeto: o Project ID da oportunidade (se livre) ou `ENG-AAAA-NNNN`. */
  private async nextCode(
    tx: Pick<ScopedPrismaClient, 'engineeringProject'>,
    preferred?: string,
  ): Promise<string> {
    if (preferred) {
      let code = preferred;
      let n = 1;
      while (await tx.engineeringProject.findFirst({ where: { code }, select: { id: true } })) {
        n += 1;
        code = `${preferred}-${n}`;
      }
      return code;
    }
    const year = new Date().getUTCFullYear();
    const count = await tx.engineeringProject.count({
      where: { code: { startsWith: `ENG-${year}-` } },
    });
    let seq = count + 1;
    for (;;) {
      const code = `ENG-${year}-${String(seq).padStart(4, '0')}`;
      if (!(await tx.engineeringProject.findFirst({ where: { code }, select: { id: true } })))
        return code;
      seq += 1;
    }
  }

  async create(input: CreateEngineeringProjectInput): Promise<EngineeringProjectDetailDto> {
    const created = await this.prisma.db.$transaction(async (tx) => {
      let opportunity = null;
      if (input.opportunityId) {
        opportunity = await tx.opportunity.findFirst({
          where: { id: input.opportunityId, deletedAt: null },
        });
        if (!opportunity) throw new NotFoundException('Oportunidade não encontrada');
      }
      return this.createWithin(tx, {
        name: input.name,
        opportunity,
        site: input.site,
      });
    });
    return this.get(created.id);
  }

  private async createWithin(
    tx: Pick<
      ScopedPrismaClient,
      'engineeringProject' | 'engineeringVersion' | 'timelineEvent' | 'auditLog'
    >,
    input: {
      name: string;
      opportunity: { id: string; projectCode: string } | null;
      site: {
        latitude: number;
        longitude: number;
        name?: string | undefined;
        city?: string | undefined;
        state?: string | undefined;
      };
      requestId?: string;
    },
  ) {
    const tenantId = this.context.requireTenantId();
    const code = await this.nextCode(tx, input.opportunity?.projectCode);
    const design = newDesign(input.site);
    const project = await tx.engineeringProject.create({
      data: {
        tenantId,
        code,
        name: input.name,
        opportunityId: input.opportunity?.id ?? null,
        responsibleId: this.context.userId ?? null,
        createdById: this.context.userId ?? null,
      },
    });
    await tx.engineeringVersion.create({
      data: {
        tenantId,
        projectId: project.id,
        number: 1,
        design: design as unknown as Prisma.InputJsonValue,
        fingerprint: fingerprintOf(design),
        createdById: this.context.userId ?? null,
      },
    });
    await this.audit.record(
      {
        action: 'engineering.project_created',
        entity: 'EngineeringProject',
        entityId: project.id,
        after: { code, name: input.name, requestId: input.requestId ?? null },
      },
      tx,
    );
    if (input.opportunity)
      await tx.timelineEvent.create({
        data: {
          tenantId,
          opportunityId: input.opportunity.id,
          type: TimelineEventType.ENGINEERING_STARTED,
          summary: `Projeto de engenharia ${code} iniciado`,
          data: { projectId: project.id, code },
          actorId: this.context.userId ?? null,
        },
      });
    return project;
  }

  /**
   * Abre o projeto a partir de um pedido de engenharia do CRM: pega o pedido, copia o local da oportunidade e liga
   * os dois. Idempotente: o mesmo pedido devolve o mesmo projeto.
   */
  async fromRequest(
    requestId: string,
    override: { latitude?: number | undefined; longitude?: number | undefined } = {},
  ): Promise<EngineeringProjectDetailDto> {
    const request = await this.prisma.db.engineeringRequest.findFirst({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Pedido de engenharia não encontrado');
    if (request.projectId) return this.get(request.projectId);
    if (request.status === 'CANCELLED' || request.status === 'DONE')
      throw new ConflictException('Este pedido já foi encerrado');

    const opportunity = await this.prisma.db.opportunity.findFirst({
      where: { id: request.opportunityId },
      include: { account: { select: { name: true } } },
    });
    if (!opportunity) throw new NotFoundException('Oportunidade do pedido não encontrada');
    const site = opportunity.siteId
      ? await this.prisma.db.site.findFirst({ where: { id: opportunity.siteId, deletedAt: null } })
      : null;
    const latitude = override.latitude ?? site?.latitude ?? null;
    const longitude = override.longitude ?? site?.longitude ?? null;
    if (latitude === null || longitude === null)
      throw new BadRequestException({
        message:
          'A oportunidade não tem as coordenadas do local. Informe a latitude e a longitude.',
        code: 'SITE_COORDINATES_MISSING',
      });

    const project = await this.prisma.db.$transaction(async (tx) => {
      const fresh = await tx.engineeringRequest.findFirstOrThrow({ where: { id: requestId } });
      if (fresh.projectId)
        return tx.engineeringProject.findFirstOrThrow({ where: { id: fresh.projectId } });
      const created = await this.createWithin(tx, {
        name: `${opportunity.account.name}: ${opportunity.title}`,
        opportunity,
        site: {
          latitude,
          longitude,
          ...(site?.name ? { name: site.name } : {}),
          ...(site?.city ? { city: site.city } : {}),
          ...(site?.state ? { state: site.state } : {}),
        },
        requestId,
      });
      await tx.engineeringRequest.update({
        where: { id: requestId },
        data: {
          projectId: created.id,
          status: 'IN_PROGRESS',
          assigneeId: fresh.assigneeId ?? this.context.userId ?? null,
        },
      });
      return created;
    });
    return this.get(project.id);
  }

  async cancel(id: string, reason: string): Promise<EngineeringProjectDetailDto> {
    const project = await this.prisma.db.engineeringProject.findFirst({ where: { id } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    if (project.status !== 'IN_PROGRESS')
      throw new ConflictException('Só projetos em andamento podem ser cancelados');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.engineeringProject.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.engineeringRequest.updateMany({
        where: { projectId: id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        data: { status: 'CANCELLED', resolution: reason, resolvedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'engineering.project_cancelled',
          entity: 'EngineeringProject',
          entityId: id,
          after: { reason },
        },
        tx,
      );
    });
    return this.get(id);
  }
}
