import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MetricsController } from './metrics.controller';

describe('MetricsController', () => {
  it('sem METRICS_TOKEN o endpoint é como se não existisse (404)', async () => {
    const controller = new MetricsController(
      { registry: {} } as never,
      { get: () => undefined } as never,
    );
    await expect(
      controller.scrape('Bearer qualquer', { setHeader: vi.fn(), send: vi.fn() } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
