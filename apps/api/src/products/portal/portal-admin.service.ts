import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  CreatePortalAccessInput,
  PortalAccessDto,
  PortalLinkDto,
  PortalUploadReviewDto,
  ReviewPortalUploadInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { PortalAuthService } from './portal-auth.service';

type AccessRow = {
  id: string;
  accountId: string;
  email: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

const toDto = (row: AccessRow): PortalAccessDto => ({
  id: row.id,
  accountId: row.accountId,
  email: row.email,
  active: row.active,
  lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** Gestão do portal pelo usuário interno: liberar e desativar acessos, gerar link e revisar o que o cliente enviou. */
@Injectable()
export class PortalAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly auth: PortalAuthService,
  ) {}

  async list(accountId: string): Promise<PortalAccessDto[]> {
    const rows = await this.prisma.db.portalAccess.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(input: CreatePortalAccessInput): Promise<PortalAccessDto> {
    const account = await this.prisma.db.account.findFirst({
      where: { id: input.accountId, deletedAt: null },
    });
    if (!account) throw new NotFoundException('Cliente não encontrado');
    const email = input.email.trim().toLowerCase();
    const row = await this.prisma.db.$transaction(async (tx) => {
      const saved = await tx.portalAccess.upsert({
        where: { accountId_email: { accountId: input.accountId, email } },
        create: {
          tenantId: this.context.requireTenantId(),
          accountId: input.accountId,
          email,
          createdById: this.context.userId ?? null,
        },
        update: { active: true },
      });
      await this.audit.record(
        {
          action: 'portal.access_granted',
          entity: 'PortalAccess',
          entityId: saved.id,
          after: { accountId: input.accountId, email },
        },
        tx,
      );
      return saved;
    });
    return toDto(row);
  }

  async deactivate(id: string): Promise<PortalAccessDto> {
    const access = await this.prisma.db.portalAccess.findFirst({ where: { id } });
    if (!access) throw new NotFoundException('Acesso não encontrado');
    const row = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.portalAccess.update({ where: { id }, data: { active: false } });
      await this.audit.record(
        { action: 'portal.access_revoked', entity: 'PortalAccess', entityId: id },
        tx,
      );
      return updated;
    });
    await this.auth.revokeAccess(id);
    return toDto(row);
  }

  async link(id: string): Promise<PortalLinkDto> {
    const link = await this.auth.createLink(id);
    await this.audit.record({
      action: 'portal.link_created',
      entity: 'PortalAccess',
      entityId: id,
    });
    return link;
  }

  // --- documentos enviados pelo cliente -----------------------------------------------------------------

  async listUploads(
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED' = 'PENDING',
  ): Promise<PortalUploadReviewDto[]> {
    const rows = await this.prisma.db.portalUpload.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    if (rows.length === 0) return [];
    const [docs, projects] = await Promise.all([
      this.prisma.db.document.findMany({ where: { id: { in: rows.map((r) => r.documentId) } } }),
      this.prisma.db.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } } }),
    ]);
    const accounts = await this.prisma.db.account.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } },
      select: { id: true, name: true },
    });
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectCode: projects.find((p) => p.id === r.projectId)?.projectCode ?? '',
      accountName: accounts.find((a) => a.id === r.accountId)?.name ?? '',
      documentId: r.documentId,
      filename: docs.find((d) => d.id === r.documentId)?.filename ?? 'arquivo',
      note: r.note,
      status: r.status,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async review(id: string, input: ReviewPortalUploadInput): Promise<PortalUploadReviewDto> {
    const upload = await this.prisma.db.portalUpload.findFirst({ where: { id } });
    if (!upload) throw new NotFoundException('Envio não encontrado');
    if (upload.status !== 'PENDING')
      throw new UnprocessableEntityException({
        code: 'UPLOAD_ALREADY_REVIEWED',
        message: 'Este envio já foi revisado.',
      });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.portalUpload.update({
        where: { id },
        data: {
          status: input.accept ? 'ACCEPTED' : 'REJECTED',
          reviewedById: this.context.userId ?? null,
          reviewedAt: new Date(),
          reviewNote: input.note ?? null,
        },
      });
      // Aceito: o arquivo passa a fazer parte do projeto. Recusado: sai de circulação (a exclusão é lógica).
      await tx.document.update({
        where: { id: upload.documentId },
        data: input.accept
          ? { entityType: 'Project', entityId: upload.projectId }
          : { deletedAt: new Date() },
      });
      await this.audit.record(
        {
          action: input.accept ? 'portal.upload_accepted' : 'portal.upload_rejected',
          entity: 'PortalUpload',
          entityId: id,
          after: { note: input.note ?? null },
        },
        tx,
      );
    });
    const [item] = (await this.listUploads(input.accept ? 'ACCEPTED' : 'REJECTED')).filter(
      (u) => u.id === id,
    );
    if (!item) throw new NotFoundException('Envio não encontrado');
    return item;
  }
}
