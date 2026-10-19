import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { createErasureSchema, paginationQuerySchema, retentionPolicySchema } from '@voltex/shared';
import { RequirePermissions } from '../../../common/decorators';
import { PrivacyService } from './privacy.service';

class PolicyDto extends createZodDto(retentionPolicySchema) {}
class ErasureDto extends createZodDto(createErasureSchema) {}
class ListDto extends createZodDto(paginationQuerySchema) {}

@ApiTags('Privacidade (LGPD)')
@ApiBearerAuth()
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('retention')
  @RequirePermissions('platform.tenant.manage')
  policy() {
    return this.privacy.getPolicy();
  }

  @Put('retention')
  @RequirePermissions('platform.tenant.manage')
  updatePolicy(@Body() body: PolicyDto) {
    return this.privacy.updatePolicy(body);
  }

  @Get('erasures')
  @RequirePermissions('platform.tenant.manage')
  list(@Query() query: ListDto) {
    return this.privacy.list(query);
  }

  /** Elimina (anonimiza) os dados pessoais de um lead ou de uma conta. Bloqueado por lei ou negócio aberto: 409. */
  @Post('erasures')
  @HttpCode(201)
  @RequirePermissions('platform.tenant.manage')
  erase(@Body() body: ErasureDto) {
    return this.privacy.requestErasure(body);
  }
}
