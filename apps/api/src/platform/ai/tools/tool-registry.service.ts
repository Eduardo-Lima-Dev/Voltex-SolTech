import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { RequestUser } from '../../../common/context/request-user';
import type { AiToolSpec } from '../ai-provider';
import type { AiPrivacySession } from '../privacy/session';
import {
  AI_TOOL_SETS,
  TOOL_PAYLOAD_MAX_CHARS,
  TOOL_RAW_MAX_CHARS,
  capResult,
  type AiToolDefinition,
  type AiToolSet,
  type ToolContext,
  type ToolOutcome,
} from './tool';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Registro das ferramentas: oferece ao modelo só as que o usuário pode usar e confere tudo de novo ao executar. */
@Injectable()
export class AiToolRegistry {
  private readonly logger = new Logger(AiToolRegistry.name);
  private readonly byName = new Map<string, AiToolDefinition>();

  constructor(@Inject(AI_TOOL_SETS) sets: readonly AiToolSet[]) {
    for (const set of sets)
      for (const tool of set.tools) {
        if (this.byName.has(tool.name)) throw new Error(`Ferramenta de IA repetida: ${tool.name}`);
        this.byName.set(tool.name, tool);
      }
  }

  all(): AiToolDefinition[] {
    return [...this.byName.values()];
  }

  get(name: string): AiToolDefinition | undefined {
    return this.byName.get(name);
  }

  /** Usar o assistente é a base de tudo: sem `ai.assistant.use`, nenhuma ferramenta é oferecida nem executada. */
  private allowed(tool: AiToolDefinition, user: RequestUser): boolean {
    return (
      user.permissions.includes('ai.assistant.use') &&
      tool.permissions.every((p) => user.permissions.includes(p))
    );
  }

  /** O que o modelo recebe: apenas as ferramentas permitidas a este usuário. */
  specsFor(user: RequestUser): AiToolSpec[] {
    return this.all()
      .filter((tool) => this.allowed(tool, user))
      .map((tool) => {
        const schema = z.toJSONSchema(tool.params, {
          io: 'input',
          unrepresentable: 'any',
        }) as Record<string, unknown>;
        delete schema.$schema;
        return { name: tool.name, description: tool.description, parameters: schema };
      });
  }

  /** Áreas que o usuário NÃO alcança (para a recusa por falta de acesso). */
  deniedAreas(user: RequestUser): string[] {
    return [
      ...new Set(
        this.all()
          .filter((t) => !this.allowed(t, user))
          .map((t) => t.area),
      ),
    ].sort();
  }

  context(user: RequestUser, session: AiPrivacySession, now = new Date()): ToolContext {
    return {
      user,
      session,
      now,
      client: (id, name) => session.pseudonyms.alias('CLIENTE', id, name),
      contact: (id, name) => session.pseudonyms.alias('CONTATO', id, name),
      person: (id, name) => session.pseudonyms.alias('USUARIO', id, name),
      crew: (id, name) => session.pseudonyms.alias('EQUIPE', id, name),
      resolve: (kind, ref) => {
        const trimmed = ref.trim();
        const entry = session.pseudonyms
          .entries()
          .find((e) => e.alias === trimmed && e.kind === kind);
        if (entry) return entry.entityId;
        return UUID.test(trimmed) ? trimmed : null;
      },
    };
  }

  /**
   * Executa uma chamada do modelo. O contexto da requisição (empresa, usuário, perfil) já deve estar ativo: as
   * consultas ao banco usam a carteira dele. O resultado volta em fatos referenciados, já limpo e com tamanho limitado.
   */
  async execute(
    name: string,
    rawArgs: Record<string, unknown>,
    user: RequestUser,
    session: AiPrivacySession,
  ): Promise<ToolOutcome> {
    const tool = this.byName.get(name);
    if (!tool)
      return {
        ok: false,
        code: 'NO_TOOL',
        message: 'Essa ferramenta não existe. Use apenas as ferramentas oferecidas.',
      };
    if (!this.allowed(tool, user))
      return {
        ok: false,
        code: 'ACCESS_DENIED',
        area: tool.area,
        message: `O perfil do usuário não tem acesso a: ${tool.area}.`,
      };
    const parsed = tool.params.safeParse(rawArgs ?? {});
    if (!parsed.success)
      return {
        ok: false,
        code: 'INVALID_ARGUMENTS',
        message: `Parâmetros inválidos: ${parsed.error.issues.map((i) => i.path.join('.') || 'valor').join(', ')}.`,
      };
    try {
      const raw = await tool.run(this.context(user, session), parsed.data);
      const capped = capResult(raw, TOOL_RAW_MAX_CHARS);
      const safeParams = JSON.parse(JSON.stringify(parsed.data)) as Record<string, unknown>;
      const payload = session.ingestToolResult(tool.name, safeParams, capped.value);
      const second = capResult(payload, TOOL_PAYLOAD_MAX_CHARS);
      return { ok: true, payload: second.value, truncated: capped.truncated || second.truncated };
    } catch (error) {
      if (error instanceof NotFoundException)
        return {
          ok: false,
          code: 'NOT_FOUND',
          message:
            'Não encontrei esse registro (ou ele não está na carteira/permissão do usuário).',
        };
      this.logger.error({ err: error, tool: name }, 'Falha em ferramenta de IA');
      return {
        ok: false,
        code: 'ERROR',
        message: 'A consulta falhou. Informe que não foi possível consultar agora.',
      };
    }
  }
}
