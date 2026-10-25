import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import { confirmPriceExtractionSchema } from '@voltex/shared';
import type { RequestUser } from '../../../common/context/request-user';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { assertAllowedFile } from '../../documents/file-validation';
import { PriceExtractionService } from './price-extraction.service';

class ConfirmDto extends createZodDto(confirmPriceExtractionSchema) {}

const upload = FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

@ApiTags('Procurement assistido')
@ApiBearerAuth()
@Controller('ai/procurement/extractions')
export class PriceExtractionController {
  constructor(private readonly extractions: PriceExtractionService) {}

  /** Lê o PDF ou CSV de preços do fornecedor e devolve a prévia. Não grava nada na lista de preços. */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('procurement.price.extract')
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  extract(
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number } | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file || file.size === 0) throw new BadRequestException('Envie o arquivo no campo "file"');
    assertAllowedFile(file.mimetype, file.buffer);
    return this.extractions.extract(user, file);
  }

  @Get()
  @RequirePermissions('procurement.price.extract')
  list() {
    return this.extractions.list();
  }

  @Get(':id')
  @RequirePermissions('procurement.price.extract')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.extractions.get(id);
  }

  /** Confirma as linhas da prévia e importa pela rotina de preços (exige também gerenciar o catálogo). */
  @Post(':id/import')
  @HttpCode(200)
  @RequirePermissions('procurement.price.extract', 'platform.catalog.manage')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.extractions.confirm(user, id, body);
  }

  @Post(':id/discard')
  @HttpCode(200)
  @RequirePermissions('procurement.price.extract')
  discard(@Param('id', ParseUUIDPipe) id: string) {
    return this.extractions.discard(id);
  }
}
