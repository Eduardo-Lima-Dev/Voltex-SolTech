import type { RequestContext } from '../../common/context/request-context';
import {
  blindIndex,
  blindIndexes,
  decryptField,
  encryptField,
  isEncrypted,
  type Keyring,
} from '../crypto/field-crypto';

/**
 * Campos pessoais protegidos: cifrados no banco, com índice cego para busca por igualdade.
 *  - `encrypted`: texto cifrado na gravação e decifrado na leitura.
 *  - `blind`: índice cego (HMAC) calculado a partir do valor normalizado.
 *  - `json`: campo JSON cujo conteúdo inteiro é guardado cifrado (como texto) e devolvido já como objeto.
 */
const PROTECTED: Record<string, { encrypted: string[]; blind: string[]; json: string[] }> = {
  Account: { encrypted: ['document'], blind: ['documentNormalized'], json: [] },
  Lead: { encrypted: ['document'], blind: ['documentNormalized'], json: [] },
  Proposal: { encrypted: ['acceptedByDocument'], blind: [], json: [] },
  // O texto do contrato e as variáveis preenchidas trazem nome, CPF/CNPJ e endereço do cliente.
  Contract: { encrypted: ['body'], blind: [], json: ['variables'] },
};
const REVEAL_TEXT = new Set(['document', 'acceptedByDocument', 'body']);
const REVEAL_JSON = new Set(['variables']);
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

/** O servidor só sobe com o conjunto de chaves válido (validado em `env.ts`). */
export function createFieldEncryption(ring: Keyring, context: RequestContext) {
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
    const tenantId = context.requireTenantId();
    const out: Json = { ...data };
    for (const field of config.encrypted)
      if (field in out)
        out[field] = protectValue(out[field], (v) => encryptField(v, ring, tenantId));
    for (const field of config.blind)
      if (field in out) out[field] = protectValue(out[field], (v) => blindIndex(v, ring, tenantId));
    for (const field of config.json)
      if (
        field in out &&
        out[field] !== null &&
        out[field] !== undefined &&
        typeof out[field] !== 'string'
      )
        out[field] = encryptField(JSON.stringify(out[field]), ring, tenantId);
    return out;
  };

  /** Filtros por `documentNormalized` viram filtros pelos índices cegos (de todas as chaves); só igualdade. */
  const protectWhere = (where: unknown): unknown => {
    if (Array.isArray(where)) return where.map(protectWhere);
    if (!isObject(where)) return where;
    const out: Json = {};
    for (const [key, value] of Object.entries(where)) {
      if (key === 'documentNormalized') {
        const tenantId = context.requireTenantId();
        const indexes = (v: unknown): string[] =>
          typeof v === 'string' ? blindIndexes(v, ring, tenantId) : [];
        if (typeof value === 'string') out[key] = { in: indexes(value) };
        else if (isObject(value)) {
          const next: Json = {};
          for (const [op, operand] of Object.entries(value)) {
            if (op === 'equals') next.in = indexes(operand);
            else if (op === 'in') next.in = (operand as unknown[]).flatMap(indexes);
            else if (op === 'notIn') next.notIn = (operand as unknown[]).flatMap(indexes);
            else if (op === 'not')
              next.notIn =
                isObject(operand) && 'equals' in operand
                  ? indexes(operand.equals)
                  : indexes(operand);
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
      if (REVEAL_TEXT.has(key) && typeof value === 'string' && isEncrypted(value))
        out[key] = decryptField(value, ring, context.requireTenantId());
      else if (REVEAL_JSON.has(key) && typeof value === 'string' && isEncrypted(value))
        out[key] = JSON.parse(decryptField(value, ring, context.requireTenantId()));
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
