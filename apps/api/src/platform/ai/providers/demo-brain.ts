import type { AiChatRequest, AiChatResult, AiToolCall } from '../ai-provider';

/**
 * "Cérebro" de demonstração do provedor simulado (`AI_PROVIDER=demo`): escolhe uma ferramenta por palavra-chave e
 * escreve uma resposta curta com a primeira referência de valor que encontrar. NÃO é inteligência: serve para ver
 * o assistente funcionando de ponta a ponta (telas, ferramentas, fatos, validador) sem internet e sem custo, e para
 * os testes de tela.
 */
const result = (over: Partial<AiChatResult>): AiChatResult => ({
  text: '',
  toolCalls: [],
  model: 'demo',
  neurons: 0,
  promptTokens: 0,
  completionTokens: 0,
  finishReason: 'stop',
  ...over,
});

const answer = (payload: unknown) => result({ text: JSON.stringify(payload) });

export function demoBrain(request: AiChatRequest): AiChatResult {
  const lastUser = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const question = lastUser.toLowerCase();
  const afterUser = request.messages.slice(
    request.messages.map((m) => m.role).lastIndexOf('user') + 1,
  );
  const toolOutputs = afterUser.filter((m) => m.role === 'tool');

  if (toolOutputs.length > 0) {
    const refs = [
      ...new Set(
        toolOutputs.flatMap((m) => [...m.content.matchAll(/\{\{F\d+\}\}/g)].map((r) => r[0])),
      ),
    ];
    if (refs.length === 0) {
      const meaning = /"significado":"([^"]+)"/.exec(toolOutputs[0]!.content)?.[1];
      return answer(
        meaning
          ? { kind: 'ANSWER', text: meaning }
          : {
              kind: 'CANNOT_ANSWER',
              cannotAnswerReason: 'NO_DATA',
              missing: ['dados para essa pergunta'],
            },
      );
    }
    return answer({
      kind: 'ANSWER',
      text: `Consultei o sistema. O principal número que encontrei é ${refs[0]}${refs[1] ? ` e o seguinte é ${refs[1]}` : ''}.`,
      followUps: ['Quais são os maiores valores?', 'Compare com o período anterior'],
    });
  }

  if (/poema|melhor marca|capital d|receita de/.test(question))
    return answer({ kind: 'CANNOT_ANSWER', cannotAnswerReason: 'OUT_OF_SCOPE' });

  const offered = new Set((request.tools ?? []).map((t) => t.name));
  const pick = (name: string, args: Record<string, unknown> = {}): AiChatResult | null =>
    offered.has(name)
      ? result({
          toolCalls: [{ id: 'demo-call-1', name, arguments: args } satisfies AiToolCall],
          finishReason: 'tool_calls',
        })
      : null;

  const glossary = /o que (é|significa)|glossário|significado/.exec(question);
  if (glossary) {
    const term = question
      .replace(/.*(o que (é|significa)|glossário|significado)( de| da| do)?/, '')
      .replace(/[?.]/g, '')
      .trim();
    const hit = pick('glossario', term ? { termo: term } : {});
    if (hit) return hit;
  }
  const rules: [RegExp, string][] = [
    [/vencid|parcela|inadimpl|receb|financeir/, 'financeiro_visao'],
    [/parad|travad|funil/, 'oportunidades_paradas'],
    [/lead/, 'leads_resumo'],
    [/melhor|ranking|cliente/, 'clientes_ranking'],
    [/chamado|usina|garantia/, 'posvenda_painel'],
    [/instala|agenda|equipe/, 'operacao_painel'],
    [/tarefa/, 'tarefas_resumo'],
  ];
  for (const [pattern, tool] of rules)
    if (pattern.test(question)) {
      const call = pick(tool);
      if (call) return call;
    }
  return answer({ kind: 'CANNOT_ANSWER', cannotAnswerReason: 'NO_TOOL' });
}
