import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { OFFGRID_SYSTEM_TYPES, type OffgridSystemType } from '@voltex/shared';
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
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { PRIORITY_BADGE, PRIORITY_LABELS, REQUEST_STATUS_BADGE } from '../engine/request-ui';
import { SYSTEM_TYPE_LABELS } from './labels';

function NewRequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [systemType, setSystemType] = useState<OffgridSystemType>('OFFGRID');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      endpoints.offgrid.createRequest({
        title: title.trim(),
        systemType,
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: async (request) => {
      toast.success('Pedido criado.');
      onOpenChange(false);
      setTitle('');
      setDescription('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.offgridRequests() });
      void navigate(`/offgrid/pedidos/${request.id}`);
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível criar o pedido.')),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo pedido off-grid</DialogTitle>
          <DialogDescription>
            Sítio sem rede, casa de campo, bomba, telecom ou sistema híbrido com bateria. O pedido
            tem fila e projeto próprios.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="og-title">Título</Label>
            <Input id="og-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="og-type">Tipo de sistema</Label>
            <NativeSelect
              id="og-type"
              value={systemType}
              onChange={(e) => setSystemType(e.target.value as OffgridSystemType)}
            >
              {OFFGRID_SYSTEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SYSTEM_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="og-desc">Descrição (opcional)</Label>
            <Input
              id="og-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={create.isPending}
            onClick={() => {
              if (title.trim().length < 3) return setError('Informe um título.');
              setError(null);
              create.mutate();
            }}
          >
            {create.isPending ? <Spinner /> : null} Criar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_FILTERS = [
  '',
  'PENDING',
  'IN_PROGRESS',
  'WAITING_VISIT',
  'WAITING_INFO',
  'IN_REVIEW',
  'DONE',
  'CANCELLED',
] as const;

/** Fila de pedidos do Off-Grid Designer. */
export function OffgridRequestsPage() {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('');
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(false);
  const filters = { ...(status ? { status } : {}), ...(mine ? { mine: true } : {}) };
  const list = useQuery({
    queryKey: queryKeys.offgridRequests(filters),
    queryFn: () => endpoints.offgrid.requests(filters),
  });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Pedidos off-grid</CardTitle>
            <CardDescription>
              Sistemas isolados e híbridos: fila própria da engenharia.
            </CardDescription>
          </div>
          <Can permission="offgrid.project.write">
            <Button onClick={() => setCreating(true)}>
              <Plus /> Novo pedido
            </Button>
          </Can>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1">
              <Label htmlFor="og-status">Estado</Label>
              <NativeSelect
                id="og-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="">Todos</option>
                {STATUS_FILTERS.filter(Boolean).map((s) => (
                  <option key={s} value={s}>
                    {ENGINEERING_STATUS_LABELS[s as keyof typeof ENGINEERING_STATUS_LABELS]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              Só os meus
            </label>
          </div>
          {list.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : list.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar os pedidos.</p>
          ) : list.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido encontrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Criado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        to={`/offgrid/pedidos/${r.id}`}
                      >
                        {r.title}
                      </Link>
                    </TableCell>
                    <TableCell>{SYSTEM_TYPE_LABELS[r.systemType]}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          REQUEST_STATUS_BADGE[r.status as keyof typeof REQUEST_STATUS_BADGE]
                        }
                      >
                        {
                          ENGINEERING_STATUS_LABELS[
                            r.status as keyof typeof ENGINEERING_STATUS_LABELS
                          ]
                        }
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={PRIORITY_BADGE[r.priority as keyof typeof PRIORITY_BADGE]}>
                        {PRIORITY_LABELS[r.priority as keyof typeof PRIORITY_LABELS]}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.assigneeName ?? '—'}</TableCell>
                    <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <NewRequestDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
