import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { InstallationStatus } from '@voltex/shared';
import {
  Button,
  Card,
  CardContent,
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
  Skeleton,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { IssuesSection } from './issues-section';
import { INSTALLATION_STATUS_LABELS, needsReason } from './labels';
import { MaterialsSection } from './materials-section';
import { InstallationStatusBadge } from './status-badge';
import { WorkOrdersSection } from './work-orders-section';

/** Passos feitos pelo sistema (ordens de serviço, materiais, pendências): não aparecem como botão manual. */
const MANUAL_HIDDEN: readonly InstallationStatus[] = [
  'MATERIAL_READY',
  'SCHEDULING',
  'CREW_ASSIGNED',
  'FIELD_ISSUE',
];

function StatusDialog({
  from,
  to,
  onClose,
  onConfirm,
  pending,
}: {
  from: InstallationStatus;
  to: InstallationStatus | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState('');
  const required = to !== null && needsReason(from, to);
  return (
    <Dialog open={to !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{to ? `Mudar para “${INSTALLATION_STATUS_LABELS[to]}”` : ''}</DialogTitle>
          <DialogDescription>
            {required
              ? 'Informe o motivo: voltar uma etapa ou cancelar fica registrado no histórico.'
              : 'A mudança fica registrada no histórico da instalação.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="status-reason">Motivo{required ? '' : ' (opcional)'}</Label>
          <Input id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant={to === 'CANCELLED' ? 'destructive' : 'default'}
            disabled={pending || (required && reason.trim().length < 3)}
            onClick={() => onConfirm(reason.trim())}
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ficha da instalação: situação, materiais, ordens de serviço, pendências de campo e histórico. */
export function InstallationPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: queryKeys.installation(id),
    queryFn: () => endpoints.operations.installations.get(id),
  });
  const [target, setTarget] = useState<InstallationStatus | null>(null);
  const change = useMutation({
    mutationFn: ({ status, reason }: { status: InstallationStatus; reason: string }) =>
      endpoints.operations.installations.changeStatus(id, {
        status,
        ...(reason ? { reason } : {}),
      }),
    onSuccess: async () => {
      setTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.installation(id) }),
        queryClient.invalidateQueries({ queryKey: ['operations', 'installations'] }),
      ]);
    },
    onError: (error) => {
      setTarget(null);
      toast.error(errorMessage(error, 'Não foi possível mudar a situação.'));
      if (isApiError(error))
        void queryClient.invalidateQueries({ queryKey: queryKeys.installation(id) });
    },
  });

  if (detail.isPending) return <Skeleton className="h-64 w-full" />;
  if (detail.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar a instalação.</p>;
  const inst = detail.data;
  const actions = inst.allowedTransitions.filter(
    (s) => s === 'CANCELLED' || !MANUAL_HIDDEN.includes(s),
  );

  return (
    <div className="space-y-6">
      <Link
        to="/operations/instalacoes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Instalações
      </Link>
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-xl">{inst.projectCode}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {inst.accountName}
              {inst.siteLabel ? ` · ${inst.siteLabel}` : ''}
            </p>
            <InstallationStatusBadge status={inst.status} />
          </div>
          <Can permission="ops.installation.write">
            <div className="flex flex-wrap gap-2" aria-label="Mudar situação">
              {actions.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === 'CANCELLED' ? 'ghost' : 'outline'}
                  disabled={change.isPending}
                  onClick={() => setTarget(s)}
                >
                  {s === 'CANCELLED'
                    ? 'Cancelar instalação'
                    : `Ir para: ${INSTALLATION_STATUS_LABELS[s]}`}
                </Button>
              ))}
            </div>
          </Can>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Homologação: {inst.projectStatus === 'APPROVED' ? 'aprovada' : 'em andamento'}
          {inst.cancelReason ? ` · cancelada: ${inst.cancelReason}` : ''}
        </CardContent>
      </Card>

      <MaterialsSection installation={inst} />
      <WorkOrdersSection installation={inst} />
      <IssuesSection installation={inst} />

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm" aria-label="Histórico da instalação">
            {inst.history.map((h) => (
              <li key={h.id}>
                <span className="font-medium">
                  {h.fromStatus ? `${INSTALLATION_STATUS_LABELS[h.fromStatus]} → ` : ''}
                  {INSTALLATION_STATUS_LABELS[h.toStatus]}
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  · {formatDateTime(h.createdAt)}
                  {h.actorId ? '' : ' · automático'}
                  {h.reason ? ` · ${h.reason}` : ''}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <StatusDialog
        key={target ?? 'none'}
        from={inst.status}
        to={target}
        pending={change.isPending}
        onClose={() => setTarget(null)}
        onConfirm={(reason) => target && change.mutate({ status: target, reason })}
      />
    </div>
  );
}
