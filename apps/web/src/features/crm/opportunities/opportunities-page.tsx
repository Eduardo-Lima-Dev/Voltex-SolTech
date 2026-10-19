import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LayoutGrid, List, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { OpportunityStage } from '@voltex/shared';
import { OpportunityStatus } from '@voltex/shared';
import {
  Badge,
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
  cn,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { Pagination } from '@/components/pagination';
import { queryKeys } from '@/features/admin/query-keys';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { OPPORTUNITY_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { formatDate } from '@/lib/format';
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

function ListView({ mine }: { mine: boolean }) {
  const me = useCurrentUser();
  const stages = useQuery({ queryKey: queryKeys.pipeline, queryFn: endpoints.pipeline.list });
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<'' | OpportunityStage>('');
  const [status, setStatus] = useState<'' | OpportunityStatus>('');
  const [noTask, setNoTask] = useState(false);
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search.trim());

  const filters = { page, search: debounced, stage, status, noTask, mine };
  const list = useQuery({
    queryKey: queryKeys.opportunities(filters),
    queryFn: () =>
      endpoints.opportunities.list({
        page,
        pageSize: PAGE_SIZE,
        search: debounced || undefined,
        stage: stage || undefined,
        status: status || undefined,
        withoutNextTask: noTask ? true : undefined,
        ownerId: mine ? me.id : undefined,
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
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_12rem_10rem_12rem]">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              className="pl-9"
              placeholder="Buscar por título, conta ou código do projeto"
              aria-label="Buscar oportunidades"
              value={search}
              onChange={(e) => reset(setSearch)(e.target.value)}
            />
          </div>
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
            aria-label="Filtrar por situação"
            value={status}
            onChange={(e) => reset(setStatus)(e.target.value as '' | OpportunityStatus)}
          >
            <option value="">Todas</option>
            {Object.values(OpportunityStatus).map((s) => (
              <option key={s} value={s}>
                {OPPORTUNITY_STATUS_LABELS[s]}
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

function BoardView({ mine }: { mine: boolean }) {
  const me = useCurrentUser();
  const stages = useQuery({ queryKey: queryKeys.pipeline, queryFn: endpoints.pipeline.list });
  const board = useQuery({
    queryKey: queryKeys.opportunityBoard(mine ? me.id : undefined),
    queryFn: () => endpoints.opportunities.board(mine ? me.id : undefined),
    placeholderData: keepPreviousData,
  });

  if (board.isPending || stages.isPending)
    return (
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-64 w-72 shrink-0" />
        ))}
      </div>
    );
  if (board.isError || stages.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o quadro.</p>;
  return <KanbanBoard columns={board.data.columns} stages={stages.data} />;
}

export function OpportunitiesPage() {
  const [view, setView] = useState<View>(readView);
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(false);

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
      <Card>
        <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row">
          <div className="space-y-1.5">
            <CardTitle>Oportunidades</CardTitle>
            <CardDescription>
              {view === 'board'
                ? 'Arraste o cartão pelo ícone para mudar de etapa, ou use “Mover para…”.'
                : 'Lista com busca e filtros.'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Responsável"
              className="h-9 w-44"
              value={mine ? 'mine' : 'all'}
              onChange={(e) => setMine(e.target.value === 'mine')}
            >
              <option value="all">Toda a equipe</option>
              <option value="mine">Só as minhas</option>
            </NativeSelect>
            <div
              role="group"
              aria-label="Modo de exibição"
              className="flex rounded-md border p-0.5"
            >
              {(
                [
                  ['board', 'Quadro', LayoutGrid],
                  ['list', 'Lista', List],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  onClick={() => choose(id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    view === id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  <Icon className="size-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
            <Can permission="crm.opportunity.write">
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> Nova oportunidade
              </Button>
            </Can>
          </div>
        </CardHeader>
      </Card>

      {view === 'board' ? <BoardView mine={mine} /> : <ListView mine={mine} />}
      <NewOpportunityDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
