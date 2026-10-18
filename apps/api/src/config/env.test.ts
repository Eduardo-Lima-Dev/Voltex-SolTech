import { describe, expect, it } from 'vitest';
import { parseDurationToSeconds, validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  JWT_SECRET: 'x'.repeat(40),
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
};

describe('parseDurationToSeconds', () => {
  it.each([
    ['15m', 900],
    ['7d', 604_800],
    ['2h', 7200],
    ['90s', 90],
    ['3600', 3600],
    [60, 60],
  ])('%s → %d', (input, expected) => expect(parseDurationToSeconds(input)).toBe(expected));

  it('rejeita formatos inválidos', () => {
    expect(() => parseDurationToSeconds('quinze minutos')).toThrow(/inválida/);
    expect(() => parseDurationToSeconds('5x')).toThrow();
  });
});

describe('validateEnv', () => {
  it('aplica padrões e converte tipos', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 3000,
      JWT_ACCESS_TTL: 900,
      JWT_REFRESH_TTL: 604_800,
      S3_FORCE_PATH_STYLE: true,
    });
  });

  it('falha de forma legível quando falta variável obrigatória', () => {
    expect(() => validateEnv({ JWT_SECRET: 'x'.repeat(40) })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'curto' })).toThrow(/32 caracteres/);
  });

  it('recusa o segredo JWT de desenvolvimento em produção', () => {
    const devSecret = 'dev-only-change-me-jwt-secret-0123456789';
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', JWT_SECRET: devSecret })).toThrow(
      /produção/,
    );
    expect(
      validateEnv({ ...base, NODE_ENV: 'development', JWT_SECRET: devSecret }).JWT_SECRET,
    ).toBe(devSecret);
  });
});
