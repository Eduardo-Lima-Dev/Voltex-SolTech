import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  listCommunicationsQuerySchema,
  logCopiedLinkSchema,
  sendEmailSchema,
  whatsAppLinkSchema,
} from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { NotificationsService } from './notifications.service';

class SendEmailDto extends createZodDto(sendEmailSchema) {}
class WhatsAppLinkDto extends createZodDto(whatsAppLinkSchema) {}
class LogCopiedLinkDto extends createZodDto(logCopiedLinkSchema) {}
class ListCommunicationsQueryDto extends createZodDto(listCommunicationsQuerySchema) {}

@ApiTags('Comunicações')
@ApiBearerAuth()
@Controller('communications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('templates')
  @RequirePermissions('platform.communication.send')
  templates() {
    return this.notifications.listTemplates();
  }

  @Get()
  @RequirePermissions('platform.communication.send')
  list(@Query() query: ListCommunicationsQueryDto) {
    return this.notifications.list(query);
  }

  @Post('email')
  @RequirePermissions('platform.communication.send')
  email(@Body() body: SendEmailDto) {
    return this.notifications.sendEmail(body);
  }

  /** Devolve o link `wa.me` com a mensagem pronta e registra no histórico; quem envia é o usuário, no próprio WhatsApp. */
  @Post('whatsapp-link')
  @RequirePermissions('platform.communication.send')
  whatsAppLink(@Body() body: WhatsAppLinkDto) {
    return this.notifications.whatsAppLink(body);
  }

  @Post('copied-link')
  @RequirePermissions('platform.communication.send')
  copiedLink(@Body() body: LogCopiedLinkDto) {
    return this.notifications.logCopiedLink(body);
  }
}
