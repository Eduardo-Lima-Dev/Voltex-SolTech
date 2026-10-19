import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, Skeleton } from '@voltex/ui';
import { Can } from '@/app/guards';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { TaskDialog } from '../tasks/task-dialog';
import { TaskList } from '../tasks/task-list';

export function TasksTab({ opportunityId }: { opportunityId: string }) {
  const [creating, setCreating] = useState(false);
  const tasks = useQuery({
    queryKey: queryKeys.tasks({ opportunityId }),
    queryFn: () => endpoints.tasks.list({ opportunityId, pageSize: 100 }),
  });
  return (
    <div className="space-y-3">
      <Can permission="crm.task.write">
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus /> Nova tarefa
        </Button>
      </Can>
      {tasks.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : tasks.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar as tarefas.</p>
      ) : (
        <TaskList tasks={tasks.data.data} opportunityId={opportunityId} />
      )}
      <TaskDialog open={creating} onOpenChange={setCreating} target={{ opportunityId }} />
    </div>
  );
}
