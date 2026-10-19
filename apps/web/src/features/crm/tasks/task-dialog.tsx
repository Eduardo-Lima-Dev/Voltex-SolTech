import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '@voltex/ui';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
  Textarea,
} from '@voltex/ui';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

/** `datetime-local` (hora local) → ISO; amanhã às 9h por padrão. */
const defaultDue = () => {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A tarefa nasce vinculada a um destes (opcional). */
  target?: { opportunityId?: string; leadId?: string; accountId?: string };
}

export function TaskDialog({ open, onOpenChange, target }: TaskDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState(defaultDue);
  const [errors, setErrors] = useState<{ title?: string; dueAt?: string }>({});

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setDueAt(defaultDue());
      setErrors({});
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      endpoints.tasks.create({
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: new Date(dueAt).toISOString(),
        ...target,
      }),
    onSuccess: async () => {
      toast.success('Tarefa criada');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks() });
      if (target?.opportunityId) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.opportunity(target.opportunityId),
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.opportunities() });
        await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
      }
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível criar a tarefa.')),
  });

  const submit = () => {
    const next: typeof errors = {};
    if (title.trim().length < 2) next.title = 'Informe o que precisa ser feito';
    if (!dueAt || Number.isNaN(new Date(dueAt).getTime())) next.dueAt = 'Informe o prazo';
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
          <DialogDescription>Fica com você, a não ser que a reatribuam depois.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id="task-title" label="O que fazer" error={errors.title}>
            <Input
              id="task-title"
              autoFocus
              aria-invalid={errors.title ? true : undefined}
              placeholder="Ex.: Ligar para confirmar a fatura"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field id="task-due" label="Prazo" error={errors.dueAt}>
            <Input
              id="task-due"
              type="datetime-local"
              aria-invalid={errors.dueAt ? true : undefined}
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Field>
          <Field id="task-description" label="Detalhes (opcional)">
            <Textarea
              id="task-description"
              rows={3}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : null}
              Criar tarefa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
