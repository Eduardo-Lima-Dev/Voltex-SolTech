import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { createPortalAccessSchema, reviewPortalUploadSchema } from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { PortalAdminService } from './portal-admin.service';

class CreateAccessDto extends createZodDto(createPortalAccessSchema) {}
class ReviewDto extends createZodDto(reviewPortalUploadSchema) {}
class ListByAccountDto extends createZodDto(z.object({ accountId: z.uuid() })) {}
class ListUploadsDto extends createZodDto(
  z.object({ status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).default('PENDING') }),
) {}

/** Gestão do portal pelo usuário interno (`crm.portal.manage`). */
@ApiTags('CRM · Portal do cliente')
@ApiBearerAuth()
@Controller('portal-access')
@RequirePermissions('crm.portal.manage')
export class PortalAdminController {
  constructor(private readonly admin: PortalAdminService) {}

  @Get()
  list(@Query() query: ListByAccountDto) {
    return this.admin.list(query.accountId);
  }

  @Post()
  create(@Body() body: CreateAccessDto) {
    return this.admin.create(body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deactivate(id);
  }

  /** Gera um link novo (30 minutos, uso único). O envio é feito por `/communications` (e-mail, WhatsApp ou cópia). */
  @Post(':id/link')
  @HttpCode(200)
  link(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.link(id);
  }

  @Get('uploads')
  uploads(@Query() query: ListUploadsDto) {
    return this.admin.listUploads(query.status);
  }

  @Post('uploads/:id/review')
  @HttpCode(200)
  review(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDto) {
    return this.admin.review(id, body);
  }
}
