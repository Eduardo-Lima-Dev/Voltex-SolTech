import {
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
import { activateRuleSetSchema, createRuleSetSchema } from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { RulesService } from './rules.service';

class CreateRuleSetDto extends createZodDto(createRuleSetSchema) {}
class ActivateRuleSetDto extends createZodDto(activateRuleSetSchema) {}
class KeyQueryDto extends createZodDto(z.object({ key: z.string().trim().optional() })) {}

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
  effective(@Query() query: KeyQueryDto) {
    return this.rules.effective(query.key);
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
