import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_ROWS, SOLAR_RESOURCES_CSV_TEMPLATE, parseSolarResourcesCsv } from './csv';

const HEADER =
  'nome;uf;latitude;longitude;fonte;plano;jan;fev;mar;abr;mai;jun;jul;ago;set;out;nov;dez';
const months = (value: string) => Array<string>(12).fill(value).join(';');

describe('parseSolarResourcesCsv', () => {
  it('lê CSV com ponto e vírgula e decimais em vírgula', () => {
    const csv = `${HEADER}\nFortaleza;ce;-3,73;-38,52;CRESESB SunData;Plano horizontal;${months('5,5')}\n`;
    const { rows, errors } = parseSolarResourcesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Fortaleza',
      latitude: -3.73,
      longitude: -38.52,
      source: 'CRESESB SunData',
    });
    expect(rows[0]!.hspMonthly).toEqual(Array(12).fill(5.5));
  });

  it('lê CSV com vírgula e decimais em ponto, BOM, aspas e linhas em branco', () => {
    const header = HEADER.replaceAll(';', ',');
    const csv = `\uFEFF${header}\r\n\r\n"Foz do Iguaçu, PR",PR,,,Atlas Solar,,${months('4.8').replaceAll(';', ',')}\r\n`;
    const { rows, errors } = parseSolarResourcesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ name: 'Foz do Iguaçu, PR', source: 'Atlas Solar' });
    expect(rows[0]!.latitude).toBeUndefined();
  });

  it('aceita cabeçalho com acento e maiúsculas', () => {
    const csv = `NOME;Fonte;${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].join(';')}\nRecife;SunData;${months('5')}`;
    expect(parseSolarResourcesCsv(csv).errors).toEqual([]);
  });

  it('exige a fonte: linha sem fonte é rejeitada com o número da linha', () => {
    const csv = `${HEADER}\nNatal;RN;;;;;${months('5')}\nRecife;PE;;;SunData;;${months('5')}`;
    const { rows, errors } = parseSolarResourcesCsv(csv);
    expect(rows.map((r) => r.name)).toEqual(['Recife']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Linha 2 \(Natal\): fonte/);
  });

  it('aponta o mês inválido (vazio, zero, texto ou fora da faixa)', () => {
    const bad = ['5', '5', '0', '5', '5', '5', '5', '5', '5', '5', '5', '5'].join(';');
    const { errors } = parseSolarResourcesCsv(`${HEADER}\nNatal;RN;;;SunData;;${bad}`);
    expect(errors[0]).toMatch(/mês mar/);
    expect(
      parseSolarResourcesCsv(`${HEADER}\nNatal;RN;;;SunData;;5;5;5;5;5;5;5;5;5;5;5;`).errors[0],
    ).toMatch(/mês dez/);
    expect(
      parseSolarResourcesCsv(`${HEADER}\nNatal;RN;;;SunData;;${months('99')}`).errors[0],
    ).toMatch(/mês jan/);
  });

  it('cabeçalho incompleto, arquivo vazio e arquivo grande demais', () => {
    expect(parseSolarResourcesCsv('nome;fonte\nA;B').errors[0]).toMatch(/Colunas ausentes.*jan/);
    expect(parseSolarResourcesCsv('').errors[0]).toMatch(/cabeçalho/);
    expect(parseSolarResourcesCsv(HEADER).errors[0]).toMatch(/cabeçalho/);
    const many = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `L${i};;;;SunData;;${months('5')}`,
    );
    expect(parseSolarResourcesCsv([HEADER, ...many].join('\n')).errors[0]).toMatch(/mais de 500/);
  });

  it('o modelo para download tem só o cabeçalho (sem dado de exemplo) e é aceito como cabeçalho válido', () => {
    expect(SOLAR_RESOURCES_CSV_TEMPLATE.trim().split('\n')).toHaveLength(1);
    expect(
      parseSolarResourcesCsv(`${SOLAR_RESOURCES_CSV_TEMPLATE}Recife;;;;SunData;;${months('5')}`)
        .errors,
    ).toEqual([]);
  });
});
