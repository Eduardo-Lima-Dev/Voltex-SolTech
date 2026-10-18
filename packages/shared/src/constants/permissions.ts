import { Role } from '../enums/index.js';

/**
 * Permissões granulares no formato `<produto>.<recurso>.<ação>`.
 * Negado por padrão: uma rota só é acessível se o perfil do usuário tiver a permissão exigida.
 */
export const PERMISSIONS = [
  // Plataforma
  'platform.tenant.read',
  'platform.tenant.manage',
  'platform.user.read',
  'platform.user.manage',
  'platform.role.manage',
  'platform.audit.read',
  'platform.document.read',
  'platform.document.write',
  'platform.rule.read',
  'platform.rule.manage',
  'platform.catalog.read',
  'platform.catalog.manage',
  // CRM
  'crm.lead.read',
  'crm.lead.write',
  'crm.account.read',
  'crm.account.write',
  'crm.opportunity.read',
  'crm.opportunity.write',
  'crm.pipeline.manage',
  'crm.task.read',
  'crm.task.write',
  'crm.energy-bill.read',
  'crm.energy-bill.write',
  'crm.quote.read',
  'crm.quote.write',
  'crm.margin.read',
  'crm.margin.approve',
  'crm.margin-policy.manage',
  'crm.proposal.read',
  'crm.proposal.write',
  'crm.contract.read',
  'crm.contract.write',
  'crm.project.read',
  'crm.project.write',
  'crm.finance.read',
  'crm.dashboard.read',
  // Solar Calculator
  'calculator.session.read',
  'calculator.session.create',
  'calculator.snapshot.create',
  // Solar Engine Studio
  'engine.project.read',
  'engine.project.write',
  'engine.project.approve',
  // Off-Grid Designer
  'offgrid.project.read',
  'offgrid.project.write',
  'offgrid.scenario.approve',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

const startsWith = (...prefixes: string[]): Permission[] =>
  PERMISSIONS.filter((p) => prefixes.some((prefix) => p.startsWith(prefix)));

const CRM_READ = PERMISSIONS.filter((p) => p.startsWith('crm.') && p.endsWith('.read'));

/** Mapeamento padrão perfil → permissões (seção 46). Pode ser refinado por tenant no futuro. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.OWNER]: ALL,
  [Role.ADMIN]: ALL.filter((p) => p !== 'crm.margin.approve'),
  [Role.SALES_MANAGER]: [
    ...startsWith('crm.lead', 'crm.account', 'crm.opportunity', 'crm.task', 'crm.energy-bill'),
    ...startsWith('crm.quote', 'crm.margin', 'crm.proposal', 'crm.contract', 'crm.dashboard'),
    'crm.pipeline.manage',
    'crm.project.read',
    ...startsWith('calculator.'),
    'platform.user.read',
    'platform.document.read',
    'platform.document.write',
  ],
  [Role.SDR]: [
    'crm.lead.read',
    'crm.lead.write',
    'crm.account.read',
    'crm.account.write',
    'crm.task.read',
    'crm.task.write',
    'crm.energy-bill.read',
    'crm.energy-bill.write',
    'calculator.session.read',
    'calculator.session.create',
    'platform.document.read',
    'platform.document.write',
  ],
  [Role.SALESPERSON]: [
    'crm.lead.read',
    'crm.lead.write',
    'crm.account.read',
    'crm.account.write',
    'crm.opportunity.read',
    'crm.opportunity.write',
    'crm.task.read',
    'crm.task.write',
    'crm.energy-bill.read',
    'crm.energy-bill.write',
    'crm.quote.read',
    'crm.quote.write',
    'crm.margin.read',
    'crm.proposal.read',
    'crm.proposal.write',
    'crm.contract.read',
    'crm.project.read',
    ...startsWith('calculator.'),
    'platform.document.read',
    'platform.document.write',
  ],
  [Role.ENGINEERING]: [
    ...startsWith('engine.project.read', 'engine.project.write', 'offgrid.project'),
    'crm.opportunity.read',
    'crm.project.read',
    'crm.project.write',
    'calculator.session.read',
    'platform.catalog.read',
    'platform.catalog.manage',
    'platform.rule.read',
    'platform.document.read',
    'platform.document.write',
  ],
  [Role.TECHNICAL_LEAD]: [
    ...startsWith('engine.', 'offgrid.'),
    'crm.opportunity.read',
    'crm.project.read',
    'crm.project.write',
    'calculator.session.read',
    'platform.catalog.read',
    'platform.catalog.manage',
    'platform.rule.read',
    'platform.rule.manage',
    'platform.document.read',
    'platform.document.write',
  ],
  [Role.OPERATIONS]: [
    'crm.account.read',
    'crm.opportunity.read',
    'crm.project.read',
    'crm.project.write',
    'crm.task.read',
    'crm.task.write',
    'platform.document.read',
    'platform.document.write',
  ],
  [Role.INSTALLER]: [
    'crm.project.read',
    'crm.task.read',
    'crm.task.write',
    'platform.document.read',
    'platform.document.write',
  ],
  [Role.FINANCE]: [
    'crm.finance.read',
    'crm.margin.read',
    'crm.opportunity.read',
    'crm.project.read',
    'crm.contract.read',
    'crm.dashboard.read',
    'platform.document.read',
  ],
  [Role.OM]: [
    'crm.account.read',
    'crm.project.read',
    'crm.task.read',
    'crm.task.write',
    'platform.document.read',
  ],
  [Role.PARTNER]: ['crm.project.read', 'platform.document.read'],
  [Role.CUSTOMER]: [],
};

export const hasPermission = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

export const permissionsForRole = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role];

/** Perfis que enxergam todo o CRM em modo leitura. Útil para telas de gestão. */
export const CRM_READ_PERMISSIONS: readonly Permission[] = CRM_READ;
