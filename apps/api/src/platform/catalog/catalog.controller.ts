import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe, createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  attachDatasheetSchema,
  type CreateEquipmentData,
  createEquipmentSchema,
  EQUIPMENT_KINDS,
  importCommitSchema,
  importPreviewQuerySchema,
  inmetroCheckSchema,
  listEquipmentQuerySchema,
  listReferencesQuerySchema,
  priceImportQuerySchema,
  updateEquipmentSchema,
} from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import type { UploadedFile as UploadedFileType } from '../documents/documents.service';
import { CatalogImportService } from './catalog-import.service';
import { CatalogService } from './catalog.service';
import { PRICE_TEMPLATE, PriceListService } from './price-list.service';
import { ReferencesService } from './references.service';

class UpdateEquipmentDto extends createZodDto(updateEquipmentSchema) {}
class ListEquipmentQueryDto extends createZodDto(listEquipmentQuerySchema) {}
class InmetroDto extends createZodDto(inmetroCheckSchema) {}
class DatasheetDto extends createZodDto(attachDatasheetSchema) {}
class ImportPreviewQueryDto extends createZodDto(importPreviewQuerySchema) {}
class ImportCommitDto extends createZodDto(importCommitSchema) {}
class ListReferencesQueryDto extends createZodDto(listReferencesQuerySchema) {}
class PriceImportQueryDto extends createZodDto(priceImportQuerySchema) {}
class KindQueryDto extends createZodDto(z.object({ kind: z.enum(EQUIPMENT_KINDS) })) {}
class ReferenceKindDto extends createZodDto(z.object({ kind: z.enum(['MODULE', 'INVERTER']) })) {}
class PriceListQueryDto extends createZodDto(z.object({ equipmentId: z.uuid().optional() })) {}
class AdoptDto extends createZodDto(
  z.object({ spec: z.record(z.string(), z.unknown()).optional() }),
) {}

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const upload = FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } });

/**
 * Catálogo técnico da empresa (ADR-0017). Ler: `platform.catalog.read`. Cadastrar, importar e propor:
 * `platform.catalog.manage`. **Aprovar e aposentar** (o que libera o uso em projeto): `engine.project.approve`,
 * do responsável técnico.
 */
@ApiTags('Catálogo técnico')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly imports: CatalogImportService,
    private readonly prices: PriceListService,
    private readonly references: ReferencesService,
  ) {}

  @Get('items')
  @RequirePermissions('platform.catalog.read')
  list(@Query() query: ListEquipmentQueryDto) {
    return this.catalog.list(query);
  }

  @Get('items/:id')
  @RequirePermissions('platform.catalog.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.get(id);
  }

  @Post('items')
  @RequirePermissions('platform.catalog.manage')
  create(@Body(new ZodValidationPipe(createEquipmentSchema)) body: CreateEquipmentData) {
    return this.catalog.create(body);
  }

  @Patch('items/:id')
  @RequirePermissions('platform.catalog.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEquipmentDto) {
    return this.catalog.update(id, body);
  }

  @Delete('items/:id')
  @HttpCode(200)
  @RequirePermissions('platform.catalog.manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.remove(id);
  }

  @Post('items/:id/approve')
  @HttpCode(200)
  @RequirePermissions('engine.project.approve')
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.approve(id);
  }

  @Post('items/:id/retire')
  @HttpCode(200)
  @RequirePermissions('engine.project.approve')
  retire(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.retire(id);
  }

  @Post('items/:id/revise')
  @RequirePermissions('platform.catalog.manage')
  revise(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.revise(id);
  }

  @Post('items/:id/inmetro')
  @HttpCode(200)
  @RequirePermissions('platform.catalog.manage')
  inmetro(@Param('id', ParseUUIDPipe) id: string, @Body() body: InmetroDto) {
    return this.catalog.setInmetro(id, body);
  }

  @Post('items/:id/datasheet')
  @HttpCode(200)
  @RequirePermissions('platform.catalog.manage')
  datasheet(@Param('id', ParseUUIDPipe) id: string, @Body() body: DatasheetDto) {
    return this.catalog.attachDatasheet(id, body.documentId);
  }

  // ---- Importação ----

  @Get('import/template')
  @RequirePermissions('platform.catalog.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  template(@Query() query: KindQueryDto) {
    return this.imports.template(query.kind);
  }

  @Post('import/preview')
  @HttpCode(200)
  @RequirePermissions('platform.catalog.manage')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  preview(
    @UploadedFile() file: UploadedFileType | undefined,
    @Query() query: ImportPreviewQueryDto,
  ) {
    return this.imports.preview(file, query.format, query.kind);
  }

  @Post('import/commit')
  @RequirePermissions('platform.catalog.manage')
  commit(@Body() body: ImportCommitDto) {
    return this.imports.commit(body);
  }

  // ---- Referências externas ----

  @Get('references')
  @RequirePermissions('platform.catalog.read')
  listReferences(@Query() query: ListReferencesQueryDto) {
    return this.references.list(query);
  }

  @Post('references/import')
  @HttpCode(200)
  @RequirePermissions('platform.catalog.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 40 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  importReferences(
    @UploadedFile() file: UploadedFileType | undefined,
    @Query() query: ReferenceKindDto,
  ) {
    if (!file || file.size === 0) throw new BadRequestException('Envie a planilha no campo "file"');
    return this.references.importCec(query.kind, file.buffer.toString('utf8'));
  }

  @Post('references/:id/adopt')
  @RequirePermissions('platform.catalog.manage')
  adopt(@Param('id', ParseUUIDPipe) id: string, @Body() body: AdoptDto) {
    return this.references.adopt(id, body.spec);
  }

  // ---- Preços ----

  @Get('prices')
  @RequirePermissions('platform.catalog.read')
  listPrices(@Query() query: PriceListQueryDto) {
    return this.prices.list(query.equipmentId);
  }

  @Get('prices/template')
  @RequirePermissions('platform.catalog.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  priceTemplate() {
    return PRICE_TEMPLATE;
  }

  @Post('prices/import')
  @HttpCode(200)
  @RequirePermissions('platform.catalog.manage')
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  importPrices(
    @UploadedFile() file: UploadedFileType | undefined,
    @Query() query: PriceImportQueryDto,
  ) {
    if (!file || file.size === 0) throw new BadRequestException('Envie a planilha no campo "file"');
    return this.prices.import(file.buffer, file.originalname, query.dryRun ?? false);
  }
}
