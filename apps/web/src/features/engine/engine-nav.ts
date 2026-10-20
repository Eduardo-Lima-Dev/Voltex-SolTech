import { ClipboardList, Boxes, FolderKanban, type LucideIcon } from 'lucide-react';
import type { Permission } from '@voltex/shared';

export interface EngineTab {
  path: 'pedidos' | 'projetos' | 'catalogo';
  label: string;
  icon: LucideIcon;
  permission: Permission;
}

/** Telas do Solar Engine Studio (submenu da barra lateral). */
export const ENGINE_TABS: readonly EngineTab[] = [
  { path: 'pedidos', label: 'Pedidos', icon: ClipboardList, permission: 'engine.project.read' },
  { path: 'projetos', label: 'Projetos', icon: FolderKanban, permission: 'engine.project.read' },
  { path: 'catalogo', label: 'Catálogo', icon: Boxes, permission: 'platform.catalog.read' },
];

/** Qualquer uma destas dá acesso ao Studio. */
export const ENGINE_PERMISSIONS: readonly Permission[] = [
  ...new Set(ENGINE_TABS.map((t) => t.permission)),
];
