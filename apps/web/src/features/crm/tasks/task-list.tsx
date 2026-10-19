import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Undo2 } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from '@voltex/ui';
import type { TaskDto } from '@voltex/shared';
import { Badge, Button } from '@voltex/ui';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';

/** Lista de tarefas com concluir/reabrir. Reusada na página de tarefas e na oportunidade. */
export function TaskList({
  tasks,
  showOpportunity = false,
  opportunityId,
}: {
  tasks: TaskDto[];
  showOpportunity?: boolean;
  opportunityId?: string;
}) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (task: TaskDto) =>
      task.status === 'DONE'
        ? endpoints.tasks.update(task.id, { status: 'OPEN' })
        : endpoints.tasks.complete(task.id),
    onSuccess: async (task) => {
      toast.success(task.status === 'DONE' ? 'Tarefa concluída' : 'Tarefa reaberta');
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks() });
      await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.opportunities() });
      if (opportunityId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.opportunity(opportunityId) });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.opportunityTimeline(opportunityId),
        });
      }
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível atualizar a tarefa.')),
  });

  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma tarefa.</p>;
  return (
    <ul className="divide-y">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-start justify-between gap-3 py-3 text-sm">
          <div className="min-w-0 space-y-0.5">
            <div
              className={
                task.status === 'DONE'
                  ? 'font-medium line-through text-muted-foreground'
                  : 'font-medium'
              }
            >
              {task.title}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Prazo: {formatDateTime(task.dueAt)}</span>
              {task.overdue ? <Badge variant="red">Atrasada</Badge> : null}
              {task.assigneeName ? <span>· {task.assigneeName}</span> : null}
              {showOpportunity && task.opportunityId ? (
                <Link className="underline" to={`/crm/oportunidades/${task.opportunityId}`}>
                  Ver oportunidade
                </Link>
              ) : null}
            </div>
            {task.description ? (
              <p className="text-xs text-muted-foreground">{task.description}</p>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(task)}
            aria-label={task.status === 'DONE' ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
          >
            {task.status === 'DONE' ? <Undo2 /> : <Check />}
            {task.status === 'DONE' ? 'Reabrir' : 'Concluir'}
          </Button>
        </li>
      ))}
    </ul>
  );
}
