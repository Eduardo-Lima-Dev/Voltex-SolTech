import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  NativeSelect,
  Skeleton,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { Pagination } from '@/components/pagination';
import { queryKeys } from '@/features/admin/query-keys';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { endpoints } from '@/lib/api/endpoints';
import { TaskDialog } from './task-dialog';
import { TaskList } from './task-list';

const PAGE_SIZE = 15;
type View = 'open' | 'overdue' | 'done' | 'all';

export function TasksPage() {
  const me = useCurrentUser();
  const [view, setView] = useState<View>('open');
  const [mine, setMine] = useState(true);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const filters = { view, mine, page };
  const list = useQuery({
    queryKey: queryKeys.tasks(filters),
    queryFn: () =>
      endpoints.tasks.list({
        page,
        pageSize: PAGE_SIZE,
        status: view === 'open' ? 'OPEN' : view === 'done' ? 'DONE' : undefined,
        overdue: view === 'overdue' ? true : undefined,
        assigneeId: mine ? me.id : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row">
        <div className="space-y-1.5">
          <CardTitle>Tarefas</CardTitle>
          <CardDescription>O que precisa ser feito, com prazo e responsável.</CardDescription>
        </div>
        <Can permission="crm.task.write">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Nova tarefa
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-3 sm:grid-cols-[12rem_12rem]">
          <NativeSelect
            aria-label="Filtrar tarefas"
            value={view}
            onChange={(e) => {
              setView(e.target.value as View);
              setPage(1);
            }}
          >
            <option value="open">Em aberto</option>
            <option value="overdue">Atrasadas</option>
            <option value="done">Concluídas</option>
            <option value="all">Todas</option>
          </NativeSelect>
          <NativeSelect
            aria-label="Responsável"
            value={mine ? 'mine' : 'all'}
            onChange={(e) => {
              setMine(e.target.value === 'mine');
              setPage(1);
            }}
          >
            <option value="mine">Minhas tarefas</option>
            <option value="all">Da equipe toda</option>
          </NativeSelect>
        </div>
        {list.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : list.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as tarefas.</p>
        ) : (
          <>
            <TaskList tasks={list.data.data} showOpportunity />
            <Pagination
              page={list.data.meta.page}
              pageSize={list.data.meta.pageSize}
              total={list.data.meta.total}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
      <TaskDialog open={creating} onOpenChange={setCreating} />
    </Card>
  );
}
