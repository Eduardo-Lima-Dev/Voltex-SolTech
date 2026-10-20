import { describe, expect, it } from 'vitest';
import {
  AccountType,
  CustomerGroup,
  CustomerSegment,
  DEFAULT_PIPELINE_STAGES,
  ENERGY_BILL_FIELDS,
  EnergyBillStatus,
  GenerationClass,
  LeadSource,
  LeadStatus,
  OpportunityStage,
  OpportunityStatus,
  RoofType,
  ShadingLevel,
  TaskStatus,
  TimelineEventType,
  PERMISSIONS,
  PhaseSystem,
  Product,
  ProjectType,
  Role,
  ROLE_PERMISSIONS,
  TrafficLight,
  thresholdsSchema,
} from '@voltex/shared';
import { ALERT_CODES } from '@voltex/solar-engine';
import { PRODUCTS } from '@/features/products/registry';
import { ADMIN_PERMISSIONS, ADMIN_TABS } from '@/features/admin/admin-nav';
import {
  ACCOUNT_TYPE_LABELS,
  ALERT_TITLES,
  BILL_FIELD_LABELS,
  BILL_STATUS_LABELS,
  ENGINEERING_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  ROOF_TYPE_LABELS,
  SEGMENT_LABELS,
  SHADING_LABELS,
  STAGE_LABELS,
  TASK_STATUS_LABELS,
  TIMELINE_TYPE_LABELS,
  AUDIT_ACTION_LABELS,
  CUSTOMER_GROUP_LABELS,
  GENERATION_CLASS_LABELS,
  MONTH_LABELS,
  PHASE_SYSTEM_LABELS,
  PROJECT_TYPE_LABELS,
  THRESHOLD_LABELS,
  TRAFFIC_LIGHT_DESCRIPTIONS,
  TRAFFIC_LIGHT_LABELS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  PRODUCT_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  auditActionLabel,
  entityLabel,
  permissionsOfGroup,
  roleLabel,
} from './labels';

describe('rótulos em pt-BR (a interface nunca mostra códigos crus)', () => {
  it('todo perfil, produto e permissão tem rótulo', () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_LABELS[role], role).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role], role).toBeTruthy();
    }
    for (const product of Object.values(Product))
      expect(PRODUCT_LABELS[product], product).toBeTruthy();
    for (const permission of PERMISSIONS)
      expect(PERMISSION_LABELS[permission], permission).toBeTruthy();
  });

  it('não há rótulos de permissão sobrando (nenhuma permissão removida ficou para trás)', () => {
    expect(Object.keys(PERMISSION_LABELS).sort()).toEqual([...PERMISSIONS].sort());
  });

  it('os grupos cobrem todas as permissões, cada uma em um único grupo', () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => permissionsOfGroup(g.prefix));
    expect(grouped.sort()).toEqual([...PERMISSIONS].sort());
  });

  it('todas as ações de auditoria emitidas pela API têm texto legível', () => {
    for (const action of [
      'auth.login',
      'auth.login_failed',
      'auth.logout',
      'auth.refresh_reuse_detected',
      'tenant.updated',
      'branch.created',
      'team.deleted',
      'user.updated',
      'user.deleted',
      'invitation.created',
      'invitation.accepted',
      'document.uploaded',
      'calculation.created',
      'calculation.snapshot_created',
      'rule.created',
      'rule.activated',
      'rule.deleted',
      'distributor.created',
      'tariff.created',
      'solar_resource.upserted',
      'solar_resource.imported',
    ]) {
      expect(AUDIT_ACTION_LABELS[action], action).toBeTruthy();
    }
  });

  it('todo alerta, semáforo, classe, grupo e limite do Solar Calculator tem rótulo', () => {
    for (const code of ALERT_CODES) expect(ALERT_TITLES[code], code).toBeTruthy();
    expect(Object.keys(ALERT_TITLES).sort()).toEqual([...ALERT_CODES].sort());
    for (const light of Object.values(TrafficLight)) {
      expect(TRAFFIC_LIGHT_LABELS[light], light).toBeTruthy();
      expect(TRAFFIC_LIGHT_DESCRIPTIONS[light], light).toBeTruthy();
    }
    for (const value of Object.values(GenerationClass))
      expect(GENERATION_CLASS_LABELS[value]).toBeTruthy();
    for (const value of Object.values(CustomerGroup))
      expect(CUSTOMER_GROUP_LABELS[value]).toBeTruthy();
    for (const value of Object.values(PhaseSystem)) expect(PHASE_SYSTEM_LABELS[value]).toBeTruthy();
    for (const value of Object.values(ProjectType)) expect(PROJECT_TYPE_LABELS[value]).toBeTruthy();
    for (const key of Object.keys(thresholdsSchema.parse({})))
      expect(THRESHOLD_LABELS[key as keyof typeof THRESHOLD_LABELS], key).toBeTruthy();
    expect(MONTH_LABELS).toHaveLength(12);
  });

  it('todo valor do CRM tem rótulo em português', () => {
    const cases: [string, Record<string, string>, readonly string[]][] = [
      ['lead status', LEAD_STATUS_LABELS, Object.values(LeadStatus)],
      ['lead origem', LEAD_SOURCE_LABELS, Object.values(LeadSource)],
      ['segmento', SEGMENT_LABELS, Object.values(CustomerSegment)],
      ['tipo de conta', ACCOUNT_TYPE_LABELS, Object.values(AccountType)],
      ['situação da oportunidade', OPPORTUNITY_STATUS_LABELS, Object.values(OpportunityStatus)],
      ['etapa', STAGE_LABELS, Object.values(OpportunityStage)],
      ['tarefa', TASK_STATUS_LABELS, Object.values(TaskStatus)],
      ['linha do tempo', TIMELINE_TYPE_LABELS, Object.values(TimelineEventType)],
      ['telhado', ROOF_TYPE_LABELS, Object.values(RoofType)],
      ['sombreamento', SHADING_LABELS, Object.values(ShadingLevel)],
      ['fatura', BILL_STATUS_LABELS, Object.values(EnergyBillStatus)],
      ['campo da fatura', BILL_FIELD_LABELS, ENERGY_BILL_FIELDS],
      [
        'engenharia',
        ENGINEERING_STATUS_LABELS,
        [
          'PENDING',
          'IN_PROGRESS',
          'WAITING_VISIT',
          'WAITING_INFO',
          'IN_REVIEW',
          'DONE',
          'CANCELLED',
        ],
      ],
    ];
    for (const [name, labels, values] of cases) {
      for (const value of values) expect(labels[value], `${name}: ${value}`).toBeTruthy();
      expect(Object.keys(labels).sort(), name).toEqual([...values].sort());
    }
    // Os nomes padrão das etapas vêm do pipeline padrão do shared.
    for (const stage of DEFAULT_PIPELINE_STAGES) expect(STAGE_LABELS[stage.key]).toBe(stage.name);
  });

  it('as ações de auditoria do CRM têm texto legível', () => {
    for (const action of [
      'lead.created',
      'lead.converted',
      'lead.captured',
      'account.created',
      'opportunity.stage_changed',
      'task.completed',
      'energy_bill.validated',
      'aneel.imported',
      'pipeline.stage_updated',
    ])
      expect(AUDIT_ACTION_LABELS[action], action).toBeTruthy();
  });

  it('valores desconhecidos aparecem como vieram (sem quebrar)', () => {
    expect(auditActionLabel('algo.novo')).toBe('algo.novo');
    expect(entityLabel('Lead')).toBe('Lead');
    expect(roleLabel('NOVO')).toBe('NOVO');
    expect(roleLabel('OWNER')).toBe('Proprietário');
  });

  it('produtos exigem permissões que existem e que ao menos um perfil possui', () => {
    expect(PRODUCTS).toHaveLength(4);
    for (const product of PRODUCTS) {
      expect(PERMISSIONS).toContain(product.permission);
      expect(
        Object.values(Role).some((r) =>
          (ROLE_PERMISSIONS[r] as readonly string[]).includes(product.permission),
        ),
        product.id,
      ).toBe(true);
      expect(product.path.startsWith('/')).toBe(true);
    }
  });

  it('as abas de administração usam permissões válidas', () => {
    for (const tab of ADMIN_TABS) for (const p of tab.anyOf) expect(PERMISSIONS).toContain(p);
    expect(ADMIN_PERMISSIONS.length).toBeGreaterThan(0);
  });
});
