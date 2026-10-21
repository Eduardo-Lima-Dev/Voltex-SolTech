import { Navigate, createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
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
    // Proposta do cliente: link com token, sem login e fora da casca da suíte.
    path: '/p/:token',
    lazy: async () => {
      const { PublicProposalPage } =
        await import('@/features/public-proposal/public-proposal-page');
      return { Component: PublicProposalPage, handle: { title: 'Proposta comercial' } };
    },
  },
  {
    // Relatório técnico do projeto aprovado para o cliente: link com token, sem login.
    path: '/r/:token',
    lazy: async () => {
      const { PublicEngineeringReportPage } =
        await import('@/features/public-engineering/public-engineering-page');
      return { Component: PublicEngineeringReportPage, handle: { title: 'Relatório técnico' } };
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
                path: 'aprovacoes',
                lazy: async () => {
                  const { ApprovalsPage } = await import('@/features/crm/approvals/approvals-page');
                  return {
                    element: (
                      <RequirePermission permission="crm.margin.approve">
                        <ApprovalsPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Aprovações' },
                  };
                },
              },
              {
                path: 'projetos',
                lazy: async () => {
                  const { ProjectsPage } = await import('@/features/crm/projects/projects-page');
                  return {
                    element: (
                      <RequirePermission permission="crm.project.read">
                        <ProjectsPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Projetos' },
                  };
                },
              },
              {
                path: 'projetos/:id',
                lazy: async () => {
                  const { ProjectDetailPage } =
                    await import('@/features/crm/projects/project-detail-page');
                  return {
                    element: (
                      <RequirePermission permission="crm.project.read">
                        <ProjectDetailPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Projeto' },
                  };
                },
              },
              {
                path: 'painel',
                lazy: async () => {
                  const { DashboardPage } = await import('@/features/crm/dashboard/dashboard-page');
                  return {
                    element: (
                      <RequirePermission permission="crm.dashboard.read">
                        <DashboardPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Painel comercial' },
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
            path: 'engine',
            handle: { title: 'Solar Engine Studio' },
            lazy: async () => {
              const { EngineLayout } = await import('@/features/engine/layout');
              return { Component: EngineLayout };
            },
            children: [
              {
                index: true,
                lazy: async () => {
                  const { EngineIndexRedirect } = await import('@/features/engine/layout');
                  return { Component: EngineIndexRedirect };
                },
              },
              {
                path: 'pedidos',
                lazy: async () => {
                  const { RequestsPage } = await import('@/features/engine/requests-page');
                  return {
                    element: (
                      <RequirePermission permission="engine.project.read">
                        <RequestsPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Pedidos de engenharia' },
                  };
                },
              },
              {
                path: 'pedidos/:id',
                lazy: async () => {
                  const { RequestPage } = await import('@/features/engine/request-page');
                  return {
                    element: (
                      <RequirePermission permission="engine.project.read">
                        <RequestPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Pedido de engenharia' },
                  };
                },
              },
              {
                path: 'painel',
                lazy: async () => {
                  const { DashboardPage } = await import('@/features/engine/dashboard-page');
                  return {
                    element: (
                      <RequirePermission permission="engine.request.manage">
                        <DashboardPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Painel da engenharia' },
                  };
                },
              },
              {
                path: 'projetos',
                lazy: async () => {
                  const { ProjectsPage } = await import('@/features/engine/projects-page');
                  return {
                    element: (
                      <RequirePermission permission="engine.project.read">
                        <ProjectsPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Projetos de engenharia' },
                  };
                },
              },
              {
                path: 'projetos/:id',
                lazy: async () => {
                  const { ProjectPage } = await import('@/features/engine/project-page');
                  return {
                    element: (
                      <RequirePermission permission="engine.project.read">
                        <ProjectPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Projeto' },
                  };
                },
              },
              {
                path: 'projetos/:id/versoes/:versionId',
                lazy: async () => {
                  const { VersionEditorPage } =
                    await import('@/features/engine/editor/version-editor-page');
                  return {
                    element: (
                      <RequirePermission permission="engine.project.read">
                        <VersionEditorPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Versão do projeto' },
                  };
                },
              },
              {
                path: 'catalogo',
                lazy: async () => {
                  const { CatalogPage } = await import('@/features/admin/catalog/catalog-page');
                  return {
                    element: (
                      <RequirePermission permission="platform.catalog.read">
                        <CatalogPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Catálogo técnico' },
                  };
                },
              },
            ],
          },
          {
            path: 'offgrid',
            handle: { title: 'Off-Grid Designer' },
            lazy: async () => {
              const { OffgridLayout } = await import('@/features/offgrid/layout');
              return { Component: OffgridLayout };
            },
            children: [
              {
                index: true,
                lazy: async () => {
                  const { OffgridIndexRedirect } = await import('@/features/offgrid/layout');
                  return { Component: OffgridIndexRedirect };
                },
              },
              {
                path: 'painel',
                lazy: async () => {
                  const { OffgridDashboardPage } =
                    await import('@/features/offgrid/dashboard-page');
                  return {
                    element: (
                      <RequirePermission permission="offgrid.project.read">
                        <OffgridDashboardPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Painel do Off-Grid' },
                  };
                },
              },
              {
                path: 'pedidos',
                lazy: async () => {
                  const { OffgridRequestsPage } = await import('@/features/offgrid/requests-page');
                  return {
                    element: (
                      <RequirePermission permission="offgrid.project.read">
                        <OffgridRequestsPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Pedidos off-grid' },
                  };
                },
              },
              {
                path: 'pedidos/:id',
                lazy: async () => {
                  const { OffgridRequestPage } = await import('@/features/offgrid/request-page');
                  return {
                    element: (
                      <RequirePermission permission="offgrid.project.read">
                        <OffgridRequestPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Pedido off-grid' },
                  };
                },
              },
              {
                path: 'projetos',
                lazy: async () => {
                  const { OffgridProjectsPage } = await import('@/features/offgrid/projects-page');
                  return {
                    element: (
                      <RequirePermission permission="offgrid.project.read">
                        <OffgridProjectsPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Projetos off-grid' },
                  };
                },
              },
              {
                path: 'projetos/:id',
                lazy: async () => {
                  const { OffgridProjectPage } = await import('@/features/offgrid/project-page');
                  return {
                    element: (
                      <RequirePermission permission="offgrid.project.read">
                        <OffgridProjectPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Projeto off-grid' },
                  };
                },
              },
              {
                path: 'projetos/:id/versoes/:versionId',
                lazy: async () => {
                  const { OffgridVersionEditorPage } =
                    await import('@/features/offgrid/editor/version-editor-page');
                  return {
                    element: (
                      <RequirePermission permission="offgrid.project.read">
                        <OffgridVersionEditorPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Versão do projeto off-grid' },
                  };
                },
              },
              {
                path: 'catalogo',
                lazy: async () => {
                  const { CatalogPage } = await import('@/features/admin/catalog/catalog-page');
                  return {
                    element: (
                      <RequirePermission permission="platform.catalog.read">
                        <CatalogPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Catálogo técnico' },
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
                  return { Component: SnapshotPage, handle: { title: 'Versão salva do cálculo' } };
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
              { path: 'catalogo', element: <Navigate to="/engine/catalogo" replace /> },
              {
                path: 'fontes',
                lazy: async () => {
                  const { SourcesPage } = await import('@/features/admin/data-hub/sources-page');
                  return {
                    element: (
                      <RequirePermission anyOf={adminTab('fontes').anyOf}>
                        <SourcesPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Fontes de dados' },
                  };
                },
              },
              {
                path: 'atualizacoes',
                lazy: async () => {
                  const { UpdatesPage } = await import('@/features/admin/data-hub/updates-page');
                  return {
                    element: (
                      <RequirePermission anyOf={adminTab('atualizacoes').anyOf}>
                        <UpdatesPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Atualizações' },
                  };
                },
              },
              {
                path: 'margens',
                lazy: async () => {
                  const { MarginsPage } = await import('@/features/admin/margins/margins-page');
                  return {
                    element: (
                      <RequirePermission anyOf={adminTab('margens').anyOf}>
                        <MarginsPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Margens' },
                  };
                },
              },
              {
                path: 'contratos',
                lazy: async () => {
                  const { ContractTemplatePage } =
                    await import('@/features/admin/contracts/contract-template-page');
                  return {
                    element: (
                      <RequirePermission anyOf={adminTab('contratos').anyOf}>
                        <ContractTemplatePage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Contratos' },
                  };
                },
              },
              {
                path: 'homologacao',
                lazy: async () => {
                  const { HomologationPage } =
                    await import('@/features/admin/homologation/homologation-page');
                  return {
                    element: (
                      <RequirePermission anyOf={adminTab('homologacao').anyOf}>
                        <HomologationPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Homologação' },
                  };
                },
              },
              {
                path: 'privacidade',
                lazy: async () => {
                  const { PrivacyPage } = await import('@/features/admin/privacy/privacy-page');
                  return {
                    element: (
                      <RequirePermission anyOf={adminTab('privacidade').anyOf}>
                        <PrivacyPage />
                      </RequirePermission>
                    ),
                    handle: { title: 'Privacidade' },
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
