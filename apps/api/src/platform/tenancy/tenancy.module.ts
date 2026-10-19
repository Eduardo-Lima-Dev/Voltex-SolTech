import { Module } from '@nestjs/common';
import { DataExportService } from './data-export.service';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

@Module({
  controllers: [TenancyController],
  providers: [TenancyService, DataExportService],
  exports: [TenancyService],
})
export class TenancyModule {}
