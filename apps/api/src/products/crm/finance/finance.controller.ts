import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  cancelReceivableSchema,
  createCommissionPolicySchema,
  createCostEntrySchema,
  createCreditApplicationSchema,
  createReceivableSchema,
  markCommissionPaidSchema,
  markReceivablePaidSchema,
  updateCreditStatusSchema,
} from '@voltex/shared';
import { RequirePermissions } from '../../../common/decorators';
import { FinanceService } from './finance.service';

class CreateReceivableDto extends createZodDto(createReceivableSchema) {}
class MarkReceivablePaidDto extends createZodDto(markReceivablePaidSchema) {}
class CancelReceivableDto extends createZodDto(cancelReceivableSchema) {}
class CreateCostEntryDto extends createZodDto(createCostEntrySchema) {}
class CreateCreditDto extends createZodDto(createCreditApplicationSchema) {}
class UpdateCreditStatusDto extends createZodDto(updateCreditStatusSchema) {}
class MarkCommissionPaidDto extends createZodDto(markCommissionPaidSchema) {}
class CreateCommissionPolicyDto extends createZodDto(createCommissionPolicySchema) {}

/** Financeiro por projeto: parcelas, custos, crédito e comissões. Registro manual, sem gateway (ADR-0024). */
@ApiTags('CRM · Financeiro')
@ApiBearerAuth()
@Controller('projects/:projectId/finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('summary')
  @RequirePermissions('crm.finance.read')
  summary(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.finance.summary(projectId);
  }

  @Get('receivables')
  @RequirePermissions('crm.finance.read')
  receivables(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.finance.listReceivables(projectId);
  }

  @Post('receivables')
  @RequirePermissions('crm.finance.write')
  createReceivable(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateReceivableDto,
  ) {
    return this.finance.createReceivable(projectId, body);
  }

  @Post('receivables/:receivableId/pay')
  @HttpCode(200)
  @RequirePermissions('crm.finance.write')
  pay(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('receivableId', ParseUUIDPipe) receivableId: string,
    @Body() body: MarkReceivablePaidDto,
  ) {
    return this.finance.markPaid(projectId, receivableId, body);
  }

  @Post('receivables/:receivableId/cancel')
  @HttpCode(200)
  @RequirePermissions('crm.finance.write')
  cancel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('receivableId', ParseUUIDPipe) receivableId: string,
    @Body() body: CancelReceivableDto,
  ) {
    return this.finance.cancelReceivable(projectId, receivableId, body);
  }

  @Post('costs')
  @RequirePermissions('crm.finance.write')
  addCost(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() body: CreateCostEntryDto) {
    return this.finance.addCost(projectId, body);
  }

  @Delete('costs/:costId')
  @HttpCode(204)
  @RequirePermissions('crm.finance.write')
  removeCost(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('costId', ParseUUIDPipe) costId: string,
  ) {
    return this.finance.removeCost(projectId, costId);
  }

  @Post('credit-applications')
  @RequirePermissions('crm.finance.write')
  createCredit(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateCreditDto,
  ) {
    return this.finance.createCredit(projectId, body);
  }

  @Post('credit-applications/:creditId/status')
  @HttpCode(200)
  @RequirePermissions('crm.finance.write')
  creditStatus(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('creditId', ParseUUIDPipe) creditId: string,
    @Body() body: UpdateCreditStatusDto,
  ) {
    return this.finance.updateCreditStatus(projectId, creditId, body);
  }

  @Post('commissions/recalculate')
  @HttpCode(200)
  @RequirePermissions('crm.finance.write')
  recalculate(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.finance.recalculateCommissions(projectId);
  }

  @Post('commissions/:commissionId/pay')
  @HttpCode(200)
  @RequirePermissions('crm.finance.write')
  payCommission(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('commissionId', ParseUUIDPipe) commissionId: string,
    @Body() body: MarkCommissionPaidDto,
  ) {
    return this.finance.markCommissionPaid(projectId, commissionId, body);
  }
}

/** Visão da empresa e política de comissão (a política é da empresa, não do projeto). */
@ApiTags('CRM · Financeiro')
@ApiBearerAuth()
@Controller('finance')
export class FinanceOverviewController {
  constructor(private readonly finance: FinanceService) {}

  @Get('overview')
  @RequirePermissions('crm.finance.read')
  overview() {
    return this.finance.overview();
  }

  @Get('commission-policies')
  @RequirePermissions('crm.finance.read')
  policies() {
    return this.finance.listPolicies();
  }

  @Post('commission-policies')
  @RequirePermissions('crm.finance.write')
  createPolicy(@Body() body: CreateCommissionPolicyDto) {
    return this.finance.createPolicy(body);
  }
}
