import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import {
  TenantStatus,
  permissionsForRole,
  type CurrentUser,
  type LoginInput,
} from '@voltex/shared';
import type { Prisma } from '@voltex/database';
import type { Env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { generateOpaqueToken, hashToken } from './tokens';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: CurrentUser;
}

export interface JwtPayload {
  sub: string;
  tid: string;
  role: string;
}

type UserWithTenant = Prisma.UserGetPayload<{ include: { tenant: true } }>;

const INVALID_CREDENTIALS = 'Credenciais inválidas';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(input: LoginInput, meta: ClientMeta): Promise<Session> {
    const user = await this.prisma.system.user.findFirst({
      where: { email: input.email, deletedAt: null },
      include: { tenant: true },
    });
    // Sempre verifica a senha (mesmo sem usuário) para não revelar, pelo tempo, se o e-mail existe.
    const passwordOk = await this.passwords.verify(user?.passwordHash, input.password);

    if (!user || !passwordOk || !this.isUsable(user)) {
      if (user) {
        await this.audit.record({
          tenantId: user.tenantId,
          actorId: user.id,
          action: 'auth.login_failed',
          entity: 'User',
          entityId: user.id,
          after: { reason: passwordOk ? 'inactive' : 'bad_password' },
        });
      }
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.prisma.system.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
    });
    return this.issueSession(user, meta);
  }

  async refresh(rawToken: string, meta: ClientMeta): Promise<Session> {
    const row = await this.prisma.system.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { include: { tenant: true } } },
    });
    if (!row) throw new UnauthorizedException('Sessão inválida');

    if (row.revokedAt) {
      const graceMs = this.config.get('REFRESH_REUSE_GRACE_MS', { infer: true });
      const withinGrace =
        row.replacedById !== null && Date.now() - row.revokedAt.getTime() < graceMs;
      if (!withinGrace) {
        await this.revokeFamily(row.familyId);
        await this.audit.record({
          tenantId: row.tenantId,
          actorId: row.userId,
          action: 'auth.refresh_reuse_detected',
          entity: 'User',
          entityId: row.userId,
        });
      }
      throw new UnauthorizedException('Sessão inválida');
    }
    if (row.expiresAt.getTime() <= Date.now() || !this.isUsable(row.user)) {
      throw new UnauthorizedException('Sessão expirada');
    }

    return this.issueSession(row.user, meta, { familyId: row.familyId, rotateFromId: row.id });
  }

  /** Encerra a sessão inteira (toda a família de refresh tokens). Idempotente. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const row = await this.prisma.system.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!row) return;
    await this.revokeFamily(row.familyId);
    await this.audit.record({
      tenantId: row.tenantId,
      actorId: row.userId,
      action: 'auth.logout',
      entity: 'User',
      entityId: row.userId,
    });
  }

  /** Revoga todas as sessões de um usuário (desativação, troca de senha). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.system.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  toCurrentUser(user: UserWithTenant): CurrentUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: user.tenant.name,
      permissions: [...permissionsForRole(user.role)],
    };
  }

  async issueSession(
    user: UserWithTenant,
    meta: ClientMeta,
    rotation?: { familyId: string; rotateFromId: string },
  ): Promise<Session> {
    const refreshToken = generateOpaqueToken();
    const refreshTtl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    const refreshExpiresAt = new Date(Date.now() + refreshTtl * 1000);
    const newId = randomUUID();

    await this.prisma.system.$transaction(async (tx) => {
      await tx.refreshToken.create({
        data: {
          id: newId,
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash: hashToken(refreshToken),
          familyId: rotation?.familyId ?? randomUUID(),
          expiresAt: refreshExpiresAt,
          userAgent: meta.userAgent?.slice(0, 255) ?? null,
          ip: meta.ip ?? null,
        },
      });
      if (rotation) {
        await tx.refreshToken.update({
          where: { id: rotation.rotateFromId },
          data: { revokedAt: new Date(), replacedById: newId },
        });
      }
    });

    const expiresIn = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const payload: JwtPayload = { sub: user.id, tid: user.tenantId, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn });

    return {
      accessToken,
      expiresIn,
      refreshToken,
      refreshExpiresAt,
      user: this.toCurrentUser(user),
    };
  }

  private isUsable(user: UserWithTenant): boolean {
    return (
      user.isActive &&
      user.deletedAt === null &&
      user.tenant.status === TenantStatus.ACTIVE &&
      user.tenant.deletedAt === null
    );
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.system.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
