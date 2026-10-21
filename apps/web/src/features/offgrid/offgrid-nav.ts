import { Boxes, ClipboardList, FolderKanban, LayoutDashboard, type LucideIcon } from 'lucide-react';
import type { Permission } from '@voltex/shared';

export interface OffgridTab {
  path: 'painel' | 'pedidos' | 'projetos' | 'catalogo';
  label: string;
  icon: LucideIcon;
  permission: Permission;
}

/** Telas do Off-Grid Designer (submenu da barra lateral). */
export const OFFGRID_TABS: readonly OffgridTab[] = [
  { path: 'painel', label: 'Painel', icon: LayoutDashboard, permission: 'offgrid.project.read' },
  { path: 'pedidos', label: 'Pedidos', icon: ClipboardList, permission: 'offgrid.project.read' },
  { path: 'projetos', label: 'Projetos', icon: FolderKanban, permission: 'offgrid.project.read' },
  { path: 'catalogo', label: 'Catálogo', icon: Boxes, permission: 'platform.catalog.read' },
];

export const OFFGRID_PERMISSIONS: readonly Permission[] = [
  ...new Set(OFFGRID_TABS.map((t) => t.permission)),
];
