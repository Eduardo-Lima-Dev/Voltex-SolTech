import { describe, expect, it } from 'vitest';
import { exceededQuota, nextReset, utcDay, type QuotaLimits, type QuotaUsage } from './ai-quota';

const limits: QuotaLimits = { global: 9_000, tenant: 1_500, user: 300, insights: 150 };
const none: QuotaUsage = { global: 0, tenant: 0, user: 0, insights: 0 };

describe('cotas de IA', () => {
  it('cabendo em tudo, libera', () => {
    expect(exceededQuota('CHAT', limits, none)).toBeNull();
  });

  it('a plataforma é a primeira a barrar', () => {
    expect(exceededQuota('CHAT', limits, { ...none, global: 8_990 })).toBe('QUOTA_GLOBAL');
  });

  it('empresa e depois usuário', () => {
    expect(exceededQuota('CHAT', limits, { ...none, tenant: 1_490 })).toBe('QUOTA_TENANT');
    expect(exceededQuota('CHAT', limits, { ...none, user: 290 })).toBe('QUOTA_USER');
  });

  it('insights usam a própria cota e não tiram a do chat', () => {
    const used = { ...none, tenant: 1_500, user: 300 };
    expect(exceededQuota('INSIGHTS', limits, used)).toBeNull();
    expect(exceededQuota('CHAT', limits, used)).toBe('QUOTA_TENANT');
    expect(exceededQuota('INSIGHTS', limits, { ...none, insights: 145 })).toBe('QUOTA_TENANT');
  });

  it('cota zero bloqueia tudo', () => {
    expect(exceededQuota('CHAT', { ...limits, tenant: 0 }, none)).toBe('QUOTA_TENANT');
  });

  it('o dia vira à meia-noite UTC', () => {
    const now = new Date('2026-10-25T23:59:00.000Z');
    expect(utcDay(now).toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(nextReset(now).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
});
