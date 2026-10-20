import {
  Building2,
  DatabaseZap,
  Inbox,
  FileText,
  HardHat,
  LockKeyhole,
  Percent,
  Receipt,
  Scale,
  ScrollText,
  ShieldCheck,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@voltex/shared';

export interface AdminTab {
  path:
    | 'empresa'
    | 'usuarios'
    | 'perfis'
    | 'auditoria'
    | 'tarifas'
    | 'irradiacao'
    | 'regras'
    | 'fontes'
    | 'atualizacoes'
    | 'margens'
    | 'contratos'
    | 'homologacao'
    | 'privacidade';
  label: string;
  description: string;
  icon: LucideIcon;
  /** Basta uma destas permissões para ver a aba. */
  anyOf: readonly Permission[];
}

export const ADMIN_TABS: readonly AdminTab[] = [
  {
    path: 'empresa',
    label: 'Empresa',
    description: 'Dados da empresa, filiais e times',
    icon: Building2,
    anyOf: ['platform.tenant.manage'],
  },
  {
    path: 'usuarios',
    label: 'Usuários',
    description: 'Pessoas, perfis e convites',
    icon: Users,
    anyOf: ['platform.user.read'],
  },
  {
    path: 'perfis',
    label: 'Perfis',
    description: 'O que cada perfil pode fazer',
    icon: ShieldCheck,
    anyOf: ['platform.user.read'],
  },
  {
    path: 'auditoria',
    label: 'Auditoria',
    description: 'Histórico de ações na plataforma',
    icon: ScrollText,
    anyOf: ['platform.audit.read'],
  },
  {
    path: 'tarifas',
    label: 'Tarifas',
    description: 'Concessionárias e tarifas de energia',
    icon: Receipt,
    anyOf: ['platform.rule.manage'],
  },
  {
    path: 'irradiacao',
    label: 'Irradiação',
    description: 'HSP mensal por local, com fonte',
    icon: Sun,
    anyOf: ['platform.rule.manage'],
  },
  {
    path: 'regras',
    label: 'Regras',
    description: 'Limites e parâmetros do Solar Calculator',
    icon: Scale,
    anyOf: ['platform.rule.read'],
  },
  {
    path: 'fontes',
    label: 'Fontes de dados',
    description: 'Bases externas, licenças e páginas vigiadas',
    icon: DatabaseZap,
    anyOf: ['platform.rule.read'],
  },
  {
    path: 'atualizacoes',
    label: 'Atualizações',
    description: 'Dados vindos de fora que esperam a sua decisão',
    icon: Inbox,
    anyOf: ['platform.rule.read'],
  },
  {
    path: 'margens',
    label: 'Margens',
    description: 'Margem mínima das cotações',
    icon: Percent,
    anyOf: ['crm.margin-policy.manage'],
  },
  {
    path: 'contratos',
    label: 'Contratos',
    description: 'Modelo de contrato da empresa',
    icon: FileText,
    anyOf: ['crm.contract.write'],
  },
  {
    path: 'homologacao',
    label: 'Homologação',
    description: 'Checklist de documentos por distribuidora',
    icon: HardHat,
    anyOf: ['platform.rule.read'],
  },
  {
    path: 'privacidade',
    label: 'Privacidade',
    description: 'LGPD: prazos de guarda e eliminação de dados',
    icon: LockKeyhole,
    anyOf: ['platform.tenant.manage'],
  },
];

export const adminTab = (path: AdminTab['path']): AdminTab => {
  const tab = ADMIN_TABS.find((t) => t.path === path);
  if (!tab) throw new Error(`Aba de administração desconhecida: ${path}`);
  return tab;
};

/** Qualquer uma destas dá acesso à área de administração. */
export const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...new Set(ADMIN_TABS.flatMap((tab) => tab.anyOf)),
];
