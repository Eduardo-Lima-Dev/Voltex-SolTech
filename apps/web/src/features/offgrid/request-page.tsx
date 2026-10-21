import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  Spinner,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { ENGINEERING_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { PRIORITY_BADGE, PRIORITY_LABELS, REQUEST_STATUS_BADGE } from '../engine/request-ui';
import { OFFGRID_EVENT_LABELS, SYSTEM_TYPE_LABELS } from './labels';
import { NewProjectDialog } from './projects-page';

const NEXT: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_VISIT', 'WAITING_INFO', 'IN_REVIEW', 'CANCELLED'],
  WAITING_VISIT: ['IN_PROGRESS', 'CANCELLED'],
  WAITING_INFO: ['IN_PROGRESS', 'CANCELLED'],
  IN_REVIEW: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

/** Pedido off-grid: andamento, histórico e abertura do projeto. */
export function OffgridRequestPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [creating, setCreating] = useState(false);

  const detail = useQuery({
    queryKey: queryKeys.offgridRequest(id),
    queryFn: () => endpoints.offgrid.request(id),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.offgridRequest(id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.offgridRequests() });
  };
  const change = useMutation({
    mutationFn: (input: Parameters<typeof endpoints.offgrid.changeRequest>[1]) =>
      endpoints.offgrid.changeRequest(id, input),
    onSuccess: async () => {
      setTarget(null);
      setNote('');
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível salvar.')),
  });
  const addComment = useMutation({
    mutationFn: () => endpoints.offgrid.commentRequest(id, comment.trim()),
    onSuccess: async () => {
      setComment('');
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível comentar.')),
  });

  if (detail.isPending) return <Skeleton className="h-64 w-full" />;
  if (detail.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o pedido.</p>;
  const r = detail.data;
  const closed = r.status === 'DONE' || r.status === 'CANCELLED';

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to="/offgrid/pedidos">
          <ArrowLeft /> Pedidos
        </Link>
      </Button>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{r.title}</CardTitle>
            <CardDescription>
              {SYSTEM_TYPE_LABELS[r.systemType]} · criado em {formatDateTime(r.createdAt)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={REQUEST_STATUS_BADGE[r.status as keyof typeof REQUEST_STATUS_BADGE]}>
              {ENGINEERING_STATUS_LABELS[r.status as keyof typeof ENGINEERING_STATUS_LABELS]}
            </Badge>
            <Badge variant={PRIORITY_BADGE[r.priority as keyof typeof PRIORITY_BADGE]}>
              {PRIORITY_LABELS[r.priority as keyof typeof PRIORITY_LABELS]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {r.description ? <p className="text-sm">{r.description}</p> : null}
          <p className="text-sm text-muted-foreground">
            Responsável: {r.assigneeName ?? 'ninguém'}
            {r.dueAt ? ` · prazo ${formatDateTime(r.dueAt)}` : ''}
          </p>
          <Can permission="offgrid.project.write">
            <div className="flex flex-wrap gap-2">
              {r.project ? (
                <Button asChild>
                  <Link to={`/offgrid/projetos/${r.project.id}`}>
                    Abrir projeto {r.project.code}
                  </Link>
                </Button>
              ) : !closed ? (
                <Button onClick={() => setCreating(true)}>Criar projeto</Button>
              ) : null}
              {(NEXT[r.status] ?? []).map((status) => (
                <Button key={status} variant="outline" onClick={() => setTarget(status)}>
                  {ENGINEERING_STATUS_LABELS[status as keyof typeof ENGINEERING_STATUS_LABELS]}
                </Button>
              ))}
              {!closed ? (
                <>
                  <NativeSelect
                    aria-label="Prioridade"
                    className="w-40"
                    value={r.priority}
                    onChange={(e) =>
                      change.mutate({
                        priority: e.target.value as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
                      })
                    }
                  >
                    {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                </>
              ) : null}
            </div>
          </Can>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linha do tempo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Can permission="offgrid.project.write">
            <div className="flex gap-2">
              <Input
                aria-label="Comentário"
                placeholder="Escreva um comentário"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <Button
                disabled={!comment.trim() || addComment.isPending}
                onClick={() => addComment.mutate()}
              >
                Comentar
              </Button>
            </div>
          </Can>
          {r.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda não há registros.</p>
          ) : (
            <ol className="space-y-3" aria-label="Linha do tempo">
              {r.events.map((event) => (
                <li key={event.id} className="flex gap-3 text-sm">
                  <Badge variant="outline" className="h-fit">
                    {OFFGRID_EVENT_LABELS[event.type] ?? event.type}
                  </Badge>
                  <div>
                    <p>{event.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.actorName ?? 'Sistema'} · {formatDateTime(event.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mudar para “
              {
                ENGINEERING_STATUS_LABELS[
                  (target ?? 'PENDING') as keyof typeof ENGINEERING_STATUS_LABELS
                ]
              }
              ”
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="og-note">
              {target === 'CANCELLED' ? 'Motivo' : 'Observação (opcional)'}
            </Label>
            <Input id="og-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Voltar
            </Button>
            <Button
              disabled={change.isPending || (target === 'CANCELLED' && note.trim().length < 3)}
              onClick={() =>
                change.mutate({
                  status: target as 'IN_PROGRESS',
                  ...(note.trim() ? { note: note.trim() } : {}),
                })
              }
            >
              {change.isPending ? <Spinner /> : null} Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        requestId={r.id}
        systemType={r.systemType}
        defaultName={r.title}
        onCreated={(project) => {
          const version = project.versions[0];
          void navigate(
            version
              ? `/offgrid/projetos/${project.id}/versoes/${version.id}`
              : `/offgrid/projetos/${project.id}`,
          );
        }}
      />
    </div>
  );
}
