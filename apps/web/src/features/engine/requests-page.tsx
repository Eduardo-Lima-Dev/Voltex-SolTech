import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { EngineeringRequestListItemDto } from '@voltex/shared';
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
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { ENGINEERING_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import {
  PRIORITY_BADGE,
  PRIORITY_LABELS,
  REQUEST_STATUS_BADGE as STATUS_BADGE,
} from './request-ui';

/** Pede as coordenadas quando a oportunidade não tem o local cadastrado. */
function CoordinatesDialog({
  request,
  onClose,
  onSubmit,
  pending,
}: {
  request: EngineeringRequestListItemDto | null;
  onClose: () => void;
  onSubmit: (latitude: number, longitude: number) => void;
  pending: boolean;
}) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [error, setError] = useState<string | null>(null);
  const parse = (raw: string) =>
    raw.trim() === '' ? Number.NaN : Number(raw.trim().replace(',', '.'));
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Local do projeto</DialogTitle>
          <DialogDescription>
            A oportunidade {request?.projectCode} não tem as coordenadas do local. Informe a
            latitude e a longitude (em graus decimais; o Brasil tem latitude e longitude negativas).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="req-lat">Latitude</Label>
            <Input
              id="req-lat"
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="-15,78"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="req-lng">Longitude</Label>
            <Input
              id="req-lng"
              inputMode="decimal"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="-47,93"
            />
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => {
              const la = parse(lat);
              const lo = parse(lng);
              if (!Number.isFinite(la) || la < -90 || la > 90)
                return setError('Latitude inválida (−90 a 90).');
              if (!Number.isFinite(lo) || lo < -180 || lo > 180)
                return setError('Longitude inválida (−180 a 180).');
              setError(null);
              onSubmit(la, lo);
            }}
          >
            {pending ? <Spinner /> : null}
            Abrir o projeto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RequestsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState<EngineeringRequestListItemDto['status'] | ''>('PENDING');
  const [mine, setMine] = useState(false);
  const [needsCoordinates, setNeedsCoordinates] = useState<EngineeringRequestListItemDto | null>(
    null,
  );
  const [cancelling, setCancelling] = useState<EngineeringRequestListItemDto | null>(null);
  const [reason, setReason] = useState('');

  const filters = { ...(status ? { status } : {}), ...(mine ? { mine: true } : {}) };
  const requests = useQuery({
    queryKey: queryKeys.engineeringRequests(filters),
    queryFn: () => endpoints.engineering.requests(filters),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.engineeringRequests() });

  const open = useMutation({
    mutationFn: ({
      request,
      coords,
    }: {
      request: EngineeringRequestListItemDto;
      coords?: { latitude: number; longitude: number };
    }) => endpoints.engineering.fromRequest(request.id, coords),
    onSuccess: async (project) => {
      toast.success(`Projeto ${project.code} aberto.`);
      await refresh();
      const version = project.versions[0];
      void navigate(
        version
          ? `/engine/projetos/${project.id}/versoes/${version.id}`
          : `/engine/projetos/${project.id}`,
      );
    },
    onError: (error, { request }) => {
      if (isApiError(error) && error.code === 'SITE_COORDINATES_MISSING')
        setNeedsCoordinates(request);
      else toast.error(errorMessage(error, 'Não foi possível abrir o projeto.'));
    },
  });
  const assign = useMutation({
    mutationFn: (id: string) => endpoints.engineering.assign(id),
    onSuccess: async () => {
      toast.success('Pedido atribuído a você.');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível pegar o pedido.')),
  });
  const cancel = useMutation({
    mutationFn: () =>
      endpoints.engineering.cancelRequest(
        (cancelling as EngineeringRequestListItemDto).id,
        reason.trim(),
      ),
    onSuccess: async () => {
      toast.success('Pedido cancelado.');
      setCancelling(null);
      setReason('');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível cancelar o pedido.')),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Pedidos de engenharia</CardTitle>
          <CardDescription>
            Cálculos com semáforo amarelo no CRM chegam aqui. Pegue um pedido para abrir o projeto
            com os dados da oportunidade.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <NativeSelect
            aria-label="Filtrar por situação"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="PENDING">Aguardando</option>
            <option value="IN_PROGRESS">Em andamento</option>
            <option value="WAITING_VISIT">Aguardando visita</option>
            <option value="WAITING_INFO">Aguardando informação</option>
            <option value="IN_REVIEW">Em revisão</option>
            <option value="DONE">Concluídos</option>
            <option value="CANCELLED">Cancelados</option>
            <option value="">Todos</option>
          </NativeSelect>
          <Label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Só
            os meus
          </Label>
        </div>
      </CardHeader>
      <CardContent>
        {requests.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : requests.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os pedidos.</p>
        ) : requests.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pedido por aqui.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Oportunidade</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Prioridade e prazo</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.data.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="max-w-xs">
                    <div className="font-medium">
                      {request.customerName ?? request.opportunityTitle}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {request.projectCode} · {formatDateTime(request.createdAt)}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-sm text-sm text-muted-foreground">
                    {request.reason}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[request.status]}>
                      {ENGINEERING_STATUS_LABELS[request.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant={PRIORITY_BADGE[request.priority]}>
                      {PRIORITY_LABELS[request.priority]}
                    </Badge>
                    {request.dueAt ? (
                      <div
                        className={request.overdue ? 'text-destructive' : 'text-muted-foreground'}
                      >
                        {request.overdue ? 'Atrasado · ' : 'até '}
                        {formatDateTime(request.dueAt)}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {request.assigneeName ?? '—'}
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/engine/pedidos/${request.id}`}>Ver pedido</Link>
                    </Button>
                    {request.projectId ? (
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/engine/projetos/${request.projectId}`}>Abrir projeto</Link>
                      </Button>
                    ) : null}
                    <Can permission="engine.project.write">
                      {request.status === 'PENDING' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={assign.isPending}
                          onClick={() => assign.mutate(request.id)}
                        >
                          Pegar pedido
                        </Button>
                      ) : null}
                      {['PENDING', 'IN_PROGRESS', 'WAITING_VISIT', 'WAITING_INFO'].includes(
                        request.status,
                      ) && !request.projectId ? (
                        <Button
                          size="sm"
                          disabled={open.isPending}
                          onClick={() => open.mutate({ request })}
                        >
                          Abrir projeto
                        </Button>
                      ) : null}
                      {!['DONE', 'CANCELLED'].includes(request.status) ? (
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(request)}>
                          Cancelar
                        </Button>
                      ) : null}
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CoordinatesDialog
        request={needsCoordinates}
        pending={open.isPending}
        onClose={() => setNeedsCoordinates(null)}
        onSubmit={(latitude, longitude) => {
          const request = needsCoordinates as EngineeringRequestListItemDto;
          setNeedsCoordinates(null);
          open.mutate({ request, coords: { latitude, longitude } });
        }}
      />
      <Dialog open={cancelling !== null} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar o pedido?</DialogTitle>
            <DialogDescription>O motivo fica registrado no pedido.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cancel-reason">Motivo</Label>
            <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancelar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
