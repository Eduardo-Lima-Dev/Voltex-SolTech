import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanService } from './plan.service';

export const REQUIRED_FEATURE_KEY = 'voltex:feature';

/** Bloqueia a rota (403) se o plano da empresa desligou o recurso. */
export const RequireFeature = (feature: string) => SetMetadata(REQUIRED_FEATURE_KEY, feature);

/** Roda depois da autenticação (o tenant já está no contexto). Rotas sem `@RequireFeature` passam direto. */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly plan: PlanService,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_FEATURE_KEY, [
      execution.getHandler(),
      execution.getClass(),
    ]);
    if (feature) await this.plan.assertFeature(feature);
    return true;
  }
}
