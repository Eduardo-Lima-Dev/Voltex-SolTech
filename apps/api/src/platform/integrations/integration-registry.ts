import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { IntegrationAdapter } from './integration-adapter';

/**
 * Adaptadores conhecidos. Os adaptadores de cada tipo (monitoramento, assinatura) entram aqui nas fases seguintes.
 * Ligar um adaptador é decisão do servidor (`INTEGRATIONS_ENABLED_PROVIDERS`), depois de conferidos os termos.
 */
@Injectable()
export class IntegrationRegistry {
  private readonly adapters = new Map<string, IntegrationAdapter>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  register(adapter: IntegrationAdapter): void {
    this.adapters.set(adapter.key, adapter);
  }

  get(key: string): IntegrationAdapter | undefined {
    return this.adapters.get(key);
  }

  list(): IntegrationAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  private enabledKeys(): Set<string> {
    return new Set(
      this.config
        .get('INTEGRATIONS_ENABLED_PROVIDERS', { infer: true })
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    );
  }

  isEnabled(key: string): boolean {
    return this.enabledKeys().has(key);
  }
}
