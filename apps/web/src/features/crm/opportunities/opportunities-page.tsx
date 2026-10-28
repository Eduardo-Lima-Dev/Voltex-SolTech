import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LayoutGrid, List, Plus, Search, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { OpportunityStage } from '@voltex/shared';
import { OpportunityStatus } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  NativeSelect,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { Pagination } from '@/components/pagination';
import { queryKeys } from '@/features/admin/query-keys';
import { useAuth } from '@/features/auth/auth-provider';
import { usePortfolioScope } from '@/features/auth/portfolio';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { OPPORTUNITY_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { formatDate } from '@/lib/format';
import { ConfigureStagesDialog } from './configure-stages-dialog';
import { KanbanBoard } from './kanban';
import { NewOpportunityDialog } from './new-opportunity-dialog';
import { stageName } from './stage-change';

const PAGE_SIZE = 10;
const VIEW_KEY = 'voltex:crm-opportunities-view';
type View = 'board' | 'list';

const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
};

interface Filters {
  search: string;
  status: '' | OpportunityStatus;
  ownerId: string | undefined;
}

function ListView({ search, status, ownerId }: Filters) {
  const stages = useQuery({ queryKey: queryKeys.pipeline, queryFn: endpoints.pipeline.list });
  const [stage, setStage] = useState<'' | OpportunityStage>('');
  const [noTask, setNoTask] = useState(false);
  const [page, setPage] = useState(1);

  const filters = { page, search, stage, status, noTask, ownerId };
  const list = useQuery({
    queryKey: queryKeys.opportunities(filters),
    queryFn: () =>
      endpoints.opportunities.list({
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        stage: stage || undefined,
        status: status || undefined,
        withoutNextTask: noTask ? true : undefined,
        ownerId,
      }),
    placeholderData: keepPreviousData,
  });
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:max-w-xl">
          <NativeSelect
            aria-label="Filtrar por etapa"
            value={stage}
            onChange={(e) => reset(setStage)(e.target.value as '' | OpportunityStage)}
          >
            <option value="">Todas as etapas</option>
            {stages.data?.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Filtrar por tarefa"
            value={noTask ? 'none' : ''}
            onChange={(e) => reset(setNoTask)(e.target.value === 'none')}
          >
            <option value="">Com ou sem tarefa</option>
            <option value="none">Sem próxima tarefa</option>
          </NativeSelect>
        </div>
        {list.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : list.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as oportunidades.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Oportunidade</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Próxima tarefa</TableHead>
                  <TableHead>Atualizada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Nenhuma oportunidade encontrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  list.data.data.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link
                          to={`/crm/oportunidades/${o.id}`}
                          className="font-medium hover:underline"
                        >
                          {o.title}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {o.accountName} · <span className="font-mono">{o.projectCode}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            o.status === 'WON'
                              ? 'green'
                              : o.status === 'LOST'
                                ? 'outline'
                                : 'secondary'
                          }
                        >
                          {stageName(stages.data, o.stage)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{o.ownerName ?? '—'}</TableCell>
                      <TableCell>
                        {o.status !== 'OPEN' ? (
                          '—'
                        ) : o.openTaskCount === 0 ? (
                          <Badge variant="yellow">Sem próxima tarefa</Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            {formatDate(o.nextTaskDueAt as string)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(o.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <Pagination
              page={list.data.meta.page}
              pageSize={list.data.meta.pageSize}
              total={list.data.meta.total}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BoardView({ search, status, ownerId }: Filters) {
  const stages = useQuery({ queryKey: queryKeys.pipeline, queryFn: endpoints.pipeline.list });
  const filters = {
    ownerId,
    search: search || undefined,
    status: status || undefined,
  };
  const board = useQuery({
    queryKey: queryKeys.opportunityBoard(filters),
    queryFn: () => endpoints.opportunities.board(filters),
    placeholderData: keepPreviousData,
  });

  if (board.isPending || stages.isPending)
    return (
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-64 w-60 shrink-0" />
        ))}
      </div>
    );
  if (board.isError || stages.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o quadro.</p>;
  return <KanbanBoard columns={board.data.columns} stages={stages.data} />;
}

export function OpportunitiesPage() {
  const { can, user } = useAuth();
  const portfolio = usePortfolioScope();
  const [view, setView] = useState<View>(readView);
  const [searchText, setSearchText] = useState('');
  const [status, setStatus] = useState<'' | OpportunityStatus>('');
  const [seller, setSeller] = useState('all');
  const [creating, setCreating] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const search = useDebouncedValue(searchText.trim());

  const canListUsers = can('platform.user.read');
  const users = useQuery({
    queryKey: queryKeys.users({ scope: 'sellers' }),
    queryFn: () => endpoints.users.list({ pageSize: 100, isActive: true }),
    enabled: canListUsers,
  });
  const ownerId = seller === 'all' ? undefined : seller === 'mine' ? user?.id : seller;
  const filters: Filters = { search, status, ownerId };

  const choose = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // sem storage: a escolha só vale nesta sessão
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Oportunidades</h1>
          {portfolio.note ? (
            <p className="text-sm text-muted-foreground">{portfolio.note}</p>
          ) : null}
        </div>
        <Can permission="crm.opportunity.write">
          <Button onClick={() => setCreating(true)}>
            <Plus /> Nova oportunidade
          </Button>
        </Can>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Modo de exibição" className="flex rounded-md border p-0.5">
          {(
            [
              ['board', 'Quadro', LayoutGrid],
              ['list', 'Lista', List],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={view === id}
              onClick={() => choose(id)}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            className="h-9 pl-9"
            placeholder="Buscar cliente"
            aria-label="Buscar cliente"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <div className="w-52">
          <NativeSelect
            aria-label="Filtrar por situação"
            className="h-9"
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | OpportunityStatus)}
          >
            <option value="">Todas as situações</option>
            {Object.values(OpportunityStatus).map((s) => (
              <option key={s} value={s}>
                {OPPORTUNITY_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {portfolio.restricted ? null : (
          <div className="w-52">
            <NativeSelect
              aria-label="Vendedor"
              className="h-9"
              value={seller}
              onChange={(e) => setSeller(e.target.value)}
            >
              <option value="all">Todos os vendedores</option>
              <option value="mine">Só as minhas</option>
              {(users.data?.data ?? [])
                .filter((u) => u.id !== user?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
        )}
        <Can permission="crm.pipeline.manage">
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setConfiguring(true)}
          >
            <Settings2 /> Configurar etapas
          </Button>
        </Can>
      </div>

      {view === 'board' ? <BoardView {...filters} /> : <ListView {...filters} />}
      <NewOpportunityDialog open={creating} onOpenChange={setCreating} />
      <ConfigureStagesDialog open={configuring} onOpenChange={setConfiguring} />
    </div>
  );
}
