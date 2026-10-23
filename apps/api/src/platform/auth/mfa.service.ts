import { Injectable } from '@nestjs/common';
import { PrismaService } from '@voltex/database';
import { randomBytes, scryptSync } from 'node:crypto';
import { promisify } from 'node:util';
import * as otplib from 'otplib';

const scrypt = promisify(scryptSync) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gera setup de MFA (QR code e backup codes).
   */
  async setupMfa(
    userId: string,
    email: string,
  ): Promise<{ qrCode: string; secret: string; backupCodes: string[] }> {
    const secret = otplib.authenticator.generateSecret({
      name: `Voltex (${email})`,
      issuer: 'Voltex',
    });

    const backupCodes = Array.from({ length: 10 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );

    const backupCodesHash = await this.hashBackupCodes(backupCodes);

    await this.prisma.system.user.update({
      where: { id: userId },
      data: {
        mfaSecret: secret,
        mfaBackupCodes: backupCodesHash,
      },
    });

    const qrCode = otplib.authenticator.keyuri(email, 'Voltex', secret);

    return { qrCode, secret, backupCodes };
  }

  /**
   * Verifica e ativa MFA.
   */
  async verifyAndEnableMfa(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.system.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.mfaSecret) {
      return false;
    }

    const isValid = otplib.authenticator.check(code, user.mfaSecret);
    if (!isValid) {
      return false;
    }

    await this.prisma.system.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    return true;
  }

  /**
   * Valida código TOTP.
   */
  async validateTotp(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.system.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      return false;
    }

    return otplib.authenticator.check(code, user.mfaSecret);
  }

  /**
   * Valida backup code.
   */
  async validateBackupCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.system.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.mfaBackupCodes) {
      return false;
    }

    const codes = user.mfaBackupCodes as string[];
    const codeHash = await this.hashToken(code);

    const isValid = codes.includes(codeHash);
    if (isValid) {
      const updatedCodes = codes.filter((c) => c !== codeHash);
      await this.prisma.system.user.update({
        where: { id: userId },
        data: { mfaBackupCodes: updatedCodes },
      });
    }

    return isValid;
  }

  /**
   * Desativa MFA.
   */
  async disableMfa(userId: string): Promise<void> {
    await this.prisma.system.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: null,
      },
    });
  }

  private async hashToken(token: string): Promise<string> {
    const salt = 'voltex-mfa-salt';
    const hash = scryptSync(token, salt, 64);
    return hash.toString('hex');
  }

  private async hashBackupCodes(codes: string[]): Promise<string[]> {
    return Promise.all(codes.map((code) => this.hashToken(code)));
  }
}
