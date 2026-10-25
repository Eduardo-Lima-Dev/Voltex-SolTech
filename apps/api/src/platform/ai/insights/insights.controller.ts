import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import { updateInsightSchema } from '@voltex/shared';
import type { RequestUser } from '../../../common/context/request-user';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { InsightsService } from './insights.service';

class UpdateInsightDto extends createZodDto(updateInsightSchema) {}

@ApiTags('Insights de IA')
@ApiBearerAuth()
@Controller('ai/insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** Achados ativos que a pessoa pode ver (pela permissão e pela carteira). Nunca chama o modelo. */
  @Get()
  @RequirePermissions('ai.insights.read')
  list(@CurrentUser() user: RequestUser) {
    return this.insights.list(user);
  }

  @Patch(':id')
  @RequirePermissions('ai.insights.read')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateInsightDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.insights.update(user, id, body);
  }

  /** Roda a rotina agora para a empresa (a administração; o agendamento faz isso uma vez por dia). */
  @Post('run')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions('ai.admin.manage')
  run() {
    return this.insights.runForCurrentTenant();
  }
}
