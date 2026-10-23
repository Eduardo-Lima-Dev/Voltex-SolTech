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
  activateIntegrationConnectionSchema,
  createIntegrationConnectionSchema,
  listIntegrationRunsQuerySchema,
  updateIntegrationConnectionSchema,
} from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { IntegrationsService } from './integrations.service';

class CreateConnectionDto extends createZodDto(createIntegrationConnectionSchema) {}
class UpdateConnectionDto extends createZodDto(updateIntegrationConnectionSchema) {}
class ActivateConnectionDto extends createZodDto(activateIntegrationConnectionSchema) {}
class ListRunsQueryDto extends createZodDto(listIntegrationRunsQuerySchema) {}

/** Integration Hub (ADR-0019). Ver: `platform.integration.read`; cadastrar, ligar, testar e reprocessar: `…manage`. */
@ApiTags('Integrações')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('providers')
  @RequirePermissions('platform.integration.read')
  providers() {
    return this.integrations.listProviders();
  }

  @Get('connections')
  @RequirePermissions('platform.integration.read')
  list() {
    return this.integrations.list();
  }

  @Get('connections/:id')
  @RequirePermissions('platform.integration.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.get(id);
  }

  @Post('connections')
  @RequirePermissions('platform.integration.manage')
  create(@Body() body: CreateConnectionDto) {
    return this.integrations.create(body);
  }

  @Patch('connections/:id')
  @RequirePermissions('platform.integration.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateConnectionDto) {
    return this.integrations.update(id, body);
  }

  @Post('connections/:id/activate')
  @HttpCode(200)
  @RequirePermissions('platform.integration.manage')
  activate(@Param('id', ParseUUIDPipe) id: string, @Body() body: ActivateConnectionDto) {
    return this.integrations.activate(id, body);
  }

  @Post('connections/:id/pause')
  @HttpCode(200)
  @RequirePermissions('platform.integration.manage')
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.pause(id);
  }

  @Post('connections/:id/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('platform.integration.manage')
  test(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.test(id);
  }

  @Post('connections/:id/sync')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @RequirePermissions('platform.integration.manage')
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.runSync(id, { trigger: 'MANUAL' });
  }

  @Delete('connections/:id')
  @RequirePermissions('platform.integration.manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.remove(id);
  }

  @Get('runs')
  @RequirePermissions('platform.integration.read')
  runs(@Query() query: ListRunsQueryDto) {
    return this.integrations.listRuns(query);
  }

  @Get('dead-letters')
  @RequirePermissions('platform.integration.read')
  deadLetters() {
    return this.integrations.listDeadLetters();
  }

  @Post('dead-letters/:id/retry')
  @HttpCode(200)
  @RequirePermissions('platform.integration.manage')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.retryDeadLetter(id);
  }

  @Post('dead-letters/:id/dismiss')
  @HttpCode(200)
  @RequirePermissions('platform.integration.manage')
  dismiss(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.dismissDeadLetter(id);
  }
}
