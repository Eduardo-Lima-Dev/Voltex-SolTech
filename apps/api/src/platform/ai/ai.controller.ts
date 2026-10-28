import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { updateAiSettingsSchema, type AiDiagnosticsDto } from '@voltex/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/context/request-user';
import { AiAdminService } from './ai-admin.service';
import { AiGateService } from './ai-gate.service';
import { AiUsageService } from './ai-usage.service';

class UpdateAiSettingsDto extends createZodDto(updateAiSettingsSchema) {}

@ApiTags('Inteligência artificial')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly gate: AiGateService,
    private readonly usage: AiUsageService,
    private readonly admin: AiAdminService,
  ) {}

  /** Situação do assistente para quem pergunta. Responde na hora, sem chamar o provedor. */
  @Get('status')
  @RequirePermissions('ai.assistant.use')
  status() {
    return this.gate.status();
  }

  @Get('admin/settings')
  @RequirePermissions('ai.admin.manage')
  settings() {
    return this.gate.adminSettings();
  }

  @Put('admin/settings')
  @RequirePermissions('ai.admin.manage')
  updateSettings(@Body() body: UpdateAiSettingsDto, @CurrentUser() user: RequestUser) {
    return this.admin.updateSettings(body, user);
  }

  @Get('admin/usage')
  @RequirePermissions('ai.admin.manage')
  history() {
    return this.usage.history();
  }

  /** Uma chamada mínima ao modelo, para conferir credencial, prazo e custo. Conta na cota. */
  @Post('admin/diagnostics')
  @HttpCode(200)
  @RequirePermissions('ai.admin.manage')
  diagnostics(): Promise<AiDiagnosticsDto> {
    return this.admin.diagnostics();
  }
}
