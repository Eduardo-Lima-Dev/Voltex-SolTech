import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { INSTALLATION_STATUSES, type InstallationStatus } from '@voltex/shared';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
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
import { INSTALLATION_STATUS_LABELS } from './labels';
import { InstallationStatusBadge } from './status-badge';

/** Lista de instalações com filtro por situação e busca por código do projeto ou nome do cliente. */
export function InstallationsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<InstallationStatus | ''>('');
  const [search, setSearch] = useState('');
  const filters = { status: status || undefined, search: search.trim() || undefined, pageSize: 50 };
  const list = useQuery({
    queryKey: queryKeys.installations(filters),
    queryFn: () => endpoints.operations.installations.list(filters),
  });
  const reconcile = useMutation({
    mutationFn: endpoints.operations.installations.reconcile,
    onSuccess: async (r) => {
      toast.success(
        r.created > 0
          ? `${r.created} instalação(ões) criada(s) para projetos que ainda não tinham.`
          : 'Todos os projetos já têm instalação.',
      );
      await queryClient.invalidateQueries({ queryKey: ['operations'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível sincronizar.')),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Instalações</CardTitle>
          <CardDescription>
            Uma instalação nasce quando o contrato é assinado e acompanha o projeto até a entrega.
          </CardDescription>
        </div>
        <Can permission="ops.installation.write">
          <Button
            size="sm"
            variant="outline"
            disabled={reconcile.isPending}
            onClick={() => reconcile.mutate()}
          >
            Criar as que faltam
          </Button>
        </Can>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Input
            aria-label="Buscar instalação"
            className="max-w-xs"
            placeholder="Código do projeto ou cliente"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <NativeSelect
            aria-label="Filtrar por situação"
            className="max-w-xs"
            value={status}
            onChange={(e) => setStatus(e.target.value as InstallationStatus | '')}
          >
            <option value="">Todas as situações</option>
            {INSTALLATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INSTALLATION_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {list.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : list.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as instalações.</p>
        ) : list.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma instalação encontrada.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Projeto</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Próxima data</TableHead>
                <TableHead>Pendências</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.data.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link
                      to={`/operations/instalacoes/${i.id}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {i.projectCode}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {i.accountName}
                      {i.siteLabel ? ` · ${i.siteLabel}` : ''}
                    </div>
                  </TableCell>
                  <TableCell>
                    <InstallationStatusBadge status={i.status} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {i.materialsTotal === 0
                      ? '—'
                      : `${i.materialsReady} de ${i.materialsTotal} recebidos`}
                  </TableCell>
                  <TableCell className="text-sm">
                    {i.nextScheduledStart ? formatDateTime(i.nextScheduledStart) : '—'}
                  </TableCell>
                  <TableCell className="text-sm">{i.openIssues > 0 ? i.openIssues : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
