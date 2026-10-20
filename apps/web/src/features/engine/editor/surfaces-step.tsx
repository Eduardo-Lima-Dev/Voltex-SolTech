import { Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Obstacle, Surface } from '@voltex/shared';
import { recommendedTiltDegrees } from '@voltex/solar-engine';
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
} from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { LayoutPreview, MonthlyLossBars, SunChart } from './charts';
import { moduleLabel, useEditor } from './editor-context';
import { NumberField } from './number-field';

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Superfície nova com valores de partida coerentes com o local (face ao equador e inclinação recomendada). */
export function defaultSurface(latitude: number, n: number): Surface {
  return {
    id: newId('s'),
    name: `Superfície ${n}`,
    kind: 'PITCHED',
    azimuthDegrees: latitude < 0 ? 0 : 180,
    tiltDegrees: Math.min(90, Math.max(10, Math.round(recommendedTiltDegrees(latitude)))),
    widthM: 8,
    depthM: 4,
    setbackM: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3 },
    moduleOrientation: 'PORTRAIT',
    moduleGapM: 0.02,
    obstacles: [],
  };
}

const MONTH_NAMES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

function ObstacleEditor({
  obstacle,
  index,
  readOnly,
  onChange,
  onRemove,
}: {
  obstacle: Obstacle;
  index: number;
  readOnly: boolean;
  onChange: (o: Obstacle) => void;
  onRemove: () => void;
}) {
  const p = `ob-${obstacle.id}`;
  return (
    <li className="space-y-3 rounded-lg border p-3">
      <div className="flex items-end justify-between gap-2">
        <div className="grid flex-1 gap-1">
          <Label htmlFor={`${p}-name`}>Obstáculo {index + 1}</Label>
          <Input
            id={`${p}-name`}
            disabled={readOnly}
            value={obstacle.name}
            onChange={(e) => onChange({ ...obstacle, name: e.target.value })}
          />
        </div>
        {!readOnly ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Remover ${obstacle.name}`}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField
          id={`${p}-az`}
          label="Direção"
          unit="°"
          min={0}
          max={359.9}
          value={obstacle.azimuthDegrees}
          disabled={readOnly}
          onChange={(v) => v !== undefined && onChange({ ...obstacle, azimuthDegrees: v })}
          hint="0 = norte, 90 = leste"
        />
        <NumberField
          id={`${p}-dist`}
          label="Distância"
          unit="m"
          min={0.1}
          max={500}
          value={obstacle.distanceM}
          disabled={readOnly}
          onChange={(v) => v !== undefined && onChange({ ...obstacle, distanceM: v })}
        />
        <NumberField
          id={`${p}-h`}
          label="Altura do topo"
          unit="m"
          min={-50}
          max={200}
          value={obstacle.heightM}
          disabled={readOnly}
          onChange={(v) => v !== undefined && onChange({ ...obstacle, heightM: v })}
          hint="Acima da base do arranjo"
        />
        <NumberField
          id={`${p}-w`}
          label="Largura"
          unit="m"
          min={0.05}
          max={500}
          value={obstacle.widthM}
          disabled={readOnly}
          onChange={(v) => v !== undefined && onChange({ ...obstacle, widthM: v })}
        />
      </div>
    </li>
  );
}

/** Etapa 2: superfícies, layout dos módulos (prévia 2D) e sombreamento (carta solar e perda mensal). */
export function SurfacesStep() {
  const { design, update, readOnly, results, modules } = useEditor();
  const [selectedId, setSelectedId] = useState<string | null>(design.surfaces[0]?.id ?? null);
  const selected = design.surfaces.find((s) => s.id === selectedId) ?? design.surfaces[0];
  const layout = results.layout.find((l) => l.surfaceId === selected?.id);
  const shading = results.shading.find((s) => s.surfaceId === selected?.id);

  const patchSurface = (id: string, fn: (s: Surface) => Surface) =>
    update((d) => ({ ...d, surfaces: d.surfaces.map((s) => (s.id === id ? fn(s) : s)) }));
  const add = () => {
    const surface = defaultSurface(design.site.latitude, design.surfaces.length + 1);
    update((d) => ({ ...d, surfaces: [...d.surfaces, surface] }));
    setSelectedId(surface.id);
  };
  const duplicate = (s: Surface) => {
    const copy: Surface = { ...structuredClone(s), id: newId('s'), name: `${s.name} (cópia)` };
    update((d) => ({ ...d, surfaces: [...d.surfaces, copy] }));
    setSelectedId(copy.id);
  };
  const remove = (id: string) => {
    update((d) => ({ ...d, surfaces: d.surfaces.filter((s) => s.id !== id) }));
    setSelectedId(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Módulo do projeto</CardTitle>
          <CardDescription>
            Só módulos <strong>aprovados</strong> do catálogo aparecem aqui. Cada superfície pode
            usar outro módulo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-md gap-1">
          <Label htmlFor="default-module">Módulo padrão</Label>
          <NativeSelect
            id="default-module"
            disabled={readOnly}
            value={design.defaultModuleId ?? ''}
            onChange={(e) =>
              update((d) => ({ ...d, defaultModuleId: e.target.value || undefined }))
            }
          >
            <option value="">Selecione</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.manufacturer} {m.model} ({(m.spec as { pmaxWp: number }).pmaxWp} Wp)
              </option>
            ))}
          </NativeSelect>
          {modules.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum módulo aprovado. Cadastre e aprove um no catálogo.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Superfícies</CardTitle>
            {!readOnly ? (
              <Button size="sm" variant="outline" onClick={add}>
                <Plus /> Nova
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {design.surfaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma superfície. Adicione a primeira água do telhado ou laje.
              </p>
            ) : (
              <ul className="space-y-1" aria-label="Superfícies do projeto">
                {design.surfaces.map((s) => {
                  const l = results.layout.find((x) => x.surfaceId === s.id);
                  const active = s.id === selected?.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-current={active}
                        onClick={() => setSelectedId(s.id)}
                        className={`w-full rounded-md border px-3 py-2 text-left text-sm ${active ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
                      >
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {l
                            ? `${l.moduleCount} módulos${l.powerKwp !== null ? ` · ${formatNumber(l.powerKwp, 2)} kWp` : ''}`
                            : '—'}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {selected ? (
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle>{selected.name}</CardTitle>
                  <CardDescription>
                    Geometria da superfície e recuos. Medidas em metros.
                  </CardDescription>
                </div>
                {!readOnly ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => duplicate(selected)}>
                      <Copy /> Duplicar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => remove(selected.id)}>
                      <Trash2 /> Remover
                    </Button>
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="grid gap-1">
                    <Label htmlFor="sf-name">Nome</Label>
                    <Input
                      id="sf-name"
                      disabled={readOnly}
                      value={selected.name}
                      onChange={(e) =>
                        patchSurface(selected.id, (s) => ({ ...s, name: e.target.value }))
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="sf-kind">Tipo</Label>
                    <NativeSelect
                      id="sf-kind"
                      disabled={readOnly}
                      value={selected.kind}
                      onChange={(e) =>
                        patchSurface(selected.id, (s) => ({
                          ...s,
                          kind: e.target.value as Surface['kind'],
                        }))
                      }
                    >
                      <option value="PITCHED">
                        Telhado inclinado (módulos no plano do telhado)
                      </option>
                      <option value="FLAT_RACK">Laje ou solo (estrutura inclinada)</option>
                    </NativeSelect>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="sf-orient">Módulos em</Label>
                    <NativeSelect
                      id="sf-orient"
                      disabled={readOnly}
                      value={selected.moduleOrientation}
                      onChange={(e) =>
                        patchSurface(selected.id, (s) => ({
                          ...s,
                          moduleOrientation: e.target.value as Surface['moduleOrientation'],
                        }))
                      }
                    >
                      <option value="PORTRAIT">Retrato</option>
                      <option value="LANDSCAPE">Paisagem</option>
                    </NativeSelect>
                  </div>
                  <NumberField
                    id="sf-az"
                    label="Azimute da face"
                    unit="°"
                    min={0}
                    max={359.9}
                    value={selected.azimuthDegrees}
                    disabled={readOnly}
                    onChange={(v) =>
                      v !== undefined &&
                      patchSurface(selected.id, (s) => ({ ...s, azimuthDegrees: v }))
                    }
                    hint="0 = norte, 90 = leste, 180 = sul"
                  />
                  <NumberField
                    id="sf-tilt"
                    label="Inclinação"
                    unit="°"
                    min={0}
                    max={90}
                    value={selected.tiltDegrees}
                    disabled={readOnly}
                    onChange={(v) =>
                      v !== undefined &&
                      patchSurface(selected.id, (s) => ({ ...s, tiltDegrees: v }))
                    }
                  />
                  <NumberField
                    id="sf-gap"
                    label="Folga entre módulos"
                    unit="m"
                    min={0}
                    max={0.2}
                    value={selected.moduleGapM}
                    disabled={readOnly}
                    onChange={(v) =>
                      v !== undefined && patchSurface(selected.id, (s) => ({ ...s, moduleGapM: v }))
                    }
                  />
                  <NumberField
                    id="sf-w"
                    label="Largura (beiral)"
                    unit="m"
                    min={0.5}
                    max={500}
                    value={selected.widthM}
                    disabled={readOnly}
                    onChange={(v) =>
                      v !== undefined && patchSurface(selected.id, (s) => ({ ...s, widthM: v }))
                    }
                  />
                  <NumberField
                    id="sf-d"
                    label={
                      selected.kind === 'PITCHED'
                        ? 'Profundidade (ao longo da água)'
                        : 'Profundidade (horizontal)'
                    }
                    unit="m"
                    min={0.5}
                    max={500}
                    value={selected.depthM}
                    disabled={readOnly}
                    onChange={(v) =>
                      v !== undefined && patchSurface(selected.id, (s) => ({ ...s, depthM: v }))
                    }
                  />
                  <NumberField
                    id="sf-count"
                    label="Limitar a quantidade"
                    unit="módulos"
                    integer
                    optional
                    min={1}
                    max={5000}
                    value={selected.moduleCount}
                    disabled={readOnly}
                    onChange={(v) => patchSurface(selected.id, (s) => ({ ...s, moduleCount: v }))}
                    hint="Vazio = todos os que cabem"
                  />
                  {selected.kind === 'FLAT_RACK' ? (
                    <NumberField
                      id="sf-rowsp"
                      label="Espaçamento entre fileiras"
                      unit="m"
                      optional
                      min={0}
                      max={20}
                      value={selected.rowSpacingM}
                      disabled={readOnly}
                      onChange={(v) => patchSurface(selected.id, (s) => ({ ...s, rowSpacingM: v }))}
                      hint={
                        layout?.minRowSpacingM != null
                          ? `Vazio = o mínimo calculado (${formatNumber(layout.minRowSpacingM, 2)} m)`
                          : undefined
                      }
                    />
                  ) : null}
                  <div className="grid gap-1">
                    <Label htmlFor="sf-module">Módulo desta superfície</Label>
                    <NativeSelect
                      id="sf-module"
                      disabled={readOnly}
                      value={selected.moduleId ?? ''}
                      onChange={(e) =>
                        patchSurface(selected.id, (s) => ({
                          ...s,
                          moduleId: e.target.value || undefined,
                        }))
                      }
                    >
                      <option value="">
                        Usar o padrão ({moduleLabel(modules, design.defaultModuleId)})
                      </option>
                      {modules.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.manufacturer} {m.model}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
                <fieldset className="grid gap-3 sm:grid-cols-4">
                  <legend className="mb-1 text-sm font-medium">Recuos (m)</legend>
                  {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
                    <NumberField
                      key={side}
                      id={`sf-sb-${side}`}
                      label={
                        { left: 'Esquerda', right: 'Direita', top: 'Topo', bottom: 'Base' }[side]
                      }
                      min={0}
                      max={10}
                      value={selected.setbackM[side]}
                      disabled={readOnly}
                      onChange={(v) =>
                        v !== undefined &&
                        patchSurface(selected.id, (s) => ({
                          ...s,
                          setbackM: { ...s.setbackM, [side]: v },
                        }))
                      }
                    />
                  ))}
                </fieldset>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Layout dos módulos</CardTitle>
                <CardDescription>
                  Prévia em planta, na vista da própria superfície. Recuos em tracejado.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {layout ? (
                  <>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Badge variant="secondary">{layout.moduleCount} módulos</Badge>
                      <Badge variant="secondary">
                        {layout.rows} fileira(s) × {layout.columns} coluna(s)
                      </Badge>
                      {layout.powerKwp !== null ? (
                        <Badge variant="secondary">{formatNumber(layout.powerKwp, 2)} kWp</Badge>
                      ) : null}
                      {layout.moduleAreaM2 !== null ? (
                        <Badge variant="secondary">
                          {formatNumber(layout.moduleAreaM2, 1)} m² de módulos
                        </Badge>
                      ) : null}
                      {layout.fitCount > layout.moduleCount ? (
                        <Badge variant="outline">cabem {layout.fitCount}</Badge>
                      ) : null}
                    </div>
                    {layout.warnings.map((w) => (
                      <p
                        key={w}
                        className="rounded border border-warning/50 bg-warning/10 p-2 text-sm"
                      >
                        {w}
                      </p>
                    ))}
                  </>
                ) : null}
                <LayoutPreview surface={selected} layout={layout} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Obstáculos próximos</CardTitle>
                <CardDescription>
                  Caixa d&apos;água, platibanda, árvore, prédio vizinho: tudo que projeta sombra no
                  arranjo.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {selected.obstacles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum obstáculo informado.</p>
                ) : null}
                <ul className="space-y-3">
                  {selected.obstacles.map((o, i) => (
                    <ObstacleEditor
                      key={o.id}
                      obstacle={o}
                      index={i}
                      readOnly={readOnly}
                      onChange={(next) =>
                        patchSurface(selected.id, (s) => ({
                          ...s,
                          obstacles: s.obstacles.map((x) => (x.id === o.id ? next : x)),
                        }))
                      }
                      onRemove={() =>
                        patchSurface(selected.id, (s) => ({
                          ...s,
                          obstacles: s.obstacles.filter((x) => x.id !== o.id),
                        }))
                      }
                    />
                  ))}
                </ul>
                {!readOnly ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      patchSurface(selected.id, (s) => ({
                        ...s,
                        obstacles: [
                          ...s.obstacles,
                          {
                            id: newId('o'),
                            name: `Obstáculo ${s.obstacles.length + 1}`,
                            azimuthDegrees: 90,
                            distanceM: 5,
                            heightM: 3,
                            widthM: 3,
                          },
                        ],
                      }))
                    }
                  >
                    <Plus /> Adicionar obstáculo
                  </Button>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sombreamento</CardTitle>
                <CardDescription>
                  Estimativa pela posição do sol (horizonte do local e obstáculos), ponderada pela
                  radiação direta com céu claro. A luz difusa não é sombreada pelos obstáculos e não
                  há penumbra.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {shading ? (
                  <>
                    <p className="text-sm">
                      Perda anual estimada:{' '}
                      <strong className="tabular-nums">
                        {formatNumber(shading.annualLossPct, 1)}%
                      </strong>
                      {shading.overridden ? ` (informada à mão: ${shading.overrideSource})` : ''}
                    </p>
                    {shading.warnings.map((w) => (
                      <p
                        key={w}
                        className="rounded border border-warning/50 bg-warning/10 p-2 text-sm"
                      >
                        {w}
                      </p>
                    ))}
                    <SunChart shading={shading} horizon={design.site.horizon} />
                    <MonthlyLossBars values={shading.monthlyLossPct} />
                    <p className="sr-only">
                      Perda por mês:{' '}
                      {shading.monthlyLossPct
                        .map((v, i) => `${MONTH_NAMES[i]} ${formatNumber(v, 1)}%`)
                        .join(', ')}
                      .
                    </p>
                  </>
                ) : null}
                <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                  <legend className="px-1 text-sm font-medium">
                    Perda por sombra informada à mão (opcional)
                  </legend>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Use quando houver medição (ex.: visita técnica com instrumento). Substitui o
                    cálculo e <strong>exige a fonte</strong>.
                  </p>
                  <NumberField
                    id="sf-ovr-pct"
                    label="Perda anual"
                    unit="%"
                    optional
                    min={0}
                    max={100}
                    value={selected.shadingLossOverride?.pct}
                    disabled={readOnly}
                    onChange={(v) =>
                      patchSurface(selected.id, (s) =>
                        v === undefined
                          ? (({ shadingLossOverride: _drop, ...rest }) => rest)(s)
                          : {
                              ...s,
                              shadingLossOverride: {
                                pct: v,
                                source: s.shadingLossOverride?.source ?? '',
                              },
                            },
                      )
                    }
                  />
                  <div className="grid gap-1">
                    <Label htmlFor="sf-ovr-src">Fonte da medição</Label>
                    <Input
                      id="sf-ovr-src"
                      disabled={readOnly || !selected.shadingLossOverride}
                      value={selected.shadingLossOverride?.source ?? ''}
                      onChange={(e) =>
                        patchSurface(selected.id, (s) =>
                          s.shadingLossOverride
                            ? {
                                ...s,
                                shadingLossOverride: {
                                  ...s.shadingLossOverride,
                                  source: e.target.value,
                                },
                              }
                            : s,
                        )
                      }
                    />
                    {selected.shadingLossOverride &&
                    selected.shadingLossOverride.source.trim().length < 3 ? (
                      <p className="text-xs text-destructive">
                        Informe a fonte (mínimo 3 caracteres) para salvar.
                      </p>
                    ) : null}
                  </div>
                </fieldset>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Adicione uma superfície para modelar o telhado e calcular o layout e o sombreamento.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
