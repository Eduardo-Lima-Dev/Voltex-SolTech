import type { RequestContext } from '../../common/context/request-context';
import {
  blindIndex,
  decryptField,
  deriveTenantKeys,
  encryptField,
  isEncrypted,
  type TenantKeys,
} from '../crypto/field-crypto';

/** Campos pessoais protegidos: cifrados no banco, com índice cego para busca por igualdade. */
const PROTECTED: Record<string, { encrypted: string[]; blind: string[] }> = {
  Account: { encrypted: ['document'], blind: ['documentNormalized'] },
  Lead: { encrypted: ['document'], blind: ['documentNormalized'] },
  Proposal: { encrypted: ['acceptedByDocument'], blind: [] },
};
const DECRYPT_KEYS = new Set(['document', 'acceptedByDocument']);
const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !(value instanceof Date);

/** Sem a chave-mestra o servidor nem sobe (validado em `env.ts`); aqui ela já vem decodificada. */
export function createFieldEncryption(master: Buffer, context: RequestContext) {
  const keysCache = new Map<string, TenantKeys>();
  const keysFor = (): TenantKeys => {
    const tenantId = context.requireTenantId();
    let keys = keysCache.get(tenantId);
    if (!keys) {
      keys = deriveTenantKeys(master, tenantId);
      keysCache.set(tenantId, keys);
    }
    return keys;
  };

  const protectValue = (value: unknown, fn: (v: string) => string): unknown => {
    if (typeof value === 'string') return fn(value);
    // `{ set: "..." }` em atualizações.
    if (isObject(value) && typeof value.set === 'string') return { ...value, set: fn(value.set) };
    return value;
  };

  const protectData = (model: string, data: unknown): unknown => {
    const config = PROTECTED[model];
    if (!config || data === undefined) return data;
    if (Array.isArray(data)) return data.map((item) => protectData(model, item));
    if (!isObject(data)) return data;
    const keys = keysFor();
    const out: Json = { ...data };
    for (const field of config.encrypted)
      if (field in out) out[field] = protectValue(out[field], (v) => encryptField(v, keys));
    for (const field of config.blind)
      if (field in out) out[field] = protectValue(out[field], (v) => blindIndex(v, keys));
    return out;
  };

  /** Filtros por `documentNormalized` viram filtros pelo índice cego; só igualdade (não há busca parcial). */
  const protectWhere = (where: unknown): unknown => {
    if (Array.isArray(where)) return where.map(protectWhere);
    if (!isObject(where)) return where;
    const out: Json = {};
    for (const [key, value] of Object.entries(where)) {
      if (key === 'documentNormalized') {
        const keys = keysFor();
        const toIndex = (v: unknown) => (typeof v === 'string' ? blindIndex(v, keys) : v);
        if (typeof value === 'string') out[key] = toIndex(value);
        else if (isObject(value)) {
          const next: Json = {};
          for (const [op, operand] of Object.entries(value)) {
            if (op === 'equals') next[op] = toIndex(operand);
            else if (op === 'in' || op === 'notIn') next[op] = (operand as unknown[]).map(toIndex);
            else if (op === 'not')
              next[op] = isObject(operand)
                ? protectWhere({ documentNormalized: operand })
                : toIndex(operand);
            else
              throw new Error(
                `Busca "${op}" em documentNormalized não é suportada: o documento é cifrado (só igualdade).`,
              );
          }
          out[key] = next;
        } else out[key] = value;
      } else out[key] = Array.isArray(value) || isObject(value) ? protectWhere(value) : value;
    }
    return out;
  };

  const revealResult = (result: unknown): unknown => {
    if (Array.isArray(result)) return result.map(revealResult);
    if (!isObject(result)) return result;
    const out: Json = {};
    for (const [key, value] of Object.entries(result)) {
      if (DECRYPT_KEYS.has(key) && typeof value === 'string' && isEncrypted(value))
        out[key] = decryptField(value, keysFor());
      else out[key] = Array.isArray(value) || isObject(value) ? revealResult(value) : value;
    }
    return out;
  };

  return {
    /** Transforma os argumentos antes da consulta e revela o resultado depois. */
    async run<T>({
      model,
      operation,
      args,
      query,
    }: {
      model: string;
      operation: string;
      args: Record<string, unknown>;
      query: (args: never) => Promise<T>;
    }): Promise<T> {
      const next: Record<string, unknown> = { ...args };
      if ('where' in next) next.where = protectWhere(next.where);
      if (WRITE_OPERATIONS.has(operation)) {
        if ('data' in next) next.data = protectData(model, next.data);
        if ('create' in next) next.create = protectData(model, next.create);
        if ('update' in next) next.update = protectData(model, next.update);
      }
      const result = await query(next as never);
      return revealResult(result) as T;
    },
  };
}
