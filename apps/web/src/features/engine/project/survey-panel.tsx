import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { SurveyData } from '@voltex/shared';
import { CONDITIONS, ROOF_TYPES, SUPPLY_TYPES, surveySchema } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Spinner,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { NumberField } from '../editor/number-field';

const SUPPLY_LABEL = { MONO: 'Monofásico', BI: 'Bifásico', TRI: 'Trifásico' } as const;
const ROOF_LABEL = {
  CERAMIC: 'Cerâmico',
  METAL: 'Metálico',
  FIBROCEMENT: 'Fibrocimento',
  SLAB: 'Laje',
  GROUND: 'Solo',
  OTHER: 'Outro',
} as const;
const COND_LABEL = { GOOD: 'Boa', FAIR: 'Regular', POOR: 'Ruim' } as const;
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

/** Levantamento do local (visita técnica): fornecimento, aterramento, telhado, obstáculos, cargas e adequações. */
export function SurveyPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const survey = useQuery({
    queryKey: ['engineering', 'survey', projectId],
    queryFn: () => endpoints.engineering.survey(projectId),
  });
  const [data, setData] = useState<SurveyData>(() => surveySchema.parse({}));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (survey.data && !dirty) setData(survey.data.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey.data]);
  const set = (fn: (d: SurveyData) => SurveyData) => {
    setData(fn);
    setDirty(true);
  };
  const refresh = async () => {
    setDirty(false);
    await queryClient.invalidateQueries({ queryKey: ['engineering', 'survey', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['engineering', 'load', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['engineering', 'timeline', projectId] });
  };
  const save = useMutation({
    mutationFn: () => endpoints.engineering.saveSurvey(projectId, data),
    onSuccess: async () => {
      toast.success('Levantamento salvo.');
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível salvar.')),
  });
  const complete = useMutation({
    mutationFn: async () => {
      await endpoints.engineering.saveSurvey(projectId, data);
      return endpoints.engineering.completeSurvey(projectId);
    },
    onSuccess: async () => {
      toast.success('Levantamento concluído.');
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível concluir.')),
  });
  const reopen = useMutation({
    mutationFn: () => endpoints.engineering.reopenSurvey(projectId),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível reabrir.')),
  });

  if (survey.isPending) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (survey.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o levantamento.</p>;
  const completed = survey.data.status === 'COMPLETED';
  const disabled = !canEdit || completed;
  const text = (v: string | undefined) => v ?? '';

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Levantamento do local</CardTitle>
          <CardDescription>
            Dados da visita técnica (EnergIF EF-R09): medidas no padrão de entrada, aterramento,
            telhado, obstáculos e cargas. Fotos entram como documentos do projeto.
          </CardDescription>
        </div>
        <Badge variant={completed ? 'green' : 'yellow'}>
          {completed ? 'Concluído' : 'Rascunho'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        {!completed && survey.data.missing.length > 0 ? (
          <p className="rounded border border-warning/50 bg-warning/10 p-2 text-sm">
            Falta para concluir: {survey.data.missing.join('; ')}.
          </p>
        ) : null}

        <fieldset className="space-y-3">
          <legend className="font-medium">Visita</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="sv-date">Data da visita</Label>
              <Input
                id="sv-date"
                type="date"
                disabled={disabled}
                value={text(data.visitedAt)}
                onChange={(e) => set((d) => ({ ...d, visitedAt: e.target.value || undefined }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="sv-by">Quem visitou</Label>
              <Input
                id="sv-by"
                disabled={disabled}
                value={text(data.visitedBy)}
                onChange={(e) => set((d) => ({ ...d, visitedBy: e.target.value || undefined }))}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">Padrão de entrada</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor="sv-supply">Tipo de fornecimento</Label>
              <NativeSelect
                id="sv-supply"
                disabled={disabled}
                value={data.supply.type ?? ''}
                onChange={(e) =>
                  set((d) => ({
                    ...d,
                    supply: { ...d.supply, type: (e.target.value || undefined) as never },
                  }))
                }
              >
                <option value="">Selecione</option>
                {SUPPLY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SUPPLY_LABEL[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <NumberField
              id="sv-line"
              label="Tensão fase–fase medida"
              unit="V"
              optional
              min={50}
              max={1000}
              disabled={disabled}
              value={data.supply.lineVoltageV}
              onChange={(v) => set((d) => ({ ...d, supply: { ...d.supply, lineVoltageV: v } }))}
            />
            <NumberField
              id="sv-phase"
              label="Tensão fase–neutro medida"
              unit="V"
              optional
              min={50}
              max={600}
              disabled={disabled}
              value={data.supply.phaseVoltageV}
              onChange={(v) => set((d) => ({ ...d, supply: { ...d.supply, phaseVoltageV: v } }))}
            />
            <NumberField
              id="sv-breaker"
              label="Disjuntor geral"
              unit="A"
              optional
              min={1}
              max={2000}
              disabled={disabled}
              value={data.supply.breakerA}
              onChange={(v) => set((d) => ({ ...d, supply: { ...d.supply, breakerA: v } }))}
            />
            <div className="grid gap-1">
              <Label htmlFor="sv-meter">Número do medidor</Label>
              <Input
                id="sv-meter"
                disabled={disabled}
                value={text(data.supply.meterNumber)}
                onChange={(e) =>
                  set((d) => ({
                    ...d,
                    supply: { ...d.supply, meterNumber: e.target.value || undefined },
                  }))
                }
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="sv-cond">Estado do padrão</Label>
              <NativeSelect
                id="sv-cond"
                disabled={disabled}
                value={data.supply.condition ?? ''}
                onChange={(e) =>
                  set((d) => ({
                    ...d,
                    supply: { ...d.supply, condition: (e.target.value || undefined) as never },
                  }))
                }
              >
                <option value="">Selecione</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {COND_LABEL[c]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">Aterramento</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor="sv-gnd">Existe aterramento?</Label>
              <NativeSelect
                id="sv-gnd"
                disabled={disabled}
                value={data.grounding.exists === undefined ? '' : String(data.grounding.exists)}
                onChange={(e) =>
                  set((d) => ({
                    ...d,
                    grounding: {
                      ...d.grounding,
                      exists: e.target.value === '' ? undefined : e.target.value === 'true',
                    },
                  }))
                }
              >
                <option value="">Selecione</option>
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="sv-gnd-ok">Adequado?</Label>
              <NativeSelect
                id="sv-gnd-ok"
                disabled={disabled}
                value={data.grounding.adequate == null ? '' : String(data.grounding.adequate)}
                onChange={(e) =>
                  set((d) => ({
                    ...d,
                    grounding: {
                      ...d.grounding,
                      adequate: e.target.value === '' ? null : e.target.value === 'true',
                    },
                  }))
                }
              >
                <option value="">Não avaliado</option>
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </NativeSelect>
            </div>
            <NumberField
              id="sv-ohm"
              label="Resistência de aterramento"
              unit="Ω"
              optional
              min={0}
              max={10000}
              disabled={disabled}
              value={data.grounding.resistanceOhm}
              onChange={(v) =>
                set((d) => ({ ...d, grounding: { ...d.grounding, resistanceOhm: v } }))
              }
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">Telhado ou local de instalação</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor="sv-roof">Tipo</Label>
              <NativeSelect
                id="sv-roof"
                disabled={disabled}
                value={data.roof.type ?? ''}
                onChange={(e) =>
                  set((d) => ({
                    ...d,
                    roof: { ...d.roof, type: (e.target.value || undefined) as never },
                  }))
                }
              >
                <option value="">Selecione</option>
                {ROOF_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ROOF_LABEL[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <NumberField
              id="sv-area"
              label="Área útil"
              unit="m²"
              optional
              min={0.1}
              max={100000}
              disabled={disabled}
              value={data.roof.usableAreaM2}
              onChange={(v) => set((d) => ({ ...d, roof: { ...d.roof, usableAreaM2: v } }))}
            />
            <NumberField
              id="sv-height"
              label="Altura da edificação"
              unit="m"
              optional
              min={0}
              max={300}
              disabled={disabled}
              value={data.roof.buildingHeightM}
              onChange={(v) => set((d) => ({ ...d, roof: { ...d.roof, buildingHeightM: v } }))}
            />
            <NumberField
              id="sv-tilt"
              label="Inclinação"
              unit="°"
              optional
              min={0}
              max={90}
              disabled={disabled}
              value={data.roof.tiltDegrees}
              onChange={(v) => set((d) => ({ ...d, roof: { ...d.roof, tiltDegrees: v } }))}
            />
            <NumberField
              id="sv-az"
              label="Azimute (0° = norte)"
              unit="°"
              optional
              min={0}
              max={359.9}
              disabled={disabled}
              value={data.roof.azimuthDegrees}
              onChange={(v) => set((d) => ({ ...d, roof: { ...d.roof, azimuthDegrees: v } }))}
            />
            <div className="grid gap-1">
              <Label htmlFor="sv-roof-cond">Estado</Label>
              <NativeSelect
                id="sv-roof-cond"
                disabled={disabled}
                value={data.roof.condition ?? ''}
                onChange={(e) =>
                  set((d) => ({
                    ...d,
                    roof: { ...d.roof, condition: (e.target.value || undefined) as never },
                  }))
                }
              >
                <option value="">Selecione</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {COND_LABEL[c]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">Obstáculos</legend>
          {data.obstacles.map((o, i) => (
            <div
              key={o.id}
              className="grid items-end gap-3 rounded border p-2 sm:grid-cols-[1fr_7rem_7rem_7rem_auto]"
            >
              <div className="grid gap-1">
                <Label htmlFor={`ob-d-${i}`}>Descrição</Label>
                <Input
                  id={`ob-d-${i}`}
                  disabled={disabled}
                  value={o.description}
                  onChange={(e) =>
                    set((d) => ({
                      ...d,
                      obstacles: d.obstacles.map((x) =>
                        x.id === o.id ? { ...x, description: e.target.value } : x,
                      ),
                    }))
                  }
                />
              </div>
              <NumberField
                id={`ob-h-${i}`}
                label="Altura (m)"
                optional
                min={0}
                max={300}
                disabled={disabled}
                value={o.heightM}
                onChange={(v) =>
                  set((d) => ({
                    ...d,
                    obstacles: d.obstacles.map((x) => (x.id === o.id ? { ...x, heightM: v } : x)),
                  }))
                }
              />
              <NumberField
                id={`ob-s-${i}`}
                label="Distância (m)"
                optional
                min={0}
                max={500}
                disabled={disabled}
                value={o.distanceM}
                onChange={(v) =>
                  set((d) => ({
                    ...d,
                    obstacles: d.obstacles.map((x) => (x.id === o.id ? { ...x, distanceM: v } : x)),
                  }))
                }
              />
              <NumberField
                id={`ob-a-${i}`}
                label="Direção (°)"
                optional
                min={0}
                max={359.9}
                disabled={disabled}
                value={o.azimuthDegrees}
                onChange={(v) =>
                  set((d) => ({
                    ...d,
                    obstacles: d.obstacles.map((x) =>
                      x.id === o.id ? { ...x, azimuthDegrees: v } : x,
                    ),
                  }))
                }
              />
              {!disabled ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    set((d) => ({ ...d, obstacles: d.obstacles.filter((x) => x.id !== o.id) }))
                  }
                >
                  Remover
                </Button>
              ) : null}
            </div>
          ))}
          {!disabled ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                set((d) => ({
                  ...d,
                  obstacles: [...d.obstacles, { id: newId('ob'), description: 'Novo obstáculo' }],
                }))
              }
            >
              Adicionar obstáculo
            </Button>
          ) : null}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">Cargas relevantes</legend>
          {data.loads.map((l, i) => (
            <div
              key={l.id}
              className="grid items-end gap-3 rounded border p-2 sm:grid-cols-[1fr_6rem_6rem_6rem_auto]"
            >
              <div className="grid gap-1">
                <Label htmlFor={`ld-n-${i}`}>Carga</Label>
                <Input
                  id={`ld-n-${i}`}
                  disabled={disabled}
                  value={l.name}
                  onChange={(e) =>
                    set((d) => ({
                      ...d,
                      loads: d.loads.map((x) =>
                        x.id === l.id ? { ...x, name: e.target.value } : x,
                      ),
                    }))
                  }
                />
              </div>
              <NumberField
                id={`ld-p-${i}`}
                label="Potência (W)"
                min={1}
                max={10000000}
                disabled={disabled}
                value={l.powerW}
                onChange={(v) =>
                  v !== undefined &&
                  set((d) => ({
                    ...d,
                    loads: d.loads.map((x) => (x.id === l.id ? { ...x, powerW: v } : x)),
                  }))
                }
              />
              <NumberField
                id={`ld-q-${i}`}
                label="Quantidade"
                integer
                min={1}
                max={10000}
                disabled={disabled}
                value={l.quantity}
                onChange={(v) =>
                  v !== undefined &&
                  set((d) => ({
                    ...d,
                    loads: d.loads.map((x) => (x.id === l.id ? { ...x, quantity: v } : x)),
                  }))
                }
              />
              <NumberField
                id={`ld-h-${i}`}
                label="Horas/dia"
                min={0}
                max={24}
                disabled={disabled}
                value={l.hoursPerDay}
                onChange={(v) =>
                  v !== undefined &&
                  set((d) => ({
                    ...d,
                    loads: d.loads.map((x) => (x.id === l.id ? { ...x, hoursPerDay: v } : x)),
                  }))
                }
              />
              {!disabled ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    set((d) => ({ ...d, loads: d.loads.filter((x) => x.id !== l.id) }))
                  }
                >
                  Remover
                </Button>
              ) : null}
            </div>
          ))}
          {!disabled ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                set((d) => ({
                  ...d,
                  loads: [
                    ...d.loads,
                    {
                      id: newId('ld'),
                      name: 'Nova carga',
                      powerW: 100,
                      quantity: 1,
                      hoursPerDay: 1,
                      daysPerMonth: 30,
                    },
                  ],
                }))
              }
            >
              Adicionar carga
            </Button>
          ) : null}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">Adequações necessárias no padrão</legend>
          {data.adequacies.map((a, i) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3">
              <Input
                aria-label={`Adequação ${i + 1}`}
                className="min-w-72 flex-1"
                disabled={disabled}
                value={a.description}
                onChange={(e) =>
                  set((d) => ({
                    ...d,
                    adequacies: d.adequacies.map((x) =>
                      x.id === a.id ? { ...x, description: e.target.value } : x,
                    ),
                  }))
                }
              />
              <Label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={a.done}
                  onChange={(e) =>
                    set((d) => ({
                      ...d,
                      adequacies: d.adequacies.map((x) =>
                        x.id === a.id ? { ...x, done: e.target.checked } : x,
                      ),
                    }))
                  }
                />{' '}
                Feita
              </Label>
              {!disabled ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    set((d) => ({ ...d, adequacies: d.adequacies.filter((x) => x.id !== a.id) }))
                  }
                >
                  Remover
                </Button>
              ) : null}
            </div>
          ))}
          {!disabled ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                set((d) => ({
                  ...d,
                  adequacies: [
                    ...d.adequacies,
                    { id: newId('ad'), description: 'Ex.: trocar o disjuntor geral', done: false },
                  ],
                }))
              }
            >
              Adicionar adequação
            </Button>
          ) : null}
        </fieldset>

        <div className="grid gap-1">
          <Label htmlFor="sv-notes">Observações</Label>
          <Input
            id="sv-notes"
            disabled={disabled}
            value={text(data.notes)}
            onChange={(e) => set((d) => ({ ...d, notes: e.target.value || undefined }))}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {!disabled ? (
            <>
              <Button
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? <Spinner /> : null} Salvar rascunho
              </Button>
              <Button disabled={complete.isPending} onClick={() => complete.mutate()}>
                {complete.isPending ? <Spinner /> : null} Concluir levantamento
              </Button>
            </>
          ) : null}
          {completed ? (
            <Can permission="engine.project.write">
              <Button variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
                Reabrir para editar
              </Button>
            </Can>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
