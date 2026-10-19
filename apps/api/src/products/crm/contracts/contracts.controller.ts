import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  cancelContractSchema,
  createContractSchema,
  signContractSchema,
  updateContractTemplateSchema,
} from '@voltex/shared';
import { RequirePermissions } from '../../../common/decorators';
import type { UploadedFile as UploadedFileType } from '../../../platform/documents/documents.service';
import { ContractsService } from './contracts.service';

class TemplateDto extends createZodDto(updateContractTemplateSchema) {}
class CreateContractDto extends createZodDto(createContractSchema) {}
class UploadTemplateDto extends createZodDto(
  z.object({ name: z.string().trim().max(80).optional() }),
) {}
class CancelContractDto extends createZodDto(cancelContractSchema) {}
class SignContractDto extends createZodDto(signContractSchema) {}

@ApiTags('CRM · Contratos')
@ApiBearerAuth()
@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get('contract-template')
  @RequirePermissions('crm.contract.read')
  template() {
    return this.contracts.getTemplate();
  }

  @Put('contract-template')
  @RequirePermissions('crm.contract.write')
  saveTemplate(@Body() body: TemplateDto) {
    return this.contracts.saveTemplate(body);
  }

  /** Envia o modelo em Word (.docx) da empresa: vira a próxima versão do modelo. */
  @Post('contract-template/upload')
  @HttpCode(201)
  @RequirePermissions('crm.contract.write', 'platform.document.write')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' }, name: { type: 'string' } },
    },
  })
  uploadTemplate(
    @UploadedFile() file: UploadedFileType | undefined,
    @Body() body: UploadTemplateDto,
  ) {
    return this.contracts.uploadTemplate(file, body.name);
  }

  @Get('contract-template/file-url')
  @RequirePermissions('crm.contract.read')
  templateFileUrl() {
    return this.contracts.templateFileUrl();
  }

  @Get('opportunities/:id/contracts')
  @RequirePermissions('crm.contract.read')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.list(id);
  }

  @Post('opportunities/:id/contracts')
  @RequirePermissions('crm.contract.write')
  generate(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateContractDto) {
    return this.contracts.generate(id, body);
  }

  @Get('contracts/:id')
  @RequirePermissions('crm.contract.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.get(id);
  }

  @Get('contracts/:id/pdf-url')
  @RequirePermissions('crm.contract.read')
  pdfUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.pdfUrl(id);
  }

  @Get('contracts/:id/signed-url')
  @RequirePermissions('crm.contract.read')
  signedUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.signedUrl(id);
  }

  @Post('contracts/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('crm.contract.write')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: CancelContractDto) {
    return this.contracts.cancel(id, body);
  }

  /** Registra o contrato assinado (arquivo digitalizado): fecha o ganho e cria o projeto. */
  @Post('contracts/:id/sign')
  @HttpCode(200)
  @RequirePermissions('crm.contract.write', 'platform.document.write')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        signedAt: { type: 'string', format: 'date-time' },
        signedByName: { type: 'string' },
      },
    },
  })
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileType | undefined,
    @Body() body: SignContractDto,
  ) {
    return this.contracts.sign(id, file, body);
  }
}
