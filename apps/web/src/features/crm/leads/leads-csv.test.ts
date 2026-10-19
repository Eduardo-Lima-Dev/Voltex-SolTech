import { describe, expect, it } from 'vitest';
import { LEADS_CSV_TEMPLATE, MAX_LEAD_ROWS, parseLeadsCsv } from './leads-csv';

const HEADER = 'nome;telefone;email;documento;segmento;cidade;uf;origem;observacoes';

describe('parseLeadsCsv', () => {
  it('lê o CSV com ponto e vírgula, mapeando segmento e origem pelo nome em português', () => {
    const { rows, errors } = parseLeadsCsv(
      `${HEADER}\nMaria Silva;(85) 98888-7777;maria@exemplo.com;;Residencial;Fortaleza;ce;Indicação;Cliente quente\n`,
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Maria Silva',
      phone: '(85) 98888-7777',
      email: 'maria@exemplo.com',
      segment: 'RESIDENTIAL',
      state: 'ce',
      source: 'REFERRAL',
      notes: 'Cliente quente',
    });
    expect(rows[0]!.document).toBeUndefined();
  });

  it('aceita só a coluna "nome", vírgula como separador, BOM e aspas', () => {
    const { rows, errors } = parseLeadsCsv('\uFEFFnome,telefone\r\n"Silva, João",85988887777\r\n');
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ name: 'Silva, João', phone: '85988887777' });
  });

  it('segmento e origem aceitam o código ou o nome, sem diferenciar acento ou maiúsculas', () => {
    const { rows, errors } = parseLeadsCsv(
      `${HEADER}\nA B;;;;RURAL;;;campanha;\nC D;;;;comércial;;;LANDING_PAGE;\nE F;;;;;;;Cadastro manual;`,
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.segment, r.source])).toEqual([
      ['RURAL', 'CAMPAIGN'],
      ['COMMERCIAL', 'LANDING_PAGE'],
      [undefined, 'MANUAL'],
    ]);
  });

  it('aponta a linha e o campo de cada problema, sem perder as linhas boas', () => {
    const { rows, errors } = parseLeadsCsv(
      `${HEADER}\nOk Um;;ok@ok.com;;;;;;\nX;;;;;;;;\nOk Dois;;email-ruim;;;;;;\nOk Três;;;;Espacial;;;;\nOk Quatro;;;;;;;Orkut;`,
    );
    expect(rows.map((r) => r.name)).toEqual(['Ok Um']);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/^Linha 3 \(X\): nome/);
    expect(errors[1]).toMatch(/^Linha 4 \(Ok Dois\): e-mail/);
    expect(errors[2]).toMatch(/segmento “Espacial” não existe/);
    expect(errors[3]).toMatch(/origem “Orkut” não existe/);
  });

  it('exige a coluna nome, ao menos uma linha e respeita o limite', () => {
    expect(parseLeadsCsv('telefone\n123').errors[0]).toMatch(/Coluna ausente.*nome/);
    expect(parseLeadsCsv('').errors[0]).toMatch(/cabeçalho/);
    expect(parseLeadsCsv(HEADER).errors[0]).toMatch(/cabeçalho/);
    const many = Array.from({ length: MAX_LEAD_ROWS + 1 }, (_, i) => `Lead ${i}`).join('\n');
    expect(parseLeadsCsv(`nome\n${many}`).errors[0]).toMatch(/mais de 500/);
  });

  it('o modelo tem só o cabeçalho e é aceito', () => {
    expect(LEADS_CSV_TEMPLATE.trim().split('\n')).toHaveLength(1);
    expect(parseLeadsCsv(`${LEADS_CSV_TEMPLATE}Fulano de Tal;;;;;;;;`).errors).toEqual([]);
  });
});
