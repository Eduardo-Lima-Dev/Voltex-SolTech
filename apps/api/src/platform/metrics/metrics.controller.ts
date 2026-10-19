import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import type { Env } from '../../config/env';
import { MetricsService } from './metrics.service';

/**
 * `GET /api/v1/metrics` (Prometheus). **Desligado** sem `METRICS_TOKEN` (responde 404, como se não existisse);
 * ligado, exige `Authorization: Bearer <METRICS_TOKEN>`. Não expõe dados de clientes, só números.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @SkipThrottle()
  @Get()
  async scrape(@Headers('authorization') authorization: string | undefined, @Res() res: Response) {
    const token = this.config.get('METRICS_TOKEN', { infer: true });
    if (!token) throw new NotFoundException();
    const given = Buffer.from(authorization?.replace(/^Bearer\s+/i, '') ?? '');
    const expected = Buffer.from(token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new UnauthorizedException();
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
