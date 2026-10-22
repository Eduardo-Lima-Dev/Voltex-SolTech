import {
  Body,
  Controller,
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
  agendaQuerySchema,
  cancelWorkOrderSchema,
  changeInstallationStatusSchema,
  completeWorkOrderSchema,
  createCrewSchema,
  createFieldIssueSchema,
  createMaterialItemSchema,
  createWorkOrderSchema,
  listInstallationsQuerySchema,
  listWorkOrdersQuerySchema,
  orderMaterialItemSchema,
  resolveFieldIssueSchema,
  updateCrewSchema,
  updateInstallationSchema,
  updateMaterialItemSchema,
  updateWorkOrderSchema,
} from '@voltex/shared';
import { Authenticated, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/context/request-user';
import { CrewsService } from './crews.service';
import { FieldIssuesService } from './field-issues.service';
import { InstallationsService } from './installations.service';
import { MaterialsService } from './materials.service';
import { WorkOrdersService } from './work-orders.service';

class ListInstallationsDto extends createZodDto(listInstallationsQuerySchema) {}
class ChangeStatusDto extends createZodDto(changeInstallationStatusSchema) {}
class UpdateInstallationDto extends createZodDto(updateInstallationSchema) {}
class CreateMaterialDto extends createZodDto(createMaterialItemSchema) {}
class UpdateMaterialDto extends createZodDto(updateMaterialItemSchema) {}
class OrderMaterialDto extends createZodDto(orderMaterialItemSchema) {}
class CreateCrewDto extends createZodDto(createCrewSchema) {}
class UpdateCrewDto extends createZodDto(updateCrewSchema) {}
class CreateWorkOrderDto extends createZodDto(createWorkOrderSchema) {}
class UpdateWorkOrderDto extends createZodDto(updateWorkOrderSchema) {}
class CancelWorkOrderDto extends createZodDto(cancelWorkOrderSchema) {}
class CompleteWorkOrderDto extends createZodDto(completeWorkOrderSchema) {}
class ListWorkOrdersDto extends createZodDto(listWorkOrdersQuerySchema) {}
class AgendaDto extends createZodDto(agendaQuerySchema) {}
class CreateFieldIssueDto extends createZodDto(createFieldIssueSchema) {}
class ResolveFieldIssueDto extends createZodDto(resolveFieldIssueSchema) {}

/**
 * Operação (Fase 11B, ADR-0020). Instalações, materiais, equipes e agenda: `ops.installation.*` e `ops.workorder.*`.
 * Iniciar, concluir e registrar pendência valem também para o técnico de campo (`ops.field.execute`) nas ordens em
 * que ele está escalado; essa checagem é do serviço (por isso `@Authenticated`).
 */
@ApiTags('Operação')
@ApiBearerAuth()
@Controller('operations')
export class OperationsController {
  constructor(
    private readonly installations: InstallationsService,
    private readonly materials: MaterialsService,
    private readonly crews: CrewsService,
    private readonly workOrders: WorkOrdersService,
    private readonly issues: FieldIssuesService,
  ) {}

  // --- instalações ------------------------------------------------------------------------------------------

  @Get('installations')
  @RequirePermissions('ops.installation.read')
  list(@Query() query: ListInstallationsDto) {
    return this.installations.list(query);
  }

  @Get('dashboard')
  @RequirePermissions('ops.installation.read')
  dashboard() {
    return this.installations.dashboard();
  }

  /** Cria as instalações dos projetos anteriores à Fase 11B. */
  @Post('installations/reconcile')
  @HttpCode(200)
  @RequirePermissions('ops.installation.write')
  reconcile() {
    return this.installations.reconcile();
  }

  @Get('installations/:id')
  @RequirePermissions('ops.installation.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.installations.getDetail(id);
  }

  @Patch('installations/:id')
  @RequirePermissions('ops.installation.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateInstallationDto) {
    return this.installations.update(id, body);
  }

  @Post('installations/:id/status')
  @HttpCode(200)
  @RequirePermissions('ops.installation.write')
  changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChangeStatusDto) {
    return this.installations.changeStatus(id, body);
  }

  // --- materiais --------------------------------------------------------------------------------------------

  @Get('installations/:id/materials')
  @RequirePermissions('ops.installation.read')
  listMaterials(@Param('id', ParseUUIDPipe) id: string) {
    return this.materials.list(id);
  }

  @Get('installations/:id/materials/quotes')
  @RequirePermissions('ops.installation.read')
  materialQuotes(@Param('id', ParseUUIDPipe) id: string) {
    return this.materials.quotes(id);
  }

  @Post('installations/:id/materials/generate')
  @HttpCode(200)
  @RequirePermissions('ops.installation.write')
  generateMaterials(@Param('id', ParseUUIDPipe) id: string) {
    return this.materials.generateFromSnapshot(id);
  }

  @Post('installations/:id/materials')
  @RequirePermissions('ops.installation.write')
  addMaterial(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateMaterialDto) {
    return this.materials.add(id, body);
  }

  @Patch('materials/:itemId')
  @RequirePermissions('ops.installation.write')
  updateMaterial(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: UpdateMaterialDto) {
    return this.materials.update(itemId, body);
  }

  @Post('materials/:itemId/order')
  @HttpCode(200)
  @RequirePermissions('ops.installation.write')
  orderMaterial(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: OrderMaterialDto) {
    return this.materials.order(itemId, body);
  }

  @Post('materials/:itemId/receive')
  @HttpCode(200)
  @RequirePermissions('ops.installation.write')
  receiveMaterial(@Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.materials.receive(itemId);
  }

  @Post('materials/:itemId/separate')
  @HttpCode(200)
  @RequirePermissions('ops.installation.write')
  separateMaterial(@Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.materials.separate(itemId);
  }

  @Post('materials/:itemId/cancel')
  @HttpCode(200)
  @RequirePermissions('ops.installation.write')
  cancelMaterial(@Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.materials.cancel(itemId);
  }

  // --- equipes ----------------------------------------------------------------------------------------------

  @Get('crews')
  @RequirePermissions('ops.installation.read')
  listCrews() {
    return this.crews.list();
  }

  @Post('crews')
  @RequirePermissions('ops.installation.write')
  createCrew(@Body() body: CreateCrewDto) {
    return this.crews.create(body);
  }

  @Patch('crews/:id')
  @RequirePermissions('ops.installation.write')
  updateCrew(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCrewDto) {
    return this.crews.update(id, body);
  }

  // --- ordens de serviço e agenda ---------------------------------------------------------------------------

  @Get('work-orders')
  @RequirePermissions('ops.workorder.read')
  listWorkOrders(@Query() query: ListWorkOrdersDto) {
    return this.workOrders.list(query);
  }

  /** As ordens em aberto de quem está logado (app de campo). */
  @Get('work-orders/mine')
  @RequirePermissions('ops.field.execute')
  mine(@CurrentUser() user: RequestUser) {
    return this.workOrders.mine(user.id);
  }

  @Get('agenda')
  @RequirePermissions('ops.workorder.read')
  agenda(@Query() query: AgendaDto) {
    return this.workOrders.agenda(query);
  }

  @Get('work-orders/:id')
  @RequirePermissions('ops.workorder.read')
  getWorkOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.get(id);
  }

  @Post('work-orders')
  @RequirePermissions('ops.workorder.write')
  createWorkOrder(@Body() body: CreateWorkOrderDto) {
    return this.workOrders.create(body);
  }

  @Patch('work-orders/:id')
  @RequirePermissions('ops.workorder.write')
  updateWorkOrder(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateWorkOrderDto) {
    return this.workOrders.update(id, body);
  }

  @Post('work-orders/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('ops.workorder.write')
  cancelWorkOrder(@Param('id', ParseUUIDPipe) id: string, @Body() body: CancelWorkOrderDto) {
    return this.workOrders.cancel(id, body);
  }

  @Post('work-orders/:id/start')
  @HttpCode(200)
  @Authenticated()
  startWorkOrder(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.workOrders.start(id, user);
  }

  @Post('work-orders/:id/complete')
  @HttpCode(200)
  @Authenticated()
  completeWorkOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CompleteWorkOrderDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.workOrders.complete(id, body, user);
  }

  // --- pendências de campo ----------------------------------------------------------------------------------

  @Get('installations/:id/issues')
  @RequirePermissions('ops.installation.read')
  listIssues(@Param('id', ParseUUIDPipe) id: string) {
    return this.issues.list(id);
  }

  @Post('installations/:id/issues')
  @Authenticated()
  createIssue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateFieldIssueDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.issues.create(id, body, user);
  }

  @Post('issues/:issueId/resolve')
  @HttpCode(200)
  @Authenticated()
  resolveIssue(
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() body: ResolveFieldIssueDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.issues.resolve(issueId, body, user);
  }
}
