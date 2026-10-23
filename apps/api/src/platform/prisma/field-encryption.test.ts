import { Prisma } from '@voltex/database';
import { describe, expect, it } from 'vitest';
import { createKeyring } from '../crypto/field-crypto';
import { createFieldEncryption } from './field-encryption';
import type { RequestContext } from '../../common/context/request-context';

const ring = createKeyring(Buffer.alloc(32, 7).toString('base64'));
const context = { requireTenantId: () => 'tenant-1' } as unknown as RequestContext;

describe('extensão de criptografia do Prisma', () => {
  it('não destrói valores Decimal, Date nem Buffer do resultado', async () => {
    const enc = createFieldEncryption(ring, context);
    const decimal = new Prisma.Decimal('12.50');
    const date = new Date('2026-10-23T00:00:00Z');
    const result = await enc.run({
      model: 'MonitoringDaily',
      operation: 'findMany',
      args: {},
      query: () =>
        Promise.resolve([{ id: 'a', kwhGenerated: decimal, date, nested: { value: decimal } }]),
    });
    const row = (
      result as unknown as {
        kwhGenerated: Prisma.Decimal;
        date: Date;
        nested: { value: Prisma.Decimal };
      }[]
    )[0]!;
    expect(row.kwhGenerated.toNumber()).toBe(12.5);
    expect(row.nested.value.toNumber()).toBe(12.5);
    expect(row.date.getTime()).toBe(date.getTime());
  });
});
