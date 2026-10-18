import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { AuditLogDto } from '@voltex/shared';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
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
} from '@voltex/ui';
import { Pagination } from '@/components/pagination';
import { AUDIT_ACTION_LABELS, ENTITY_LABELS, auditActionLabel, entityLabel } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { formatDateTime, shortId } from '@/lib/format';
import { queryKeys } from '../query-keys';

const PAGE_SIZE = 15;

/** Início/fim do dia no fuso do usuário, em ISO (a API compara em UTC). */
const startOfDay = (date: string) => new Date(`${date}T00:00:00`).toISOString();
const endOfDay = (date: string) => new Date(`${date}T23:59:59.999`).toISOString();

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium">{title}</h4>
      <pre className="max-h-60 overflow-auto rounded-md border bg-muted p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function AuditPage() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLogDto | null>(null);

  const filters = { page, entity, action, from, to };
  const logs = useQuery({
    queryKey: queryKeys.audit(filters),
    queryFn: () =>
      endpoints.audit.list({
        page,
        pageSize: PAGE_SIZE,
        entity: entity || undefined,
        action: action || undefined,
        from: from ? startOfDay(from) : undefined,
        to: to ? endOfDay(to) : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  // Nomes dos autores: reaproveita a lista de usuários (cache compartilhado com a tela de usuários).
  const people = useQuery({
    queryKey: queryKeys.users({ lookup: true }),
    queryFn: () => endpoints.users.list({ page: 1, pageSize: 100 }),
    staleTime: 60_000,
  });
  const names = useMemo(
    () => new Map(people.data?.data.map((u) => [u.id, u.name]) ?? []),
    [people.data],
  );
  const actorName = (id: string | null) =>
    id ? (names.get(id) ?? `Usuário ${shortId(id)}`) : 'Sistema';

  const change =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auditoria</CardTitle>
        <CardDescription>
          Registro imutável das ações importantes feitas na plataforma.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="audit-entity">Tipo</Label>
            <NativeSelect
              id="audit-entity"
              value={entity}
              onChange={(e) => change(setEntity)(e.target.value)}
            >
              <option value="">Todos</option>
              {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-action">Ação</Label>
            <NativeSelect
              id="audit-action"
              value={action}
              onChange={(e) => change(setAction)(e.target.value)}
            >
              <option value="">Todas</option>
              {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-from">De</Label>
            <Input
              id="audit-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => change(setFrom)(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-to">Até</Label>
            <Input
              id="audit-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => change(setTo)(e.target.value)}
            />
          </div>
        </div>

        {logs.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : logs.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar a auditoria.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Quem</TableHead>
                  <TableHead>O quê</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Detalhes</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Nenhum registro encontrado com esses filtros.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.data.data.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </TableCell>
                      <TableCell>{actorName(log.actorId)}</TableCell>
                      <TableCell className="font-medium">{auditActionLabel(log.action)}</TableCell>
                      <TableCell>{entityLabel(log.entity)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelected(log)}
                          aria-label={`Ver detalhes de ${auditActionLabel(log.action)}`}
                        >
                          Detalhes
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <Pagination
              page={logs.data.meta.page}
              pageSize={logs.data.meta.pageSize}
              total={logs.data.meta.total}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{auditActionLabel(selected.action)}</DialogTitle>
                <DialogDescription>
                  {formatDateTime(selected.createdAt)} · {actorName(selected.actorId)}
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Tipo</dt>
                <dd>{entityLabel(selected.entity)}</dd>
                <dt className="text-muted-foreground">Registro</dt>
                <dd className="break-all font-mono text-xs">{selected.entityId ?? '—'}</dd>
                <dt className="text-muted-foreground">IP</dt>
                <dd>{selected.ip ?? '—'}</dd>
                <dt className="text-muted-foreground">Requisição</dt>
                <dd className="break-all font-mono text-xs">{selected.requestId ?? '—'}</dd>
              </dl>
              <JsonBlock title="Antes" value={selected.before} />
              <JsonBlock title="Depois" value={selected.after} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
