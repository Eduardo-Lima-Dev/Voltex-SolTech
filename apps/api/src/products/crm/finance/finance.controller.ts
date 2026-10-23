import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import type {
  CreateCreditApplicationInput,
  CreateReceivableInput,
  ProjectFinancialSummaryDto,
} from '@voltex/shared';
import { RequirePermissions } from '../../../common/decorators';
import { FinanceService } from './finance.service';

class CreateReceivableDto extends createZodDto(
  // Would use CreateReceivableInput schema here but we're using inline for now
  class {} as any,
) {}

class CreateCreditApplicationDto extends createZodDto(
  // Would use CreateCreditApplicationInput schema here
  class {} as any,
) {}

/**
 * Financeiro por projeto: recebíveis, custos, comissões, crédito.
 * Rotas sob `/projects/:projectId/finance`.
 */
@Controller('projects/:projectId/finance')
@RequirePermissions('crm.finance.read')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  // --- recebíveis ---------------------------------------------------------------

  @Get('receivables')
  async listReceivables(@Param('projectId', new ParseUUIDPipe()) projectId: string) {
    return await this.finance.listReceivables(projectId);
  }

  @Post('receivables')
  @RequirePermissions('crm.finance.write')
  async createReceivable(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() input: CreateReceivableInput,
  ) {
    return await this.finance.createReceivable(projectId, input);
  }

  @Post('receivables/:receivableId/mark-paid')
  @RequirePermissions('crm.finance.write')
  async markReceivableAsPaid(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('receivableId', new ParseUUIDPipe()) receivableId: string,
    @Body() input: { paymentMethod: string },
  ) {
    return await this.finance.markAsPaid(projectId, receivableId, input.paymentMethod);
  }

  // --- resumo financeiro -------------------------------------------------------

  @Get('summary')
  async getFinancialSummary(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<ProjectFinancialSummaryDto> {
    return await this.finance.getFinancialSummary(projectId);
  }

  // --- crédito ------------------------------------------------------------------

  @Post('credit-applications')
  @RequirePermissions('crm.finance.write')
  async createCreditApplication(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() input: CreateCreditApplicationInput,
  ) {
    return await this.finance.createCreditApplication(projectId, input);
  }

  @Post('credit-applications/:creditId/status')
  @RequirePermissions('crm.finance.write')
  async updateCreditStatus(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('creditId', new ParseUUIDPipe()) creditId: string,
    @Body() input: { status: 'SENT' | 'PENDING' | 'APPROVED' | 'REJECTED'; pendencies?: string[] },
  ) {
    return await this.finance.updateCreditApplicationStatus(
      projectId,
      creditId,
      input.status,
      input.pendencies,
    );
  }
}
