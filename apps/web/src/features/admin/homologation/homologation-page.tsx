import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Alert,
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
  toast,
} from '@voltex/ui';
import {
  BUILT_IN_HOMOLOGATION_RULES,
  type ChecklistDeadline,
  type ChecklistItemRuleInput,
  type HomologationChecklistDto,
} from '@voltex/shared';
import { Can } from '@/app/guards';
import { Field } from '@/components/field';
import { DEADLINE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../query-keys';

const emptyItem = (): ChecklistItemRuleInput => ({
  code: '',
  title: '',
  required: true,
  condition: 'ALWAYS',
  source: '',
});
const DEADLINE_CODES = ['ACCESS_OPINION', 'INSPECTION', 'POST_APPROVAL_EXECUTION'] as const;

function PublishDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const distributors = useQuery({
    queryKey: queryKeys.distributors,
    queryFn: endpoints.distributors.list,
    enabled: open,
  });
  const [distributorId, setDistributorId] = useState('');
  const [source, setSource] = useState('');
  const [reviewedBy, setReviewedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ChecklistItemRuleInput[]>([]);
  const [deadlines, setDeadlines] = useState<Record<string, { days: string; source: string }>>({});
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    // Parte da base EnergIF 2023 para a empresa editar; a fonte precisa ser a da regra que ela vai publicar.
    setDistributorId('');
    setSource('');
    setReviewedBy('');
    setNotes('');
    setItems(BUILT_IN_HOMOLOGATION_RULES.items.map((i) => ({ ...i })));
    setDeadlines({});
    setError(undefined);
  }, [open]);

  const setItem = (index: number, patch: Partial<ChecklistItemRuleInput>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const publish = useMutation({
    mutationFn: () =>
      endpoints.homologation.publish({
        distributorId: distributorId || undefined,
        source: source.trim(),
        reviewedBy: reviewedBy.trim() || undefined,
        notes: notes.trim() || undefined,
        items: items.map((i) => ({
          ...i,
          code: i.code.trim().toUpperCase(),
          title: i.title.trim(),
          source: i.source.trim(),
        })),
        deadlines: DEADLINE_CODES.flatMap((code): ChecklistDeadline[] => {
          const d = deadlines[code];
          const days = Number(d?.days);
          return d && days > 0
            ? [
                {
                  code,
                  label: DEADLINE_LABELS[code],
                  days,
                  source: d.source.trim() || source.trim(),
                },
              ]
            : [];
        }),
      }),
    onSuccess: async () => {
      toast.success('Regras publicadas');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.homologation });
    },
    onError: (e) => setError(errorMessage(e, 'Não foi possível publicar as regras.')),
  });

  const submit = () => {
    if (source.trim().length < 5)
      return setError('Informe a fonte das regras (norma, versão, data)');
    if (items.some((i) => !i.code.trim() || !i.title.trim() || !i.source.trim()))
      return setError('Todo item precisa de código, título e fonte');
    setError(undefined);
    publish.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Publicar regras de homologação</DialogTitle>
          <DialogDescription>
            Parte da base EnergIF 2023 (lista de 2023). Ajuste com a norma da distribuidora e cite a
            fonte. Projetos novos passam a usar esta versão; os existentes mantêm a que já tinham.
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
          <Field id="rule-distributor" label="Vale para">
            <NativeSelect
              id="rule-distributor"
              value={distributorId}
              onChange={(e) => setDistributorId(e.target.value)}
            >
              <option value="">Padrão da empresa (qualquer distribuidora)</option>
              {distributors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="rule-source"
            label="Fonte das regras"
            hint="Ex.: Norma técnica da distribuidora, rev. 2026"
          >
            <Input id="rule-source" value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
          <Field id="rule-reviewer" label="Revisado por (recomendado: responsável técnico)">
            <Input
              id="rule-reviewer"
              value={reviewedBy}
              onChange={(e) => setReviewedBy(e.target.value)}
            />
          </Field>
          <Field id="rule-notes" label="Observações (opcional)">
            <Input id="rule-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Documentos exigidos</legend>
            {items.map((item, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-md border p-2 sm:grid-cols-[9rem_1fr_1fr_auto]"
              >
                <Input
                  aria-label={`Código do item ${index + 1}`}
                  placeholder="CODIGO"
                  value={item.code}
                  onChange={(e) => setItem(index, { code: e.target.value })}
                />
                <Input
                  aria-label={`Título do item ${index + 1}`}
                  placeholder="Título"
                  value={item.title}
                  onChange={(e) => setItem(index, { title: e.target.value })}
                />
                <Input
                  aria-label={`Fonte do item ${index + 1}`}
                  placeholder="Fonte"
                  value={item.source}
                  onChange={(e) => setItem(index, { source: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover item ${index + 1}`}
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
                <label className="flex items-center gap-2 text-xs sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={item.required}
                    onChange={(e) => setItem(index, { required: e.target.checked })}
                  />
                  Obrigatório
                </label>
                <NativeSelect
                  aria-label={`Quando vale o item ${index + 1}`}
                  className="h-8 sm:col-span-2"
                  value={item.condition ?? 'ALWAYS'}
                  onChange={(e) =>
                    setItem(index, {
                      condition: e.target.value as 'ALWAYS' | 'MINI_GENERATION_ONLY',
                    })
                  }
                >
                  <option value="ALWAYS">Sempre</option>
                  <option value="MINI_GENERATION_ONLY">Só minigeração</option>
                </NativeSelect>
              </div>
            ))}
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setItems([...items, emptyItem()])}
              >
                <Plus /> Adicionar documento
              </Button>
            </div>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Prazos sugeridos (opcional)</legend>
            {DEADLINE_CODES.map((code) => (
              <div key={code} className="grid gap-2 sm:grid-cols-[12rem_6rem_1fr] sm:items-center">
                <span className="text-sm">{DEADLINE_LABELS[code]}</span>
                <Input
                  aria-label={`Dias: ${DEADLINE_LABELS[code]}`}
                  inputMode="numeric"
                  placeholder="dias"
                  value={deadlines[code]?.days ?? ''}
                  onChange={(e) =>
                    setDeadlines({
                      ...deadlines,
                      [code]: { days: e.target.value, source: deadlines[code]?.source ?? '' },
                    })
                  }
                />
                <Input
                  aria-label={`Fonte do prazo: ${DEADLINE_LABELS[code]}`}
                  placeholder="Fonte (padrão: a fonte das regras)"
                  value={deadlines[code]?.source ?? ''}
                  onChange={(e) =>
                    setDeadlines({
                      ...deadlines,
                      [code]: { days: deadlines[code]?.days ?? '', source: e.target.value },
                    })
                  }
                />
              </div>
            ))}
          </fieldset>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={publish.isPending}>
              {publish.isPending ? <Spinner /> : null}
              Publicar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HomologationPage() {
  const [publishing, setPublishing] = useState(false);
  const rules = useQuery({
    queryKey: queryKeys.homologation,
    queryFn: endpoints.homologation.list,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Regras de homologação</CardTitle>
          <CardDescription>
            Checklist de documentos e prazos sugeridos, por distribuidora, sempre com a fonte. Sem
            regra própria vale a base EnergIF 2023.
          </CardDescription>
        </div>
        <Can permission="platform.rule.manage">
          <Button size="sm" onClick={() => setPublishing(true)}>
            <Plus /> Publicar regras
          </Button>
        </Can>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert variant="warning">
          <p>
            A base EnergIF 2023 é uma lista de <strong>2023</strong> e não substitui a exigência
            atual de cada distribuidora. Confirme na concessionária antes de protocolar.
          </p>
        </Alert>
        {rules.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : rules.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as regras.</p>
        ) : (
          <ul className="divide-y">
            {rules.data.map((r: HomologationChecklistDto) => (
              <li key={r.id ?? 'built-in'} className="space-y-1 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{r.ref}</span>
                  <Badge variant="secondary">
                    {r.scope === 'BUILT_IN'
                      ? 'Base do sistema'
                      : r.scope === 'TENANT'
                        ? 'Padrão da empresa'
                        : (r.distributorName ?? 'Distribuidora')}
                  </Badge>
                  {r.reviewedBy ? (
                    <Badge variant="green">Revisada por {r.reviewedBy}</Badge>
                  ) : (
                    <Badge variant="yellow">Sem revisão</Badge>
                  )}
                </div>
                <p className="text-muted-foreground">
                  {r.items.length} documento(s) · {r.source}
                  {r.createdAt ? ` · ${formatDateTime(r.createdAt)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <PublishDialog open={publishing} onOpenChange={setPublishing} />
    </Card>
  );
}
