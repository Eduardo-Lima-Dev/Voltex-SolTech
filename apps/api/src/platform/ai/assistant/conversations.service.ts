import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AiAnswerKind,
  AiConversationDetailDto,
  AiConversationSummaryDto,
  AiFactDto,
  AiFeedbackInput,
  AiMessageDto,
  AiMessagePart,
} from '@voltex/shared';
import { RequestContext } from '../../../common/context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { Fact } from '../privacy/facts';
import type { PseudonymEntry } from '../privacy/pseudonymizer';

const MAX_FACTS_KEPT = 400;

interface MessageRow {
  id: string;
  role: 'USER' | 'ASSISTANT';
  text: string;
  maskedText: string | null;
  kind: string | null;
  cannotAnswerReason: string | null;
  parts: unknown;
  facts: unknown;
  followUps: unknown;
  removed: unknown;
  helpful: boolean | null;
  createdAt: Date;
}

export const toMessageDto = (m: MessageRow): AiMessageDto => ({
  id: m.id,
  role: m.role,
  text: m.text,
  parts: (m.parts ?? []) as AiMessagePart[],
  kind: (m.kind as AiAnswerKind | null) ?? null,
  cannotAnswerReason: m.cannotAnswerReason,
  facts: (m.facts ?? []) as AiFactDto[],
  followUps: (m.followUps ?? []) as string[],
  removed: (m.removed ?? {}) as Record<string, number>,
  helpful: m.helpful,
  createdAt: m.createdAt.toISOString(),
});

export interface StoredConversation {
  id: string;
  title: string;
  pseudonyms: PseudonymEntry[];
  facts: Fact[];
  /** Últimas mensagens, na ordem, no formato que o modelo vê. */
  history: { role: 'USER' | 'ASSISTANT'; masked: string }[];
}

/** Conversas do usuário com o assistente. Só o próprio usuário lê, edita ou apaga as dele (nem o administrador). */
@Injectable()
export class AiConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  private get userId(): string {
    const id = this.context.userId;
    if (!id) throw new Error('Conversa de IA sem usuário no contexto');
    return id;
  }

  async load(id: string): Promise<StoredConversation> {
    const row = await this.prisma.db.aiConversation.findFirst({
      where: { id, userId: this.userId, deletedAt: null },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 6 } },
    });
    if (!row) throw new NotFoundException('Conversa não encontrada');
    return {
      id: row.id,
      title: row.title,
      pseudonyms: row.pseudonyms as unknown as PseudonymEntry[],
      facts: row.facts as unknown as Fact[],
      history: [...row.messages].reverse().map((m) => ({
        role: m.role,
        masked: m.role === 'USER' ? m.text : (m.maskedText ?? m.text),
      })),
    };
  }

  /** Grava a pergunta e a resposta da vez e atualiza o que a conversa precisa lembrar (pseudônimos e fatos). */
  async saveTurn(input: {
    conversationId: string | null;
    title: string;
    pseudonyms: PseudonymEntry[];
    facts: Fact[];
    question: { text: string; removed: Record<string, number> };
    answer: {
      text: string;
      maskedText: string;
      kind: AiAnswerKind;
      cannotAnswerReason: string | null;
      parts: AiMessagePart[];
      facts: AiFactDto[];
      followUps: string[];
      model: string | null;
      neurons: number | null;
      durationMs: number;
    };
  }): Promise<{ conversationId: string; message: AiMessageDto }> {
    const tenantId = this.context.requireTenantId();
    const kept = input.facts.slice(-MAX_FACTS_KEPT);
    return this.prisma.db.$transaction(async (tx) => {
      const conversation = input.conversationId
        ? await tx.aiConversation.update({
            where: { id: input.conversationId },
            data: { pseudonyms: input.pseudonyms as never, facts: kept as never },
          })
        : await tx.aiConversation.create({
            data: {
              tenantId,
              userId: this.userId,
              title: input.title,
              pseudonyms: input.pseudonyms as never,
              facts: kept as never,
            },
          });
      await tx.aiMessage.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          role: 'USER',
          text: input.question.text,
          removed: input.question.removed as never,
        },
      });
      const reply = await tx.aiMessage.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          role: 'ASSISTANT',
          text: input.answer.text,
          maskedText: input.answer.maskedText,
          kind: input.answer.kind,
          cannotAnswerReason: input.answer.cannotAnswerReason,
          parts: input.answer.parts as never,
          facts: input.answer.facts as never,
          followUps: input.answer.followUps as never,
          model: input.answer.model,
          neurons: input.answer.neurons,
          durationMs: input.answer.durationMs,
        },
      });
      return { conversationId: conversation.id, message: toMessageDto(reply) };
    });
  }

  async list(limit = 30): Promise<AiConversationSummaryDto[]> {
    const rows = await this.prisma.db.aiConversation.findMany({
      where: { userId: this.userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { _count: { select: { messages: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updatedAt.toISOString(),
      messagesCount: r._count.messages,
    }));
  }

  async detail(id: string): Promise<AiConversationDetailDto> {
    const row = await this.prisma.db.aiConversation.findFirst({
      where: { id, userId: this.userId, deletedAt: null },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Conversa não encontrada');
    return { id: row.id, title: row.title, messages: row.messages.map(toMessageDto) };
  }

  async remove(id: string): Promise<{ id: string }> {
    const row = await this.prisma.db.aiConversation.findFirst({
      where: { id, userId: this.userId, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Conversa não encontrada');
    await this.prisma.db.aiConversation.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id };
  }

  async feedback(messageId: string, input: AiFeedbackInput): Promise<AiMessageDto> {
    const msg = await this.prisma.db.aiMessage.findFirst({
      where: {
        id: messageId,
        role: 'ASSISTANT',
        conversation: { userId: this.userId, deletedAt: null },
      },
    });
    if (!msg) throw new NotFoundException('Mensagem não encontrada');
    const updated = await this.prisma.db.aiMessage.update({
      where: { id: messageId },
      data: { helpful: input.helpful, feedbackReason: input.reason ?? null },
    });
    return toMessageDto(updated);
  }
}
