import {
  Body,
  Controller,
  Delete,
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
import { listDocumentsQuerySchema, uploadDocumentSchema } from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { DocumentsService, type UploadedFile as UploadedFileType } from './documents.service';

class UploadDocumentDto extends createZodDto(uploadDocumentSchema) {}
class ListDocumentsQueryDto extends createZodDto(listDocumentsQuerySchema) {}

@ApiTags('Documentos')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @RequirePermissions('platform.document.write')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        entityType: { type: 'string' },
        entityId: { type: 'string' },
        replacesDocumentId: { type: 'string', format: 'uuid' },
      },
    },
  })
  upload(@UploadedFile() file: UploadedFileType | undefined, @Body() body: UploadDocumentDto) {
    return this.documents.upload(file, body);
  }

  @Get()
  @RequirePermissions('platform.document.read')
  list(@Query() query: ListDocumentsQueryDto) {
    return this.documents.list(query);
  }

  @Get(':id')
  @RequirePermissions('platform.document.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(id);
  }

  @Get(':id/versions')
  @RequirePermissions('platform.document.read')
  versions(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.versions(id);
  }

  @Get(':id/download-url')
  @RequirePermissions('platform.document.read')
  downloadUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.downloadUrl(id);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('platform.document.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.remove(id);
  }
}
