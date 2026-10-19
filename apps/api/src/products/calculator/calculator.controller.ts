import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { listCalculationsQuerySchema } from '@voltex/shared';
import { createCalculationSchema, createSnapshotSchema } from '@voltex/solar-engine';
import { RequirePermissions } from '../../common/decorators';
import { CalculatorService } from './calculator.service';

class CreateCalculationDto extends createZodDto(createCalculationSchema) {}
class CreateSnapshotDto extends createZodDto(createSnapshotSchema) {}
class ListCalculationsQueryDto extends createZodDto(listCalculationsQuerySchema) {}

@ApiTags('Solar Calculator')
@ApiBearerAuth()
@Controller('calculations/quick')
export class CalculatorController {
  constructor(private readonly calculator: CalculatorService) {}

  /** Limites e custo de disponibilidade em vigor (regra ativa ou padrão), para o preview do front. */
  @Get('config')
  @RequirePermissions('calculator.session.read')
  config() {
    return this.calculator.config();
  }

  @Post()
  @RequirePermissions('calculator.session.create')
  create(@Body() body: CreateCalculationDto) {
    return this.calculator.create(body);
  }

  @Get()
  @RequirePermissions('calculator.session.read')
  list(@Query() query: ListCalculationsQueryDto) {
    return this.calculator.list(query);
  }

  @Get('snapshots/:snapshotId')
  @RequirePermissions('calculator.session.read')
  getSnapshot(@Param('snapshotId', ParseUUIDPipe) snapshotId: string) {
    return this.calculator.getSnapshot(snapshotId);
  }

  @Get(':id')
  @RequirePermissions('calculator.session.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.calculator.get(id);
  }

  @Post(':id/snapshot')
  @HttpCode(201)
  @RequirePermissions('calculator.snapshot.create')
  createSnapshot(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateSnapshotDto) {
    return this.calculator.createSnapshot(id, body.note);
  }

  @Get(':id/snapshots')
  @RequirePermissions('calculator.session.read')
  listSnapshots(@Param('id', ParseUUIDPipe) id: string) {
    return this.calculator.listSnapshots(id);
  }
}
