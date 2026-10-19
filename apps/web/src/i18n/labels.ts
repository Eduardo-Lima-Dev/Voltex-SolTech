import {
  PERMISSIONS,
  type Permission,
  type Product,
  type Role,
  type Thresholds,
} from '@voltex/shared';
import type { AlertCode } from '@voltex/solar-engine';

/** Textos da interface em pt-BR. Toda enumeração do domínio passa por aqui; nunca exibimos o código cru. */

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  SALES_MANAGER: 'Gestor comercial',
  SDR: 'SDR',
  SALESPERSON: 'Vendedor',
  ENGINEERING: 'Engenharia',
  TECHNICAL_LEAD: 'Responsável técnico',
  OPERATIONS: 'Operação',
  INSTALLER: 'Instalador',
  FINANCE: 'Financeiro',
  OM: 'O&M',
  PARTNER: 'Parceiro',
  CUSTOMER: 'Cliente final',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Acesso total, incluindo configurações e outros administradores.',
  ADMIN: 'Configuração, usuários e integrações. Não gerencia proprietários.',
  SALES_MANAGER: 'Leads, oportunidades, equipe e aprovação de margem.',
  SDR: 'Qualificação de leads, contatos e cálculos rápidos.',
  SALESPERSON: 'Oportunidades, Solar Calculator e propostas.',
  ENGINEERING: 'Solar Engine Studio, Off-Grid Designer e documentos técnicos.',
  TECHNICAL_LEAD: 'Aprovação e congelamento técnico de projetos.',
  OPERATIONS: 'Projetos, agenda e instalação.',
  INSTALLER: 'Ordens de serviço e checklists atribuídos.',
  FINANCE: 'Custos, recebíveis, comissões e margem.',
  OM: 'Plantas instaladas, monitoramento e chamados.',
  PARTNER: 'Acesso restrito por projeto.',
  CUSTOMER: 'Portal do cliente final.',
};

export const PRODUCT_LABELS: Record<Product, string> = {
  CRM: 'CRM Solar',
  CALCULATOR: 'Solar Calculator',
  ENGINE: 'Solar Engine Studio',
  OFFGRID: 'Off-Grid Designer',
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  'platform.tenant.read': 'Ver dados da empresa',
  'platform.tenant.manage': 'Gerenciar empresa, filiais e times',
  'platform.user.read': 'Ver usuários',
  'platform.user.manage': 'Gerenciar usuários e convites',
  'platform.role.manage': 'Gerenciar perfis',
  'platform.audit.read': 'Consultar a auditoria',
  'platform.document.read': 'Ver documentos',
  'platform.document.write': 'Enviar e excluir documentos',
  'platform.rule.read': 'Ver regras regulatórias',
  'platform.rule.manage': 'Gerenciar regras regulatórias',
  'platform.catalog.read': 'Ver o catálogo técnico',
  'platform.catalog.manage': 'Gerenciar o catálogo técnico',
  'crm.lead.read': 'Ver leads',
  'crm.lead.write': 'Criar e editar leads',
  'crm.account.read': 'Ver contas e contatos',
  'crm.account.write': 'Criar e editar contas e contatos',
  'crm.opportunity.read': 'Ver oportunidades',
  'crm.opportunity.write': 'Criar e editar oportunidades',
  'crm.pipeline.manage': 'Configurar o pipeline',
  'crm.task.read': 'Ver tarefas',
  'crm.task.write': 'Criar e editar tarefas',
  'crm.energy-bill.read': 'Ver faturas de energia',
  'crm.energy-bill.write': 'Enviar e validar faturas de energia',
  'crm.quote.read': 'Ver cotações',
  'crm.quote.write': 'Criar e editar cotações',
  'crm.margin.read': 'Ver margens',
  'crm.margin.approve': 'Aprovar margem abaixo do mínimo',
  'crm.margin-policy.manage': 'Configurar políticas de margem',
  'crm.proposal.read': 'Ver propostas',
  'crm.proposal.write': 'Criar e enviar propostas',
  'crm.contract.read': 'Ver contratos',
  'crm.contract.write': 'Criar e editar contratos',
  'crm.project.read': 'Ver projetos',
  'crm.project.write': 'Criar e editar projetos',
  'crm.finance.read': 'Ver o financeiro dos projetos',
  'crm.dashboard.read': 'Ver o painel comercial',
  'calculator.session.read': 'Ver cálculos',
  'calculator.session.create': 'Criar cálculos',
  'calculator.snapshot.create': 'Salvar snapshots de cálculo',
  'engine.project.read': 'Ver projetos técnicos',
  'engine.project.write': 'Criar e editar projetos técnicos',
  'engine.project.approve': 'Aprovar e congelar projetos técnicos',
  'offgrid.project.read': 'Ver projetos off-grid',
  'offgrid.project.write': 'Criar e editar projetos off-grid',
  'offgrid.scenario.approve': 'Aprovar cenários off-grid',
};

export const PERMISSION_GROUPS: { id: string; label: string; prefix: string }[] = [
  { id: 'platform', label: 'Plataforma', prefix: 'platform.' },
  { id: 'crm', label: PRODUCT_LABELS.CRM, prefix: 'crm.' },
  { id: 'calculator', label: PRODUCT_LABELS.CALCULATOR, prefix: 'calculator.' },
  { id: 'engine', label: PRODUCT_LABELS.ENGINE, prefix: 'engine.' },
  { id: 'offgrid', label: PRODUCT_LABELS.OFFGRID, prefix: 'offgrid.' },
];

export const permissionsOfGroup = (prefix: string): Permission[] =>
  PERMISSIONS.filter((p) => p.startsWith(prefix));

export const ENTITY_LABELS: Record<string, string> = {
  User: 'Usuário',
  Tenant: 'Empresa',
  Branch: 'Filial',
  Team: 'Time',
  Invitation: 'Convite',
  Document: 'Documento',
  CalculationSession: 'Cálculo',
  QuickCalculationSnapshot: 'Snapshot de cálculo',
  RuleSet: 'Regra',
  SolarResource: 'Irradiação',
  Tariff: 'Tarifa',
  Distributor: 'Concessionária',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Login realizado',
  'auth.login_failed': 'Tentativa de login recusada',
  'auth.logout': 'Logout',
  'auth.refresh_reuse_detected': 'Reuso de sessão detectado (sessão encerrada)',
  'tenant.updated': 'Empresa atualizada',
  'branch.created': 'Filial criada',
  'branch.updated': 'Filial atualizada',
  'branch.deleted': 'Filial excluída',
  'team.created': 'Time criado',
  'team.updated': 'Time atualizado',
  'team.deleted': 'Time excluído',
  'user.updated': 'Usuário atualizado',
  'user.deleted': 'Usuário excluído',
  'invitation.created': 'Convite enviado',
  'invitation.revoked': 'Convite revogado',
  'invitation.accepted': 'Convite aceito',
  'document.uploaded': 'Documento enviado',
  'document.deleted': 'Documento excluído',
  'document.download_url_issued': 'Link de download gerado',
  'calculation.created': 'Cálculo criado',
  'calculation.snapshot_created': 'Snapshot de cálculo salvo',
  'rule.created': 'Regra criada (rascunho)',
  'rule.activated': 'Regra ativada',
  'rule.deleted': 'Regra excluída',
  'distributor.created': 'Concessionária criada',
  'distributor.updated': 'Concessionária atualizada',
  'distributor.deleted': 'Concessionária excluída',
  'tariff.created': 'Tarifa cadastrada',
  'tariff.deleted': 'Tarifa excluída',
  'solar_resource.upserted': 'Irradiação cadastrada',
  'solar_resource.imported': 'Irradiação importada',
  'solar_resource.deleted': 'Irradiação excluída',
};

export const auditActionLabel = (action: string): string => AUDIT_ACTION_LABELS[action] ?? action;
export const entityLabel = (entity: string): string => ENTITY_LABELS[entity] ?? entity;
export const roleLabel = (role: string): string => ROLE_LABELS[role as Role] ?? role;

export const INVITATION_STATUS_LABELS = {
  PENDING: 'Pendente',
  ACCEPTED: 'Aceito',
  REVOKED: 'Revogado',
  EXPIRED: 'Expirado',
} as const;

export const BRAZILIAN_STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

// ---- Solar Calculator ----

export const TRAFFIC_LIGHT_LABELS = {
  GREEN: 'Pré-viável',
  YELLOW: 'Requer atenção',
  RED: 'Não recomendado',
} as const;

export const TRAFFIC_LIGHT_DESCRIPTIONS = {
  GREEN: 'Nenhum impedimento encontrado na pré-análise.',
  YELLOW: 'Há pontos a confirmar; pode exigir validação de engenharia.',
  RED: 'Há impedimentos. Não siga para a proposta sem resolver.',
} as const;

export const ALERT_SEVERITY_LABELS = {
  INFO: 'Informação',
  WARNING: 'Atenção',
  BLOCKING: 'Impedimento',
} as const;

/** Título curto de cada alerta do motor. A mensagem completa vem do próprio resultado. */
export const ALERT_TITLES: Record<AlertCode, string> = {
  MISSING_CRITICAL_DATA: 'Dado crítico ausente',
  GROUP_A_COMPLEX: 'Cliente do Grupo A',
  CONTRACTED_DEMAND_RELEVANT: 'Demanda contratada relevante',
  POSSIBLE_GRID_ZERO: 'Possível Grid Zero',
  SHADING_RELEVANT: 'Sombreamento relevante',
  HYBRID_REQUESTED: 'Sistema híbrido solicitado',
  OFF_GRID_REQUESTED: 'Sistema off-grid solicitado',
  INSUFFICIENT_AREA: 'Área insuficiente',
  INCONSISTENT_INPUT: 'Dados inconsistentes',
  ASSUMPTION_OUT_OF_RANGE: 'Premissa fora da faixa',
  OVERSIZED_SYSTEM: 'Sistema sobredimensionado',
  NO_PAYBACK_IN_HORIZON: 'Sem retorno no horizonte',
  DEFAULT_PERFORMANCE_RATIO: 'PR padrão em uso',
  HSP_OUTSIDE_TYPICAL_RANGE: 'HSP fora da faixa típica',
  TILT_BELOW_RECOMMENDED: 'Inclinação abaixo da recomendada',
  ORIENTATION_NOT_OPTIMAL: 'Orientação distante da ideal',
  MINIGENERATION_CLASS: 'Minigeração',
  UTILITY_SCALE_OUT_OF_SCOPE: 'Usina fora do escopo',
};

export const GENERATION_CLASS_LABELS = {
  MICRO: 'Microgeração',
  MINI: 'Minigeração',
  UTILITY: 'Usina',
} as const;

export const CUSTOMER_GROUP_LABELS = {
  A: 'Grupo A (alta tensão)',
  B: 'Grupo B (baixa tensão)',
} as const;

export const PHASE_SYSTEM_LABELS = {
  SINGLE_PHASE: 'Monofásico',
  TWO_PHASE: 'Bifásico',
  THREE_PHASE: 'Trifásico',
} as const;

export const PROJECT_TYPE_LABELS = {
  ON_GRID: 'On-grid',
  HYBRID: 'Híbrido',
  OFF_GRID: 'Off-grid',
} as const;

export const PERFORMANCE_RATIO_SOURCE_LABELS = {
  INPUT: 'Informado',
  LOSSES: 'Calculado pelas perdas',
  DEFAULT: 'Padrão da regra',
} as const;

export const HSP_SOURCE_LABELS = {
  DATASET: 'Base de irradiação',
  MANUAL: 'Entrada manual',
} as const;

export const RULE_STATUS_LABELS = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativa',
  RETIRED: 'Aposentada',
} as const;

export const RULE_SOURCE_TYPE_LABELS = {
  REGULATION: 'Regulação',
  STANDARD: 'Norma técnica',
  BOOK: 'Livro técnico',
  INTERNAL_POLICY: 'Política interna',
} as const;

export const THRESHOLD_LABELS: Record<keyof Thresholds, { label: string; unit?: string }> = {
  performanceRatioMin: { label: 'PR mínimo aceito' },
  performanceRatioMax: { label: 'PR máximo aceito' },
  hspMin: { label: 'HSP mínimo aceito', unit: 'kWh/m²·dia' },
  hspMax: { label: 'HSP máximo aceito', unit: 'kWh/m²·dia' },
  maxGenerationToConsumptionRatio: { label: 'Geração máxima sobre o consumo' },
  defaultPerformanceRatio: { label: 'PR padrão' },
  typicalHspMin: { label: 'HSP típico mínimo', unit: 'kWh/m²·dia' },
  typicalHspMax: { label: 'HSP típico máximo', unit: 'kWh/m²·dia' },
  minRecommendedTiltDegrees: { label: 'Inclinação mínima recomendada', unit: '°' },
  orientationToleranceDegrees: { label: 'Tolerância de orientação', unit: '°' },
  microgenerationMaxKw: { label: 'Limite da microgeração', unit: 'kW' },
  minigenerationMaxKw: { label: 'Limite da minigeração', unit: 'kW' },
};

export const MONTH_LABELS = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
] as const;
