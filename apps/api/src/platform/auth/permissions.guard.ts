import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Permission } from '@voltex/shared';
import { AUTHENTICATED_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../../common/decorators';

/**
 * Guard global de autorização: NEGADO POR PADRÃO. Toda rota precisa declarar `@Public()`,
 * `@Authenticated()` ou `@RequirePermissions(...)`; uma rota esquecida responde 403 (e vai para o log).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(execution: ExecutionContext): boolean {
    const targets = [execution.getHandler(), execution.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      AUTHENTICATED_KEY,
      targets,
    );

    if (!required && !authenticatedOnly) {
      const route = execution.switchToHttp().getRequest<Request>().originalUrl;
      this.logger.error(`Rota sem declaração de acesso (negada por padrão): ${route}`);
      throw new ForbiddenException('Rota sem permissão declarada');
    }
    if (!required || required.length === 0) return true;

    const user = execution.switchToHttp().getRequest<Request>().user;
    if (!user || !required.every((permission) => user.permissions.includes(permission))) {
      throw new ForbiddenException('Permissão insuficiente');
    }
    return true;
  }
}
