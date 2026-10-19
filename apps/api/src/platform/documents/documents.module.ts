import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { Env } from '../../config/env';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { S3Service } from './s3.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      // Memória: o arquivo é validado (tipo + assinatura) antes de ir ao S3. O limite barra uploads gigantes.
      useFactory: (config: ConfigService<Env, true>) => ({
        limits: { fileSize: config.get('UPLOAD_MAX_BYTES', { infer: true }), files: 1 },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, S3Service],
  exports: [S3Service, DocumentsService],
})
export class DocumentsModule {}
