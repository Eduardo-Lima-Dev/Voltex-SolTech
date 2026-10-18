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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  createBranchSchema,
  createTeamSchema,
  updateBranchSchema,
  updateTeamSchema,
  updateTenantSchema,
} from '@voltex/shared';
import { Audit, Authenticated, RequirePermissions } from '../../common/decorators';
import { TenancyService } from './tenancy.service';

class UpdateTenantDto extends createZodDto(updateTenantSchema) {}
class CreateBranchDto extends createZodDto(createBranchSchema) {}
class UpdateBranchDto extends createZodDto(updateBranchSchema) {}
class CreateTeamDto extends createZodDto(createTeamSchema) {}
class UpdateTeamDto extends createZodDto(updateTeamSchema) {}

@ApiTags('Empresa')
@ApiBearerAuth()
@Controller()
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get('tenant')
  @Authenticated()
  getTenant() {
    return this.tenancy.getTenant();
  }

  @Patch('tenant')
  @RequirePermissions('platform.tenant.manage')
  updateTenant(@Body() body: UpdateTenantDto) {
    return this.tenancy.updateTenant(body);
  }

  // ---- Filiais ----
  @Get('branches')
  @Authenticated()
  listBranches() {
    return this.tenancy.listBranches();
  }

  @Post('branches')
  @RequirePermissions('platform.tenant.manage')
  @Audit('branch.created', 'Branch')
  createBranch(@Body() body: CreateBranchDto) {
    return this.tenancy.createBranch(body);
  }

  @Patch('branches/:id')
  @RequirePermissions('platform.tenant.manage')
  @Audit('branch.updated', 'Branch')
  updateBranch(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateBranchDto) {
    return this.tenancy.updateBranch(id, body);
  }

  @Delete('branches/:id')
  @HttpCode(200)
  @RequirePermissions('platform.tenant.manage')
  @Audit('branch.deleted', 'Branch')
  removeBranch(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenancy.removeBranch(id);
  }

  // ---- Times ----
  @Get('teams')
  @Authenticated()
  listTeams() {
    return this.tenancy.listTeams();
  }

  @Post('teams')
  @RequirePermissions('platform.tenant.manage')
  @Audit('team.created', 'Team')
  createTeam(@Body() body: CreateTeamDto) {
    return this.tenancy.createTeam(body);
  }

  @Patch('teams/:id')
  @RequirePermissions('platform.tenant.manage')
  @Audit('team.updated', 'Team')
  updateTeam(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTeamDto) {
    return this.tenancy.updateTeam(id, body);
  }

  @Delete('teams/:id')
  @HttpCode(200)
  @RequirePermissions('platform.tenant.manage')
  @Audit('team.deleted', 'Team')
  removeTeam(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenancy.removeTeam(id);
  }
}
