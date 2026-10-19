import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
import type { Product } from '@voltex/shared';
import { AppShell } from './layout/app-shell';
import { RootLayout } from './root-layout';
import { GuestOnly, RequireAuth, RequirePermission } from './guards';
import { NotFoundPage } from './pages/not-found-page';
import { RouteErrorPage } from './pages/route-error-page';
import { ADMIN_TABS, adminTab } from '@/features/admin/admin-nav';
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
          ...PRODUCTS.filter((product) => product.availability.status === 'soon').map(
            (product) => ({
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
            }),
          ),
          {
            path: 'crm',
            handle: { title: 'CRM Solar' },
            lazy: async () => {
              const { CrmLayout } = await import('@/features/crm/layout');
              return { Component: CrmLayout };
            },
            children: [
              {
                index: true,
                lazy: async () => {
                  const { CrmIndexRedirect } = await import('@/features/crm/layout');
                  return { Component: CrmIndexRedirect };
                },
              },
              {
                path: 'leads',
                lazy: async () => {
                  const { LeadsPage } = await import('@/features/crm/leads/leads-page');
                  return {
                    element: (
                      <RequirePermission permission="crm.lead.read">
                        <LeadsPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Leads' },
                  };
                },
              },
              {
                path: 'oportunidades',
                lazy: async () => {
                  const { OpportunitiesPage } =
                    await import('@/features/crm/opportunities/opportunities-page');
                  return {
                    element: (
                      <RequirePermission permission="crm.opportunity.read">
                        <OpportunitiesPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Oportunidades' },
                  };
                },
              },
              {
                path: 'oportunidades/:id',
                lazy: async () => {
                  const { OpportunityDetailPage } =
                    await import('@/features/crm/opportunities/opportunity-detail-page');
                  return {
                    element: (
                      <RequirePermission permission="crm.opportunity.read">
                        <OpportunityDetailPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Oportunidade' },
                  };
                },
              },
              {
                path: 'oportunidades/:id/faturas/:billId',
                lazy: async () => {
                  const { BillReviewPage } =
                    await import('@/features/crm/opportunities/bill-review-page');
                  return {
                    element: (
                      <RequirePermission
                        permission={['crm.opportunity.read', 'crm.energy-bill.write']}
                      >
                        <BillReviewPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Revisar fatura' },
                  };
                },
              },
              {
                path: 'contas',
                lazy: async () => {
                  const { AccountsPage } = await import('@/features/crm/accounts/accounts-page');
                  return {
                    element: (
                      <RequirePermission permission="crm.account.read">
                        <AccountsPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Contas' },
                  };
                },
              },
              {
                path: 'contas/:id',
                lazy: async () => {
                  const { AccountDetailPage } =
                    await import('@/features/crm/accounts/account-detail-page');
                  return {
                    element: (
                      <RequirePermission permission="crm.account.read">
                        <AccountDetailPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Conta' },
                  };
                },
              },
              {
                path: 'tarefas',
                lazy: async () => {
                  const { TasksPage } = await import('@/features/crm/tasks/tasks-page');
                  return {
                    element: (
                      <RequirePermission permission="crm.task.read">
                        <TasksPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Tarefas' },
                  };
                },
              },
            ],
          },
          {
            path: 'calculator',
            handle: { title: 'Solar Calculator' },
            lazy: async () => {
              const { CalculatorLayout } = await import('@/features/calculator/layout');
              return { Component: CalculatorLayout };
            },
            children: [
              {
                index: true,
                lazy: async () => {
                  const { CalculatorListPage } = await import('@/features/calculator/list-page');
                  return { Component: CalculatorListPage };
                },
              },
              {
                path: 'new',
                lazy: async () => {
                  const { CalculatorWizardPage } =
                    await import('@/features/calculator/wizard-page');
                  return {
                    element: (
                      <RequirePermission permission="calculator.session.create">
                        <CalculatorWizardPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Novo cálculo' },
                  };
                },
              },
              {
                path: 'snapshots/:snapshotId',
                lazy: async () => {
                  const { SnapshotPage } = await import('@/features/calculator/detail-page');
                  return { Component: SnapshotPage, handle: { title: 'Snapshot de cálculo' } };
                },
              },
              {
                path: ':id',
                lazy: async () => {
                  const { CalculationDetailPage } =
                    await import('@/features/calculator/detail-page');
                  return { Component: CalculationDetailPage, handle: { title: 'Cálculo' } };
                },
              },
            ],
          },
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
                path: 'tarifas',
                lazy: async () => {
                  const { TariffsPage } = await import('@/features/admin/reference/tariffs-page');
                  return {
                    element: (
                      <RequirePermission anyOf={adminTab('tarifas').anyOf}>
                        <TariffsPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Tarifas' },
                  };
                },
              },
              {
                path: 'irradiacao',
                lazy: async () => {
                  const { SolarResourcesPage } =
                    await import('@/features/admin/reference/solar-resources-page');
                  return {
                    element: (
                      <RequirePermission anyOf={adminTab('irradiacao').anyOf}>
                        <SolarResourcesPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Irradiação' },
                  };
                },
              },
              {
                path: 'regras',
                lazy: async () => {
                  const { RulesPage } = await import('@/features/admin/reference/rules-page');
                  return {
                    element: (
                      <RequirePermission anyOf={adminTab('regras').anyOf}>
                        <RulesPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Regras' },
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
