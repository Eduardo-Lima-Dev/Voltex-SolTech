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
  createDistributorSchema,
  createSolarResourceSchema,
  createTariffSchema,
  importSolarResourcesSchema,
  listSolarResourcesQuerySchema,
  listTariffsQuerySchema,
  updateDistributorSchema,
} from '@voltex/shared';
import { Audit, RequirePermissions } from '../../common/decorators';
import { Throttle } from '@nestjs/throttler';
import { AneelImportService } from './aneel-import.service';
import { ReferenceDataService } from './reference-data.service';

class CreateDistributorDto extends createZodDto(createDistributorSchema) {}
class UpdateDistributorDto extends createZodDto(updateDistributorSchema) {}
class CreateTariffDto extends createZodDto(createTariffSchema) {}
class ListTariffsQueryDto extends createZodDto(listTariffsQuerySchema) {}
class CreateSolarResourceDto extends createZodDto(createSolarResourceSchema) {}
class ImportSolarResourcesDto extends createZodDto(importSolarResourcesSchema) {}
class ListSolarResourcesQueryDto extends createZodDto(listSolarResourcesQuerySchema) {}

/** Leitura para quem calcula; escrita para quem gerencia regras (`platform.rule.manage`). */
@ApiTags('Dados de referência')
@ApiBearerAuth()
@Controller()
export class ReferenceDataController {
  constructor(
    private readonly data: ReferenceDataService,
    private readonly aneel: AneelImportService,
  ) {}

  /**
   * Importa concessionárias e a tarifa residencial vigente dos Dados Abertos da ANEEL (arquivo grande: pode levar
   * alguns minutos). Os valores NÃO incluem impostos.
   */
  @Post('reference-data/aneel/import')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  importAneel() {
    return this.aneel.importAll();
  }

  // ---- Concessionárias ----
  @Get('distributors')
  @RequirePermissions('calculator.session.read')
  listDistributors() {
    return this.data.listDistributors();
  }

  @Post('distributors')
  @RequirePermissions('platform.rule.manage')
  @Audit('distributor.created', 'Distributor')
  createDistributor(@Body() body: CreateDistributorDto) {
    return this.data.createDistributor(body);
  }

  @Patch('distributors/:id')
  @RequirePermissions('platform.rule.manage')
  @Audit('distributor.updated', 'Distributor')
  updateDistributor(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDistributorDto) {
    return this.data.updateDistributor(id, body);
  }

  @Delete('distributors/:id')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  @Audit('distributor.deleted', 'Distributor')
  removeDistributor(@Param('id', ParseUUIDPipe) id: string) {
    return this.data.removeDistributor(id);
  }

  // ---- Tarifas ----
  @Get('tariffs')
  @RequirePermissions('calculator.session.read')
  listTariffs(@Query() query: ListTariffsQueryDto) {
    return this.data.listTariffs(query);
  }

  @Post('tariffs')
  @RequirePermissions('platform.rule.manage')
  createTariff(@Body() body: CreateTariffDto) {
    return this.data.createTariff(body);
  }

  @Delete('tariffs/:id')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  removeTariff(@Param('id', ParseUUIDPipe) id: string) {
    return this.data.removeTariff(id);
  }

  // ---- Recurso solar ----
  @Get('solar-resources')
  @RequirePermissions('calculator.session.read')
  listSolarResources(@Query() query: ListSolarResourcesQueryDto) {
    return this.data.listSolarResources(query);
  }

  @Get('solar-resources/:id')
  @RequirePermissions('calculator.session.read')
  getSolarResource(@Param('id', ParseUUIDPipe) id: string) {
    return this.data.getSolarResource(id);
  }

  @Post('solar-resources')
  @RequirePermissions('platform.rule.manage')
  @Audit('solar_resource.upserted', 'SolarResource')
  async createSolarResource(@Body() body: CreateSolarResourceDto) {
    return (await this.data.upsertSolarResource(body)).resource;
  }

  @Post('solar-resources/import')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  importSolarResources(@Body() body: ImportSolarResourcesDto) {
    return this.data.importSolarResources(body);
  }

  @Delete('solar-resources/:id')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  @Audit('solar_resource.deleted', 'SolarResource')
  removeSolarResource(@Param('id', ParseUUIDPipe) id: string) {
    return this.data.removeSolarResource(id);
  }
}
