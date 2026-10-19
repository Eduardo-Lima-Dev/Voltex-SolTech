import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  createAccountSchema,
  createConsumerUnitSchema,
  createContactSchema,
  createSiteSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
  updateConsumerUnitSchema,
  updateContactSchema,
  updateSiteSchema,
} from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { AccountsService } from './accounts.service';

class CreateAccountDto extends createZodDto(createAccountSchema) {}
class UpdateAccountDto extends createZodDto(updateAccountSchema) {}
class ListAccountsQueryDto extends createZodDto(listAccountsQuerySchema) {}
class CreateContactDto extends createZodDto(createContactSchema) {}
class UpdateContactDto extends createZodDto(updateContactSchema) {}
class CreateSiteDto extends createZodDto(createSiteSchema) {}
class UpdateSiteDto extends createZodDto(updateSiteSchema) {}
class CreateConsumerUnitDto extends createZodDto(createConsumerUnitSchema) {}
class UpdateConsumerUnitDto extends createZodDto(updateConsumerUnitSchema) {}

@ApiTags('CRM · Contas')
@ApiBearerAuth()
@Controller()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('accounts')
  @RequirePermissions('crm.account.read')
  list(@Query() query: ListAccountsQueryDto) {
    return this.accounts.list(query);
  }

  @Post('accounts')
  @RequirePermissions('crm.account.write')
  create(@Body() body: CreateAccountDto) {
    return this.accounts.create(body);
  }

  @Get('accounts/:id')
  @RequirePermissions('crm.account.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(id);
  }

  @Patch('accounts/:id')
  @RequirePermissions('crm.account.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateAccountDto) {
    return this.accounts.update(id, body);
  }

  @Delete('accounts/:id')
  @RequirePermissions('crm.account.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.remove(id);
  }

  // ---- Contatos ----
  @Post('accounts/:id/contacts')
  @RequirePermissions('crm.account.write')
  addContact(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateContactDto) {
    return this.accounts.addContact(id, body);
  }

  @Patch('contacts/:id')
  @RequirePermissions('crm.account.write')
  updateContact(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateContactDto) {
    return this.accounts.updateContact(id, body);
  }

  @Delete('contacts/:id')
  @RequirePermissions('crm.account.write')
  removeContact(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.removeContact(id);
  }

  // ---- Imóveis ----
  @Post('accounts/:id/sites')
  @RequirePermissions('crm.account.write')
  addSite(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateSiteDto) {
    return this.accounts.addSite(id, body);
  }

  @Patch('sites/:id')
  @RequirePermissions('crm.account.write')
  updateSite(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSiteDto) {
    return this.accounts.updateSite(id, body);
  }

  @Delete('sites/:id')
  @RequirePermissions('crm.account.write')
  removeSite(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.removeSite(id);
  }

  // ---- Unidades consumidoras ----
  @Post('accounts/:id/consumer-units')
  @RequirePermissions('crm.account.write')
  addConsumerUnit(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateConsumerUnitDto) {
    return this.accounts.addConsumerUnit(id, body);
  }

  @Patch('consumer-units/:id')
  @RequirePermissions('crm.account.write')
  updateConsumerUnit(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateConsumerUnitDto) {
    return this.accounts.updateConsumerUnit(id, body);
  }

  @Delete('consumer-units/:id')
  @RequirePermissions('crm.account.write')
  removeConsumerUnit(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.removeConsumerUnit(id);
  }
}
