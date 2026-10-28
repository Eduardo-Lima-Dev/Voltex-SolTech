import {
  BadgeCheck,
  BarChart3,
  HardHat,
  Building2,
  CheckSquare,
  Gauge,
  Kanban,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@voltex/shared';

export interface CrmTab {
  path:
    | 'leads'
    | 'oportunidades'
    | 'contas'
    | 'aprovacoes'
    | 'projetos'
    | 'painel'
    | 'tarefas'
    | 'pontuacao';
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
  { path: 'projetos', label: 'Projetos', icon: HardHat, permission: 'crm.project.read' },
  { path: 'painel', label: 'Painel', icon: BarChart3, permission: 'crm.dashboard.read' },
  { path: 'tarefas', label: 'Tarefas', icon: CheckSquare, permission: 'crm.task.read' },
  {
    path: 'pontuacao',
    label: 'Pontuação de leads',
    icon: Gauge,
    permission: 'crm.lead-scoring.manage',
  },
];

/** Qualquer uma destas dá acesso à área do CRM. */
export const CRM_PERMISSIONS: readonly Permission[] = CRM_TABS.map((t) => t.permission);
