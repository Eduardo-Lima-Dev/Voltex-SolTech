import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPELINE_STAGES,
  DOMAIN_EVENT_TYPES,
  OpportunityStage,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  Role,
  ROUTES,
  changeStageSchema,
  createLeadSchema,
  domainEventEnvelopeSchema,
  formatBrlFromCents,
  formatKwh,
  formatKwp,
  formatPercent,
  formatYears,
  assignableRoles,
  canManageRole,
  hasPermission,
  loginSchema,
  paginationQuerySchema,
} from './index.js';

describe('pipeline padrão', () => {
  it('tem as 15 etapas da modelagem, em ordem e com Ganho/Perdido terminais', () => {
    expect(DEFAULT_PIPELINE_STAGES).toHaveLength(15);
    expect(DEFAULT_PIPELINE_STAGES.map((s) => s.order)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
    expect(DEFAULT_PIPELINE_STAGES.filter((s) => s.terminal).map((s) => s.key)).toEqual([
      OpportunityStage.WON,
      OpportunityStage.LOST,
    ]);
    expect(new Set(DEFAULT_PIPELINE_STAGES.map((s) => s.key)).size).toBe(15);
  });
});

describe('permissões', () => {
  it('não repete permissões e usa o formato produto.recurso.ação', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const p of PERMISSIONS) expect(p).toMatch(/^[a-z]+\.[a-z-]+\.[a-z-]+$/);
  });

  it('todo perfil só referencia permissões existentes', () => {
    for (const role of Object.values(Role)) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it('aplica o princípio de menor privilégio', () => {
    expect(hasPermission(Role.OWNER, 'platform.user.manage')).toBe(true);
    expect(hasPermission(Role.SALESPERSON, 'crm.margin.approve')).toBe(false);
    expect(hasPermission(Role.SALES_MANAGER, 'crm.margin.approve')).toBe(true);
    expect(hasPermission(Role.INSTALLER, 'crm.lead.read')).toBe(false);
    expect(hasPermission(Role.TECHNICAL_LEAD, 'engine.project.approve')).toBe(true);
    // O engenheiro aprova versões de projeto, mas só o responsável técnico aprova equipamento do catálogo.
    expect(hasPermission(Role.ENGINEERING, 'engine.version.approve')).toBe(true);
    expect(hasPermission(Role.ENGINEERING, 'engine.project.approve')).toBe(false);
    expect(hasPermission(Role.SALESPERSON, 'engine.version.approve')).toBe(false);
    expect(ROLE_PERMISSIONS[Role.CUSTOMER]).toEqual([]);
  });
});

describe('schemas', () => {
  it('normaliza e valida login', () => {
    expect(loginSchema.parse({ email: '  USER@Exemplo.com ', password: '12345678' }).email).toBe(
      'user@exemplo.com',
    );
    expect(loginSchema.safeParse({ email: 'x', password: '12345678' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '123' }).success).toBe(false);
  });

  it('aplica padrões ao criar lead', () => {
    const lead = createLeadSchema.parse({ name: 'Maria Silva', state: 'ce' });
    expect(lead.source).toBe('MANUAL');
    expect(lead.state).toBe('CE');
  });

  it('exige motivo ao marcar como perdido', () => {
    expect(changeStageSchema.safeParse({ stage: 'LOST' }).success).toBe(false);
    expect(changeStageSchema.safeParse({ stage: 'LOST', lostReason: 'Preço' }).success).toBe(true);
    expect(changeStageSchema.safeParse({ stage: 'QUOTING' }).success).toBe(true);
  });

  it('pagina com padrões e limites', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
    expect(paginationQuerySchema.safeParse({ pageSize: 1000 }).success).toBe(false);
  });
});

describe('eventos', () => {
  it('lista todos os eventos sem duplicidade', () => {
    expect(DOMAIN_EVENT_TYPES).toHaveLength(new Set(DOMAIN_EVENT_TYPES).size);
    expect(DOMAIN_EVENT_TYPES).toContain('DealWon');
  });

  it('valida o envelope', () => {
    const ok = domainEventEnvelopeSchema.parse({
      id: 'e1',
      type: 'LeadCreated',
      occurredAt: '2026-10-18T12:00:00Z',
      tenantId: 't1',
      actorId: null,
      payload: { leadId: 'l1' },
    });
    expect(ok.schemaVersion).toBe(1);
    expect(ok.projectCode).toBeNull();
    expect(domainEventEnvelopeSchema.safeParse({ ...ok, type: 'Inexistente' }).success).toBe(false);
  });
});

describe('rotas', () => {
  it('monta caminhos parametrizados', () => {
    expect(ROUTES.calculations.quickSnapshot('abc')).toBe('/calculations/quick/abc/snapshot');
    expect(ROUTES.energyBills.validate('x1')).toBe('/energy-bills/x1/validate');
  });
});

describe('formatação pt-BR', () => {
  const normalize = (s: string) => s.replace(/\s/g, ' ');

  it('formata moeda a partir de centavos', () => {
    expect(normalize(formatBrlFromCents(1980000))).toBe('R$ 19.800,00');
    expect(normalize(formatBrlFromCents(44650))).toBe('R$ 446,50');
  });

  it('formata unidades de energia, potência, porcentagem e prazo', () => {
    expect(normalize(formatKwh(528))).toBe('528 kWh');
    expect(normalize(formatKwp(4.4))).toBe('4,40 kWp');
    expect(normalize(formatPercent(0.25))).toBe('25%');
    expect(normalize(formatYears(3.695))).toBe('3,7 anos');
    expect(formatYears(null)).toBe('—');
  });
});

describe('política de perfis', () => {
  it('OWNER atribui qualquer perfil; ADMIN atribui todos menos OWNER; demais nenhum', () => {
    expect(assignableRoles(Role.OWNER)).toHaveLength(Object.values(Role).length);
    expect(assignableRoles(Role.ADMIN)).not.toContain(Role.OWNER);
    expect(assignableRoles(Role.ADMIN)).toHaveLength(Object.values(Role).length - 1);
    expect(assignableRoles(Role.SALES_MANAGER)).toEqual([]);
    expect(canManageRole(Role.ADMIN, Role.OWNER)).toBe(false);
  });
});

describe('signatário do projeto de engenharia', () => {
  it('lista, em ordem, o que falta para quem assina estar completo', async () => {
    const { signatoryMissing } = await import('./schemas/engineering-management.js');
    expect(signatoryMissing({})).toEqual([
      'signatoryName',
      'councilType',
      'councilRegistration',
      'councilState',
      'artType',
      'artNumber',
    ]);
    expect(
      signatoryMissing({
        signatoryName: 'Maria Souza',
        councilType: 'CREA',
        councilRegistration: 'SP-123456',
        councilState: 'SP',
        artType: 'ART',
        artNumber: '123',
      }),
    ).toEqual([]);
    expect(signatoryMissing({ signatoryName: '  ' })).toContain('signatoryName');
  });
});
