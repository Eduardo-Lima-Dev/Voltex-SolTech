import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, mergeMap } from 'rxjs';
import { AUDIT_KEY, type AuditMetadata } from '../../common/decorators';
import { AuditService } from './audit.service';

/** Audita as rotas marcadas com `@Audit(action, entity)` usando a resposta como estado "depois". */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMetadata | undefined>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      mergeMap(async (response: unknown) => {
        const id =
          (response as { id?: string } | null)?.id ??
          (request.params as Record<string, string>).id ??
          null;
        try {
          await this.audit.record({
            action: meta.action,
            entity: meta.entity,
            entityId: id,
            after: response,
          });
        } catch (error) {
          // A operação já foi concluída; a falha de auditoria precisa aparecer nos logs para investigação.
          this.logger.error({ err: error, action: meta.action }, 'Falha ao gravar auditoria');
        }
        return response;
      }),
    );
  }
}
