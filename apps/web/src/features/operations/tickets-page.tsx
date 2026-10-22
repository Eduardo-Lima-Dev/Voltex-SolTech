import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  type TicketPriority,
  type TicketStatus,
  type TicketSummaryDto,
  type TicketType,
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import {
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_VARIANT,
  TICKET_TYPE_LABELS,
} from './aftersales-labels';

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <Badge variant={TICKET_STATUS_VARIANT[status]}>{TICKET_STATUS_LABELS[status]}</Badge>;
}

/** Abre um chamado para uma planta (ou, na lista, para a planta escolhida). */
export function NewTicketDialog({
  plantId,
  open,
  onClose,
}: {
  plantId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [type, setType] = useState<TicketType>('CORRECTIVE');
  const [chosen, setChosen] = useState('');
  const plants = useQuery({
    queryKey: queryKeys.plants({ pickList: true }),
    queryFn: () => endpoints.operations.aftersales.plants.list({ pageSize: 100 }),
    enabled: open && plantId === null,
  });
  const target = plantId ?? chosen;
  const create = useMutation({
    mutationFn: () =>
      endpoints.operations.aftersales.tickets.create({
        plantId: target,
        title,
        description: description.trim() || undefined,
        priority,
        type,
      }),
    onSuccess: async () => {
      toast.success('Chamado aberto.');
      await queryClient.invalidateQueries({ queryKey: ['operations'] });
      setTitle('');
      setDescription('');
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível abrir o chamado.')),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo chamado</DialogTitle>
          <DialogDescription>
            O prazo de atendimento só aparece se a empresa o configurou para a prioridade.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {plantId === null ? (
            <div className="grid gap-1.5">
              <Label htmlFor="ticket-plant">Planta</Label>
              <NativeSelect
                id="ticket-plant"
                value={chosen}
                onChange={(e) => setChosen(e.target.value)}
              >
                <option value="">Escolha a planta</option>
                {plants.data?.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.projectCode})
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="ticket-title">Assunto</Label>
            <Input id="ticket-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ticket-description">Descrição</Label>
            <textarea
              id="ticket-description"
              className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ticket-type">Tipo</Label>
              <NativeSelect
                id="ticket-type"
                value={type}
                onChange={(e) => setType(e.target.value as TicketType)}
              >
                {TICKET_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {TICKET_TYPE_LABELS[x]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ticket-priority">Prioridade</Label>
              <NativeSelect
                id="ticket-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
              >
                {TICKET_PRIORITIES.map((x) => (
                  <option key={x} value={x}>
                    {TICKET_PRIORITY_LABELS[x]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={title.trim().length < 3 || !target || create.isPending}
            onClick={() => create.mutate()}
          >
            Abrir chamado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ficha do chamado: andamento, comentários, ordem de serviço e encerramento. */
function TicketDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const ticket = useQuery({
    queryKey: queryKeys.ticket(id),
    queryFn: () => endpoints.operations.aftersales.tickets.get(id),
  });
  const [comment, setComment] = useState('');
  const [resolution, setResolution] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['operations'] });
  const fail = (fallback: string) => (error: unknown) => toast.error(errorMessage(error, fallback));
  const addComment = useMutation({
    mutationFn: () =>
      endpoints.operations.aftersales.tickets.comment(id, { body: comment, internal: true }),
    onSuccess: async () => {
      setComment('');
      await refresh();
    },
    onError: fail('Não foi possível comentar.'),
  });
  const change = useMutation({
    mutationFn: (status: TicketStatus) =>
      endpoints.operations.aftersales.tickets.changeStatus(id, {
        status,
        resolution: status === 'RESOLVED' ? resolution : undefined,
      }),
    onSuccess: refresh,
    onError: fail('Não foi possível mudar a situação.'),
  });
  const order = useMutation({
    mutationFn: () => endpoints.operations.aftersales.tickets.workOrder(id, {}),
    onSuccess: async () => {
      toast.success('Ordem de serviço criada. Agende-a na Agenda.');
      await refresh();
    },
    onError: fail('Não foi possível criar a ordem.'),
  });
  const t = ticket.data;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t ? `${t.code} — ${t.title}` : 'Chamado'}</DialogTitle>
          <DialogDescription>
            {t ? `${t.plantName} · ${t.accountName}` : 'Carregando…'}
          </DialogDescription>
        </DialogHeader>
        {!t ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="grid gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <TicketStatusBadge status={t.status} />
              <Badge variant="outline">{TICKET_PRIORITY_LABELS[t.priority]}</Badge>
              <Badge variant="outline">{TICKET_TYPE_LABELS[t.type]}</Badge>
              {t.slaDueAt ? (
                <Badge variant={t.slaBreached ? 'red' : 'secondary'}>
                  Prazo: {formatDateTime(t.slaDueAt)}
                </Badge>
              ) : null}
            </div>
            {t.description ? <p className="whitespace-pre-wrap">{t.description}</p> : null}
            {t.resolution ? (
              <p>
                <strong>Solução:</strong> {t.resolution}
              </p>
            ) : null}
            <Can permission="ops.ticket.write">
              <div className="grid gap-2">
                {t.allowedTransitions.includes('RESOLVED') ? (
                  <Input
                    aria-label="Como foi resolvido"
                    placeholder="Como foi resolvido (obrigatório para resolver)"
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {t.allowedTransitions.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant="outline"
                      disabled={
                        change.isPending || (s === 'RESOLVED' && resolution.trim().length < 3)
                      }
                      onClick={() => change.mutate(s)}
                    >
                      Marcar como {TICKET_STATUS_LABELS[s].toLowerCase()}
                    </Button>
                  ))}
                  {!t.workOrderId ? (
                    <Button size="sm" disabled={order.isPending} onClick={() => order.mutate()}>
                      Gerar ordem de serviço
                    </Button>
                  ) : (
                    <Badge variant="secondary">Ordem de serviço criada</Badge>
                  )}
                </div>
              </div>
            </Can>
            <section aria-label="Comentários" className="grid gap-2">
              <h3 className="font-medium">Comentários</h3>
              {t.comments.length === 0 ? (
                <p className="text-muted-foreground">Nenhum comentário.</p>
              ) : (
                <ul className="space-y-2">
                  {t.comments.map((c) => (
                    <li key={c.id} className="rounded-md border p-2">
                      <div className="text-xs text-muted-foreground">
                        {c.authorName} · {formatDateTime(c.createdAt)}
                      </div>
                      {c.body}
                    </li>
                  ))}
                </ul>
              )}
              <Can permission="ops.ticket.write">
                <div className="flex gap-2">
                  <Input
                    aria-label="Novo comentário"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={!comment.trim() || addComment.isPending}
                    onClick={() => addComment.mutate()}
                  >
                    Comentar
                  </Button>
                </div>
              </Can>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TicketRows({
  tickets,
  onOpen,
}: {
  tickets: TicketSummaryDto[];
  onOpen: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Chamado</TableHead>
          <TableHead>Situação</TableHead>
          <TableHead>Prioridade</TableHead>
          <TableHead>Prazo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.map((t) => (
          <TableRow key={t.id}>
            <TableCell>
              <button
                type="button"
                className="text-left font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => onOpen(t.id)}
              >
                {t.code} — {t.title}
              </button>
              <div className="text-xs text-muted-foreground">
                {t.plantName} · {TICKET_TYPE_LABELS[t.type]}
              </div>
            </TableCell>
            <TableCell>
              <TicketStatusBadge status={t.status} />
            </TableCell>
            <TableCell className="text-sm">{TICKET_PRIORITY_LABELS[t.priority]}</TableCell>
            <TableCell className="text-sm">
              {t.slaDueAt ? (
                <span className={t.slaBreached ? 'font-medium text-destructive' : undefined}>
                  {formatDateTime(t.slaDueAt)}
                </span>
              ) : (
                '—'
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export { TicketDialog };

/** Chamados de manutenção e de pedidos dos clientes, com filtro por situação e prioridade. */
export function TicketsPage() {
  const [status, setStatus] = useState<TicketStatus | 'OPEN_ONLY' | ''>('OPEN_ONLY');
  const [priority, setPriority] = useState<TicketPriority | ''>('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const filters = {
    open: status === 'OPEN_ONLY' ? ('true' as const) : undefined,
    status: status && status !== 'OPEN_ONLY' ? status : undefined,
    priority: priority || undefined,
    search: search.trim() || undefined,
    pageSize: 50,
  };
  const list = useQuery({
    queryKey: queryKeys.tickets(filters),
    queryFn: () => endpoints.operations.aftersales.tickets.list(filters),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Chamados</CardTitle>
          <CardDescription>Corretivos, preventivos e pedidos dos clientes.</CardDescription>
        </div>
        <Can permission="ops.ticket.write">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> Novo chamado
          </Button>
        </Can>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Input
            aria-label="Buscar chamado"
            className="max-w-xs"
            placeholder="Assunto ou código"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <NativeSelect
            aria-label="Filtrar por situação"
            className="max-w-xs"
            value={status}
            onChange={(e) => setStatus(e.target.value as TicketStatus | 'OPEN_ONLY' | '')}
          >
            <option value="OPEN_ONLY">Em aberto</option>
            <option value="">Todas as situações</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TICKET_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Filtrar por prioridade"
            className="max-w-xs"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TicketPriority | '')}
          >
            <option value="">Todas as prioridades</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TICKET_PRIORITY_LABELS[p]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {list.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : list.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os chamados.</p>
        ) : list.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum chamado encontrado.</p>
        ) : (
          <TicketRows tickets={list.data.data} onOpen={setOpened} />
        )}
      </CardContent>
      <NewTicketDialog plantId={null} open={creating} onClose={() => setCreating(false)} />
      {opened ? <TicketDialog id={opened} onClose={() => setOpened(null)} /> : null}
    </Card>
  );
}
