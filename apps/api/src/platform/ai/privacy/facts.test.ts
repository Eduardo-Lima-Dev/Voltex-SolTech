import { describe, expect, it } from 'vitest';
import { FactTable, formatFact, inferFactType } from './facts';
import { renderFacts, refsIn } from './renderer';

describe('tipo do fato pelo nome do campo e pelo valor', () => {
  it('segue a convenção das ferramentas', () => {
    expect(inferFactType('amountCents', 594000)).toBe('MONEY');
    expect(inferFactType('marginRealPct', 24.5)).toBe('PERCENT_POINTS');
    expect(inferFactType('conversionRate', 0.25)).toBe('PERCENT');
    expect(inferFactType('expectedKwh', 528)).toBe('KWH');
    expect(inferFactType('powerKwp', 4.4)).toBe('KWP');
    expect(inferFactType('overdueCount', 3)).toBe('COUNT');
    expect(inferFactType('qualquer', 7)).toBe('NUMBER');
    expect(inferFactType('dueOn', '2026-10-25')).toBe('DATE');
    expect(inferFactType('createdAt', '2026-10-25T12:00:00.000Z')).toBe('DATE');
    expect(inferFactType('projectCode', 'VLX-6WB4CMRT')).toBe('CODE');
    expect(inferFactType('ref', 'NF-2026/10')).toBe('TEXT');
  });

  it('texto sem algarismo, booleano e nulo não viram fato', () => {
    expect(inferFactType('stage', 'Qualificação')).toBeNull();
    expect(inferFactType('active', true)).toBeNull();
    expect(inferFactType('x', null)).toBeNull();
    expect(inferFactType('x', Number.NaN)).toBeNull();
    // Pseudônimo tem algarismo, mas não é dado a referenciar.
    expect(inferFactType('nome', '[CLIENTE_1]')).toBeNull();
    expect(inferFactType('obs', '[CLIENTE_1] pagou a NF 123')).toBe('TEXT');
  });
});

describe('formatação em pt-BR', () => {
  it('cada tipo no seu formato', () => {
    expect(formatFact({ type: 'MONEY', value: 594000 })).toMatch(/R\$\s?5\.940,00/);
    expect(formatFact({ type: 'PERCENT', value: 0.245 })).toBe('24,5%');
    expect(formatFact({ type: 'PERCENT_POINTS', value: 24.5 })).toBe('24,5%');
    expect(formatFact({ type: 'COUNT', value: 3 })).toBe('3');
    expect(formatFact({ type: 'KWH', value: 528 })).toBe('528 kWh');
    expect(formatFact({ type: 'KWP', value: 4.4 })).toBe('4,40 kWp');
    expect(formatFact({ type: 'DATE', value: '2026-10-25T15:00:00.000Z' })).toBe('25/10/2026');
    expect(formatFact({ type: 'CODE', value: 'VLX-1' })).toBe('VLX-1');
  });
});

describe('tabela de fatos', () => {
  const result = {
    projectCode: 'VLX-6WB4CMRT',
    stage: 'Qualificação',
    totalOverdueCents: 231000,
    overdue: [{ order: 2, dueOn: '2026-10-22', amountCents: 231000 }],
    marginRealPct: 24.5,
    ativo: true,
  };

  it('troca cada número, data e código por { ref, valor } e guarda a fonte', () => {
    const facts = new FactTable();
    const out = facts.ingest(
      'financeiro_projeto',
      { projeto: 'VLX-6WB4CMRT' },
      result,
      new Date('2026-10-25T10:00:00Z'),
    ) as {
      stage: string;
      ativo: boolean;
      totalOverdueCents: { ref: string; valor: string };
      overdue: { amountCents: { ref: string } }[];
    };
    expect(out.stage).toBe('Qualificação');
    expect(out.ativo).toBe(true);
    expect(out.totalOverdueCents.ref).toBe('{{F2}}');
    expect(out.totalOverdueCents.valor).toMatch(/R\$\s?2\.310,00/);
    expect(out.overdue[0]!.amountCents.ref).toBe('{{F5}}');
    const f = facts.get('F2')!;
    expect(f).toMatchObject({ type: 'MONEY', value: 231000, path: 'totalOverdueCents' });
    expect(f.source).toEqual({
      tool: 'financeiro_projeto',
      params: { projeto: 'VLX-6WB4CMRT' },
      at: '2026-10-25T10:00:00.000Z',
    });
    expect(facts.all().map((x) => x.type)).toEqual([
      'CODE',
      'MONEY',
      'NUMBER',
      'DATE',
      'MONEY',
      'PERCENT_POINTS',
    ]);
  });

  it('as referências continuam únicas entre várias ferramentas da mesma resposta', () => {
    const facts = new FactTable();
    facts.ingest('a', {}, { xCents: 1 });
    facts.ingest('b', {}, { yCents: 2 });
    expect(facts.all().map((f) => f.id)).toEqual(['F1', 'F2']);
  });

  it('renderiza {{F#}} com o valor formatado e mantém o que não conhece', () => {
    const facts = new FactTable();
    facts.ingest('t', {}, { aCents: 231000, mPct: 24.5 });
    const text = 'Vencido: {{F1}} com margem de {{ F2 }}; ver {{F9}}.';
    expect(refsIn(text)).toEqual(['F1', 'F2', 'F9']);
    expect(renderFacts(text, facts)).toMatch(
      /Vencido: R\$\s?2\.310,00 com margem de 24,5%; ver \{\{F9\}\}\./,
    );
  });
});

describe('valor visto pelo modelo', () => {
  it('vai formatado; um valor grande em centavos não vira número cru longo', () => {
    const facts = new FactTable();
    const out = facts.ingest('t', {}, { contractCents: 1_250_000_000 }) as Record<
      string,
      { valor: string }
    >;
    expect(out.contractCents!.valor).toMatch(/R\$\s?12\.500\.000,00/);
    expect(JSON.stringify(out)).not.toMatch(/\d{9,}/);
  });
});
