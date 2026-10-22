import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { WorkOrderDto } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  NativeSelect,
  Skeleton,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { queryKeys } from '../admin/query-keys';
import { WORK_ORDER_STATUS_LABELS, WORK_ORDER_TYPE_LABELS } from './labels';
import { WorkOrderDialog } from './work-orders-section';

const DAY = 86_400_000;

const startOfWeek = (base: Date): Date => {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
};

const dayFormat = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
});
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Agenda da semana, por dia, com filtro por equipe. Choques de horário aparecem como aviso. */
export function AgendaPage() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [crewId, setCrewId] = useState('');
  const [creating, setCreating] = useState(false);
  const from = weekStart.toISOString();
  const to = new Date(weekStart.getTime() + 7 * DAY - 1).toISOString();
  const filters = { from, to, crewId: crewId || undefined };
  const crews = useQuery({ queryKey: queryKeys.crews, queryFn: endpoints.operations.crews.list });
  const agenda = useQuery({
    queryKey: queryKeys.agenda(filters),
    queryFn: () => endpoints.operations.agenda(filters),
  });
  const orders = agenda.data?.orders;
  const days = useMemo(() => {
    const byDay = new Map<number, WorkOrderDto[]>();
    for (const order of orders ?? []) {
      const d = new Date(order.scheduledStart!);
      d.setHours(0, 0, 0, 0);
      byDay.set(d.getTime(), [...(byDay.get(d.getTime()) ?? []), order]);
    }
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(weekStart.getTime() + i * DAY);
      return { day, orders: byDay.get(day.getTime()) ?? [] };
    });
  }, [orders, weekStart]);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Agenda</CardTitle>
          <CardDescription>
            Ordens de serviço agendadas, da semana de {weekStart.toLocaleDateString('pt-BR')}.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label="Filtrar por equipe"
            value={crewId}
            onChange={(e) => setCrewId(e.target.value)}
          >
            <option value="">Todas as equipes</option>
            {crews.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            size="icon"
            variant="outline"
            aria-label="Semana anterior"
            onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Hoje
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Próxima semana"
            onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Can permission="ops.workorder.write">
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" /> Ordem avulsa
            </Button>
          </Can>
        </div>
      </CardHeader>
      <CardContent>
        {agenda.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : agenda.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar a agenda.</p>
        ) : (
          <ol className="divide-y" aria-label="Dias da semana">
            {days.map(({ day, orders }) => (
              <li key={day.getTime()} className="py-3">
                <h3 className="text-sm font-semibold capitalize">{dayFormat.format(day)}</h3>
                {orders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem ordens.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {orders.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="tabular-nums text-muted-foreground">
                          {timeFormat.format(new Date(o.scheduledStart!))}
                        </span>
                        {o.installationId ? (
                          <Link
                            to={`/operations/instalacoes/${o.installationId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {o.title}
                          </Link>
                        ) : (
                          <span className="font-medium">{o.title}</span>
                        )}
                        <span className="text-muted-foreground">
                          {WORK_ORDER_TYPE_LABELS[o.type]}
                          {o.crewName ? ` · ${o.crewName}` : ''}
                          {o.accountName ? ` · ${o.accountName}` : ''}
                        </span>
                        <Badge variant="secondary">{WORK_ORDER_STATUS_LABELS[o.status]}</Badge>
                        {o.conflictsWith.length > 0 ? (
                          <Badge variant="yellow">Choque de horário</Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
      {creating ? (
        <WorkOrderDialog
          installationId={null}
          order={null}
          open
          onClose={() => setCreating(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['operations', 'agenda'] })}
        />
      ) : null}
    </Card>
  );
}
