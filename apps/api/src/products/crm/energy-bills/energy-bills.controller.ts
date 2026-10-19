import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  listEnergyBillsQuerySchema,
  rejectEnergyBillSchema,
  validateEnergyBillSchema,
} from '@voltex/shared';
import { RequirePermissions } from '../../../common/decorators';
import type { UploadedFile as UploadedFileType } from '../../../platform/documents/documents.service';
import { EnergyBillsService } from './energy-bills.service';

class UploadBillDto extends createZodDto(
  z.object({ opportunityId: z.uuid().optional(), consumerUnitId: z.uuid().optional() }),
) {}
class ListBillsQueryDto extends createZodDto(listEnergyBillsQuerySchema) {}
class ValidateBillDto extends createZodDto(validateEnergyBillSchema) {}
class RejectBillDto extends createZodDto(rejectEnergyBillSchema) {}

@ApiTags('CRM · Fatura de energia')
@ApiBearerAuth()
@Controller('energy-bills')
export class EnergyBillsController {
  constructor(private readonly bills: EnergyBillsService) {}

  @Post()
  @RequirePermissions('crm.energy-bill.write', 'platform.document.write')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        opportunityId: { type: 'string', format: 'uuid' },
        consumerUnitId: { type: 'string', format: 'uuid' },
      },
    },
  })
  upload(@UploadedFile() file: UploadedFileType | undefined, @Body() body: UploadBillDto) {
    return this.bills.upload(file, body);
  }

  @Get()
  @RequirePermissions('crm.energy-bill.read')
  list(@Query() query: ListBillsQueryDto) {
    return this.bills.list(query);
  }

  @Get(':id')
  @RequirePermissions('crm.energy-bill.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.bills.get(id);
  }

  @Get(':id/snapshots')
  @RequirePermissions('crm.energy-bill.read')
  snapshots(@Param('id', ParseUUIDPipe) id: string) {
    return this.bills.snapshots(id);
  }

  @Get(':id/download-url')
  @RequirePermissions('crm.energy-bill.read')
  downloadUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.bills.downloadUrl(id);
  }

  @Post(':id/validate')
  @HttpCode(200)
  @RequirePermissions('crm.energy-bill.write')
  validate(@Param('id', ParseUUIDPipe) id: string, @Body() body: ValidateBillDto) {
    return this.bills.validate(id, body);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('crm.energy-bill.write')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: RejectBillDto) {
    return this.bills.reject(id, body.reason);
  }
}
