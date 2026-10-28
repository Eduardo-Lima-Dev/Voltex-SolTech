import type { AiCannotAnswerReason } from '@voltex/shared';
import { findPersonalData, redactPersonalData, type PersonalDataType } from './detectors';
import { FactTable, type Fact } from './facts';
import { Pseudonymizer, type PseudonymEntry } from './pseudonymizer';
import { refsIn, renderFacts } from './renderer';
import { cannotAnswerText, parseModelAnswer } from './structured-answer';
import { periodsIn, retryInstruction, validateAnswer, type AnswerIssue } from './validator';

export type FinalizedAnswer =
  | {
      ok: true;
      kind: 'ANSWER' | 'CANNOT_ANSWER' | 'NEEDS_CLARIFICATION';
      text: string;
      /** O que o modelo escreveu (com `{{F#}}` e pseudônimos), para o histórico das próximas perguntas. Vazio na recusa. */
      maskedText: string;
      cannotAnswerReason: AiCannotAnswerReason | null;
      /** Fatos citados na resposta, com a fonte, para o "ver os dados" da tela. */
      factsUsed: Fact[];
      followUps: string[];
    }
  | { ok: false; issues: AnswerIssue[]; retryInstruction: string };

/**
 * Uma resposta do assistente, do começo ao fim (ADR-0030): mascara o que entra, transforma o resultado das
 * ferramentas em fatos referenciados e só libera o texto do modelo depois de validado e renderizado.
 */
export class AiPrivacySession {
  readonly pseudonyms: Pseudonymizer;
  readonly facts: FactTable;
  /** Períodos escritos na pergunta atual (o modelo pode repeti-los). */
  private echo: string[] = [];

  constructor(opts: { pseudonyms?: readonly PseudonymEntry[]; facts?: readonly Fact[] } = {}) {
    this.pseudonyms = new Pseudonymizer(opts.pseudonyms);
    this.facts = new FactTable(opts.facts);
  }

  /** Pergunta do usuário: troca nomes conhecidos por pseudônimos e remove dado pessoal digitado. */
  maskUserText(text: string): {
    text: string;
    removed: Partial<Record<PersonalDataType, number>>;
  } {
    this.echo = periodsIn(text);
    return redactPersonalData(this.pseudonyms.scrub(text));
  }

  /** Mesmo tratamento, em todo texto do resultado de uma ferramenta (defesa extra: a ferramenta já deve vir limpa). */
  private clean(node: unknown): unknown {
    if (typeof node === 'string') return redactPersonalData(this.pseudonyms.scrub(node)).text;
    if (Array.isArray(node)) return node.map((n) => this.clean(n));
    if (node && typeof node === 'object')
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, this.clean(v)]),
      );
    return node;
  }

  /** Resultado de ferramenta → o que o modelo recebe (texto limpo e números como referências). */
  ingestToolResult(tool: string, params: Record<string, unknown>, result: unknown): unknown {
    return this.facts.ingest(tool, params, this.clean(result));
  }

  /**
   * Valida e renderiza a resposta bruta do modelo. Se reprovar, devolve os problemas e o texto de reforço para a
   * segunda tentativa. `canSee` decide quais nomes reais podem voltar para a tela de quem perguntou.
   */
  finalize(raw: string, canSee: (entry: PseudonymEntry) => boolean): FinalizedAnswer {
    const parsed = parseModelAnswer(raw);
    if (!parsed) {
      const issues: AnswerIssue[] = [
        { code: 'FORMAT', detail: 'responda apenas com o JSON pedido' },
      ];
      return { ok: false, issues, retryInstruction: retryInstruction(issues) };
    }
    const safe = (items: readonly string[]): string[] =>
      items.filter((s) => validateAnswer(s, this.facts, this.pseudonyms, this.echo).length === 0);
    const followUps = safe(parsed.followUps).map((s) => this.render(s, canSee));

    if (parsed.kind === 'CANNOT_ANSWER') {
      // O texto da recusa é do sistema; o que o modelo diz que falta só entra se passar nas mesmas regras.
      // "Faltaria" é só texto em português: item com referência a valor (`{{F1}}`) viraria "1; 10" sem sentido.
      const missing = safe(parsed.missing.filter((m) => !/\{\{/.test(m))).map((m) =>
        this.render(m, canSee),
      );
      return {
        ok: true,
        kind: 'CANNOT_ANSWER',
        text: cannotAnswerText(parsed.cannotAnswerReason, missing),
        maskedText: '',
        cannotAnswerReason: parsed.cannotAnswerReason ?? 'NO_DATA',
        factsUsed: [],
        followUps,
      };
    }

    parsed.text = this.tidy(parsed.text);
    const issues = validateAnswer(parsed.text, this.facts, this.pseudonyms, this.echo);
    if (issues.length > 0) return { ok: false, issues, retryInstruction: retryInstruction(issues) };
    const used = refsIn(parsed.text).flatMap((id) => {
      const f = this.facts.get(id);
      return f ? [f] : [];
    });
    return {
      ok: true,
      kind: parsed.kind,
      text: this.render(parsed.text, canSee),
      maskedText: parsed.text,
      cannotAnswerReason: null,
      factsUsed: used,
      followUps,
    };
  }

  /** O valor formatado já traz "R$": tira o "R$" que o modelo escreveu antes da referência (evita "R$ R$ 4.620,00"). */
  private tidy(text: string): string {
    return text.replace(/R\$\s*(\{\{\s*F\d+\s*\}\})/g, (whole, ref: string) => {
      const id = /F\d+/.exec(ref)?.[0];
      return id && this.facts.get(id)?.type === 'MONEY' ? ref : whole;
    });
  }

  private render(text: string, canSee: (entry: PseudonymEntry) => boolean): string {
    return this.pseudonyms.reveal(renderFacts(text, this.facts), canSee);
  }

  /** O texto final (já com nomes reais) não deve ser reenviado ao provedor: ferramenta para conferir. */
  static hasPersonalData(text: string): boolean {
    return findPersonalData(text).length > 0;
  }
}
