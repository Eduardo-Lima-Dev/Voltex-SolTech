import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AiAdminService } from './ai-admin.service';
import { AiGateService } from './ai-gate.service';
import { AiGatewayService } from './ai-gateway.service';
import { AiProvider } from './ai-provider';
import { AiUsageService } from './ai-usage.service';
import { AiController } from './ai.controller';
import { CloudflareAiProvider } from './providers/cloudflare-ai.provider';
import { FakeAiProvider } from './providers/fake-ai.provider';

/** Escolhe o provedor pela configuração. O simulado é recusado em produção. */
export function createAiProvider(
  config: ConfigService<Env, true>,
  cloudflare: CloudflareAiProvider,
  fake: FakeAiProvider,
): AiProvider {
  const key = config.get('AI_PROVIDER', { infer: true });
  if (key === 'fake' || key === 'demo') {
    if (config.get('NODE_ENV', { infer: true }) === 'production')
      throw new Error(`AI_PROVIDER=${key} não pode ser usado em produção`);
    fake.demo = key === 'demo';
    return fake;
  }
  if (key === 'cloudflare') return cloudflare;
  // `none`: um provedor que se diz não configurado; o portão responde "indisponível neste ambiente".
  fake.configured = false;
  return fake;
}

/** Inteligência artificial (Fase 12, ADR-0029): provedor trocável, portão de acesso, cotas e uso diário. */
@Global()
@Module({
  imports: [TenancyModule],
  controllers: [AiController],
  providers: [
    CloudflareAiProvider,
    FakeAiProvider,
    {
      provide: AiProvider,
      inject: [ConfigService, CloudflareAiProvider, FakeAiProvider],
      useFactory: createAiProvider,
    },
    AiUsageService,
    AiGateService,
    AiGatewayService,
    AiAdminService,
  ],
  exports: [AiProvider, AiGatewayService, AiGateService, AiUsageService],
})
export class AiModule {}
