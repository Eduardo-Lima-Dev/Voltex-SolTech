import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@voltex/ui';
import { ENGINEERING_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { queryKeys } from '../admin/query-keys';
import { PROJECT_STATUS_LABELS } from '../engine/labels';

/** Painel do Off-Grid Designer: pedidos, projetos e revisões pendentes. */
export function OffgridDashboardPage() {
  const dash = useQuery({
    queryKey: queryKeys.offgridDashboard,
    queryFn: endpoints.offgrid.dashboard,
  });
  if (dash.isPending) return <Skeleton className="h-48 w-full" />;
  if (dash.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o painel.</p>;
  const d = dash.data;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle>Aguardando revisão</CardTitle>
          <CardDescription>Versões enviadas ao responsável técnico</CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold">{d.versionsAwaitingReview}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pedidos atrasados</CardTitle>
          <CardDescription>Prazo vencido e ainda abertos</CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold">{d.overdueRequests}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pedidos</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {Object.entries(d.requests).map(([status, count]) => (
              <li key={status}>
                {ENGINEERING_STATUS_LABELS[status as keyof typeof ENGINEERING_STATUS_LABELS] ??
                  status}
                : {count}
              </li>
            ))}
            {Object.keys(d.requests).length === 0 ? (
              <li className="text-muted-foreground">Nenhum pedido.</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Projetos</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {Object.entries(d.projects).map(([status, count]) => (
              <li key={status}>
                {PROJECT_STATUS_LABELS[status as keyof typeof PROJECT_STATUS_LABELS] ?? status}:{' '}
                {count}
              </li>
            ))}
            {Object.keys(d.projects).length === 0 ? (
              <li className="text-muted-foreground">Nenhum projeto.</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
