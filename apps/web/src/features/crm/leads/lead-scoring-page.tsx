import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  CustomerSegment,
  LeadSource,
  type LeadRoutingMethod,
  type LeadScoringConfig,
  type LeadScoringCriterion,
} from '@voltex/shared';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  toast,
} from '@voltex/ui';
import { BRAZILIAN_STATES, LEAD_SOURCE_LABELS, SEGMENT_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api';
import { parseMoney } from '../opportunities/quote-form';

type Key = LeadScoringCriterion['key'];
const KEY_LABELS: Record<Key, string> = {
  SOURCE: 'Origem do lead',
  SEGMENT: 'Segmento',
  STATE: 'Estado (UF)',
  MONTHLY_BILL: 'Conta de luz mensal',
};
const KEYS = Object.keys(KEY_LABELS) as Key[];

const num = (value: string): number | null => {
  const n = Number(value.replace(',', '.'));
  return value.trim() === '' || !Number.isFinite(n) ? null : n;
};

function CriterionEditor({
  criterion,
  onChange,
  onRemove,
}: {
  criterion: LeadScoringCriterion;
  onChange: (next: LeadScoringCriterion) => void;
  onRemove: () => void;
}) {
  const label = KEY_LABELS[criterion.key];
  const setPoints = (field: string, value: string) => {
    if (criterion.key === 'MONTHLY_BILL') return;
    const next = { ...(criterion.points as Record<string, number>) };
    const n = num(value);
    if (n === null) delete next[field];
    else next[field] = n;
    onChange({ ...criterion, points: next } as LeadScoringCriterion);
  };
  const options: { value: string; label: string }[] =
    criterion.key === 'SOURCE'
      ? Object.values(LeadSource).map((v) => ({ value: v, label: LEAD_SOURCE_LABELS[v] }))
      : criterion.key === 'SEGMENT'
        ? Object.values(CustomerSegment).map((v) => ({ value: v, label: SEGMENT_LABELS[v] }))
        : criterion.key === 'STATE'
          ? BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }))
          : [];
  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`w-${criterion.key}`}>Peso (1 a 100)</Label>
          <Input
            id={`w-${criterion.key}`}
            className="w-28"
            inputMode="numeric"
            value={String(criterion.weight)}
            onChange={(e) =>
              onChange({ ...criterion, weight: Math.round(num(e.target.value) ?? 0) })
            }
          />
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 /> Remover critério
        </Button>
      </div>
      {criterion.key === 'MONTHLY_BILL' ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Cada faixa vale a partir do valor mínimo da conta. Vale a faixa de maior mínimo que
            couber.
          </p>
          {criterion.ranges.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`min-${i}`}>A partir de (R$)</Label>
                <Input
                  id={`min-${i}`}
                  className="w-32"
                  inputMode="decimal"
                  defaultValue={(r.minCents / 100).toFixed(2).replace('.', ',')}
                  onBlur={(e) => {
                    const cents = parseMoney(e.target.value);
                    if (cents === null) return;
                    const ranges = criterion.ranges.map((x, j) =>
                      j === i ? { ...x, minCents: cents } : x,
                    );
                    onChange({ ...criterion, ranges });
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`rp-${i}`}>Pontos (0 a 100)</Label>
                <Input
                  id={`rp-${i}`}
                  className="w-28"
                  inputMode="decimal"
                  value={String(r.points)}
                  onChange={(e) =>
                    onChange({
                      ...criterion,
                      ranges: criterion.ranges.map((x, j) =>
                        j === i ? { ...x, points: num(e.target.value) ?? 0 } : x,
                      ),
                    })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remover faixa ${i + 1}`}
                disabled={criterion.ranges.length === 1}
                onClick={() =>
                  onChange({ ...criterion, ranges: criterion.ranges.filter((_, j) => j !== i) })
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={criterion.ranges.length >= 10}
            onClick={() =>
              onChange({ ...criterion, ranges: [...criterion.ranges, { minCents: 0, points: 0 }] })
            }
          >
            <Plus /> Faixa
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Pontos de 0 a 100 para cada valor. Em branco vale 0.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {options.map((o) => (
              <div key={o.value} className="flex items-center gap-2">
                <Label htmlFor={`pt-${criterion.key}-${o.value}`} className="w-32 shrink-0 text-sm">
                  {o.label}
                </Label>
                <Input
                  id={`pt-${criterion.key}-${o.value}`}
                  aria-label={`${label}: pontos de ${o.label}`}
                  className="w-24"
                  inputMode="decimal"
                  value={String((criterion.points as Record<string, number>)[o.value] ?? '')}
                  onChange={(e) => setPoints(o.value, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}

const emptyCriterion = (key: Key): LeadScoringCriterion =>
  key === 'MONTHLY_BILL'
    ? { key, weight: 10, ranges: [{ minCents: 0, points: 0 }] }
    : ({ key, weight: 10, points: {} } as LeadScoringCriterion);

/** Critérios, pesos e distribuição de leads: tudo definido pela empresa (RF-CRM-006). */
export function LeadScoringPage() {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ['lead-scoring'], queryFn: endpoints.leadScoring.get });
  const users = useQuery({
    queryKey: ['lead-scoring', 'users'],
    queryFn: () => endpoints.users.list({ pageSize: 100 }),
  });
  const [draft, setDraft] = useState<LeadScoringConfig | null>(null);
  useEffect(() => {
    if (config.data && draft === null) setDraft(config.data);
  }, [config.data, draft]);

  const save = useMutation({
    mutationFn: (value: LeadScoringConfig) => endpoints.leadScoring.save(value),
    onSuccess: async (saved) => {
      toast.success(
        'Configuração salva. Vale para os próximos leads; use "Pontuar de novo" para os atuais.',
      );
      setDraft(saved);
      await queryClient.invalidateQueries({ queryKey: ['lead-scoring'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar.')),
  });
  const rescore = useMutation({
    mutationFn: endpoints.leadScoring.rescore,
    onSuccess: (r) => toast.success(`${r.updated} lead(s) pontuado(s) de novo.`),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível pontuar de novo.')),
  });

  if (config.isPending || draft === null) return <Skeleton className="h-64 w-full" />;
  const used = new Set(draft.criteria.map((c) => c.key));
  const sellers = (users.data?.data ?? []).filter((u) => u.isActive);
  const setRouting = (patch: Partial<LeadScoringConfig['routing']>) =>
    setDraft({ ...draft, routing: { ...draft.routing, ...patch } });
  const toggleUser = (id: string, list: string[]) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Pontuação de leads</h2>
        <p className="text-muted-foreground">
          Você define o que vale ponto e quem recebe cada lead. Sem critérios, nenhum lead é
          pontuado; sem regra de distribuição, nenhum é atribuído sozinho.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Critérios</CardTitle>
          <CardDescription>
            A nota do lead (0 a 100) é a média dos pontos de cada critério, ponderada pelos pesos.
            Critério sem dado no lead (ex.: sem segmento) fica de fora da conta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft.criteria.map((c) => (
            <CriterionEditor
              key={c.key}
              criterion={c}
              onChange={(next) =>
                setDraft({
                  ...draft,
                  criteria: draft.criteria.map((x) => (x.key === c.key ? next : x)),
                })
              }
              onRemove={() =>
                setDraft({ ...draft, criteria: draft.criteria.filter((x) => x.key !== c.key) })
              }
            />
          ))}
          <div className="flex flex-wrap gap-2">
            {KEYS.filter((k) => !used.has(k)).map((k) => (
              <Button
                key={k}
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft({ ...draft, criteria: [...draft.criteria, emptyCriterion(k)] })
                }
              >
                <Plus /> {KEY_LABELS[k]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Distribuição</CardTitle>
          <CardDescription>
            Vale para leads que chegam sem responsável (formulário do site e importação). O lead
            cadastrado à mão continua com quem o cadastrou.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid max-w-xs gap-1.5">
            <Label htmlFor="routing-method">Regra</Label>
            <NativeSelect
              id="routing-method"
              value={draft.routing.method}
              onChange={(e) => setRouting({ method: e.target.value as LeadRoutingMethod })}
            >
              <option value="NONE">Não distribuir sozinho</option>
              <option value="ROUND_ROBIN">Rodízio entre vendedores</option>
              <option value="REGION">Por estado do lead</option>
            </NativeSelect>
          </div>
          {draft.routing.method === 'ROUND_ROBIN' ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Quem entra no rodízio (nenhum marcado = todos os vendedores)
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {sellers.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.routing.userIds.includes(u.id)}
                      onChange={() =>
                        setRouting({ userIds: toggleUser(u.id, draft.routing.userIds) })
                      }
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {draft.routing.method === 'REGION' ? (
            <div className="space-y-3">
              {draft.routing.regions.map((region, i) => (
                <fieldset key={i} className="space-y-2 rounded-lg border p-3">
                  <legend className="px-1 text-sm font-medium">Região {i + 1}</legend>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`region-states-${i}`}>
                      Estados (siglas separadas por vírgula)
                    </Label>
                    <Input
                      id={`region-states-${i}`}
                      defaultValue={region.states.join(', ')}
                      onBlur={(e) =>
                        setRouting({
                          regions: draft.routing.regions.map((r, j) =>
                            j === i
                              ? {
                                  ...r,
                                  states: e.target.value
                                    .split(/[,\s]+/)
                                    .map((x) => x.trim().toUpperCase())
                                    .filter(Boolean),
                                }
                              : r,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {sellers.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={region.userIds.includes(u.id)}
                          onChange={() =>
                            setRouting({
                              regions: draft.routing.regions.map((r, j) =>
                                j === i ? { ...r, userIds: toggleUser(u.id, r.userIds) } : r,
                              ),
                            })
                          }
                        />
                        {u.name}
                      </label>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setRouting({ regions: draft.routing.regions.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 /> Remover região
                  </Button>
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setRouting({ regions: [...draft.routing.regions, { states: [], userIds: [] }] })
                }
              >
                <Plus /> Região
              </Button>
              <p className="text-xs text-muted-foreground">
                Lead de um estado sem região cadastrada fica sem responsável.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button disabled={save.isPending} onClick={() => save.mutate(draft)}>
          Salvar configuração
        </Button>
        <Button variant="outline" disabled={rescore.isPending} onClick={() => rescore.mutate()}>
          Pontuar de novo os leads em aberto
        </Button>
      </div>
    </div>
  );
}
