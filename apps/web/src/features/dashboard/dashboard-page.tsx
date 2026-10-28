import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@voltex/ui';
import type { Permission } from '@voltex/shared';
import { useAuth, useCurrentUser } from '@/features/auth/auth-provider';
import { InsightsCard } from '@/features/ai/insights-card';
import { PRODUCTS } from '@/features/products/registry';
import { endpoints } from '@/lib/api/endpoints';
import { formatCents, formatDateTime } from '@/lib/format';
import { roleLabel } from '@/i18n/labels';

interface Stat {
  label: string;
  value: ReactNode;
  /** Chama atenção (atraso, vencido, estourado). */
  alert?: boolean;
}

/** Cartão de números de uma área, com link para a tela completa. Se a consulta falhar, o cartão some. */
function StatsCard({
  title,
  description,
  to,
  query,
  stats,
}: {
  title: string;
  description: string;
  to: string;
  query: { isPending: boolean; isError: boolean };
  stats: Stat[];
}) {
  if (query.isError) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          {title}
          <Link
            to={to}
            className="flex items-center gap-1 text-sm font-medium text-brand-cyan-strong hover:underline dark:text-brand-cyan"
          >
            Abrir <ArrowRight className="size-4" aria-hidden />
          </Link>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <dl className="grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
                <dd
                  className={
                    s.alert ? 'text-2xl font-semibold text-destructive' : 'text-2xl font-semibold'
                  }
                >
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function MyTasksCard() {
  const user = useCurrentUser();
  const tasks = useQuery({
    queryKey: ['home', 'tasks', user.id],
    queryFn: () => endpoints.tasks.list({ assigneeId: user.id, status: 'OPEN', pageSize: 5 }),
  });
  if (tasks.isError) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Minhas tarefas
          <Link
            to="/crm/tarefas"
            className="flex items-center gap-1 text-sm font-medium text-brand-cyan-strong hover:underline dark:text-brand-cyan"
          >
            Abrir <ArrowRight className="size-4" aria-hidden />
          </Link>
        </CardTitle>
        <CardDescription>Abertas e atribuídas a você, as mais próximas primeiro.</CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : tasks.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa aberta. Tudo em dia.</p>
        ) : (
          <ul className="divide-y text-sm" aria-label="Minhas tarefas abertas">
            {tasks.data.data.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <span className="truncate">{t.title}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {t.overdue ? <Badge variant="red">Atrasada</Badge> : null}
                  {formatDateTime(t.dueAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FieldCard() {
  const orders = useQuery({
    queryKey: ['home', 'field'],
    queryFn: endpoints.field.orders,
  });
  const running = orders.data?.filter((o) => o.status === 'IN_PROGRESS').length ?? 0;
  return (
    <StatsCard
      title="Meu dia em campo"
      description="Suas ordens de serviço. O app de campo funciona sem internet."
      to="/campo"
      query={orders}
      stats={[
        { label: 'Ordens para você', value: orders.data?.length ?? 0 },
        { label: 'Em execução', value: running },
      ]}
    />
  );
}

function CommercialCard() {
  const dash = useQuery({
    queryKey: ['home', 'commercial'],
    queryFn: () => endpoints.dashboard.commercial({}),
  });
  const d = dash.data;
  return (
    <StatsCard
      title="Comercial"
      description="Funil do período padrão do painel comercial."
      to="/crm/oportunidades"
      query={dash}
      stats={[
        { label: 'Leads', value: d?.totalLeads ?? 0 },
        { label: 'Propostas enviadas', value: d?.proposals.sent ?? 0 },
        { label: 'Negócios ganhos', value: d?.won.count ?? 0 },
        { label: 'Pipeline aberto', value: formatCents(d?.forecast.openTotalCents ?? 0) },
      ]}
    />
  );
}

function OperationsCard() {
  const dash = useQuery({
    queryKey: ['home', 'operations'],
    queryFn: endpoints.operations.dashboard,
  });
  const d = dash.data;
  return (
    <StatsCard
      title="Instalações"
      description="O que está andando e o que está parado na execução."
      to="/operations/painel"
      query={dash}
      stats={[
        { label: 'Agendadas', value: d?.scheduledCount ?? 0 },
        { label: 'Atrasadas', value: d?.overdueCount ?? 0, alert: (d?.overdueCount ?? 0) > 0 },
        { label: 'Aguardando material', value: d?.awaitingMaterialCount ?? 0 },
        {
          label: 'Pendências de campo',
          value: d?.openIssuesCount ?? 0,
          alert: (d?.openIssuesCount ?? 0) > 0,
        },
      ]}
    />
  );
}

function AftersalesCard() {
  const dash = useQuery({
    queryKey: ['home', 'aftersales'],
    queryFn: endpoints.operations.aftersales.dashboard,
  });
  const d = dash.data;
  return (
    <StatsCard
      title="Pós-venda"
      description="Base instalada, chamados e garantias."
      to="/operations/plantas"
      query={dash}
      stats={[
        { label: 'Plantas ativas', value: d?.installedBase.plants ?? 0 },
        { label: 'Chamados abertos', value: d?.openTickets ?? 0 },
        {
          label: 'Fora do prazo',
          value: d?.breachedTickets ?? 0,
          alert: (d?.breachedTickets ?? 0) > 0,
        },
        { label: 'Garantias a vencer', value: d?.warrantiesExpiring ?? '—' },
      ]}
    />
  );
}

function FinanceCard() {
  const overview = useQuery({
    queryKey: ['finance', 'overview'],
    queryFn: endpoints.finance.overview,
  });
  const d = overview.data;
  return (
    <StatsCard
      title="Financeiro"
      description="Recebíveis dos projetos, lançados à mão."
      to="/operations/financeiro"
      query={overview}
      stats={[
        { label: 'A receber', value: formatCents(d?.totalOpenCents ?? 0) },
        {
          label: 'Vencido',
          value: formatCents(d?.totalOverdueCents ?? 0),
          alert: (d?.totalOverdueCents ?? 0) > 0,
        },
        { label: 'Recebido (30 dias)', value: formatCents(d?.receivedLast30DaysCents ?? 0) },
        { label: 'Comissões a pagar', value: formatCents(d?.commissionsPendingCents ?? 0) },
      ]}
    />
  );
}

function EngineeringCard() {
  const dash = useQuery({
    queryKey: ['home', 'engineering'],
    queryFn: endpoints.engineering.dashboard,
  });
  const d = dash.data;
  return (
    <StatsCard
      title="Engenharia"
      description="Pedidos de projeto e prazos."
      to="/engine"
      query={dash}
      stats={[
        { label: 'Pedidos abertos', value: d?.open ?? 0 },
        { label: 'Atrasados', value: d?.overdue ?? 0, alert: (d?.overdue ?? 0) > 0 },
        { label: 'Sem responsável', value: d?.unassigned ?? 0 },
        { label: 'Projetos em andamento', value: d?.projects.inProgress ?? 0 },
      ]}
    />
  );
}

interface Section {
  key: string;
  permission: Permission;
  /** Perfis para os quais esta área vem primeiro. */
  firstFor: readonly string[];
  node: ReactNode;
}

const SECTIONS: readonly Section[] = [
  { key: 'field', permission: 'ops.field.execute', firstFor: ['INSTALLER'], node: <FieldCard /> },
  {
    key: 'commercial',
    permission: 'crm.dashboard.read',
    firstFor: ['SALESPERSON', 'SDR', 'SALES_MANAGER'],
    node: <CommercialCard />,
  },
  {
    key: 'tasks',
    permission: 'crm.task.read',
    firstFor: ['SDR', 'SALESPERSON'],
    node: <MyTasksCard />,
  },
  {
    key: 'engineering',
    // O painel da engenharia exige gerenciar pedidos (a rota `/engineering/dashboard`).
    permission: 'engine.request.manage',
    firstFor: ['ENGINEERING', 'TECHNICAL_LEAD'],
    node: <EngineeringCard />,
  },
  {
    key: 'operations',
    permission: 'ops.installation.read',
    firstFor: ['OPERATIONS', 'TECHNICAL_LEAD'],
    node: <OperationsCard />,
  },
  { key: 'aftersales', permission: 'ops.plant.read', firstFor: ['OM'], node: <AftersalesCard /> },
  { key: 'finance', permission: 'crm.finance.read', firstFor: ['FINANCE'], node: <FinanceCard /> },
];

/** Início de cada pessoa: o que ela tem para fazer agora, na ordem que importa para o perfil dela. */
export function DashboardPage() {
  const user = useCurrentUser();
  const { can } = useAuth();
  const firstName = user.name.split(' ')[0];

  const visible = SECTIONS.filter((s) => can(s.permission));
  const ordered = [
    ...visible.filter((s) => s.firstFor.includes(user.role)),
    ...visible.filter((s) => !s.firstFor.includes(user.role)),
  ];
  const products = PRODUCTS.filter((p) => can(p.permission) && p.availability.status !== 'soon');

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {firstName}</h1>
        <p className="text-muted-foreground">
          {user.tenantName} · {roleLabel(user.role)}
        </p>
      </header>

      {can('ai.insights.read') ? <InsightsCard /> : null}

      {ordered.length > 0 ? (
        <section aria-labelledby="agora" className="space-y-4">
          <h2 id="agora" className="text-lg font-medium">
            Para você agora
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {ordered.map((s) => (
              <div key={s.key} className="contents">
                {s.node}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Use o menu ao lado para abrir as áreas liberadas para o seu perfil.
        </p>
      )}

      {products.length > 0 ? (
        <section aria-labelledby="produtos" className="space-y-3">
          <h2 id="produtos" className="text-lg font-medium">
            Seus produtos
          </h2>
          <ul className="flex flex-wrap gap-2">
            {products.map((product) => (
              <li key={product.id}>
                <Link
                  to={product.path}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <product.icon className="size-4" aria-hidden />
                  {product.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
