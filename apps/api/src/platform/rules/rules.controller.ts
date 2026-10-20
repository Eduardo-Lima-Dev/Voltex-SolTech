import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  CALCULATOR_RULESET_KEY,
  activateRuleSetSchema,
  createRuleSetSchema,
  effectiveRuleQuerySchema,
  isRuleSetKey,
} from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { RulesService } from './rules.service';

class CreateRuleSetDto extends createZodDto(createRuleSetSchema) {}
class ActivateRuleSetDto extends createZodDto(activateRuleSetSchema) {}
class KeyQueryDto extends createZodDto(z.object({ key: z.string().trim().optional() })) {}
class EffectiveQueryDto extends createZodDto(effectiveRuleQuerySchema) {}

@ApiTags('Regras')
@ApiBearerAuth()
@Controller('rules')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  @RequirePermissions('platform.rule.read')
  list(@Query() query: KeyQueryDto) {
    return this.rules.list(query.key);
  }

  @Get('effective')
  @RequirePermissions('platform.rule.read')
  async effective(@Query() query: EffectiveQueryDto) {
    const key = query.key ?? CALCULATOR_RULESET_KEY;
    if (key === CALCULATOR_RULESET_KEY) return this.rules.effective(key);
    if (!isRuleSetKey(key)) throw new BadRequestException(`Chave de regra desconhecida: ${key}`);
    const { key: _key, ...scope } = query;
    // Chaves do Engine não têm padrão: sem regra ativa o consumidor recebe `null` e trava a aprovação.
    return (await this.rules.resolve(key, scope)) ?? { ref: null, key, definition: null };
  }

  @Post()
  @RequirePermissions('platform.rule.manage')
  create(@Body() body: CreateRuleSetDto) {
    return this.rules.create(body);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  activate(@Param('id', ParseUUIDPipe) id: string, @Body() body: ActivateRuleSetDto) {
    return this.rules.activate(id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('platform.rule.manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.rules.remove(id);
  }
}
