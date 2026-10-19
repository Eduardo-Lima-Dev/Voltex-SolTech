import {
  BadgeCheck,
  Building2,
  CheckSquare,
  Kanban,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@voltex/shared';

export interface CrmTab {
  path: 'leads' | 'oportunidades' | 'contas' | 'aprovacoes' | 'tarefas';
  label: string;
  icon: LucideIcon;
  permission: Permission;
}

export const CRM_TABS: readonly CrmTab[] = [
  { path: 'leads', label: 'Leads', icon: UserPlus, permission: 'crm.lead.read' },
  {
    path: 'oportunidades',
    label: 'Oportunidades',
    icon: Kanban,
    permission: 'crm.opportunity.read',
  },
  { path: 'contas', label: 'Contas', icon: Building2, permission: 'crm.account.read' },
  {
    path: 'aprovacoes',
    label: 'Aprovações',
    icon: BadgeCheck,
    permission: 'crm.margin.approve',
  },
  { path: 'tarefas', label: 'Tarefas', icon: CheckSquare, permission: 'crm.task.read' },
];

/** Qualquer uma destas dá acesso à área do CRM. */
export const CRM_PERMISSIONS: readonly Permission[] = CRM_TABS.map((t) => t.permission);
