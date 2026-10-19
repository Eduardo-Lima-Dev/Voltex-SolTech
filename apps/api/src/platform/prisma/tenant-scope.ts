/**
 * Regras puras de escopo de tenant para argumentos de consulta do Prisma.
 * Separado da extensão para ser testável sem banco. Falha FECHADO: qualquer operação não
 * reconhecida, ou tentativa de ler/gravar em outro tenant, lança erro.
 */

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

type Args = Record<string, unknown> | undefined;

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

const MUTATING_WITH_DATA = new Set(['update', 'updateMany', 'updateManyAndReturn']);

function scopeWhere(where: unknown, tenantId: string, model: string): Record<string, unknown> {
  const current = (where ?? {}) as Record<string, unknown>;
  if (current.tenantId !== undefined && current.tenantId !== tenantId) {
    throw new TenantScopeError(`${model}: filtro por tenantId diferente do tenant da requisição`);
  }
  return { ...current, tenantId };
}

function assertNoTenantChange(data: unknown, model: string): void {
  const record = data as Record<string, unknown> | undefined;
  if (record && ('tenantId' in record || 'tenant' in record)) {
    throw new TenantScopeError(`${model}: não é permitido alterar o tenant de um registro`);
  }
}

function scopeCreateData(data: unknown, tenantId: string, model: string): Record<string, unknown> {
  const record = (data ?? {}) as Record<string, unknown>;
  if ('tenant' in record) {
    throw new TenantScopeError(`${model}: informe tenantId em vez de relação tenant`);
  }
  if (record.tenantId !== undefined && record.tenantId !== tenantId) {
    throw new TenantScopeError(`${model}: tentativa de criar registro em outro tenant`);
  }
  return { ...record, tenantId };
}

/** Devolve os argumentos já restritos ao tenant, ou lança `TenantScopeError`. */
export function scopeArgs(
  model: string,
  operation: string,
  args: Args,
  tenantId: string,
): Record<string, unknown> {
  const input = (args ?? {}) as Record<string, unknown>;

  if (WHERE_OPERATIONS.has(operation)) {
    if (MUTATING_WITH_DATA.has(operation)) assertNoTenantChange(input.data, model);
    return { ...input, where: scopeWhere(input.where, tenantId, model) };
  }

  switch (operation) {
    case 'create':
      return { ...input, data: scopeCreateData(input.data, tenantId, model) };
    case 'createMany':
    case 'createManyAndReturn': {
      const data = Array.isArray(input.data) ? input.data : [input.data];
      return { ...input, data: data.map((row) => scopeCreateData(row, tenantId, model)) };
    }
    case 'upsert':
      assertNoTenantChange(input.update, model);
      return {
        ...input,
        where: scopeWhere(input.where, tenantId, model),
        create: scopeCreateData(input.create, tenantId, model),
      };
    default:
      throw new TenantScopeError(
        `${model}.${operation}: operação não suportada em modelo com escopo de tenant`,
      );
  }
}
