import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Branding } from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/prisma/prisma.service';

const LOGO_TYPES = new Set(['image/png', 'image/jpeg']);

/** Identidade visual da empresa nas propostas (`tenant.settings.branding`). */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<Branding> {
    const tenant = await this.prisma.system.tenant.findUniqueOrThrow({
      where: { id: this.context.requireTenantId() },
      select: { settings: true },
    });
    return ((tenant.settings as { branding?: Branding } | null)?.branding ?? {}) as Branding;
  }

  async update(input: Branding): Promise<Branding> {
    if (input.logoDocumentId) {
      const document = await this.prisma.db.document.findFirst({
        where: { id: input.logoDocumentId, deletedAt: null },
        select: { mimeType: true },
      });
      if (!document) throw new UnprocessableEntityException('O arquivo da logo não foi encontrado');
      if (!LOGO_TYPES.has(document.mimeType))
        throw new UnprocessableEntityException('A logo precisa ser uma imagem PNG ou JPEG');
    }
    const tenantId = this.context.requireTenantId();
    const tenant = await this.prisma.system.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    const before = (settings.branding ?? {}) as Branding;
    const next: Branding = { ...before, ...input };
    if (input.logoDocumentId === null) delete next.logoDocumentId;
    await this.prisma.system.tenant.update({
      where: { id: tenantId },
      data: { settings: { ...settings, branding: next } as object },
    });
    await this.audit.record({
      action: 'branding.updated',
      entity: 'Tenant',
      entityId: tenantId,
      before,
      after: next,
    });
    return next;
  }
}
