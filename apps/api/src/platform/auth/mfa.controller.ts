import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { MfaService } from './mfa.service';
import { MfaVerifyRequestSchema, MfaStatusSchema } from '@voltex/shared';
import { Request } from 'express';

@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  /**
   * POST /auth/mfa/setup
   * Inicia setup de MFA (retorna QR code e backup codes).
   */
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  async setupMfa(@Req() req: Request) {
    const userId = (req.user as any)?.id;
    if (!userId) {
      throw new BadRequestException('Usuário não autenticado');
    }

    const email = (req.user as any)?.email;
    return this.mfaService.setupMfa(userId, email);
  }

  /**
   * POST /auth/mfa/verify
   * Verifica código TOTP e ativa MFA.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyAndEnable(@Req() req: Request, @Body() body: unknown) {
    const parsed = MfaVerifyRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Código inválido');
    }

    const userId = (req.user as any)?.id;
    const success = await this.mfaService.verifyAndEnableMfa(userId, parsed.data.code);

    if (!success) {
      throw new BadRequestException('Código não corresponde');
    }

    return { success: true, message: 'MFA ativado com sucesso' };
  }

  /**
   * POST /auth/mfa/disable
   * Desativa MFA (requer autenticação).
   */
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disableMfa(@Req() req: Request) {
    const userId = (req.user as any)?.id;
    await this.mfaService.disableMfa(userId);
    return { success: true, message: 'MFA desativado' };
  }

  /**
   * GET /auth/mfa/status
   * Status de MFA do usuário.
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getStatus(@Req() req: Request) {
    const user = req.user as any;
    return {
      enabled: user?.mfaEnabled || false,
      backupCodesCount: user?.mfaBackupCodes?.length || 0,
    };
  }
}
