import { useState } from 'react';
import { ChevronDown, LayoutDashboard, Settings, type LucideIcon } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import {
  Logo,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@voltex/ui';
import type { Permission } from '@voltex/shared';
import { useAuth } from '@/features/auth/auth-provider';
import { PRODUCTS } from '@/features/products/registry';
import { ADMIN_PERMISSIONS, ADMIN_TABS } from '@/features/admin/admin-nav';
import { CRM_PERMISSIONS, CRM_TABS } from '@/features/crm/crm-nav';
import { ENGINE_PERMISSIONS, ENGINE_TABS } from '@/features/engine/engine-nav';
import { OFFGRID_PERMISSIONS, OFFGRID_TABS } from '@/features/offgrid/offgrid-nav';
import { OPERATIONS_PERMISSIONS, OPERATIONS_TABS } from '@/features/operations/operations-nav';

type SubmenuItem = { to: string; label: string; icon: LucideIcon };

interface SidebarNavProps {
  /** Chamado ao navegar (fecha o menu no celular). */
  onNavigate?: () => void;
  className?: string;
}

/** Menu lateral: troca entre os produtos da suíte e acesso à administração. Sempre azul-marinho (marca). */
export function SidebarNav({ onNavigate, className }: SidebarNavProps) {
  const { can, canAny } = useAuth();
  // Cada produto com telas próprias aparece para quem acessa qualquer uma delas (ex.: o instalador só vê Projetos e Tarefas).
  const submenus: Record<string, { anyOf: readonly Permission[]; items: SubmenuItem[] }> = {
    '/crm': {
      anyOf: CRM_PERMISSIONS,
      items: CRM_TABS.filter((tab) => can(tab.permission)).map((tab) => ({
        to: `/crm/${tab.path}`,
        label: tab.label,
        icon: tab.icon,
      })),
    },
    '/engine': {
      anyOf: ENGINE_PERMISSIONS,
      items: ENGINE_TABS.filter((tab) => can(tab.permission)).map((tab) => ({
        to: `/engine/${tab.path}`,
        label: tab.label,
        icon: tab.icon,
      })),
    },
    '/offgrid': {
      anyOf: OFFGRID_PERMISSIONS,
      items: OFFGRID_TABS.filter((tab) => can(tab.permission)).map((tab) => ({
        to: `/offgrid/${tab.path}`,
        label: tab.label,
        icon: tab.icon,
      })),
    },
    '/operations': {
      anyOf: OPERATIONS_PERMISSIONS,
      items: OPERATIONS_TABS.filter((tab) => can(tab.permission)).map((tab) => ({
        to: `/operations/${tab.path}`,
        label: tab.label,
        icon: tab.icon,
      })),
    },
  };
  const products = PRODUCTS.filter((product) => {
    const submenu = submenus[product.path];
    return submenu ? canAny(submenu.anyOf) : can(product.permission);
  });
  const adminItems = ADMIN_TABS.filter((tab) => canAny(tab.anyOf)).map((tab) => ({
    to: `/admin/${tab.path}`,
    label: tab.label,
    icon: tab.icon,
  }));

  return (
    <Sidebar className={className}>
      <SidebarHeader>
        <NavLink
          to="/"
          onClick={onNavigate}
          aria-label="Voltex SolTech — início"
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary"
        >
          <Logo tone="on-dark" title="Voltex SolTech" className="h-9" />
        </NavLink>
      </SidebarHeader>

      <SidebarContent role="navigation" aria-label="Navegação principal">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <NavLink
                  to="/"
                  end
                  onClick={onNavigate}
                  className={({ isActive }) => navClass(isActive)}
                >
                  <LayoutDashboard />
                  Início
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {products.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>Produtos</SidebarGroupLabel>
            <SidebarMenu>
              {products.map((product) =>
                (submenus[product.path]?.items.length ?? 0) > 0 ? (
                  <NavSubmenu
                    key={product.id}
                    base={product.path}
                    label={product.name}
                    icon={product.icon}
                    items={submenus[product.path]!.items}
                    onNavigate={onNavigate}
                  />
                ) : (
                  <SidebarMenuItem key={product.id}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={product.path}
                        onClick={onNavigate}
                        className={({ isActive }) => navClass(isActive)}
                      >
                        <product.icon />
                        <span className="flex-1 truncate">{product.name}</span>
                        {product.availability.status === 'soon' ? (
                          <span className="sr-only">(em breve)</span>
                        ) : null}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ),
              )}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        {canAny(ADMIN_PERMISSIONS) ? (
          <SidebarGroup>
            <SidebarGroupLabel>Gestão</SidebarGroupLabel>
            <SidebarMenu>
              <NavSubmenu
                base="/admin"
                label="Administração"
                icon={Settings}
                items={adminItems}
                onNavigate={onNavigate}
              />
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <p className="px-2 text-xs text-sidebar-muted">Voltex SolTech · v0.1</p>
      </SidebarFooter>
    </Sidebar>
  );
}

/** Estados do link dentro do botão da barra lateral (o `data-active` do botão não enxerga o NavLink). */
const navClass = (isActive: boolean): string =>
  isActive
    ? 'flex w-full items-center gap-2 font-medium text-sidebar-primary'
    : 'flex w-full items-center gap-2';

interface NavSubmenuProps {
  base: string;
  label: string;
  icon: LucideIcon;
  items: readonly { to: string; label: string; icon: LucideIcon }[];
  onNavigate?: () => void;
}

/** Item do menu que abre uma lista de telas logo abaixo (ex.: CRM Solar → Leads, Oportunidades…). */
function NavSubmenu({ base, label, icon: Icon, items, onNavigate }: NavSubmenuProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const inside = pathname === base || pathname.startsWith(`${base}/`);
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? inside;
  const listId = `submenu-${base.replace(/\W/g, '')}`;

  const toggle = () => {
    // Abrir de fora leva direto à primeira tela; fechar só recolhe a lista.
    if (!open && !inside && items[0]) void navigate(items[0].to);
    setManual(!open);
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={listId}
        isActive={inside}
      >
        <Icon />
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronDown
          aria-hidden
          className={
            open ? 'size-4 transition-transform' : 'size-4 -rotate-90 transition-transform'
          }
        />
      </SidebarMenuButton>
      {open ? (
        <ul id={listId} className="mt-1 ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
          {items.map((item) => {
            // A tela continua marcada nas subtelas (ficha do lead, da conta, do projeto…): vale o prefixo do caminho.
            const current = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <li key={item.to}>
                <SidebarMenuButton asChild isActive={current}>
                  <NavLink
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={current ? 'page' : undefined}
                    className={navClass(current)}
                  >
                    <item.icon />
                    {item.label}
                  </NavLink>
                </SidebarMenuButton>
              </li>
            );
          })}
        </ul>
      ) : null}
    </SidebarMenuItem>
  );
}
