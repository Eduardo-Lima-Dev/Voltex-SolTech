import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Badge, Button, Skeleton } from '@voltex/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { queryKeys } from '@/features/admin/query-keys';
import { ENGINEERING_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { formatDateTime } from '@/lib/format';

export function EngineeringTab({ opportunityId }: { opportunityId: string }) {
  const { can } = useAuth();
  const requests = useQuery({
    queryKey: queryKeys.opportunityEngineering(opportunityId),
    queryFn: () => endpoints.opportunities.engineeringRequests(opportunityId),
  });
  if (requests.isPending) return <Skeleton className="h-16 w-full" />;
  if (requests.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar os pedidos.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Um cálculo com semáforo amarelo abre um pedido de engenharia. O atendimento acontece no
        Solar Engine Studio.
      </p>
      {requests.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum pedido de engenharia.</p>
      ) : (
        <ul className="divide-y">
          {requests.data.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"
            >
              <div>
                <div className="font-medium">{r.reason}</div>
                <div className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{ENGINEERING_STATUS_LABELS[r.status]}</Badge>
                {can('engine.project.read') && r.status !== 'CANCELLED' && r.status !== 'DONE' ? (
                  <Button asChild size="sm" variant="outline">
                    <Link to={r.projectId ? `/engine/projetos/${r.projectId}` : '/engine/pedidos'}>
                      Abrir no Studio
                    </Link>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
