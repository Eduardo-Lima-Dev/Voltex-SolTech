import { z } from 'zod';
import type { Permission } from '@voltex/shared';
import type { RequestUser } from '../../../common/context/request-user';
import type { AiPrivacySession } from '../privacy/session';

/**
 * Ferramentas de leitura do assistente (Fase 12D, ADR-0030). Cada uma:
 *  - exige a MESMA permissão da rota de leitura que ela espelha (`mirrors`; um teste compara);
 *  - roda com o usuário que perguntou (empresa, perfil e carteira dele);
 *  - devolve só campos seguros: nomes viram pseudônimos pelo `ctx`, e nenhum dado pessoal sai daqui.
 */

export interface ToolContext {
  user: RequestUser;
  session: AiPrivacySession;
  now: Date;
  /** Pseudônimo de uma conta (cliente), de um lead/contato, de um usuário interno ou de uma equipe. */
  client(id: string, name: string): string;
  contact(id: string, name: string): string;
  person(id: string, name: string): string;
  crew(id: string, name: string): string;
  /** Entidade a que um pseudônimo (`[CLIENTE_1]`) ou um id aponta, ou `null` se a referência não é desta conversa. */
  resolve(kind: 'CLIENTE' | 'CONTATO' | 'USUARIO' | 'EQUIPE', ref: string): string | null;
}

export interface MirroredRoute {
  /** Classe do controlador cuja rota de leitura esta ferramenta espelha. */
  controller: abstract new (...args: never[]) => unknown;
  handler: string;
}

export interface AiToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  /** Área mostrada ao usuário quando falta acesso ("o seu perfil não tem acesso a …"). */
  area: string;
  /** Texto para o modelo decidir quando usar a ferramenta. */
  description: string;
  /** Todas são exigidas. */
  permissions: readonly Permission[];
  mirrors: MirroredRoute;
  params: S;
  run(ctx: ToolContext, params: z.output<S>): Promise<unknown>;
}

export function defineTool<S extends z.ZodObject>(def: AiToolDefinition<S>): AiToolDefinition {
  return def as unknown as AiToolDefinition;
}

/** Conjunto de ferramentas de um domínio, registrado no módulo. */
export interface AiToolSet {
  readonly tools: readonly AiToolDefinition[];
}

export const AI_TOOL_SETS = Symbol('AI_TOOL_SETS');

/** Limites padrão de tamanho: a resposta de uma ferramenta tem que caber no contexto do modelo. */
export const TOOL_RAW_MAX_CHARS = 5_000;
export const TOOL_PAYLOAD_MAX_CHARS = 10_000;

const size = (v: unknown): number => JSON.stringify(v)?.length ?? 0;

/**
 * Corta o resultado até caber: reduz à metade a maior lista, repetidamente. Devolve também se cortou, para a
 * resposta poder dizer "mostrando só uma parte".
 */
export function capResult(
  value: unknown,
  maxChars: number,
): { value: unknown; truncated: boolean } {
  let truncated = false;
  const current = structuredClone(value);
  for (let guard = 0; guard < 40 && size(current) > maxChars; guard++) {
    let best: { arr: unknown[]; bytes: number } | null = null;
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        const bytes = size(node);
        if (node.length > 1 && (!best || bytes > best.bytes)) best = { arr: node, bytes };
        node.forEach(walk);
      } else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(current);
    const target = best as { arr: unknown[]; bytes: number } | null;
    if (!target) break;
    target.arr.length = Math.max(1, Math.floor(target.arr.length / 2));
    truncated = true;
  }
  if (size(current) > maxChars)
    return {
      value: {
        truncated: true,
        aviso: 'Resultado grande demais para exibir; peça um recorte menor.',
      },
      truncated: true,
    };
  if (truncated && current && typeof current === 'object' && !Array.isArray(current))
    (current as Record<string, unknown>).truncated = true;
  return { value: current, truncated };
}

/** Mensagens do modelo sobre o que aconteceu com a chamada. Nunca levam dado do usuário. */
export type ToolFailure = 'NO_TOOL' | 'ACCESS_DENIED' | 'INVALID_ARGUMENTS' | 'NOT_FOUND' | 'ERROR';

export type ToolOutcome =
  | { ok: true; payload: unknown; truncated: boolean }
  | { ok: false; code: ToolFailure; message: string; area?: string };
