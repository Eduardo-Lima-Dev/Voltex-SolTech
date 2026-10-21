import { createHash, randomBytes } from 'node:crypto';
import {
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  INTERNAL_TEST_RULE_WARNING,
  type CreateEngineeringShareLinkInput,
  type EngineeringDesign,
  type EngineeringResults,
  type EngineeringShareLinkDto,
  type PublicEngineeringReportDto,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Relatório técnico simplificado para o cliente final (9I): link com token (só o hash fica guardado), validade e
 * revogação. Só a versão **aprovada** tem relatório, e ele nunca traz custos, margem, regras internas ou fichas.
 */
@Injectable()
export class EngineeringShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  private toDto(row: {
    id: string;
    expiresAt: Date;
    revokedAt: Date | null;
    viewCount: number;
    lastViewedAt: Date | null;
    createdAt: Date;
  }): EngineeringShareLinkDto {
    return {
      id: row.id,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      viewCount: row.viewCount,
      lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Cria o link. O token só aparece nesta resposta. */
  async create(versionId: string, input: CreateEngineeringShareLinkInput) {
    const snapshot = await this.prisma.db.engineeringSnapshot.findFirst({ where: { versionId } });
    if (!snapshot)
      throw new UnprocessableEntityException({
        message: 'Só a versão aprovada tem relatório para o cliente',
        code: 'VERSION_NOT_APPROVED',
      });
    const token = randomBytes(32).toString('base64url');
    const validDays = input.validDays ?? 30;
    const row = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.engineeringShareLink.create({
        data: {
          tenantId: this.context.requireTenantId(),
          snapshotId: snapshot.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + validDays * 86_400_000),
          createdById: this.context.userId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'engineering.share_link_created',
          entity: 'EngineeringShareLink',
          entityId: created.id,
          after: { versionId, validDays },
        },
        tx,
      );
      return created;
    });
    return { ...this.toDto(row), token, path: `/r/${token}` };
  }

  async list(versionId: string): Promise<EngineeringShareLinkDto[]> {
    const snapshot = await this.prisma.db.engineeringSnapshot.findFirst({ where: { versionId } });
    if (!snapshot) return [];
    const rows = await this.prisma.db.engineeringShareLink.findMany({
      where: { snapshotId: snapshot.id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  async revoke(linkId: string): Promise<EngineeringShareLinkDto> {
    const link = await this.prisma.db.engineeringShareLink.findFirst({ where: { id: linkId } });
    if (!link) throw new NotFoundException('Link não encontrado');
    if (link.revokedAt) return this.toDto(link);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.engineeringShareLink.update({
        where: { id: linkId },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'engineering.share_link_revoked',
          entity: 'EngineeringShareLink',
          entityId: linkId,
        },
        tx,
      );
      return updated;
    });
    return this.toDto(row);
  }

  /** Abre o relatório pelo token (sem login). Link inexistente ou revogado: 404; vencido: 410. */
  async openPublic(token: string): Promise<PublicEngineeringReportDto> {
    const link = await this.prisma.system.engineeringShareLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { snapshot: true },
    });
    if (!link || link.revokedAt) throw new NotFoundException('Relatório não encontrado');
    if (link.expiresAt.getTime() < Date.now())
      throw new GoneException('Este link expirou. Peça um novo ao seu consultor.');
    await this.prisma.system.engineeringShareLink.update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
    const [tenant, project] = await Promise.all([
      this.prisma.system.tenant.findUniqueOrThrow({ where: { id: link.tenantId } }),
      this.prisma.system.engineeringProject.findUniqueOrThrow({
        where: { id: link.snapshot.projectId },
      }),
    ]);
    const content = link.snapshot.content as unknown as {
      version: { design: EngineeringDesign; results: EngineeringResults };
      approvedAt: string;
      internalTestRules?: boolean;
    };
    const { design, results } = content.version;
    const economics = results.economics;
    return {
      companyName: tenant.name,
      projectName: project.name,
      city: design.site.city ?? null,
      state: design.site.state ?? null,
      approvedAt: content.approvedAt,
      powerKwp: results.totals.powerKwp,
      moduleCount: results.totals.moduleCount,
      moduleAreaM2: results.totals.moduleAreaM2,
      annualEnergyKwh: results.simulation?.energyKwh ?? null,
      performanceRatio: results.simulation?.performanceRatio ?? null,
      monthlyKwh: results.simulation?.monthlyKwh ?? null,
      monthlyConsumptionKwh: design.economics?.monthlyConsumptionKwh ?? null,
      economics:
        economics && economics.status !== 'INCOMPLETE'
          ? {
              firstYearSavingsCents: economics.firstYearSavingsCents,
              accumulatedSavingsCents: economics.accumulatedSavingsCents,
              simplePaybackYears: economics.simplePaybackYears,
              horizonYears: economics.horizonYears,
            }
          : null,
      notes: [
        ...(content.internalTestRules ? [INTERNAL_TEST_RULE_WARNING] : []),
        'Estimativas de geração e economia dependem do clima, do consumo e das tarifas e podem variar.',
        'Este relatório resume o projeto técnico aprovado; o memorial completo fica com o responsável técnico.',
      ],
    };
  }
}
