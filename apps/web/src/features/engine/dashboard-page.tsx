import { useQuery } from '@tanstack/react-query';
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
import { ENGINEERING_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { formatDateTime, formatNumber } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { PRIORITY_BADGE, PRIORITY_LABELS } from './request-ui';

const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: 'bad' }) => (
  <div className="rounded-lg border p-3">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd
      className={`text-2xl font-semibold tabular-nums ${tone === 'bad' && Number(value) > 0 ? 'text-destructive' : ''}`}
    >
      {value}
    </dd>
  </div>
);

/** Painel da engenharia: carga de trabalho, atrasos e projetos, para quem coordena. */
export function DashboardPage() {
  const dashboard = useQuery({
    queryKey: queryKeys.engineeringDashboard,
    queryFn: () => endpoints.engineering.dashboard(),
  });
  if (dashboard.isPending) return <Skeleton className="h-64 w-full" />;
  if (dashboard.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o painel.</p>;
  const d = dashboard.data;
  const maxStatus = Math.max(1, ...Object.values(d.byStatus));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Painel da engenharia</CardTitle>
          <CardDescription>Pedidos em aberto, atrasos e andamento dos projetos.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Pedidos abertos" value={d.open} />
            <Stat label="Atrasados" value={d.overdue} tone="bad" />
            <Stat label="Sem responsável" value={d.unassigned} tone="bad" />
            <Stat label="Urgentes" value={d.urgent} tone="bad" />
            <Stat label="Projetos em andamento" value={d.projects.inProgress} />
            <Stat
              label="Tempo médio de atendimento"
              value={
                d.avgResolutionDays === null ? '—' : `${formatNumber(d.avgResolutionDays, 1)} d`
              }
            />
          </dl>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pedidos por estado</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2" aria-label="Pedidos por estado">
              {Object.entries(d.byStatus).map(([status, count]) => (
                <li
                  key={status}
                  className="grid grid-cols-[10rem_1fr_2rem] items-center gap-2 text-sm"
                >
                  <span>
                    {(ENGINEERING_STATUS_LABELS as Record<string, string>)[status] ?? status}
                  </span>
                  <span
                    className="block h-3 rounded bg-primary/70"
                    style={{ width: `${(count / maxStatus) * 100}%` }}
                    role="presentation"
                  />
                  <span className="text-right tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Carga por engenheiro</CardTitle>
          </CardHeader>
          <CardContent>
            {d.byAssignee.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum pedido aberto com responsável.</p>
            ) : (
              <ul className="space-y-1 text-sm" aria-label="Carga por engenheiro">
                {d.byAssignee.map((a) => (
                  <li key={a.id ?? a.name} className="flex justify-between">
                    <span>{a.name}</span>
                    <span className="tabular-nums">{a.open} em aberto</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Próximos prazos</CardTitle>
        </CardHeader>
        <CardContent>
          {d.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido aberto com prazo.</p>
          ) : (
            <ul className="divide-y text-sm" aria-label="Próximos prazos">
              {d.upcoming.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link className="underline" to={`/engine/pedidos/${u.id}`}>
                    {u.customerName ?? u.projectCode}
                  </Link>
                  <span className="flex items-center gap-2">
                    <Badge variant={PRIORITY_BADGE[u.priority as keyof typeof PRIORITY_BADGE]}>
                      {PRIORITY_LABELS[u.priority as keyof typeof PRIORITY_LABELS]}
                    </Badge>
                    {formatDateTime(u.dueAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
