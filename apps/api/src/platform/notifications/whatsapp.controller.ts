import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppMessageSchema } from '@voltex/shared';
import { Request } from 'express';

@Controller('notifications/whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  /**
   * POST /notifications/whatsapp/link
   * Gera link wa.me para envio manual.
   */
  @Post('link')
  @HttpCode(HttpStatus.OK)
  async generateLink(@Body() body: unknown) {
    const parsed = WhatsAppMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Dados inválidos');
    }

    const { phoneE164, message } = parsed.data;
    return this.whatsAppService.generateCopyLink(phoneE164, message);
  }

  /**
   * POST /notifications/whatsapp/send
   * Registra envio de link no histórico.
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  async recordSend(@Body() body: unknown, @Req() req: Request) {
    const parsed = WhatsAppMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Dados inválidos');
    }

    const tenantId = (req as any).tenantId;
    const userId = (req.user as any)?.id;

    const { phoneE164, message, entityType, entityId } = parsed.data;

    await this.whatsAppService.recordWhatsAppLink(
      tenantId,
      phoneE164,
      message,
      entityType,
      entityId,
      userId,
    );

    return { success: true, message: 'Link registrado' };
  }
}
