import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { TenantStatus, permissionsForRole } from '@voltex/shared';
import { RequestContext } from '../../common/context/request-context';
import type { RequestUser } from '../../common/context/request-user';
import { IS_PUBLIC_KEY } from '../../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './auth.service';

/**
 * Guard global. Valida o access token e recarrega o usuário do banco a cada requisição, assim desativar
 * um usuário/tenant ou mudar o perfil vale imediatamente (e não só quando o token expirar).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
        execution.getHandler(),
        execution.getClass(),
      ])
    ) {
      return true;
    }

    const request = execution.switchToHttp().getRequest<Request>();
    const token = this.extractBearer(request);
    if (!token) throw new UnauthorizedException('Token ausente');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }

    const user = await this.prisma.system.user.findFirst({
      where: {
        id: payload.sub,
        tenantId: payload.tid,
        isActive: true,
        deletedAt: null,
        tenant: { status: TenantStatus.ACTIVE, deletedAt: null },
      },
      include: { tenant: { select: { name: true } } },
    });
    if (!user) throw new UnauthorizedException('Usuário inativo ou inexistente');

    const requestUser: RequestUser = {
      id: user.id,
      tenantId: user.tenantId,
      tenantName: user.tenant.name,
      role: user.role,
      name: user.name,
      email: user.email,
      permissions: permissionsForRole(user.role),
    };
    request.user = requestUser;
    this.context.set({ tenantId: user.tenantId, userId: user.id, role: user.role });
    return true;
  }

  private extractBearer(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' && token ? token : undefined;
  }
}
