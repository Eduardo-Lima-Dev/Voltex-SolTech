import { z } from 'zod';
import {
  AI_CANNOT_ANSWER_MESSAGES,
  AI_CANNOT_ANSWER_REASONS,
  type AiCannotAnswerReason,
} from '@voltex/shared';

/** Formato da resposta do modelo (ADR-0030): ele escolhe o tipo; o texto de recusa é do sistema. */
export const modelAnswerSchema = z.object({
  kind: z.enum(['ANSWER', 'CANNOT_ANSWER', 'NEEDS_CLARIFICATION']),
  text: z.string().default(''),
  cannotAnswerReason: z.enum(AI_CANNOT_ANSWER_REASONS).optional(),
  missing: z.array(z.string()).max(5).default([]),
  followUps: z.array(z.string()).max(3).default([]),
});
export type ModelAnswer = z.infer<typeof modelAnswerSchema>;

/** Tira cercas de código e texto antes/depois do JSON, que alguns modelos acrescentam. */
function extractJson(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}

export function parseModelAnswer(raw: string): ModelAnswer | null {
  const json = extractJson(raw);
  if (!json) return null;
  try {
    const parsed = modelAnswerSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Texto fixo da recusa. Sem motivo informado, o motivo é "sem dado". */
export function cannotAnswerText(
  reason: AiCannotAnswerReason | undefined,
  missing: readonly string[] = [],
): string {
  const base = AI_CANNOT_ANSWER_MESSAGES[reason ?? 'NO_DATA'];
  return missing.length ? `${base} Faltaria: ${missing.join('; ')}.` : base;
}
