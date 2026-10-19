import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DomainEvent,
  TenantStatus,
  type AcceptInvitationInput,
  type CreateInvitationInput,
} from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import type { RequestUser } from '../../common/context/request-user';
import type { Env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { AuthService, type ClientMeta } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { generateOpaqueToken, hashToken } from '../auth/tokens';
import { EventBus } from '../events/event-bus.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { canManageRole } from './role-policy';
import { UsersService } from './users.service';

const INVALID_INVITATION = 'Convite inválido ou expirado';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly mail: MailService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(input: CreateInvitationInput, actor: RequestUser) {
    if (!canManageRole(actor.role, input.role))
      throw new ForbiddenException('Você não pode convidar para este perfil');
    await this.users.assertBranchAndTeam(input.branchId, input.teamId);

    // O e-mail é único na plataforma inteira: não revelamos de qual tenant é, só que está em uso.
    if (
      await this.prisma.system.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      })
    ) {
      throw new ConflictException('Já existe um usuário com este e-mail');
    }

    const token = generateOpaqueToken();
    const ttl = this.config.get('INVITATION_TTL', { infer: true });
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const invitation = await this.prisma.db.$transaction(async (tx) => {
      // Reenviar convite invalida os pendentes anteriores do mesmo e-mail.
      await tx.invitation.updateMany({
        where: { email: input.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.invitation.create({
        data: {
          tenantId: actor.tenantId,
          email: input.email,
          role: input.role,
          branchId: input.branchId ?? null,
          teamId: input.teamId ?? null,
          tokenHash: hashToken(token),
          invitedById: actor.id,
          expiresAt,
        },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      });
      await this.audit.record(
        {
          action: 'invitation.created',
          entity: 'Invitation',
          entityId: created.id,
          after: created,
        },
        tx,
      );
      await this.events.publish(
        {
          type: DomainEvent.USER_INVITED,
          payload: { invitationId: created.id, email: created.email, role: created.role },
        },
        tx,
      );
      return created;
    });

    const acceptUrl = `${this.config.get('WEB_URL', { infer: true })}/accept-invitation?token=${token}`;
    const emailSent = await this.sendEmail(input.email, actor, acceptUrl, expiresAt);
    const exposeUrl = this.config.get('NODE_ENV', { infer: true }) !== 'production';
    return { ...invitation, emailSent, ...(exposeUrl ? { devAcceptUrl: acceptUrl } : {}) };
  }

  async list() {
    const now = new Date();
    const rows = await this.prisma.db.invitation.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      status: row.acceptedAt
        ? 'ACCEPTED'
        : row.revokedAt
          ? 'REVOKED'
          : row.expiresAt <= now
            ? 'EXPIRED'
            : 'PENDING',
    }));
  }

  async revoke(id: string) {
    const found = await this.prisma.db.invitation.findFirst({
      where: { id, acceptedAt: null, revokedAt: null },
    });
    if (!found) throw new BadRequestException('Convite não encontrado ou já finalizado');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(
        { action: 'invitation.revoked', entity: 'Invitation', entityId: id },
        tx,
      );
    });
    return { id };
  }

  /** Aceita o convite (rota pública): cria o usuário, grava auditoria/evento e já devolve a sessão. */
  async accept(input: AcceptInvitationInput, meta: ClientMeta) {
    const invitation = await this.prisma.system.invitation.findUnique({
      where: { tokenHash: hashToken(input.token) },
      include: { tenant: true },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= Date.now() ||
      invitation.tenant.status !== TenantStatus.ACTIVE
    ) {
      throw new BadRequestException(INVALID_INVITATION);
    }
    if (
      await this.prisma.system.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      })
    ) {
      throw new ConflictException('Já existe um usuário com este e-mail');
    }

    const passwordHash = await this.passwords.hash(input.password);

    // A partir daqui o tenant é conhecido: o resto roda no contexto dele, com o cliente escopado.
    const user = await this.context.run({ tenantId: invitation.tenantId }, () =>
      this.prisma.db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            tenantId: invitation.tenantId,
            name: input.name,
            email: invitation.email,
            passwordHash,
            role: invitation.role,
            branchId: invitation.branchId,
            teamId: invitation.teamId,
          },
          include: { tenant: true },
        });
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });
        await this.audit.record(
          {
            action: 'invitation.accepted',
            entity: 'User',
            entityId: created.id,
            actorId: created.id,
            after: { email: created.email, role: created.role },
          },
          tx,
        );
        await this.events.publish(
          {
            type: DomainEvent.USER_ACTIVATED,
            actorId: created.id,
            payload: { userId: created.id, role: created.role },
          },
          tx,
        );
        return created;
      }),
    );

    return this.auth.issueSession(user, meta);
  }

  private async sendEmail(
    to: string,
    actor: RequestUser,
    url: string,
    expiresAt: Date,
  ): Promise<boolean> {
    try {
      await this.mail.send({
        to,
        subject: `${actor.name} convidou você para a ${actor.tenantName} no Voltex SolTech`,
        text: `Olá!\n\n${actor.name} convidou você para acessar o Voltex SolTech (${actor.tenantName}).\n\nCrie sua conta: ${url}\n\nO convite expira em ${expiresAt.toLocaleDateString('pt-BR')}.`,
        html: `<p>Olá!</p><p><strong>${escapeHtml(actor.name)}</strong> convidou você para acessar o Voltex SolTech (${escapeHtml(actor.tenantName)}).</p><p><a href="${url}">Criar minha conta</a></p><p>O convite expira em ${expiresAt.toLocaleDateString('pt-BR')}.</p>`,
      });
      return true;
    } catch (error) {
      // O convite já existe; o gestor pode reenviar. A falha não pode derrubar a criação.
      this.logger.error({ err: error }, 'Falha ao enviar e-mail de convite');
      return false;
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
