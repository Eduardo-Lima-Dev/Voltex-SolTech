import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@voltex/ui';
import { ProjectStatus } from '@voltex/shared';
import { Pagination } from '@/components/pagination';
import { queryKeys } from '@/features/admin/query-keys';
import { PROJECT_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { formatCents } from '@/lib/format';

export const PROJECT_STATUS_BADGE = {
  DOCUMENTATION: 'secondary',
  SUBMITTED: 'default',
  INSPECTION: 'yellow',
  APPROVED: 'green',
  CANCELLED: 'outline',
} as const;

export function ProjectsPage() {
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const filters = { status, search, page };
  const projects = useQuery({
    queryKey: queryKeys.projects(filters),
    queryFn: () =>
      endpoints.projects.list({
        status: (status || undefined) as ProjectStatus | undefined,
        search: search.trim() || undefined,
        page,
        pageSize: 20,
      }),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Cada contrato assinado vira um projeto, com o mesmo Project ID, para acompanhar a
        homologação na distribuidora.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Buscar projeto"
          placeholder="Buscar por cliente, título ou Project ID"
          className="max-w-xs"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <div role="group" aria-label="Situação" className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={status === '' ? 'default' : 'outline'}
            aria-pressed={status === ''}
            onClick={() => setStatus('')}
          >
            Todos
          </Button>
          {Object.values(ProjectStatus).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? 'default' : 'outline'}
              aria-pressed={status === s}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
            >
              {PROJECT_STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
      </div>

      {projects.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : projects.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os projetos.</p>
      ) : projects.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum projeto encontrado.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Projeto</TableHead>
                <TableHead>Concessionária</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead className="text-right">Pendências</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.data.data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link className="font-medium hover:underline" to={`/crm/projetos/${p.id}`}>
                      {p.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {p.accountName} · <span className="font-mono">{p.projectCode}</span>
                    </div>
                  </TableCell>
                  <TableCell>{p.distributorName ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={PROJECT_STATUS_BADGE[p.status]}>
                        {PROJECT_STATUS_LABELS[p.status]}
                      </Badge>
                      {p.overdue ? <Badge variant="red">Prazo vencido</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>{p.responsibleName ?? '—'}</TableCell>
                  <TableCell className="text-right">{p.pendingRequired}</TableCell>
                  <TableCell className="text-right">{formatCents(p.valueCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={projects.data.meta.page}
            pageSize={projects.data.meta.pageSize}
            total={projects.data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
