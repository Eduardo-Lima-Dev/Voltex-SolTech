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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  addTicketCommentSchema,
  changeTicketStatusSchema,
  createAssetSchema,
  createMaintenancePlanSchema,
  createManualWarrantySchema,
  createOmContractSchema,
  createTicketSchema,
  createTicketWorkOrderSchema,
  createWarrantyTermSchema,
  listPlantsQuerySchema,
  listTicketsQuerySchema,
  listWarrantiesQuerySchema,
  operationsSettingsSchema,
  replaceAssetSchema,
  updateAssetSchema,
  updateMaintenancePlanSchema,
  updateOmContractSchema,
  updatePlantSchema,
  updateTicketSchema,
} from '@voltex/shared';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import type { RequestUser } from '../../../common/context/request-user';
import { AftersalesScanService } from './aftersales-scan.service';
import { AftersalesDashboardService } from './dashboard.service';
import { MaintenanceService } from './maintenance.service';
import { OmContractsService } from './om-contracts.service';
import { PlantsService } from './plants.service';
import { OperationsSettingsService } from './settings.service';
import { TicketsService } from './tickets.service';
import { WarrantiesService } from './warranties.service';

class ListPlantsDto extends createZodDto(listPlantsQuerySchema) {}
class UpdatePlantDto extends createZodDto(updatePlantSchema) {}
class CreateAssetDto extends createZodDto(createAssetSchema) {}
class UpdateAssetDto extends createZodDto(updateAssetSchema) {}
class ReplaceAssetDto extends createZodDto(replaceAssetSchema) {}
class CreateWarrantyTermDto extends createZodDto(createWarrantyTermSchema) {}
class CreateManualWarrantyDto extends createZodDto(createManualWarrantySchema) {}
class ListWarrantiesDto extends createZodDto(listWarrantiesQuerySchema) {}
class CreateTicketDto extends createZodDto(createTicketSchema) {}
class UpdateTicketDto extends createZodDto(updateTicketSchema) {}
class ChangeTicketStatusDto extends createZodDto(changeTicketStatusSchema) {}
class AddTicketCommentDto extends createZodDto(addTicketCommentSchema) {}
class ListTicketsDto extends createZodDto(listTicketsQuerySchema) {}
class CreateTicketWorkOrderDto extends createZodDto(createTicketWorkOrderSchema) {}
class CreatePlanDto extends createZodDto(createMaintenancePlanSchema) {}
class UpdatePlanDto extends createZodDto(updateMaintenancePlanSchema) {}
class CreateContractDto extends createZodDto(createOmContractSchema) {}
class UpdateContractDto extends createZodDto(updateOmContractSchema) {}
class SettingsDto extends createZodDto(operationsSettingsSchema) {}

/** Pós-venda e O&M (Fase 11E, ADR-0023): plantas, ativos, garantias, chamados, manutenção, contratos e indicadores. */
@ApiTags('Pós-venda')
@ApiBearerAuth()
@Controller('operations')
export class AftersalesController {
  constructor(
    private readonly plants: PlantsService,
    private readonly warranties: WarrantiesService,
    private readonly tickets: TicketsService,
    private readonly maintenance: MaintenanceService,
    private readonly contracts: OmContractsService,
    private readonly settings: OperationsSettingsService,
    private readonly dashboard: AftersalesDashboardService,
    private readonly scan: AftersalesScanService,
  ) {}

  // --- plantas e ativos -------------------------------------------------------------------------------------

  @Get('plants')
  @RequirePermissions('ops.plant.read')
  listPlants(@Query() query: ListPlantsDto) {
    return this.plants.list(query);
  }

  /** Cria a planta de instalações aceitas antes da fase (ou cujo evento se perdeu). */
  @Post('plants/reconcile')
  @HttpCode(200)
  @RequirePermissions('ops.plant.write')
  reconcilePlants() {
    return this.plants.reconcile();
  }

  @Get('plants/:id')
  @RequirePermissions('ops.plant.read')
  getPlant(@Param('id', ParseUUIDPipe) id: string) {
    return this.plants.get(id);
  }

  @Patch('plants/:id')
  @RequirePermissions('ops.plant.write')
  updatePlant(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePlantDto) {
    return this.plants.update(id, body);
  }

  @Post('plants/:id/assets')
  @RequirePermissions('ops.plant.write')
  addAsset(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateAssetDto) {
    return this.plants.addAsset(id, body);
  }

  @Patch('assets/:assetId')
  @RequirePermissions('ops.plant.write')
  updateAsset(@Param('assetId', ParseUUIDPipe) assetId: string, @Body() body: UpdateAssetDto) {
    return this.plants.updateAsset(assetId, body);
  }

  @Post('assets/:assetId/replace')
  @HttpCode(200)
  @RequirePermissions('ops.plant.write')
  replaceAsset(@Param('assetId', ParseUUIDPipe) assetId: string, @Body() body: ReplaceAssetDto) {
    return this.plants.replaceAsset(assetId, body);
  }

  // --- garantias --------------------------------------------------------------------------------------------

  @Get('warranties')
  @RequirePermissions('ops.plant.read')
  listWarranties(@Query() query: ListWarrantiesDto) {
    return this.warranties.list(query);
  }

  @Post('assets/:assetId/warranties')
  @RequirePermissions('ops.warranty.manage')
  addWarranty(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() body: CreateManualWarrantyDto,
  ) {
    return this.warranties.addManual(assetId, body);
  }

  @Delete('warranties/:id')
  @RequirePermissions('ops.warranty.manage')
  removeWarranty(@Param('id', ParseUUIDPipe) id: string) {
    return this.warranties.remove(id);
  }

  @Get('warranty-terms')
  @RequirePermissions('ops.plant.read')
  listTerms(@Query('all') all?: string) {
    return this.warranties.listTerms(all === 'true');
  }

  @Post('warranty-terms')
  @RequirePermissions('ops.warranty.manage')
  createTerm(@Body() body: CreateWarrantyTermDto, @CurrentUser() user: RequestUser) {
    return this.warranties.createTerm(body, user.id);
  }

  @Post('warranty-terms/:id/retire')
  @HttpCode(200)
  @RequirePermissions('ops.warranty.manage')
  retireTerm(@Param('id', ParseUUIDPipe) id: string) {
    return this.warranties.retireTerm(id);
  }

  // --- chamados ---------------------------------------------------------------------------------------------

  @Get('tickets')
  @RequirePermissions('ops.ticket.read')
  listTickets(@Query() query: ListTicketsDto) {
    return this.tickets.list(query);
  }

  @Post('tickets')
  @RequirePermissions('ops.ticket.write')
  createTicket(@Body() body: CreateTicketDto) {
    return this.tickets.create(body);
  }

  @Get('tickets/:id')
  @RequirePermissions('ops.ticket.read')
  getTicket(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.get(id);
  }

  @Patch('tickets/:id')
  @RequirePermissions('ops.ticket.write')
  updateTicket(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTicketDto) {
    return this.tickets.update(id, body);
  }

  @Post('tickets/:id/status')
  @HttpCode(200)
  @RequirePermissions('ops.ticket.write')
  changeTicketStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeTicketStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tickets.changeStatus(id, body, user);
  }

  @Post('tickets/:id/comments')
  @RequirePermissions('ops.ticket.write')
  addTicketComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddTicketCommentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tickets.addComment(id, body, user);
  }

  @Post('tickets/:id/work-order')
  @RequirePermissions('ops.ticket.write')
  createTicketWorkOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateTicketWorkOrderDto,
  ) {
    return this.tickets.createWorkOrder(id, body);
  }

  // --- manutenção e contratos -------------------------------------------------------------------------------

  @Get('maintenance-plans')
  @RequirePermissions('ops.plant.read')
  listPlans(@Query('plantId') plantId?: string) {
    return this.maintenance.list(plantId);
  }

  @Post('maintenance-plans')
  @RequirePermissions('ops.om.manage')
  createPlan(@Body() body: CreatePlanDto) {
    return this.maintenance.create(body);
  }

  @Patch('maintenance-plans/:id')
  @RequirePermissions('ops.om.manage')
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePlanDto) {
    return this.maintenance.update(id, body);
  }

  @Get('om-contracts')
  @RequirePermissions('ops.plant.read')
  listContracts(@Query('status') status?: 'ACTIVE' | 'EXPIRED' | 'CANCELLED') {
    return this.contracts.list(status);
  }

  @Post('om-contracts')
  @RequirePermissions('ops.om.manage')
  createContract(@Body() body: CreateContractDto) {
    return this.contracts.create(body);
  }

  @Patch('om-contracts/:id')
  @RequirePermissions('ops.om.manage')
  updateContract(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateContractDto) {
    return this.contracts.update(id, body);
  }

  // --- configurações, painel e rotina -----------------------------------------------------------------------

  @Get('aftersales/settings')
  @RequirePermissions('ops.plant.read')
  getSettings() {
    return this.settings.get();
  }

  @Put('aftersales/settings')
  @RequirePermissions('ops.om.manage')
  updateSettings(@Body() body: SettingsDto) {
    return this.settings.update(body);
  }

  @Get('aftersales/dashboard')
  @RequirePermissions('ops.plant.read')
  getDashboard() {
    return this.dashboard.get();
  }

  /** Roda agora as regras do pós-venda da empresa (a rotina também roda sozinha, de tempos em tempos). */
  @Post('aftersales/scan')
  @HttpCode(200)
  @RequirePermissions('ops.om.manage')
  runScan() {
    return this.scan.scanTenant();
  }
}
