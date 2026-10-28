import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AiAnswerKind,
  AiChatEvent,
  AiChatRequest,
  AiChatResponseDto,
  AiMessagePart,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import type { RequestUser } from '../../../common/context/request-user';
import type { Env } from '../../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGateService } from '../ai-gate.service';
import { AiGatewayService } from '../ai-gateway.service';
import { AiUsageService } from '../ai-usage.service';
import { AiUnavailableError } from '../ai-errors';
import type { AiMessage } from '../ai-provider';
import { findMentions, type NamedEntity } from '../privacy/mentions';
import { AiPrivacySession } from '../privacy/session';
import { cannotAnswerText } from '../privacy/structured-answer';
import { formatFact, type Fact } from '../privacy/facts';
import { revealPolicy } from '../tools/reveal-policy';
import { AiToolRegistry } from '../tools/tool-registry.service';
import { accessDeniedAnswer } from './areas';
import { AiConversationsService } from './conversations.service';
import { plainText, splitParts, toFactDto, toolLabel } from './parts';
import { SYSTEM_PROMPT, contextLine } from './system-prompt';
import { selectTools } from './tool-selection';

const MAX_ROUNDS = 3;
const MAX_CALLS_PER_ROUND = 4;
const MAX_FALLBACK_FACTS = 12;

const REMOVED_LABELS: Record<string, string> = {
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'e-mail',
  PHONE: 'telefone',
  CEP: 'CEP',
  COORDINATES: 'localização',
  LONG_NUMBER: 'número de documento',
};

const FIELD_LABELS: Record<string, string> = {
  totalReceivedCents: 'Total recebido',
  totalOpenCents: 'Total a receber',
  totalOverdueCents: 'Total vencido',
  totalCostsCents: 'Custos realizados',
  marginCents: 'Margem real',
  marginPct: 'Margem real (%)',
  valueCents: 'Valor do contrato',
  receivedLast30DaysCents: 'Recebido nos últimos 30 dias',
  commissionsPendingCents: 'Comissões pendentes',
  overdueInstallmentsCount: 'Parcelas vencidas',
  totalCount: 'Total',
  openCount: 'Em aberto',
  overdueCount: 'Atrasadas',
  slaBreachedCount: 'Com primeiro contato atrasado',
  stalledCount: 'Paradas',
  mrrCents: 'Receita recorrente mensal',
};

const fieldLabel = (path: string): string => {
  const last =
    path
      .split('.')
      .pop()
      ?.replace(/\[\d+\]/g, '') ?? path;
  return FIELD_LABELS[last] ?? path;
};

interface TurnOutcome {
  kind: AiAnswerKind;
  cannotAnswerReason: string | null;
  maskedText: string;
  parts: AiMessagePart[];
  factsShown: Fact[];
  followUps: string[];
}

/**
 * O assistente de ponta a ponta (Fase 12E, ADR-0030): recebe a pergunta, protege o que vai ao provedor, deixa o modelo
 * chamar ferramentas de leitura, valida a redação e devolve a resposta (ou uma recusa fixa). Em falha, devolve o que
 * já tem. Nunca deixa a pessoa sem uma resposta pronta.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly gate: AiGateService,
    private readonly gateway: AiGatewayService,
    private readonly usage: AiUsageService,
    private readonly registry: AiToolRegistry,
    private readonly conversations: AiConversationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Nomes da empresa (clientes, leads, contatos, colegas) para achar menções na pergunta. Só leem nomes: não saem daqui. */
  private async loadEntities(): Promise<NamedEntity[]> {
    return this.context.withoutOwnership(async () => {
      const db = this.prisma.db;
      const [accounts, leads, users] = await Promise.all([
        db.account.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true },
          take: 3000,
        }),
        db.lead.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true },
          take: 3000,
        }),
        db.user.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true },
          take: 500,
        }),
      ]);
      return [
        ...accounts.map((a) => ({ kind: 'CLIENTE' as const, id: a.id, name: a.name })),
        ...leads.map((l) => ({ kind: 'CONTATO' as const, id: l.id, name: l.name })),
        ...users.map((u) => ({ kind: 'USUARIO' as const, id: u.id, name: u.name })),
      ];
    });
  }

  private notice(removed: Record<string, number>): string | null {
    const kinds = Object.entries(removed).filter(([, n]) => n > 0);
    if (!kinds.length) return null;
    const list = kinds
      .map(([k, n]) => `${n > 1 ? `${n} ` : ''}${REMOVED_LABELS[k] ?? k}`)
      .join(', ');
    return `Por segurança, removi da sua pergunta antes de enviá-la à IA: ${list}.`;
  }

  async ask(
    user: RequestUser,
    request: AiChatRequest,
    emit: (event: AiChatEvent) => void = () => undefined,
  ): Promise<AiChatResponseDto> {
    const started = Date.now();
    const totalMs = this.config.get('AI_TOTAL_TIMEOUT_MS', { infer: true });
    const deadlineAt = started + totalMs;

    // Sem IA para esta pessoa agora: responde na hora com a mensagem pronta (e sem gastar nada).
    const blocked = await this.gate.blocker();
    if (blocked) throw new AiUnavailableError(blocked);

    const stored = request.conversationId
      ? await this.conversations.load(request.conversationId)
      : null;
    const session = new AiPrivacySession({ pseudonyms: stored?.pseudonyms, facts: stored?.facts });
    const reveal = revealPolicy(user);
    const canSee = (entry: Parameters<typeof reveal>[0]) => reveal(entry);

    emit({ type: 'progress', label: 'Entendendo a pergunta…' });

    // 1) Nomes citados: viram pseudônimo ANTES de qualquer coisa ir ao provedor.
    const entities = await this.loadEntities();
    const mention = findMentions(request.question, entities, (e) =>
      session.pseudonyms.alias(e.kind, e.id, e.name),
    );
    const masked = session.maskUserText(mention.text);
    const title = masked.text.slice(0, 60);
    const base = {
      conversationId: stored?.id ?? null,
      title,
      pseudonyms: session.pseudonyms.entries(),
      question: { text: masked.text, removed: masked.removed as Record<string, number> },
    };
    const finish = async (outcome: TurnOutcome, model: string | null, neurons: number | null) => {
      const facts = outcome.factsShown.map((f) =>
        toFactDto(f, (t) => toolLabel(t, this.registry.get(t)?.area)),
      );
      const text = plainText(outcome.parts);
      const saved = await this.conversations.saveTurn({
        ...base,
        pseudonyms: session.pseudonyms.entries(),
        facts: session.facts.all(),
        answer: {
          text,
          maskedText: JSON.stringify({ kind: outcome.kind, text: outcome.maskedText }),
          kind: outcome.kind,
          cannotAnswerReason: outcome.cannotAnswerReason,
          parts: outcome.parts,
          facts,
          followUps: outcome.followUps,
          model,
          neurons,
          durationMs: Date.now() - started,
        },
      });
      return {
        conversationId: saved.conversationId,
        message: saved.message,
        notice: this.notice(masked.removed),
      };
    };
    const fixed = (text: string, kind: AiAnswerKind, reason: string | null): TurnOutcome => ({
      kind,
      cannotAnswerReason: reason,
      maskedText: '',
      parts: [{ type: 'text', text }],
      factsShown: [],
      followUps: [],
    });

    // 2) Nome ambíguo: pede o nome completo (sem chamar o modelo).
    if (mention.ambiguous.length)
      return finish(
        fixed(
          `Encontrei mais de um cadastro com o nome "${mention.ambiguous.join('", "')}". Informe o nome completo para eu consultar o cadastro certo.`,
          'NEEDS_CLARIFICATION',
          null,
        ),
        null,
        null,
      );

    // 3) Assunto sem acesso para o perfil: recusa fixa, sem chamar o modelo.
    const denied = accessDeniedAnswer(request.question, user, this.registry);
    if (denied) return finish(fixed(denied, 'CANNOT_ANSWER', 'ACCESS_DENIED'), null, null);

    // 4) Conversa com o modelo: ferramentas de leitura e redação validada.
    await this.usage.recordQuestion().catch(() => undefined);
    const specs = selectTools(request.question, this.registry.specsFor(user));
    const history = (stored?.history ?? []).map((h): AiMessage => ({
      role: h.role === 'USER' ? 'user' : 'assistant',
      content: h.masked,
    }));
    const ctx = contextLine(request.context);
    const messages: AiMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: `${ctx ? `${ctx}\n\n` : ''}Pergunta: ${masked.text}` },
    ];
    const turnStart = session.facts.all().length;
    const turnFacts = (): Fact[] => session.facts.all().slice(turnStart);
    let neurons = 0;
    let model: string | null = null;
    let rounds = 0;
    let retried = false;

    const fallback = (reason: 'TIMEOUT' | 'FAILED' | 'UNVERIFIED'): TurnOutcome => {
      const facts = turnFacts().slice(0, MAX_FALLBACK_FACTS);
      const intro =
        reason === 'TIMEOUT'
          ? 'A IA demorou demais para responder; aqui estão os dados que encontrei:'
          : reason === 'FAILED'
            ? 'O assistente de IA ficou indisponível no meio da consulta; aqui estão os dados que encontrei:'
            : 'Não consegui redigir uma explicação confiável; estes são os dados que encontrei:';
      if (facts.length === 0)
        return fixed(
          'Não consegui consultar os dados agora. Tente de novo em instantes.',
          'FALLBACK',
          null,
        );
      const parts: AiMessagePart[] = [{ type: 'text', text: intro }];
      for (const f of facts) {
        parts.push({ type: 'text', text: `\n• ${fieldLabel(f.path)}: ` });
        parts.push({ type: 'fact', factId: f.id, text: formatFact(f) });
      }
      return {
        kind: 'FALLBACK',
        cannotAnswerReason: null,
        maskedText: '',
        parts,
        factsShown: facts,
        followUps: [],
      };
    };

    for (;;) {
      if (Date.now() > deadlineAt - 1_500 && turnFacts().length > 0)
        return finish(fallback('TIMEOUT'), model, neurons);
      let result;
      try {
        result = await this.gateway.chat({
          purpose: 'CHAT',
          messages,
          tools: rounds < MAX_ROUNDS ? specs : undefined,
          maxTokens: 700,
          temperature: 0.1,
          deadlineAt,
        });
      } catch (error) {
        // A IA caiu depois de já termos dados: entrega os dados em vez de uma tela de erro.
        if (
          error instanceof AiUnavailableError &&
          turnFacts().length > 0 &&
          error.aiCode !== 'PRIVACY_BLOCKED'
        )
          return finish(
            fallback(error.aiCode === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED'),
            model,
            neurons,
          );
        throw error;
      }
      neurons += result.neurons ?? 0;
      model = result.model;

      if (result.toolCalls.length > 0 && rounds < MAX_ROUNDS) {
        rounds += 1;
        const calls = result.toolCalls.slice(0, MAX_CALLS_PER_ROUND);
        messages.push({ role: 'assistant', content: result.text, toolCalls: calls });
        for (const call of calls) {
          const area = this.registry.get(call.name)?.area;
          emit({
            type: 'progress',
            label: area ? `Consultando ${area}…` : 'Consultando os dados…',
          });
          const outcome = await this.registry.execute(call.name, call.arguments, user, session);
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify(
              outcome.ok ? outcome.payload : { erro: outcome.message, codigo: outcome.code },
            ),
          });
        }
        continue;
      }

      emit({ type: 'progress', label: 'Redigindo a resposta…' });
      const final = session.finalize(result.text, canSee);
      // Resposta sobre os dados da empresa sem ter consultado nada e sem citar nenhum valor: o modelo estaria
      // falando de memória. Pede para consultar; se insistir, recusa com o texto fixo.
      if (final.ok && final.kind === 'ANSWER' && rounds === 0 && final.factsUsed.length === 0) {
        this.logger.warn('Resposta da IA sem consulta aos dados');
        if (retried)
          return finish(
            fixed(cannotAnswerText('NO_TOOL', []), 'CANNOT_ANSWER', 'NO_TOOL'),
            model,
            neurons,
          );
        retried = true;
        messages.push({
          role: 'user',
          content:
            'Você respondeu sem consultar nenhuma ferramenta. Chame a ferramenta adequada para obter os dados da empresa e só então responda. Se nenhuma ferramenta serve para a pergunta, responda com kind CANNOT_ANSWER e cannotAnswerReason NO_TOOL.',
        });
        continue;
      }
      if (final.ok) {
        const facts = new Map(session.facts.all().map((f) => [f.id, f]));
        const parts: AiMessagePart[] =
          final.kind === 'CANNOT_ANSWER'
            ? [{ type: 'text', text: final.text }]
            : splitParts(final.maskedText, facts, session.pseudonyms, canSee);
        return finish(
          {
            kind: final.kind,
            cannotAnswerReason: final.cannotAnswerReason,
            maskedText: final.maskedText,
            parts,
            factsShown: final.factsUsed,
            followUps: final.followUps,
          },
          model,
          neurons,
        );
      }
      this.logger.warn(
        { issues: final.issues.map((i) => i.code) },
        'Resposta da IA reprovada pelo validador',
      );
      if (retried) return finish(fallback('UNVERIFIED'), model, neurons);
      retried = true;
      // Nunca devolve ao modelo o texto reprovado (pode ter dado pessoal): só a instrução de correção.
      messages.push({ role: 'user', content: final.retryInstruction });
    }
  }
}
