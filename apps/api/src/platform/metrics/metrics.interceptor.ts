import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/** Mede cada requisição. O rótulo é o padrão da rota (`/crm/opportunities/:id`), nunca a URL real: sem explosão de séries. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = process.hrtime.bigint();
    const done = () => {
      const route = (req.route as { path?: string } | undefined)?.path ?? 'desconhecida';
      if (route.endsWith('/metrics')) return;
      this.metrics.observe(
        req.method,
        route,
        res.statusCode,
        Number(process.hrtime.bigint() - start) / 1e9,
      );
    };
    return next.handle().pipe(tap({ next: done, error: done }));
  }
}
