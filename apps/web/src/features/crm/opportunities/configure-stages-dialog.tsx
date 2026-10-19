import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CUSTOM_STAGE_BASES } from '@voltex/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  Spinner,
  Switch,
  toast,
} from '@voltex/ui';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

/**
 * Personaliza o funil da empresa: renomear e esconder etapas, e criar colunas novas.
 * A ordem e as regras de passagem entre etapas continuam as do sistema; uma coluna nova segue as regras da etapa
 * em que for criada (só muda onde o cartão aparece).
 */
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
  const customs = useQuery({
    queryKey: queryKeys.customStages,
    queryFn: endpoints.pipeline.customStages,
    enabled: open,
  });
  const [names, setNames] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState('');
  const [newBase, setNewBase] = useState<(typeof CUSTOM_STAGE_BASES)[number]>(
    CUSTOM_STAGE_BASES[2]!,
  );
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNames({
      ...Object.fromEntries((stages.data ?? []).map((s) => [s.id, s.name])),
      ...Object.fromEntries((customs.data ?? []).map((c) => [c.id, c.name])),
    });
    setHidden(Object.fromEntries((stages.data ?? []).map((s) => [s.id, s.hidden])));
    setConfirmRemove(null);
  }, [open, stages.data, customs.data]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.pipeline }),
      queryClient.invalidateQueries({ queryKey: ['opportunity-board'] }),
    ]);

  const changedStages = (stages.data ?? []).filter((s) => {
    const next = (names[s.id] ?? s.name).trim();
    return (next.length > 1 && next !== s.name) || (hidden[s.id] ?? s.hidden) !== s.hidden;
  });
  const changedCustoms = (customs.data ?? []).filter((c) => {
    const next = (names[c.id] ?? c.name).trim();
    return next.length > 1 && next !== c.name;
  });
  const changes = changedStages.length + changedCustoms.length;

  const save = useMutation({
    mutationFn: () =>
      Promise.all([
        ...changedStages.map((s) =>
          endpoints.pipeline.updateStage(s.id, {
            name: (names[s.id] ?? s.name).trim(),
            hidden: hidden[s.id] ?? s.hidden,
          }),
        ),
        ...changedCustoms.map((c) =>
          endpoints.pipeline.updateCustomStage(c.id, { name: (names[c.id] ?? c.name).trim() }),
        ),
      ]),
    onSuccess: async () => {
      await refresh();
      toast.success('Funil atualizado');
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar o funil.')),
  });

  const add = useMutation({
    mutationFn: () =>
      endpoints.pipeline.createCustomStage({ name: newName.trim(), baseStage: newBase }),
    onSuccess: async () => {
      setNewName('');
      await refresh();
      toast.success('Coluna criada');
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível criar a coluna.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => endpoints.pipeline.removeCustomStage(id),
    onSuccess: async (result) => {
      setConfirmRemove(null);
      await refresh();
      toast.success(
        result.movedBack > 0
          ? `Coluna apagada. ${result.movedBack} negócio(s) voltaram para a coluna padrão da etapa.`
          : 'Coluna apagada',
      );
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível apagar a coluna.')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Configurar etapas</DialogTitle>
          <DialogDescription>
            Mude o nome, esconda o que sua equipe não usa ou crie colunas novas. Etapas escondidas
            voltam sozinhas se ainda tiverem negócios. A ordem e as regras do funil não mudam.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {(stages.data ?? []).flatMap((s) => [
            <li key={s.id} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-muted-foreground">{s.order}</span>
              <Input
                aria-label={`Nome da etapa ${s.order}`}
                maxLength={60}
                value={names[s.id] ?? s.name}
                onChange={(e) => setNames((prev) => ({ ...prev, [s.id]: e.target.value }))}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Switch
                  aria-label={`Mostrar ${s.name} no quadro`}
                  checked={!(hidden[s.id] ?? s.hidden)}
                  onCheckedChange={(shown) => setHidden((prev) => ({ ...prev, [s.id]: !shown }))}
                />
                Mostrar
              </label>
            </li>,
            ...(customs.data ?? [])
              .filter((c) => c.baseStage === s.key)
              .map((c) => (
                <li key={c.id} className="flex items-center gap-2 pl-6">
                  <span className="w-6 text-right text-xs text-muted-foreground">↳</span>
                  <Input
                    aria-label={`Nome da coluna ${c.name}`}
                    maxLength={60}
                    value={names[c.id] ?? c.name}
                    onChange={(e) => setNames((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  />
                  {confirmRemove === c.id ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(c.id)}
                    >
                      Confirmar
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Apagar a coluna ${c.name}`}
                      onClick={() => setConfirmRemove(c.id)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              )),
          ])}
        </ul>

        <form
          className="space-y-2 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim().length > 1) add.mutate();
          }}
        >
          <p className="text-sm font-medium">Nova coluna</p>
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-40 flex-1"
              aria-label="Nome da nova coluna"
              placeholder="Ex.: Visita técnica agendada"
              maxLength={60}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="w-52">
              <NativeSelect
                aria-label="Etapa da nova coluna"
                value={newBase}
                onChange={(e) => setNewBase(e.target.value as (typeof CUSTOM_STAGE_BASES)[number])}
              >
                {CUSTOM_STAGE_BASES.map((key) => (
                  <option key={key} value={key}>
                    {stages.data?.find((s) => s.key === key)?.name ?? key}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={newName.trim().length < 2 || add.isPending}
            >
              {add.isPending ? <Spinner /> : <Plus />} Adicionar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A coluna nova aparece logo depois da etapa escolhida e segue as regras dela.
          </p>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            type="button"
            disabled={changes === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner /> : null}
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
