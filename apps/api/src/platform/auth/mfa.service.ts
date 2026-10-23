import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  MFA_CHALLENGE_TTL_SECONDS,
  TenantStatus,
  mfaPolicySchema,
  type MfaChallengeDto,
  type MfaPolicy,
  type MfaRecoveryDto,
  type MfaSetupDto,
  type MfaStatusDto,
} from '@voltex/shared';
import type { Prisma } from '@voltex/database';
import type { Env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { createKeyring, decryptField, encryptField, type Keyring } from '../crypto/field-crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import {
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from './totp';

const ISSUER = 'Voltex SolTech';
const MAX_FAILURES = 5;
const LOCK_WINDOW_MS = 15 * 60_000;

interface ChallengeClaims {
  sub: string;
  tid: string;
  purpose: 'mfa';
  setup: boolean;
}

/** Usuário como o login o carrega (com a empresa). */
export type MfaUser = Prisma.UserGetPayload<{ include: { tenant: true } }>;

/**
 * Segundo fator por aplicativo (TOTP). O segredo fica cifrado por empresa; os códigos de recuperação, só em hash e
 * de uso único. O desafio do login usa um token de curta duração assinado com OUTRA chave: ele nunca vale como
 * token de acesso.
 */
@Injectable()
export class MfaService {
  private readonly ring: Keyring;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.ring = createKeyring(
      config.get('DATA_ENCRYPTION_KEY', { infer: true }),
      config.get('DATA_ENCRYPTION_KEY_PREVIOUS', { infer: true }),
    );
  }

  // --- política da empresa ---------------------------------------------------------------------------------

  policyOf(settings: unknown): MfaPolicy {
    const raw = (settings as Record<string, unknown> | null)?.mfa;
    const parsed = mfaPolicySchema.safeParse(raw);
    return parsed.success ? parsed.data : { required: false, roles: [] };
  }

  isRequiredFor(settings: unknown, role: string): boolean {
    const policy = this.policyOf(settings);
    return policy.required && (policy.roles.length === 0 || policy.roles.includes(role as never));
  }

  async getPolicy(tenantId: string): Promise<MfaPolicy> {
    const tenant = await this.prisma.system.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return this.policyOf(tenant.settings);
  }

  async setPolicy(tenantId: string, actorId: string, input: MfaPolicy): Promise<MfaPolicy> {
    const tenant = await this.prisma.system.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const settings = { ...((tenant.settings as Record<string, unknown> | null) ?? {}), mfa: input };
    await this.prisma.system.tenant.update({ where: { id: tenantId }, data: { settings } });
    await this.audit.record({
      tenantId,
      actorId,
      action: 'auth.mfa_policy_changed',
      entity: 'Tenant',
      entityId: tenantId,
      after: input,
    });
    return input;
  }

  // --- desafio do login ------------------------------------------------------------------------------------

  private challengeSecret(): string {
    return `${this.config.get('JWT_SECRET', { infer: true })}:mfa-challenge`;
  }

  async challenge(user: MfaUser, setup: boolean): Promise<MfaChallengeDto> {
    const claims: ChallengeClaims = { sub: user.id, tid: user.tenantId, purpose: 'mfa', setup };
    const mfaToken = await this.jwt.signAsync(claims, {
      secret: this.challengeSecret(),
      expiresIn: MFA_CHALLENGE_TTL_SECONDS,
    });
    return {
      status: setup ? 'MFA_SETUP_REQUIRED' : 'MFA_REQUIRED',
      mfaToken,
      expiresIn: MFA_CHALLENGE_TTL_SECONDS,
    };
  }

  /** Valida o desafio e devolve o usuário (ainda ativo e com a empresa ativa). */
  async resolveChallenge(mfaToken: string, expectSetup: boolean): Promise<MfaUser> {
    let claims: ChallengeClaims;
    try {
      claims = await this.jwt.verifyAsync<ChallengeClaims>(mfaToken, {
        secret: this.challengeSecret(),
      });
    } catch {
      throw new UnauthorizedException('O desafio expirou. Entre novamente.');
    }
    if (claims.purpose !== 'mfa' || claims.setup !== expectSetup)
      throw new UnauthorizedException('O desafio expirou. Entre novamente.');
    const user = await this.prisma.system.user.findFirst({
      where: { id: claims.sub, tenantId: claims.tid, deletedAt: null, isActive: true },
      include: { tenant: true },
    });
    if (!user || user.tenant.status !== TenantStatus.ACTIVE || user.tenant.deletedAt !== null)
      throw new UnauthorizedException('O desafio expirou. Entre novamente.');
    return user;
  }

  // --- cadastro do aplicativo ------------------------------------------------------------------------------

  private secretOf(user: MfaUser): string | null {
    return user.mfaSecret ? decryptField(user.mfaSecret, this.ring, user.tenantId) : null;
  }

  async startSetup(user: MfaUser): Promise<MfaSetupDto> {
    if (user.mfaEnabled)
      throw new UnprocessableEntityException({
        code: 'MFA_ALREADY_ENABLED',
        message: 'O segundo fator já está ativo. Desative antes de cadastrar outro aparelho.',
      });
    const secret = generateSecret();
    await this.prisma.system.user.update({
      where: { id: user.id },
      data: { mfaSecret: encryptField(secret, this.ring, user.tenantId), mfaEnabled: false },
    });
    return { secret, otpauthUri: otpauthUri(ISSUER, user.email, secret) };
  }

  /** Confirma o primeiro código do aplicativo, liga o segundo fator e entrega os códigos de recuperação. */
  async confirmSetup(user: MfaUser, code: string): Promise<MfaRecoveryDto> {
    if (user.mfaEnabled)
      throw new UnprocessableEntityException({
        code: 'MFA_ALREADY_ENABLED',
        message: 'O segundo fator já está ativo.',
      });
    const secret = this.secretOf(user);
    if (!secret)
      throw new UnprocessableEntityException({
        code: 'MFA_SETUP_NOT_STARTED',
        message: 'Comece o cadastro do aplicativo antes de confirmar.',
      });
    await this.assertNotLocked(user);
    const step = verifyTotp(secret, code);
    if (step === null) {
      await this.recordFailure(user);
      throw new UnprocessableEntityException({
        code: 'INVALID_MFA_CODE',
        message: 'Código incorreto. Confira o aplicativo e tente de novo.',
      });
    }
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.system.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        mfaEnabledAt: new Date(),
        mfaLastStep: step,
        mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
      },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.mfa_enabled',
      entity: 'User',
      entityId: user.id,
    });
    return { recoveryCodes };
  }

  // --- verificação no login --------------------------------------------------------------------------------

  private async assertNotLocked(user: MfaUser): Promise<void> {
    const failures = await this.prisma.system.auditLog.count({
      where: {
        tenantId: user.tenantId,
        entityId: user.id,
        action: 'auth.mfa_failed',
        createdAt: { gt: new Date(Date.now() - LOCK_WINDOW_MS) },
      },
    });
    if (failures >= MAX_FAILURES)
      throw new HttpException(
        {
          code: 'MFA_LOCKED',
          message: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private async recordFailure(user: MfaUser): Promise<void> {
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.mfa_failed',
      entity: 'User',
      entityId: user.id,
    });
  }

  /** Código do aplicativo (6 dígitos, uso único) ou de recuperação (uso único). Falha com 401. */
  async verifyLoginCode(user: MfaUser, code: string): Promise<void> {
    await this.assertNotLocked(user);
    const secret = this.secretOf(user);
    if (!user.mfaEnabled || !secret) throw new UnauthorizedException('Código inválido');

    if (/^\d{6}$/.test(code.trim())) {
      const step = verifyTotp(secret, code.trim(), new Date(), user.mfaLastStep ?? -1);
      if (step !== null) {
        // Condicional: dois logins simultâneos com o mesmo código, só um passa.
        const claimed = await this.prisma.system.user.updateMany({
          where: {
            id: user.id,
            OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }],
          },
          data: { mfaLastStep: step },
        });
        if (claimed.count === 1) return;
      }
    } else {
      const hash = hashRecoveryCode(code);
      const hashes = Array.isArray(user.mfaRecoveryCodes)
        ? (user.mfaRecoveryCodes as string[])
        : [];
      if (hashes.includes(hash)) {
        const remaining = hashes.filter((h) => h !== hash);
        const fresh = await this.prisma.system.user.findUniqueOrThrow({ where: { id: user.id } });
        const current = Array.isArray(fresh.mfaRecoveryCodes)
          ? (fresh.mfaRecoveryCodes as string[])
          : [];
        if (current.includes(hash)) {
          await this.prisma.system.user.update({
            where: { id: user.id },
            data: { mfaRecoveryCodes: current.filter((h) => h !== hash) },
          });
          await this.audit.record({
            tenantId: user.tenantId,
            actorId: user.id,
            action: 'auth.mfa_recovery_code_used',
            entity: 'User',
            entityId: user.id,
            after: { remaining: remaining.length },
          });
          return;
        }
      }
    }
    await this.recordFailure(user);
    throw new UnauthorizedException('Código inválido');
  }

  // --- conta do usuário ------------------------------------------------------------------------------------

  async status(user: MfaUser): Promise<MfaStatusDto> {
    return {
      enabled: user.mfaEnabled,
      required: this.isRequiredFor(user.tenant.settings, user.role),
      recoveryCodesLeft: Array.isArray(user.mfaRecoveryCodes) ? user.mfaRecoveryCodes.length : 0,
    };
  }

  async disable(user: MfaUser, password: string, code: string): Promise<void> {
    if (this.isRequiredFor(user.tenant.settings, user.role))
      throw new UnprocessableEntityException({
        code: 'MFA_REQUIRED_BY_POLICY',
        message: 'A empresa exige o segundo fator para o seu perfil: ele não pode ser desativado.',
      });
    if (!(await this.passwords.verify(user.passwordHash, password)))
      throw new UnprocessableEntityException({
        code: 'INVALID_PASSWORD',
        message: 'Senha incorreta.',
      });
    await this.verifyLoginCode(user, code).catch(() => {
      throw new UnprocessableEntityException({
        code: 'INVALID_MFA_CODE',
        message: 'Código incorreto.',
      });
    });
    await this.clear(user.id);
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.mfa_disabled',
      entity: 'User',
      entityId: user.id,
    });
  }

  /** Administrador remove o segundo fator de quem perdeu o aparelho e os códigos de recuperação. */
  async adminReset(tenantId: string, userId: string, actorId: string): Promise<void> {
    const target = await this.prisma.system.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
    });
    if (!target) throw new UnprocessableEntityException('Usuário não encontrado');
    await this.clear(userId);
    await this.audit.record({
      tenantId,
      actorId,
      action: 'auth.mfa_reset_by_admin',
      entity: 'User',
      entityId: userId,
    });
  }

  private async clear(userId: string): Promise<void> {
    await this.prisma.system.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: [],
        mfaEnabledAt: null,
        mfaLastStep: null,
      },
    });
  }
}
