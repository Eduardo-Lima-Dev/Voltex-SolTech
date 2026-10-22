import {
  CalendarDays,
  HardHat,
  LayoutDashboard,
  Smartphone,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@voltex/shared';

export interface OperationsTab {
  path: 'painel' | 'instalacoes' | 'agenda' | 'equipes' | 'campo';
  label: string;
  icon: LucideIcon;
  permission: Permission;
}

/** Telas da Operação (submenu da barra lateral). */
export const OPERATIONS_TABS: readonly OperationsTab[] = [
  { path: 'painel', label: 'Painel', icon: LayoutDashboard, permission: 'ops.installation.read' },
  { path: 'instalacoes', label: 'Instalações', icon: HardHat, permission: 'ops.installation.read' },
  { path: 'agenda', label: 'Agenda', icon: CalendarDays, permission: 'ops.workorder.read' },
  { path: 'equipes', label: 'Equipes', icon: Users, permission: 'ops.installation.read' },
  { path: 'campo', label: 'App de campo', icon: Smartphone, permission: 'ops.field.execute' },
];

export const OPERATIONS_PERMISSIONS: readonly Permission[] = [
  ...new Set(OPERATIONS_TABS.map((t) => t.permission)),
];
