import { describe, expect, it } from 'vitest';
import { fieldLabel } from './parts';

describe('rótulo legível dos campos', () => {
  it('usa o nome conhecido, ou monta em português a partir do caminho', () => {
    expect(fieldLabel('totalOverdueCents')).toBe('Total vencido');
    expect(fieldLabel('meta.queriedAt')).toBe('Data da consulta');
    expect(fieldLabel('openCount')).toBe('Em aberto');
    expect(fieldLabel('porPrioridade[0].count')).toBe('Por prioridade (1º) · Quantidade');
    expect(fieldLabel('porSituacao[2].count')).toBe('Por situação (3º) · Quantidade');
    expect(fieldLabel('maisAntigos[0].projectCode')).toBe('Mais antigos (1º) · Projeto');
    expect(fieldLabel('maisAntigos[0].daysOpenDays')).toBe('Mais antigos (1º) · Dias em aberto');
  });

  it('nunca devolve o nome técnico cru de campos comuns', () => {
    for (const path of [
      'breachedCount',
      'overdueRequestsCount',
      'warrantiesMissingCount',
      'semValorCount',
    ])
      expect(fieldLabel(path)).not.toMatch(/[a-z][A-Z]/);
  });
});
