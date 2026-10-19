import { createHash, randomBytes } from 'node:crypto';

/** Token opaco e imprevisível (refresh token, convite). Só o hash vai para o banco. */
export const generateOpaqueToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
