import { Injectable } from '@nestjs/common';
import { PrismaService } from '@voltex/database';

@Injectable()
export class WhatsAppService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gera link wa.me para uma mensagem.
   */
  generateLink(phoneE164: string, message: string): string {
    const encoded = encodeURIComponent(message);
    return `https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encoded}`;
  }

  /**
   * Registra envio de link WhatsApp no histórico.
   */
  async recordWhatsAppLink(
    tenantId: string,
    phoneE164: string,
    message: string,
    entityType: string,
    entityId: string,
    sentById: string,
  ): Promise<void> {
    const link = this.generateLink(phoneE164, message);

    await this.prisma.platform.communicationLog.create({
      data: {
        tenantId,
        channel: 'WHATSAPP_LINK',
        recipient: phoneE164,
        templateKey: 'whatsapp_link',
        entityType,
        entityId,
        sentById,
        metadata: { link, message },
      },
    });
  }

  /**
   * Gera link de cópia para envio manual.
   */
  generateCopyLink(phoneE164: string, message: string): { link: string; preview: string } {
    return {
      link: this.generateLink(phoneE164, message),
      preview: `${message}\n\n---\nEnviado via Voltex em ${new Date().toLocaleDateString('pt-BR')}`,
    };
  }
}
