import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VARIABLES,
  DEFAULT_CONTRACT_TEMPLATE,
  MISSING_VALUE,
  extractTemplateVariables,
  renderContractTemplate,
  unknownTemplateVariables,
} from './contract-template';
import { BUILT_IN_HOMOLOGATION_RULES, applicableChecklistItems } from './homologation';

describe('modelo de contrato', () => {
  it('extrai as variáveis sem repetição, aceitando espaços dentro das chaves', () => {
    expect(
      extractTemplateVariables('{{cliente.nome}} e {{ cliente.nome }} pagam {{contrato.valor}}'),
    ).toEqual(['cliente.nome', 'contrato.valor']);
  });

  it('aponta variáveis desconhecidas (erro de digitação)', () => {
    expect(unknownTemplateVariables('{{cliente.nome}} {{cliente.nomee}} {{x}}')).toEqual([
      'cliente.nomee',
      'x',
    ]);
  });

  it('preenche os valores e marca o que ficou sem valor', () => {
    const out = renderContractTemplate(
      'A: {{cliente.nome}} / B: {{contrato.pagamento}} / C: {{contrato.valor}}',
      {
        'cliente.nome': 'Maria',
        'contrato.pagamento': '   ',
      },
    );
    expect(out.text).toBe(`A: Maria / B: ${MISSING_VALUE} / C: ${MISSING_VALUE}`);
    expect(out.missing.sort()).toEqual(['contrato.pagamento', 'contrato.valor']);
  });

  it('o modelo-base só usa variáveis conhecidas e avisa que não tem revisão jurídica', () => {
    expect(unknownTemplateVariables(DEFAULT_CONTRACT_TEMPLATE)).toEqual([]);
    expect(DEFAULT_CONTRACT_TEMPLATE).toMatch(/MODELO-BASE/);
    expect(new Set(CONTRACT_VARIABLES.map((v) => v.key)).size).toBe(CONTRACT_VARIABLES.length);
  });
});

describe('checklist de homologação (base EnergIF 2023)', () => {
  const rules = BUILT_IN_HOMOLOGATION_RULES;

  it('todo item e todo prazo traz a fonte; a base não está revisada', () => {
    expect(rules.reviewedBy).toBeNull();
    for (const item of rules.items) expect(item.source).toMatch(/EnergIF/);
    for (const deadline of rules.deadlines) expect(deadline.source).toMatch(/EF-R06/);
    expect(new Set(rules.items.map((i) => i.code)).size).toBe(rules.items.length);
  });

  it('o cronograma só vale para minigeração', () => {
    const micro = applicableChecklistItems(rules, 'MICRO')
      .filter((x) => x.applicable)
      .map((x) => x.item.code);
    const mini = applicableChecklistItems(rules, 'MINI')
      .filter((x) => x.applicable)
      .map((x) => x.item.code);
    expect(micro).not.toContain('SCHEDULE');
    expect(mini).toContain('SCHEDULE');
    // Sem a classe, entra por precaução.
    expect(
      applicableChecklistItems(rules, null)
        .filter((x) => x.applicable)
        .map((x) => x.item.code),
    ).toContain('SCHEDULE');
  });
});
