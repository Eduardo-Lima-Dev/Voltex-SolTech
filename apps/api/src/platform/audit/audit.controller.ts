import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { listAuditLogsQuerySchema } from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { AuditService } from './audit.service';

class ListAuditLogsQueryDto extends createZodDto(listAuditLogsQuerySchema) {}

@ApiTags('Auditoria')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('platform.audit.read')
  list(@Query() query: ListAuditLogsQueryDto) {
    return this.audit.list(query);
  }
}
