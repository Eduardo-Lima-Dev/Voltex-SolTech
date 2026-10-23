import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@voltex/ui';
import { INSTALLATION_STATUSES } from '@voltex/shared';
import { endpoints } from '@/lib/api/endpoints';
import { queryKeys } from '../admin/query-keys';
import { INSTALLATION_STATUS_LABELS } from './labels';

function Metric({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-3xl font-semibold">{value}</CardContent>
    </Card>
  );
}

/** Painel da Operação (modelagem §51): instalações por situação, atrasos, pendências e produtividade. */
export function OperationsDashboardPage() {
  const dash = useQuery({
    queryKey: queryKeys.operationsDashboard,
    queryFn: endpoints.operations.dashboard,
  });
  if (dash.isPending) return <Skeleton className="h-48 w-full" />;
  if (dash.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o painel.</p>;
  const d = dash.data;
  const active = INSTALLATION_STATUSES.filter((s) => (d.byStatus[s] ?? 0) > 0);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Metric
        title="Aguardando material"
        description="Homologadas, sem material completo"
        value={d.awaitingMaterialCount}
      />
      <Metric
        title="Com equipe designada"
        description="Instalações agendadas"
        value={d.scheduledCount}
      />
      <Metric
        title="Ordens atrasadas"
        description="Agendadas e ainda não iniciadas"
        value={d.overdueCount}
      />
      <Metric
        title="Pendências de campo"
        description="Abertas, de todas as instalações"
        value={d.openIssuesCount}
      />
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Instalações por situação</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1 text-sm sm:grid-cols-2" aria-label="Instalações por situação">
            {active.map((status) => (
              <li key={status} className="flex justify-between gap-4">
                <span>{INSTALLATION_STATUS_LABELS[status]}</span>
                <span className="font-medium">{d.byStatus[status]}</span>
              </li>
            ))}
            {active.length === 0 ? (
              <li className="text-muted-foreground">Nenhuma instalação ainda.</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Produtividade das equipes</CardTitle>
          <CardDescription>Ordens concluídas nos últimos 30 dias</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm" aria-label="Produtividade das equipes">
            {d.crews.map((c) => (
              <li key={c.crewId} className="flex justify-between gap-4">
                <span>{c.crewName}</span>
                <span className="font-medium">{c.doneLast30Days}</span>
              </li>
            ))}
            {d.crews.length === 0 ? (
              <li className="text-muted-foreground">Nenhuma ordem concluída no período.</li>
            ) : null}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Retrabalho de campo: {d.reworkCount} instalação(ões) com pendência ou mais de uma ordem
            de instalação.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
