import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import {
  PROJECT_STATUS_BADGE,
  PROJECT_STATUS_LABELS,
  VERSION_STATUS_BADGE,
  VERSION_STATUS_LABELS,
} from '../engine/labels';
import { OFFGRID_EVENT_LABELS, SYSTEM_TYPE_LABELS } from './labels';

/** Projeto off-grid: versões e linha do tempo. */
export function OffgridProjectPage() {
  const { id = '' } = useParams();
  const detail = useQuery({
    queryKey: queryKeys.offgridProject(id),
    queryFn: () => endpoints.offgrid.project(id),
  });
  if (detail.isPending) return <Skeleton className="h-64 w-full" />;
  if (detail.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o projeto.</p>;
  const p = detail.data;
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to="/offgrid/projetos">
          <ArrowLeft /> Projetos
        </Link>
      </Button>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>
              {p.code} · {p.name}
            </CardTitle>
            <CardDescription>{SYSTEM_TYPE_LABELS[p.systemType]}</CardDescription>
          </div>
          <Badge variant={PROJECT_STATUS_BADGE[p.status]}>{PROJECT_STATUS_LABELS[p.status]}</Badge>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {p.openRequests.map((r) => (
            <p key={r.id}>
              Pedido:{' '}
              <Link className="underline underline-offset-4" to={`/offgrid/pedidos/${r.id}`}>
                {r.title}
              </Link>
            </p>
          ))}
          {p.artNumber ? (
            <p>
              {p.artType} {p.artNumber}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Versões</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versão</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Criada</TableHead>
                <TableHead>Decisão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.versions.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      to={`/offgrid/projetos/${p.id}/versoes/${v.id}`}
                    >
                      Versão {v.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={VERSION_STATUS_BADGE[v.status]}>
                      {VERSION_STATUS_LABELS[v.status]}
                    </Badge>
                    {v.stale ? <Badge variant="yellow">desatualizada</Badge> : null}
                  </TableCell>
                  <TableCell>{formatDateTime(v.createdAt)}</TableCell>
                  <TableCell>{v.decidedAt ? formatDateTime(v.decidedAt) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linha do tempo</CardTitle>
        </CardHeader>
        <CardContent>
          {p.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda não há registros.</p>
          ) : (
            <ol className="space-y-3" aria-label="Linha do tempo">
              {p.events.map((event) => (
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
    </div>
  );
}
