import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  createMarginPolicySchema,
  decideApprovalSchema,
  listApprovalsQuerySchema,
  requestApprovalSchema,
  updateMarginPolicySchema,
} from '@voltex/shared';
import { saveQuoteSchema, updateQuoteSchema } from '@voltex/solar-engine';
import { RequirePermissions } from '../../../common/decorators';
import { MarginPoliciesService } from './margin-policies.service';
import { QuotesService } from './quotes.service';

class SaveQuoteDto extends createZodDto(saveQuoteSchema) {}
class UpdateQuoteDto extends createZodDto(updateQuoteSchema) {}
class RequestApprovalDto extends createZodDto(requestApprovalSchema) {}
class DecideApprovalDto extends createZodDto(decideApprovalSchema) {}
class ListApprovalsQueryDto extends createZodDto(listApprovalsQuerySchema) {}
class CreateMarginPolicyDto extends createZodDto(createMarginPolicySchema) {}
class UpdateMarginPolicyDto extends createZodDto(updateMarginPolicySchema) {}

@ApiTags('CRM · Cotação e Margin Guard')
@ApiBearerAuth()
@Controller()
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly policies: MarginPoliciesService,
  ) {}

  @Get('opportunities/:id/quotes')
  @RequirePermissions('crm.quote.read')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.list(id);
  }

  @Post('opportunities/:id/quotes')
  @RequirePermissions('crm.quote.write')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() body: SaveQuoteDto) {
    return this.quotes.create(id, body);
  }

  @Get('quotes/:id')
  @RequirePermissions('crm.quote.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(id);
  }

  @Patch('quotes/:id')
  @RequirePermissions('crm.quote.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateQuoteDto) {
    return this.quotes.update(id, body);
  }

  @Delete('quotes/:id')
  @RequirePermissions('crm.quote.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.remove(id);
  }

  @Post('quotes/:id/request-approval')
  @HttpCode(200)
  @RequirePermissions('crm.quote.write')
  requestApproval(@Param('id', ParseUUIDPipe) id: string, @Body() body: RequestApprovalDto) {
    return this.quotes.requestApproval(id, body);
  }

  // ---- Aprovações de margem ----

  @Get('approvals')
  @RequirePermissions('crm.margin.approve')
  listApprovals(@Query() query: ListApprovalsQueryDto) {
    return this.quotes.listApprovals(query);
  }

  @Post('approvals/:id/decide')
  @HttpCode(200)
  @RequirePermissions('crm.margin.approve')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecideApprovalDto) {
    return this.quotes.decide(id, body);
  }

  // ---- Política de margem ----

  @Get('margin-policies')
  @RequirePermissions('crm.margin.read')
  listPolicies() {
    return this.policies.list();
  }

  @Post('margin-policies')
  @RequirePermissions('crm.margin-policy.manage')
  createPolicy(@Body() body: CreateMarginPolicyDto) {
    return this.policies.create(body);
  }

  @Patch('margin-policies/:id')
  @RequirePermissions('crm.margin-policy.manage')
  updatePolicy(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateMarginPolicyDto) {
    return this.policies.update(id, body);
  }

  @Delete('margin-policies/:id')
  @RequirePermissions('crm.margin-policy.manage')
  removePolicy(@Param('id', ParseUUIDPipe) id: string) {
    return this.policies.remove(id);
  }
}
