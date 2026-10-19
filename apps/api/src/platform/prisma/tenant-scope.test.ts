import { describe, expect, it } from 'vitest';
import { TenantScopeError, scopeArgs } from './tenant-scope';

const T = 'tenant-a';

describe('scopeArgs', () => {
  it.each([
    'findMany',
    'findFirst',
    'findFirstOrThrow',
    'count',
    'aggregate',
    'groupBy',
    'deleteMany',
    'delete',
  ])('%s recebe where com tenantId', (op) => {
    expect(scopeArgs('User', op, { where: { role: 'ADMIN' } }, T)).toEqual({
      where: { role: 'ADMIN', tenantId: T },
    });
  });

  it('cria o where quando ausente', () => {
    expect(scopeArgs('User', 'findMany', undefined, T)).toEqual({ where: { tenantId: T } });
    expect(scopeArgs('User', 'count', {}, T)).toEqual({ where: { tenantId: T } });
  });

  it('findUnique mantém a chave única e acrescenta o tenant', () => {
    expect(scopeArgs('User', 'findUnique', { where: { id: 'u1' } }, T)).toEqual({
      where: { id: 'u1', tenantId: T },
    });
  });

  it('preserva select/include/orderBy', () => {
    const args = { where: { id: 'x' }, select: { id: true }, orderBy: { createdAt: 'desc' } };
    expect(scopeArgs('User', 'findMany', args, T)).toEqual({
      ...args,
      where: { id: 'x', tenantId: T },
    });
  });

  it('recusa filtro explícito por outro tenant, inclusive com o mesmo tenant sendo aceito', () => {
    expect(() => scopeArgs('User', 'findMany', { where: { tenantId: 'tenant-b' } }, T)).toThrow(
      TenantScopeError,
    );
    expect(scopeArgs('User', 'findMany', { where: { tenantId: T } }, T)).toEqual({
      where: { tenantId: T },
    });
  });

  it('create injeta tenantId e recusa outro tenant ou relação tenant', () => {
    expect(scopeArgs('Branch', 'create', { data: { name: 'x' } }, T)).toEqual({
      data: { name: 'x', tenantId: T },
    });
    expect(() =>
      scopeArgs('Branch', 'create', { data: { name: 'x', tenantId: 'tenant-b' } }, T),
    ).toThrow(TenantScopeError);
    expect(() =>
      scopeArgs('Branch', 'create', { data: { name: 'x', tenant: { connect: { id: 'b' } } } }, T),
    ).toThrow(TenantScopeError);
  });

  it('createMany injeta em cada linha (objeto ou lista)', () => {
    expect(scopeArgs('Branch', 'createMany', { data: [{ name: 'a' }, { name: 'b' }] }, T)).toEqual({
      data: [
        { name: 'a', tenantId: T },
        { name: 'b', tenantId: T },
      ],
    });
    expect(() =>
      scopeArgs('Branch', 'createManyAndReturn', { data: [{ name: 'a', tenantId: 'x' }] }, T),
    ).toThrow(TenantScopeError);
  });

  it('update/updateMany não podem mover o registro de tenant', () => {
    expect(scopeArgs('User', 'update', { where: { id: '1' }, data: { name: 'n' } }, T)).toEqual({
      where: { id: '1', tenantId: T },
      data: { name: 'n' },
    });
    expect(() =>
      scopeArgs('User', 'update', { where: { id: '1' }, data: { tenantId: 'b' } }, T),
    ).toThrow(TenantScopeError);
    expect(() =>
      scopeArgs('User', 'updateMany', { data: { tenant: { connect: { id: 'b' } } } }, T),
    ).toThrow(TenantScopeError);
  });

  it('upsert restringe where e create e recusa mover tenant no update', () => {
    const scoped = scopeArgs(
      'Team',
      'upsert',
      { where: { id: '1' }, create: { name: 'x' }, update: { name: 'y' } },
      T,
    );
    expect(scoped).toEqual({
      where: { id: '1', tenantId: T },
      create: { name: 'x', tenantId: T },
      update: { name: 'y' },
    });
    expect(() =>
      scopeArgs(
        'Team',
        'upsert',
        { where: { id: '1' }, create: { name: 'x' }, update: { tenantId: 'b' } },
        T,
      ),
    ).toThrow(TenantScopeError);
  });

  it('falha fechado em operações desconhecidas', () => {
    expect(() => scopeArgs('User', 'findRaw', {}, T)).toThrow(/não suportada/);
  });

  it('não muta o objeto de entrada', () => {
    const args = { where: { role: 'ADMIN' } };
    scopeArgs('User', 'findMany', args, T);
    expect(args).toEqual({ where: { role: 'ADMIN' } });
  });
});
