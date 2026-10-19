import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProjectType, type MarginPolicyDto } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  Skeleton,
  Spinner,
  Switch,
  toast,
} from '@voltex/ui';
import { Field } from '@/components/field';
import { parseRate } from '@/features/crm/opportunities/quote-form';
import { PROJECT_TYPE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatPercent } from '@/lib/format';
import { queryKeys } from '../query-keys';
import { ConfirmDialog } from '../company/confirm-delete';

const rateText = (fraction: number) =>
  String(Math.round(fraction * 10_000) / 100).replace('.', ',');

function PolicyDialog({
  policy,
  open,
  onOpenChange,
}: {
  policy: MarginPolicyDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const teams = useQuery({
    queryKey: queryKeys.teams,
    queryFn: endpoints.teams.list,
    enabled: open,
  });
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [projectType, setProjectType] = useState('');
  const [teamId, setTeamId] = useState('');
  const [errors, setErrors] = useState<{ name?: string; rate?: string }>({});

  useEffect(() => {
    if (!open) return;
    setName(policy?.name ?? '');
    setRate(policy ? rateText(policy.minMarginRate) : '');
    setProjectType(policy?.projectType ?? '');
    setTeamId(policy?.teamId ?? '');
    setErrors({});
  }, [open, policy]);

  const save = useMutation({
    mutationFn: (minMarginRate: number) =>
      policy
        ? endpoints.marginPolicies.update(policy.id, { name: name.trim(), minMarginRate })
        : endpoints.marginPolicies.create({
            name: name.trim(),
            minMarginRate,
            projectType: projectType ? (projectType as ProjectType) : undefined,
            teamId: teamId || undefined,
          }),
    onSuccess: async () => {
      toast.success(policy ? 'Política atualizada' : 'Política criada');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.marginPolicies });
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível salvar a política.')),
  });

  const submit = () => {
    const parsed = parseRate(rate);
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Dê um nome à política';
    if (parsed === null || parsed > 0.95 || rate.trim() === '')
      next.rate = 'Informe um percentual entre 0 e 95';
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate(parsed as number);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {policy ? 'Editar política de margem' : 'Nova política de margem'}
          </DialogTitle>
          <DialogDescription>
            Vale a política mais específica: time e tipo de projeto vencem a regra geral.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id="policy-name" label="Nome" error={errors.name}>
            <Input id="policy-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            id="policy-rate"
            label="Margem mínima (%)"
            hint="Margem de contribuição sobre o preço de venda."
            error={errors.rate}
          >
            <Input
              id="policy-rate"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          {!policy ? (
            <>
              <Field id="policy-type" label="Tipo de projeto (opcional)">
                <NativeSelect
                  id="policy-type"
                  value={projectType}
                  onChange={(e) => setProjectType(e.target.value)}
                >
                  <option value="">Todos</option>
                  {Object.values(ProjectType).map((t) => (
                    <option key={t} value={t}>
                      {PROJECT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="policy-team" label="Time (opcional)">
                <NativeSelect
                  id="policy-team"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                >
                  <option value="">Todos</option>
                  {teams.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MarginsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<MarginPolicyDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<MarginPolicyDto | null>(null);
  const policies = useQuery({
    queryKey: queryKeys.marginPolicies,
    queryFn: endpoints.marginPolicies.list,
  });
  const teams = useQuery({ queryKey: queryKeys.teams, queryFn: endpoints.teams.list });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.marginPolicies });

  const toggle = useMutation({
    mutationFn: (p: MarginPolicyDto) =>
      endpoints.marginPolicies.update(p.id, { active: !p.active }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível alterar a política.')),
  });
  const remove = useMutation({
    mutationFn: (p: MarginPolicyDto) => endpoints.marginPolicies.remove(p.id),
    onSuccess: async () => {
      toast.success('Política excluída');
      setDeleting(null);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível excluir a política.')),
  });

  const teamName = (id: string | null) => teams.data?.find((t) => t.id === id)?.name ?? 'Time';

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Margem mínima</CardTitle>
          <CardDescription>
            Cotações abaixo do mínimo só viram proposta com aprovação de um gestor. Sem nenhuma
            política ativa, nenhuma cotação é liberada.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing(null)}>
          <Plus /> Nova política
        </Button>
      </CardHeader>
      <CardContent>
        {policies.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : policies.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as políticas.</p>
        ) : policies.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma política cadastrada. Cadastre ao menos a margem mínima geral da empresa.
          </p>
        ) : (
          <ul className="divide-y">
            {policies.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Badge variant="secondary">{formatPercent(p.minMarginRate, 1)}</Badge>
                    {!p.active ? <Badge variant="outline">Inativa</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.projectType
                      ? PROJECT_TYPE_LABELS[p.projectType]
                      : 'Todos os tipos de projeto'}{' '}
                    · {p.teamId ? teamName(p.teamId) : 'Todos os times'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    aria-label={`${p.active ? 'Desativar' : 'Ativar'} ${p.name}`}
                    checked={p.active}
                    onCheckedChange={() => toggle.mutate(p)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Editar ${p.name}`}
                    onClick={() => setEditing(p)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Excluir ${p.name}`}
                    onClick={() => setDeleting(p)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <PolicyDialog
        policy={editing ?? null}
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir política?"
        description="Cotações já criadas mantêm o valor gravado, mas passam a ser avaliadas pelas políticas que restarem."
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Card>
  );
}
