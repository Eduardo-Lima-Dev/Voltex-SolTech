import { describe, expect, it } from 'vitest';
import {
  OPEN_STAGES,
  OPPORTUNITY_TRANSITIONS,
  OpportunityStage,
  canTransition,
  convertLeadSchema,
  createOpportunitySchema,
  createTaskSchema,
  isValidCnpj,
  isValidCpf,
  isValidDocument,
  normalizeDocument,
  normalizeEmail,
  normalizePhone,
  publicLeadSchema,
  siteIntakeSchema,
  updateLeadSchema,
  validateEnergyBillSchema,
} from './index.js';

const S = OpportunityStage;

describe('máquina de estados da oportunidade', () => {
  it('define as transições de todas as etapas, só para etapas existentes', () => {
    expect(Object.keys(OPPORTUNITY_TRANSITIONS).sort()).toEqual(Object.values(S).sort());
    for (const targets of Object.values(OPPORTUNITY_TRANSITIONS))
      for (const target of targets) expect(Object.values(S)).toContain(target);
  });

  it('avança passo a passo e não permite pular etapas', () => {
    expect(canTransition(S.NEW_LEAD, S.FIRST_CONTACT)).toBe(true);
    expect(canTransition(S.QUOTING, S.PROPOSAL_READY)).toBe(true);
    expect(canTransition(S.NEW_LEAD, S.QUOTING)).toBe(false);
    expect(canTransition(S.QUALIFICATION, S.PROPOSAL_SENT)).toBe(false);
    expect(canTransition(S.QUOTING, S.WON)).toBe(false);
  });

  it('só o contrato leva a Ganho; Ganho é final; Perdido só reabre para o início', () => {
    const toWon = Object.entries(OPPORTUNITY_TRANSITIONS)
      .filter(([, targets]) => targets.includes(S.WON))
      .map(([from]) => from);
    expect(toWon).toEqual([S.CONTRACT]);
    expect(OPPORTUNITY_TRANSITIONS[S.WON]).toEqual([]);
    expect(OPPORTUNITY_TRANSITIONS[S.LOST]).toEqual([S.FIRST_CONTACT, S.QUALIFICATION]);
  });

  it('qualquer etapa aberta pode ir a Perdido, e nenhuma volta a Novo lead', () => {
    for (const stage of OPEN_STAGES) expect(canTransition(stage, S.LOST)).toBe(true);
    for (const stage of Object.values(S)) expect(canTransition(stage, S.NEW_LEAD)).toBe(false);
    expect(OPEN_STAGES).toHaveLength(13);
  });

  it('uma etapa nunca vai para si mesma', () => {
    for (const [from, targets] of Object.entries(OPPORTUNITY_TRANSITIONS))
      expect(targets).not.toContain(from);
  });
});

describe('normalização para deduplicação', () => {
  it('telefone: só dígitos, sem DDI, e nulo quando curto', () => {
    expect(normalizePhone('+55 (85) 98888-7777')).toBe('85988887777');
    expect(normalizePhone('(85) 3222-1111')).toBe('8532221111');
    expect(normalizePhone('85988887777')).toBe('85988887777');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('e-mail em minúsculas e nulo sem arroba', () => {
    expect(normalizeEmail('  Maria@Exemplo.COM ')).toBe('maria@exemplo.com');
    expect(normalizeEmail('maria')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it('documento: 11 ou 14 dígitos', () => {
    expect(normalizeDocument('529.982.247-25')).toBe('52998224725');
    expect(normalizeDocument('11.444.777/0001-61')).toBe('11444777000161');
    expect(normalizeDocument('123')).toBeNull();
  });

  it('valida os dígitos verificadores de CPF e CNPJ', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('529.982.247-26')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCnpj('11.444.777/0001-61')).toBe(true);
    expect(isValidCnpj('11.444.777/0001-62')).toBe(false);
    expect(isValidDocument('52998224725')).toBe(true);
    expect(isValidDocument('00000000000000')).toBe(false);
  });
});

describe('schemas do CRM', () => {
  it('captação pública exige contato e consentimento; a isca de robô precisa ficar vazia', () => {
    const base = { name: 'Maria Silva', phone: '85988887777', consent: true as const };
    expect(publicLeadSchema.safeParse(base).success).toBe(true);
    expect(publicLeadSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(publicLeadSchema.safeParse({ name: 'Maria Silva', consent: true }).success).toBe(false);
    expect(publicLeadSchema.safeParse({ ...base, website: 'http://spam' }).success).toBe(false);
    expect(publicLeadSchema.safeParse({ ...base, website: '' }).success).toBe(true);
  });

  it('desqualificar exige motivo e converter só pelo fluxo de conversão', () => {
    expect(updateLeadSchema.safeParse({ status: 'DISQUALIFIED' }).success).toBe(false);
    expect(
      updateLeadSchema.safeParse({ status: 'DISQUALIFIED', disqualifiedReason: 'Sem interesse' })
        .success,
    ).toBe(true);
    expect(updateLeadSchema.safeParse({ status: 'CONVERTED' }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ status: 'QUALIFIED' }).success).toBe(true);
  });

  it('conversão cria oportunidade por padrão', () => {
    expect(convertLeadSchema.parse({})).toMatchObject({
      accountType: 'PERSON',
      createOpportunity: true,
      projectType: 'ON_GRID',
    });
  });

  it('oportunidade exige conta (uuid) e tarefa exige prazo', () => {
    expect(createOpportunitySchema.safeParse({ accountId: 'x' }).success).toBe(false);
    expect(
      createOpportunitySchema.parse({ accountId: '0192b0c0-0000-7000-8000-000000000001' })
        .projectType,
    ).toBe('ON_GRID');
    expect(createTaskSchema.safeParse({ title: 'Ligar para o cliente' }).success).toBe(false);
    const task = createTaskSchema.parse({ title: 'Ligar para o cliente', dueAt: '2026-11-01' });
    expect(task.dueAt).toBeInstanceOf(Date);
  });

  it('intake técnico aceita parcial e rejeita valores fora da faixa', () => {
    expect(siteIntakeSchema.safeParse({}).success).toBe(true);
    expect(siteIntakeSchema.safeParse({ roofAzimuthDegrees: 360 }).success).toBe(false);
    expect(siteIntakeSchema.safeParse({ tiltDegrees: 91 }).success).toBe(false);
    expect(siteIntakeSchema.safeParse({ shading: 'ALGUM' }).success).toBe(false);
  });

  it('validar fatura exige UC e ao menos um mês de consumo', () => {
    const ok = {
      fields: { ucNumber: '12345678', consumptionHistory: [{ month: '2026-08', kwh: 480 }] },
    };
    expect(validateEnergyBillSchema.safeParse(ok).success).toBe(true);
    expect(
      validateEnergyBillSchema.safeParse({
        fields: { ucNumber: '12345678', consumptionHistory: [] },
      }).success,
    ).toBe(false);
    expect(
      validateEnergyBillSchema.safeParse({
        fields: { consumptionHistory: [{ month: '2026-08', kwh: 480 }] },
      }).success,
    ).toBe(false);
    expect(
      validateEnergyBillSchema.safeParse({
        fields: { ucNumber: '12345678', consumptionHistory: [{ month: '2026-13', kwh: 1 }] },
      }).success,
    ).toBe(false);
  });
});
