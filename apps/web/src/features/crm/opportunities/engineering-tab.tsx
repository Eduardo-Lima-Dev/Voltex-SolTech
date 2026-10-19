import { useQuery } from '@tanstack/react-query';
import { Badge, Skeleton } from '@voltex/ui';
import { queryKeys } from '@/features/admin/query-keys';
import { ENGINEERING_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { formatDateTime } from '@/lib/format';

export function EngineeringTab({ opportunityId }: { opportunityId: string }) {
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
        Solar Engine Studio (em breve).
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
              <Badge variant="secondary">{ENGINEERING_STATUS_LABELS[r.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
