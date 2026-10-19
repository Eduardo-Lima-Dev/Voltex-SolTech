import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient, isTenantScopedModel, type PrismaClient } from '@voltex/database';
import { RequestContext } from '../../common/context/request-context';
import type { Env } from '../../config/env';
import { parseMasterKey } from '../crypto/field-crypto';
import { createFieldEncryption } from './field-encryption';
import { TenantScopeError, scopeArgs } from './tenant-scope';

function createScopedClient(base: PrismaClient, context: RequestContext, master: Buffer) {
  const encryption = createFieldEncryption(master, context);
  return (
    base
      .$extends({
        name: 'tenant-scope',
        query: {
          $allModels: {
            $allOperations({ model, operation, args, query }) {
              if (!isTenantScopedModel(model)) return query(args);
              const tenantId = context.tenantId;
              if (!tenantId) {
                throw new TenantScopeError(
                  `${model}.${operation}: sem tenant no contexto (use prisma.system para operações de sistema)`,
                );
              }
              return query(
                scopeArgs(
                  model,
                  operation,
                  args as Record<string, unknown>,
                  tenantId,
                ) as typeof args,
              );
            },
          },
        },
      })
      // Depois do filtro de tenant: cifra os campos pessoais ao gravar e os revela ao ler.
      .$extends({
        name: 'field-encryption',
        query: {
          $allModels: {
            $allOperations: ({ model, operation, args, query }) =>
              encryption.run({
                model,
                operation,
                args: args as Record<string, unknown>,
                query: query as never,
              }),
          },
        },
      })
  );
}

export type ScopedPrismaClient = ReturnType<typeof createScopedClient>;

/**
 * Duas portas de acesso ao banco, de propósito:
 * - `db`: filtra automaticamente por tenant e FALHA se não houver tenant no contexto (padrão para tudo).
 * - `system`: sem filtro. Só para o que acontece antes de existir tenant (login, aceitar convite, refresh)
 *   ou em workers (outbox). Quem usa precisa filtrar manualmente e justificar.
 *
 * `$queryRaw`/`$executeRaw` NÃO passam pela extensão; evite-os em código de negócio.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly system: PrismaClient;
  readonly db: ScopedPrismaClient;

  constructor(config: ConfigService<Env, true>, context: RequestContext) {
    this.system = createPrismaClient({
      connectionString: config.get('DATABASE_URL', { infer: true }),
    });
    this.db = createScopedClient(
      this.system,
      context,
      parseMasterKey(config.get('DATA_ENCRYPTION_KEY', { infer: true })),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.system.$disconnect();
    this.logger.log('Conexão com o banco encerrada');
  }
}
