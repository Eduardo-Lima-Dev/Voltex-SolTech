import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import {
  WORK_ORDER_TYPES,
  type InstallationDetailDto,
  type WorkOrderDto,
  type WorkOrderType,
} from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { WORK_ORDER_STATUS_LABELS, WORK_ORDER_TYPE_LABELS } from './labels';

/** `datetime-local` (hora do navegador) → ISO com fuso; vazio → nulo. */
export const toIso = (local: string): string | null =>
  local ? new Date(local).toISOString() : null;

/** ISO → valor de `datetime-local` na hora do navegador. */
export const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface OrderDialogProps {
  /** Instalação à qual a ordem pertence (nulo = ordem avulsa, como visita). */
  installationId: string | null;
  order: WorkOrderDto | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}

export function WorkOrderDialog({
  installationId,
  order,
  open,
  onClose,
  onSaved,
}: OrderDialogProps) {
  const crews = useQuery({
    queryKey: queryKeys.crews,
    queryFn: endpoints.operations.crews.list,
    enabled: open,
  });
  const [type, setType] = useState<WorkOrderType>(order?.type ?? 'INSTALLATION');
  const [title, setTitle] = useState(order?.title ?? '');
  const [crewId, setCrewId] = useState(order?.crewId ?? '');
  const [start, setStart] = useState(toLocalInput(order?.scheduledStart ?? null));
  const [end, setEnd] = useState(toLocalInput(order?.scheduledEnd ?? null));
  const save = useMutation({
    mutationFn: () =>
      order
        ? endpoints.operations.workOrders.update(order.id, {
            title,
            crewId: crewId || null,
            scheduledStart: toIso(start),
            scheduledEnd: toIso(end),
          })
        : endpoints.operations.workOrders.create({
            ...(installationId ? { installationId } : {}),
            type,
            title,
            ...(crewId ? { crewId } : {}),
            ...(start ? { scheduledStart: toIso(start) } : {}),
            ...(end ? { scheduledEnd: toIso(end) } : {}),
          }),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Não foi possível salvar a ordem de serviço.')),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{order ? 'Editar ordem de serviço' : 'Nova ordem de serviço'}</DialogTitle>
          <DialogDescription>
            Com data e equipe, a instalação passa para “equipe designada”. Choques de horário são só
            um aviso.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {!order ? (
            <div className="grid gap-1.5">
              <Label htmlFor="wo-type">Tipo</Label>
              <NativeSelect
                id="wo-type"
                value={type}
                onChange={(e) => setType(e.target.value as WorkOrderType)}
              >
                {WORK_ORDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {WORK_ORDER_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="wo-title">Título</Label>
            <Input id="wo-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wo-crew">Equipe</Label>
            <NativeSelect id="wo-crew" value={crewId} onChange={(e) => setCrewId(e.target.value)}>
              <option value="">Sem equipe</option>
              {crews.data
                ?.filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wo-start">Início</Label>
              <Input
                id="wo-start"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wo-end">Fim</Label>
              <Input
                id="wo-end"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={title.trim().length < 3 || save.isPending}
            onClick={() => save.mutate()}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  order,
  onClose,
  onDone,
}: {
  order: WorkOrderDto | null;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => endpoints.operations.workOrders.cancel(order!.id, { reason }),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível cancelar a ordem.')),
  });
  return (
    <Dialog open={order !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar ordem de serviço</DialogTitle>
          <DialogDescription>{order?.title}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="wo-cancel">Motivo</Label>
          <Input id="wo-cancel" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 3 || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancelar ordem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ordens de serviço da instalação: criar, reagendar, cancelar e acompanhar a execução. */
export function WorkOrdersSection({ installation }: { installation: InstallationDetailDto }) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.installation(installation.id) }),
      queryClient.invalidateQueries({ queryKey: ['operations', 'installations'] }),
      queryClient.invalidateQueries({ queryKey: ['operations', 'agenda'] }),
    ]);
  const [editing, setEditing] = useState<WorkOrderDto | 'new' | null>(null);
  const [cancelling, setCancelling] = useState<WorkOrderDto | null>(null);
  const closed = installation.status === 'DONE' || installation.status === 'CANCELLED';
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Ordens de serviço</CardTitle>
          <CardDescription>Instalação, comissionamento e visitas desta obra.</CardDescription>
        </div>
        <Can permission="ops.workorder.write">
          {!closed ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" /> Ordem
            </Button>
          ) : null}
        </Can>
      </CardHeader>
      <CardContent>
        {installation.workOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ordem de serviço.</p>
        ) : (
          <ul className="divide-y" aria-label="Ordens de serviço">
            {installation.workOrders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {o.title}
                    <Badge
                      variant={
                        o.status === 'DONE'
                          ? 'green'
                          : o.status === 'CANCELLED'
                            ? 'outline'
                            : 'secondary'
                      }
                    >
                      {WORK_ORDER_STATUS_LABELS[o.status]}
                    </Badge>
                    {o.conflictsWith.length > 0 ? (
                      <Badge variant="yellow">Choque de horário</Badge>
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {WORK_ORDER_TYPE_LABELS[o.type]}
                    {o.crewName ? ` · ${o.crewName}` : ''}
                    {o.scheduledStart ? ` · ${formatDateTime(o.scheduledStart)}` : ''}
                    {o.cancelReason ? ` · ${o.cancelReason}` : ''}
                  </div>
                </div>
                <Can permission="ops.workorder.write">
                  {o.status === 'PENDING' ||
                  o.status === 'SCHEDULED' ||
                  (o.status === 'IN_PROGRESS' && o.type !== 'INSTALLATION') ? (
                    <div className="flex gap-1">
                      {o.status !== 'IN_PROGRESS' ? (
                        <Button size="sm" variant="outline" onClick={() => setEditing(o)}>
                          Editar
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => setCancelling(o)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : null}
                </Can>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing !== null ? (
        <WorkOrderDialog
          key={editing === 'new' ? 'new' : editing.id}
          installationId={installation.id}
          order={editing === 'new' ? null : editing}
          open
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      ) : null}
      <CancelDialog
        key={cancelling?.id ?? 'none'}
        order={cancelling}
        onClose={() => setCancelling(null)}
        onDone={refresh}
      />
    </Card>
  );
}
