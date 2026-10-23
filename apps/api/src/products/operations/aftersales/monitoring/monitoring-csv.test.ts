import { describe, expect, it } from 'vitest';
import { parseGenerationCsv, parseKwh } from './monitoring-csv';

const TODAY = new Date('2026-10-23T12:00:00Z');

describe('planilha de geração diária', () => {
  it('lê data e kWh com ponto e vírgula, cabeçalho e vírgula decimal', () => {
    const r = parseGenerationCsv('data;kwh\n01/10/2026;12,5\n02/10/2026;1.234,56\n', TODAY);
    expect(r.rejected).toEqual([]);
    expect(r.rows).toEqual([
      { date: '2026-10-01', kwh: 12.5 },
      { date: '2026-10-02', kwh: 1234.56 },
    ]);
  });

  it('aceita vírgula como separador (kWh com ponto), data ISO e BOM', () => {
    const r = parseGenerationCsv('﻿2026-10-01,10.25\n2026-10-02,0', TODAY);
    expect(r.rows).toEqual([
      { date: '2026-10-01', kwh: 10.25 },
      { date: '2026-10-02', kwh: 0 },
    ]);
  });

  it('devolve cada linha ruim com o motivo e importa as demais', () => {
    const r = parseGenerationCsv(
      [
        '2026-10-01;10',
        '31/02/2026;5',
        '2026-10-03;abc',
        '2026-10-04',
        '2026-12-31;7',
        '2026-10-05;-3',
      ].join('\n'),
      TODAY,
    );
    expect(r.rows).toEqual([{ date: '2026-10-01', kwh: 10 }]);
    expect(r.rejected.map((x) => x.line)).toEqual([2, 3, 4, 5, 6]);
    expect(r.rejected[0]?.reason).toMatch(/Data inválida/);
    expect(r.rejected[1]?.reason).toMatch(/kWh inválido/);
    expect(r.rejected[3]?.reason).toMatch(/futuro/);
  });

  it('data repetida vale a última', () => {
    const r = parseGenerationCsv('2026-10-01;10\n2026-10-01;20', TODAY);
    expect(r.rows).toEqual([{ date: '2026-10-01', kwh: 20 }]);
  });

  it('kWh: formatos válidos e inválidos', () => {
    expect(parseKwh('12')).toBe(12);
    expect(parseKwh('1.234,5')).toBe(1234.5);
    expect(parseKwh('')).toBeNull();
    expect(parseKwh('1e3')).toBeNull();
    expect(parseKwh('-1')).toBeNull();
  });
});
