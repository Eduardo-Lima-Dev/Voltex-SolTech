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

  /**
   * Só confirma que o processo responde, sem consultar banco, Redis nem armazenamento. É o que hospedagens com plano
   * gratuito devem usar na verificação periódica: o `/health` completo acordaria o banco e gastaria comandos do Redis.
   */
  @Public()
  @SkipThrottle()
  @Get('live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Public()
  @SkipThrottle()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const { healthy, body } = await this.health.check();
    if (!healthy) res.status(503);
    return body;
  }
}
