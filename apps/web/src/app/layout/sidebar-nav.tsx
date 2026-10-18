import { LayoutDashboard, Settings } from 'lucide-react';
import { NavLink } from 'react-router';
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
import { useAuth } from '@/features/auth/auth-provider';
import { PRODUCTS } from '@/features/products/registry';
import { ADMIN_PERMISSIONS } from '@/features/admin/admin-nav';

interface SidebarNavProps {
  /** Chamado ao navegar (fecha o menu no celular). */
  onNavigate?: () => void;
  className?: string;
}

/** Menu lateral: troca entre os produtos da suíte e acesso à administração. Sempre azul-marinho (marca). */
export function SidebarNav({ onNavigate, className }: SidebarNavProps) {
  const { can, canAny } = useAuth();
  const products = PRODUCTS.filter((product) => can(product.permission));

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
              {products.map((product) => (
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
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        {canAny(ADMIN_PERMISSIONS) ? (
          <SidebarGroup>
            <SidebarGroupLabel>Gestão</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/admin"
                    onClick={onNavigate}
                    className={({ isActive }) => navClass(isActive)}
                  >
                    <Settings />
                    Administração
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
