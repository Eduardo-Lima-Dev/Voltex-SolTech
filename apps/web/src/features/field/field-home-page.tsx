import { CalendarClock, MapPin } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Card, CardContent, Button } from '@voltex/ui';
import { formatDateTime } from '@/lib/format';
import type { FieldViewOrder } from './field-engine';
import { useField } from './field-provider';
import { WORK_ORDER_STATUS_LABELS, WORK_ORDER_TYPE_LABELS } from '../operations/labels';

function OrderCard({ order }: { order: FieldViewOrder }) {
  const waiting =
    order.pendingActions + order.pendingPhotos.length + (order.pendingSignature ? 1 : 0);
  return (
    <li>
      <Link
        to={`/campo/${order.id}`}
        className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{order.title}</div>
              <Badge variant={order.status === 'IN_PROGRESS' ? 'green' : 'secondary'}>
                {WORK_ORDER_STATUS_LABELS[order.status]}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              {WORK_ORDER_TYPE_LABELS[order.type]}
              {order.accountName ? ` · ${order.accountName}` : ''}
            </div>
            {order.scheduledStart ? (
              <div className="flex items-center gap-1 text-sm">
                <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
                {formatDateTime(order.scheduledStart)}
              </div>
            ) : null}
            {order.address ? (
              <div className="flex items-start gap-1 text-sm">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {order.address}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1">
              {waiting > 0 ? <Badge variant="yellow">{waiting} p/ enviar</Badge> : null}
              {order.rejectedActions.length + order.rejectedFiles.length > 0 ? (
                <Badge variant="red">Recusado pelo sistema</Badge>
              ) : null}
              {order.openIssues.length > 0 ? (
                <Badge variant="red">{order.openIssues.length} pendência(s)</Badge>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}

/** Ordens de serviço do técnico: em execução primeiro, depois as agendadas por data. */
export function FieldHomePage() {
  const { engine, state } = useField();
  const running = state.orders.filter((o) => o.status === 'IN_PROGRESS');
  const scheduled = state.orders.filter((o) => o.status !== 'IN_PROGRESS');
  return (
    <div className="space-y-6">
      <section aria-labelledby="field-running" className="space-y-2">
        <h2
          id="field-running"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Em execução
        </h2>
        {running.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ordem em execução.</p>
        ) : (
          <ul className="space-y-3" aria-label="Ordens em execução">
            {running.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="field-scheduled" className="space-y-2">
        <h2
          id="field-scheduled"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Agendadas
        </h2>
        {scheduled.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {state.lastSyncAt
              ? 'Nenhuma ordem agendada para você. Ordens aparecem aqui quando o escritório agenda uma equipe com você ou escala você diretamente.'
              : 'Conecte-se à internet uma vez para baixar as suas ordens.'}
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Ordens agendadas">
            {scheduled.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </ul>
        )}
      </section>
      {state.pending === 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (
              window.confirm(
                'Apagar do aparelho as ordens baixadas e o perfil? Você precisará de internet para baixá-las de novo.',
              )
            )
              void engine.clearDevice();
          }}
        >
          Limpar dados deste aparelho
        </Button>
      ) : null}
    </div>
  );
}
