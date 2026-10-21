import { Module } from '@nestjs/common';
import { DocumentsModule } from '../../platform/documents/documents.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { AutomationsService } from './automations/automations.service';
import { ContractsController } from './contracts/contracts.controller';
import { ContractsService } from './contracts/contracts.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { HomologationRulesController } from './projects/homologation-rules.controller';
import { HomologationRulesService } from './projects/homologation-rules.service';
import { PrivacyController } from './privacy/privacy.controller';
import { PrivacyService } from './privacy/privacy.service';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { BILL_PARSER } from './energy-bills/bill-parser';
import { EnergyBillsController } from './energy-bills/energy-bills.controller';
import { EnergyBillsService } from './energy-bills/energy-bills.service';
import { PdfTextBillParser } from './energy-bills/pdf-text-bill-parser';
import { GuardController } from './guard/guard.controller';
import { GuardService } from './guard/guard.service';
import { LeadCaptureController, LeadsController, PublicLeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { OpportunitiesController, PipelineController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { PipelineService } from './pipeline.service';
import { BrandingService } from './proposals/branding.service';
import { ProposalsController, PublicProposalsController } from './proposals/proposals.controller';
import { ProposalsService } from './proposals/proposals.service';
import { MarginPoliciesService } from './quotes/margin-policies.service';
import { QuotesController } from './quotes/quotes.controller';
import { QuotesService } from './quotes/quotes.service';
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
    GuardController,
    ContractsController,
    ProjectsController,
    HomologationRulesController,
    DashboardController,
    PrivacyController,
    QuotesController,
    ProposalsController,
    PublicProposalsController,
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
    GuardService,
    MarginPoliciesService,
    QuotesService,
    BrandingService,
    ProposalsService,
    HomologationRulesService,
    ProjectsService,
    ContractsService,
    DashboardService,
    PrivacyService,
    AutomationsService,
    { provide: BILL_PARSER, useExisting: PdfTextBillParser },
  ],
  exports: [
    OpportunitiesService,
    TimelineService,
    UserDirectory,
    PipelineService,
    TasksService,
    GuardService,
    QuotesService,
    ProposalsService,
    HomologationRulesService,
  ],
})
export class CrmModule {}
