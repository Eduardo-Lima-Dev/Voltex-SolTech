import { Module } from '@nestjs/common';
import { DocumentsModule } from '../../platform/documents/documents.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { BILL_PARSER } from './energy-bills/bill-parser';
import { EnergyBillsController } from './energy-bills/energy-bills.controller';
import { EnergyBillsService } from './energy-bills/energy-bills.service';
import { PdfTextBillParser } from './energy-bills/pdf-text-bill-parser';
import { LeadCaptureController, LeadsController, PublicLeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { OpportunitiesController, PipelineController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { PipelineService } from './pipeline.service';
import { TimelineService } from './support/timeline.service';
import { UserDirectory } from './support/user-directory.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [DocumentsModule, CalculatorModule],
  controllers: [
    LeadsController,
    LeadCaptureController,
    PublicLeadsController,
    AccountsController,
    PipelineController,
    OpportunitiesController,
    TasksController,
    EnergyBillsController,
  ],
  providers: [
    UserDirectory,
    TimelineService,
    PipelineService,
    LeadsService,
    AccountsService,
    OpportunitiesService,
    TasksService,
    EnergyBillsService,
    PdfTextBillParser,
    { provide: BILL_PARSER, useExisting: PdfTextBillParser },
  ],
  exports: [OpportunitiesService, TimelineService, UserDirectory, PipelineService, TasksService],
})
export class CrmModule {}
