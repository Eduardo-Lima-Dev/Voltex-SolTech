import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { HealthService } from './health.service';

@ApiTags('Saúde')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const { healthy, body } = await this.health.check();
    if (!healthy) res.status(503);
    return body;
  }
}
