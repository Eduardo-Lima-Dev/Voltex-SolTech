import { describe, expect, it } from 'vitest';
import { AiPrivacySession } from './session';

const allow = () => true;
const json = (o: unknown) => JSON.stringify(o);

describe('sessão de privacidade (ponta a ponta)', () => {
  const make = () => {
    const s = new AiPrivacySession();
    s.pseudonyms.alias('CLIENTE', 'a1', 'Helena Duarte Campos');
    return s;
  };

  it('mascara a pergunta: nome vira pseudônimo e dado pessoal digitado é removido', () => {
    const s = make();
    const out = s.maskUserText(
      'Quanto Helena Duarte Campos deve? CPF 529.982.247-25, e-mail h@x.com',
    );
    expect(out.text).toBe('Quanto [CLIENTE_1] deve? CPF [CPF REMOVIDO], e-mail [E-MAIL REMOVIDO]');
    expect(out.removed).toEqual({ CPF: 1, EMAIL: 1 });
  });

  it('o resultado da ferramenta chega limpo: números viram referências e nome ou contato esquecidos são removidos', () => {
    const s = make();
    const seen = s.ingestToolResult(
      'cliente_perfil',
      { conta: 'a1' },
      {
        nome: 'Helena Duarte Campos',
        email: 'helena@example.com',
        observacao: 'ligar para (85) 98877-1001',
        vencidoCents: 231000,
      },
    ) as Record<string, unknown>;
    expect(JSON.stringify(seen)).not.toMatch(/Helena|@|98877/);
    expect(seen.nome).toBe('[CLIENTE_1]');
    expect(seen.vencidoCents).toMatchObject({ ref: '{{F1}}' });
    expect(JSON.stringify(seen)).toMatch(/R\$\s?2\.310,00/);
  });

  it('resposta boa: valida, renderiza valores e mostra o nome real a quem pode ver', () => {
    const s = make();
    s.ingestToolResult('t', {}, { vencidoCents: 231000 });
    const out = s.finalize(
      json({
        kind: 'ANSWER',
        text: '[CLIENTE_1] deve {{F1}}.',
        followUps: ['Ver parcelas de [CLIENTE_1]?'],
      }),
      allow,
    );
    expect(out).toMatchObject({ ok: true, kind: 'ANSWER' });
    if (!out.ok) return;
    expect(out.text).toMatch(/^Helena Duarte Campos deve R\$\s?2\.310,00\.$/);
    expect(out.factsUsed.map((f) => f.id)).toEqual(['F1']);
    expect(out.followUps).toEqual(['Ver parcelas de Helena Duarte Campos?']);
  });

  it('quem não pode ver o cliente recebe a resposta sem o nome', () => {
    const s = make();
    s.ingestToolResult('t', {}, { vencidoCents: 231000 });
    const out = s.finalize(json({ kind: 'ANSWER', text: '[CLIENTE_1] deve {{F1}}.' }), () => false);
    expect(out.ok && out.text).toMatch(/^um cliente deve R\$/);
  });

  it('número digitado pelo modelo reprova e devolve o reforço para a segunda tentativa', () => {
    const s = make();
    s.ingestToolResult('t', {}, { vencidoCents: 231000 });
    const out = s.finalize(json({ kind: 'ANSWER', text: 'Ela deve 2310 reais.' }), allow);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.issues.map((i) => i.code)).toEqual(['LOOSE_NUMBER']);
    expect(out.retryInstruction).toMatch(/\{\{F#\}\}/);
  });

  it('resposta fora do formato pedido reprova com FORMAT', () => {
    const s = make();
    const out = s.finalize('Claro! A cliente deve bastante.', allow);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues[0]!.code).toBe('FORMAT');
  });

  it('aceita o JSON mesmo dentro de cerca de código e com texto em volta', () => {
    const s = make();
    const raw =
      'Aqui está:\n```json\n' +
      json({ kind: 'ANSWER', text: 'Tudo certo com [CLIENTE_1].' }) +
      '\n```';
    expect(s.finalize(raw, allow)).toMatchObject({
      ok: true,
      text: 'Tudo certo com Helena Duarte Campos.',
    });
  });

  it('recusa: o texto é do sistema, e o "faltaria" do modelo só entra se passar nas regras', () => {
    const s = make();
    const out = s.finalize(
      json({
        kind: 'CANNOT_ANSWER',
        cannotAnswerReason: 'NO_DATA',
        text: 'Inventei isso',
        missing: ['o faturamento anual da empresa', 'o CPF 529.982.247-25 dela', 'receita de 2026'],
      }),
      allow,
    );
    expect(out).toMatchObject({ ok: true, kind: 'CANNOT_ANSWER', cannotAnswerReason: 'NO_DATA' });
    if (!out.ok) return;
    expect(out.text).toBe(
      'Não posso responder: o sistema não tem esse dado registrado. Faltaria: o faturamento anual da empresa.',
    );
    expect(out.text).not.toContain('Inventei');
  });

  it('recusa por falta de acesso e fora do escopo usam os textos fixos', () => {
    const s = make();
    const denied = s.finalize(
      json({ kind: 'CANNOT_ANSWER', cannotAnswerReason: 'ACCESS_DENIED' }),
      allow,
    );
    expect(denied.ok && denied.text).toMatch(/perfil não tem acesso/);
    const scope = s.finalize(
      json({ kind: 'CANNOT_ANSWER', cannotAnswerReason: 'OUT_OF_SCOPE' }),
      allow,
    );
    expect(scope.ok && scope.text).toMatch(/fora do que o assistente cobre/);
  });

  it('pergunta de esclarecimento passa pelas mesmas regras', () => {
    const s = make();
    const out = s.finalize(
      json({ kind: 'NEEDS_CLARIFICATION', text: 'De qual projeto você fala?' }),
      allow,
    );
    expect(out).toMatchObject({
      ok: true,
      kind: 'NEEDS_CLARIFICATION',
      text: 'De qual projeto você fala?',
    });
    const bad = s.finalize(
      json({ kind: 'NEEDS_CLARIFICATION', text: 'Fala do projeto 123?' }),
      allow,
    );
    expect(bad.ok).toBe(false);
  });
});

describe('o que vai ao modelo passa na última barreira', () => {
  it('resultado de ferramenta ingerido (inclusive valor alto) não aciona o bloqueio de dado pessoal', async () => {
    const { assertNoPersonalData } = await import('./guard');
    const s = new AiPrivacySession();
    const seen = s.ingestToolResult(
      't',
      {},
      { totalCents: 1_250_000_000, due: '2026-10-25', code: 'VLX-6WB4CMRT' },
    );
    expect(() =>
      assertNoPersonalData([{ role: 'tool', content: JSON.stringify(seen), toolCallId: 'c1' }]),
    ).not.toThrow();
  });
});
