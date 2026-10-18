import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
import type { Product } from '@voltex/shared';
import { AppShell } from './layout/app-shell';
import { RootLayout } from './root-layout';
import { GuestOnly, RequireAuth, RequirePermission } from './guards';
import { NotFoundPage } from './pages/not-found-page';
import { RouteErrorPage } from './pages/route-error-page';
import { ADMIN_TABS } from '@/features/admin/admin-nav';
import { PRODUCTS } from '@/features/products/registry';

/**
 * Mapa de rotas. As páginas pesadas carregam sob demanda (`lazy`) para o login abrir rápido.
 * `handle.title` alimenta o título da aba do navegador.
 */
const pageRoutes: RouteObject[] = [
  {
    path: '/login',
    lazy: async () => {
      const { LoginPage } = await import('@/features/auth/login-page');
      return {
        element: (
          <GuestOnly>
            <LoginPage />
          </GuestOnly>
        ),
        handle: { title: 'Entrar' },
      };
    },
  },
  {
    path: '/accept-invitation',
    lazy: async () => {
      const { AcceptInvitationPage } = await import('@/features/auth/accept-invitation-page');
      return { Component: AcceptInvitationPage, handle: { title: 'Aceitar convite' } };
    },
  },
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppShell />,
        children: [
          {
            index: true,
            lazy: async () => {
              const { DashboardPage } = await import('@/features/dashboard/dashboard-page');
              return { Component: DashboardPage, handle: { title: 'Início' } };
            },
          },
          ...PRODUCTS.map((product) => ({
            path: `${product.path.slice(1)}/*`,
            lazy: async () => {
              const { ProductPage } = await import('@/features/products/product-page');
              return {
                element: (
                  <RequirePermission permission={product.permission}>
                    <ProductPage id={product.id as Product} />
                  </RequirePermission>
                ),
                handle: { title: product.name },
              };
            },
          })),
          {
            path: 'admin',
            lazy: async () => {
              const { AdminLayout } = await import('@/features/admin/admin-layout');
              return { Component: AdminLayout, handle: { title: 'Administração' } };
            },
            children: [
              {
                index: true,
                lazy: async () => {
                  const { AdminIndexRedirect } = await import('@/features/admin/admin-layout');
                  return { Component: AdminIndexRedirect };
                },
              },
              {
                path: 'empresa',
                lazy: async () => {
                  const { CompanyPage } = await import('@/features/admin/company/company-page');
                  return {
                    element: (
                      <RequirePermission anyOf={ADMIN_TABS[0]!.anyOf}>
                        <CompanyPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Empresa' },
                  };
                },
              },
              {
                path: 'usuarios',
                lazy: async () => {
                  const { UsersPage } = await import('@/features/admin/users-page');
                  return {
                    element: (
                      <RequirePermission anyOf={ADMIN_TABS[1]!.anyOf}>
                        <UsersPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Usuários' },
                  };
                },
              },
              {
                path: 'perfis',
                lazy: async () => {
                  const { RolesPage } = await import('@/features/admin/roles/roles-page');
                  return {
                    element: (
                      <RequirePermission anyOf={ADMIN_TABS[2]!.anyOf}>
                        <RolesPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Perfis' },
                  };
                },
              },
              {
                path: 'auditoria',
                lazy: async () => {
                  const { AuditPage } = await import('@/features/admin/audit/audit-page');
                  return {
                    element: (
                      <RequirePermission anyOf={ADMIN_TABS[3]!.anyOf}>
                        <AuditPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Auditoria' },
                  };
                },
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

/** Raiz: só adiciona o título da aba; as rotas de página ficam abaixo. */
export const routes: RouteObject[] = [{ element: <RootLayout />, children: pageRoutes }];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) =>
  createMemoryRouter(routes, { initialEntries });
