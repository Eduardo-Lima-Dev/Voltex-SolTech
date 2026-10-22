import { Module } from '@nestjs/common';
import { DataExportService } from './data-export.service';
import { PlanService } from './plan.service';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

@Module({
  controllers: [TenancyController],
  providers: [TenancyService, DataExportService, PlanService],
  exports: [TenancyService, PlanService],
})
export class TenancyModule {}
