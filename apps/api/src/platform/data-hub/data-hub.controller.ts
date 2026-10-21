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
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import {
  createSourceWatchSchema,
  decideProposalSchema,
  horizonQuerySchema,
  listProposalsQuerySchema,
  proposeSolarResourceSchema,
  updateSourceWatchSchema,
  weatherQuerySchema,
} from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { ClimateService } from './climate.service';
import { DataSourcesService } from './data-sources.service';
import { SolarResourceProposalService } from './solar-resource-proposal.service';
import { SourceWatchService } from './source-watch.service';
import { TariffScanService } from './tariff-scan.service';
import { UpdateProposalsService } from './update-proposals.service';

class WeatherQueryDto extends createZodDto(weatherQuerySchema) {}
class HorizonQueryDto extends createZodDto(horizonQuerySchema) {}
class CreateSourceWatchDto extends createZodDto(createSourceWatchSchema) {}
class UpdateSourceWatchDto extends createZodDto(updateSourceWatchSchema) {}
class ListProposalsQueryDto extends createZodDto(listProposalsQuerySchema) {}
class ProposeSolarResourceDto extends createZodDto(proposeSolarResourceSchema) {}
class DecideProposalDto extends createZodDto(decideProposalSchema) {}

/**
 * Central de Dados Externos (ADR-0018). Clima e horizonte: quem projeta. Fontes vigiadas, tarifas e decisões da
 * caixa de atualizações: quem gerencia regras (`platform.rule.manage`), pois podem mexer em dado normativo.
 */
@ApiTags('Central de dados')
@ApiBearerAuth()
@Controller('data-hub')
export class DataHubController {
  constructor(
    private readonly sources: DataSourcesService,
    private readonly climate: ClimateService,
    private readonly watches: SourceWatchService,
    private readonly proposals: UpdateProposalsService,
    private readonly tariffs: TariffScanService,
    private readonly solarResources: SolarResourceProposalService,
  ) {}

  @Get('sources')
  @RequirePermissions('platform.rule.read')
  listSources() {
    return this.sources.list();
  }

  @Get('weather')
  @RequirePermissions('engine.project.read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  weather(@Query() query: WeatherQueryDto) {
    return this.climate.weather(query);
  }

  @Get('horizon')
  @RequirePermissions('engine.project.read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  horizon(@Query() query: HorizonQueryDto) {
    return this.climate.horizon(query);
  }

  @Get('watches')
  @RequirePermissions('platform.rule.read')
  listWatches() {
    return this.watches.list();
  }

  @Post('watches')
  @RequirePermissions('platform.rule.manage')
  createWatch(@Body() body: CreateSourceWatchDto) {
    return this.watches.create(body);
  }

  @Patch('watches/:id')
  @RequirePermissions('platform.rule.manage')
  updateWatch(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSourceWatchDto) {
    return this.watches.update(id, body);
  }

  @Delete('watches/:id')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  removeWatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.watches.remove(id);
  }

  @Post('watches/:id/check')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  checkWatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.watches.check(id);
  }

  @Post('tariffs/scan')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  scanTariffs() {
    return this.tariffs.scanCurrentTenant();
  }

  @Post('solar-resources/propose')
  @RequirePermissions('platform.rule.manage')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  proposeSolarResource(@Body() body: ProposeSolarResourceDto) {
    return this.solarResources.propose(body);
  }

  @Get('updates')
  @RequirePermissions('platform.rule.read')
  listUpdates(@Query() query: ListProposalsQueryDto) {
    return this.proposals.list(query);
  }

  @Get('updates/:id')
  @RequirePermissions('platform.rule.read')
  getUpdate(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.get(id);
  }

  @Post('updates/:id/decide')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecideProposalDto) {
    return this.proposals.decide(id, body);
  }
}
