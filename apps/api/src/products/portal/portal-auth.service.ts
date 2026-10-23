import { createHash, randomBytes } from 'node:crypto';
import {
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PORTAL_LINK_TTL_MINUTES,
  PORTAL_SESSION_TTL_HOURS,
  TenantStatus,
  type PortalLinkDto,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import type { Env } from '../../config/env';
import { NotificationsService } from '../../platform/notifications/notifications.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { MAX_ACCESSES_PER_EMAIL, PORTAL_LINK_COOLDOWN_MS } from './portal.constants';

export interface PortalPrincipal {
  sessionId: string;
  accessId: string;
  accountId: string;
  tenantId: string;
  email: string;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const newToken = (): string => randomBytes(32).toString('base64url');

/**
 * Autenticação do portal (ADR-0027): link mágico de uso único e sessão própria, separada do login interno.
 * Só o hash do link e da sessão fica no banco. O acesso do cliente vale para UMA conta (cliente) de UMA empresa.
 */
@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly config: ConfigService<Env, true>,
    private readonly notifications: NotificationsService,
  ) {}

  private url(token: string): string {
    return `${this.config.get('WEB_URL', { infer: true })}/portal/acesso/${token}`;
  }

  /** Cria um link para o acesso. Chamado com o tenant no contexto (usuário interno ou rotina). */
  async createLink(accessId: string): Promise<PortalLinkDto> {
    const access = await this.prisma.db.portalAccess.findFirst({
      where: { id: accessId, active: true },
    });
    if (!access) throw new NotFoundException('Acesso ao portal não encontrado ou desativado');
    const token = newToken();
    const expiresAt = new Date(Date.now() + PORTAL_LINK_TTL_MINUTES * 60_000);
    await this.prisma.db.portalMagicLink.create({
      data: {
        tenantId: access.tenantId,
        accountId: access.accountId,
        accessId: access.id,
        tokenHash: hashToken(token),
        expiresAt,
      },
    });
    return { url: this.url(token), expiresAt: expiresAt.toISOString() };
  }

  /**
   * O cliente pede o link pelo próprio e-mail. A resposta é sempre a mesma (não revela se o e-mail tem acesso) e o
   * link vai só por e-mail. Falhas de envio são registradas e engolidas pelo mesmo motivo.
   */
  async requestLinks(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const accesses = await this.prisma.system.portalAccess.findMany({
      where: { email, active: true },
      take: MAX_ACCESSES_PER_EMAIL,
    });
    for (const access of accesses) {
      try {
        const [tenant, account, recent] = await Promise.all([
          this.prisma.system.tenant.findFirst({
            where: { id: access.tenantId, status: TenantStatus.ACTIVE, deletedAt: null },
          }),
          this.prisma.system.account.findFirst({
            where: { id: access.accountId, tenantId: access.tenantId, deletedAt: null },
          }),
          this.prisma.system.portalMagicLink.findFirst({
            where: {
              accessId: access.id,
              createdAt: { gt: new Date(Date.now() - PORTAL_LINK_COOLDOWN_MS) },
            },
            select: { id: true },
          }),
        ]);
        if (!tenant || !account || recent) continue;
        await this.context.run({ tenantId: access.tenantId }, async () => {
          const link = await this.createLink(access.id);
          await this.notifications.sendEmail({
            template: 'portal.access',
            to: email,
            variables: { nome: account.name, link: link.url },
            entityType: 'PortalAccess',
            entityId: access.id,
            accountId: access.accountId,
          });
        });
      } catch (error) {
        this.logger.warn({ err: error, accessId: access.id }, 'Falha ao enviar o link do portal');
      }
    }
  }

  /** Troca o link por uma sessão. Link inexistente: 404; já usado ou vencido: 410. */
  async exchange(
    token: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ sessionToken: string; expiresAt: Date }> {
    const tokenHash = hashToken(token);
    const link = await this.prisma.system.portalMagicLink.findUnique({
      where: { tokenHash },
      include: { access: true },
    });
    if (!link?.access || !link.access.active) throw new NotFoundException('Link inválido');
    if (link.usedAt || link.expiresAt.getTime() < Date.now())
      throw new GoneException('Este link expirou ou já foi usado. Peça um novo.');
    const tenant = await this.prisma.system.tenant.findFirst({
      where: { id: link.tenantId, status: TenantStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Link inválido');

    // Consumo atômico: duas aberturas simultâneas do mesmo link, só uma passa.
    const used = await this.prisma.system.portalMagicLink.updateMany({
      where: { id: link.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date(), ip: meta.ip ?? null },
    });
    if (used.count !== 1)
      throw new GoneException('Este link expirou ou já foi usado. Peça um novo.');

    const sessionToken = newToken();
    const expiresAt = new Date(Date.now() + PORTAL_SESSION_TTL_HOURS * 3_600_000);
    await this.prisma.system.$transaction([
      this.prisma.system.portalSession.create({
        data: {
          tenantId: link.tenantId,
          accountId: link.accountId,
          accessId: link.access.id,
          tokenHash: hashToken(sessionToken),
          expiresAt,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        },
      }),
      this.prisma.system.portalAccess.update({
        where: { id: link.access.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);
    return { sessionToken, expiresAt };
  }

  /** Valida o cookie da sessão. Acesso desativado, empresa suspensa ou sessão vencida/revogada: 401. */
  async authenticate(sessionToken: string | undefined): Promise<PortalPrincipal> {
    if (!sessionToken) throw new UnauthorizedException('Entre pelo link enviado ao seu e-mail');
    const session = await this.prisma.system.portalSession.findUnique({
      where: { tokenHash: hashToken(sessionToken) },
      include: { access: true },
    });
    if (
      !session?.access ||
      !session.access.active ||
      session.revokedAt ||
      session.expiresAt.getTime() < Date.now()
    )
      throw new UnauthorizedException('Sua sessão expirou. Peça um novo link.');
    const tenant = await this.prisma.system.tenant.findFirst({
      where: { id: session.tenantId, status: TenantStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });
    if (!tenant) throw new UnauthorizedException('Sua sessão expirou. Peça um novo link.');
    return {
      sessionId: session.id,
      accessId: session.access.id,
      accountId: session.accountId,
      tenantId: session.tenantId,
      email: session.access.email,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.system.portalSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoga todas as sessões e os links ainda abertos de um acesso (desativação). */
  async revokeAccess(accessId: string): Promise<void> {
    await this.prisma.system.portalSession.updateMany({
      where: { accessId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.system.portalMagicLink.updateMany({
      where: { accessId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}
