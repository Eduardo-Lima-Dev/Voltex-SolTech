import { Building2, ScrollText, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import type { Permission } from '@voltex/shared';

export interface AdminTab {
  path: 'empresa' | 'usuarios' | 'perfis' | 'auditoria';
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
];

/** Qualquer uma destas dá acesso à área de administração. */
export const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...new Set(ADMIN_TABS.flatMap((tab) => tab.anyOf)),
];
