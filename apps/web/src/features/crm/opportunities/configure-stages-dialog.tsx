import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
  toast,
} from '@voltex/ui';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

/** Renomeia as etapas do funil. A ordem e as regras de passagem entre etapas continuam as do sistema. */
export function ConfigureStagesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const stages = useQuery({
    queryKey: queryKeys.pipeline,
    queryFn: endpoints.pipeline.list,
    enabled: open,
  });
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open && stages.data) setNames(Object.fromEntries(stages.data.map((s) => [s.id, s.name])));
  }, [open, stages.data]);

  const changed = (stages.data ?? []).filter((s) => {
    const next = (names[s.id] ?? s.name).trim();
    return next.length > 0 && next !== s.name;
  });
  const save = useMutation({
    mutationFn: () =>
      Promise.all(
        changed.map((s) => endpoints.pipeline.updateStage(s.id, { name: names[s.id]!.trim() })),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.pipeline }),
        queryClient.invalidateQueries({ queryKey: ['opportunity-board'] }),
      ]);
      toast.success('Etapas atualizadas');
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar as etapas.')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurar etapas</DialogTitle>
          <DialogDescription>
            Mude o nome que cada etapa tem na sua empresa. A ordem do funil não muda.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {(stages.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-muted-foreground">{s.order}</span>
              <Input
                aria-label={`Nome da etapa ${s.order}`}
                maxLength={60}
                value={names[s.id] ?? s.name}
                onChange={(e) => setNames((prev) => ({ ...prev, [s.id]: e.target.value }))}
              />
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={changed.length === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
