import { Plus, Trash2 } from 'lucide-react';
import type { OffgridLoad } from '@voltex/shared';
import { offgridLoadSchema } from '@voltex/shared';
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
} from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { NumberField } from '../../engine/editor/number-field';
import { LoadCurveChart } from './charts';
import { useOffgrid } from './offgrid-context';

const PRESETS: {
  name: string;
  powerW: number;
  hoursPerDay: number;
  surgeFactor?: number;
  critical?: boolean;
  windowStartHour?: number;
  windowEndHour?: number;
  quantity?: number;
}[] = [
  { name: 'Geladeira', powerW: 120, hoursPerDay: 12, surgeFactor: 4, critical: true },
  {
    name: 'Iluminação LED',
    powerW: 10,
    quantity: 8,
    hoursPerDay: 5,
    windowStartHour: 18,
    windowEndHour: 24,
  },
  { name: 'TV e roteador', powerW: 120, hoursPerDay: 5, windowStartHour: 18, windowEndHour: 23 },
  {
    name: 'Bomba d’água',
    powerW: 370,
    hoursPerDay: 1,
    surgeFactor: 5,
    windowStartHour: 8,
    windowEndHour: 12,
  },
  { name: 'Ventilador', powerW: 70, hoursPerDay: 8, windowStartHour: 12, windowEndHour: 22 },
];

const newId = () => `l${Math.random().toString(36).slice(2, 8)}`;

/** Etapa 2: cargas, janela de uso e perfil diário. */
export function LoadsStep() {
  const { design, update, readOnly, results } = useOffgrid();
  const patchLoad = (id: string, patch: Partial<OffgridLoad>) =>
    update((d) => ({ ...d, loads: d.loads.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const add = (preset?: (typeof PRESETS)[number]) =>
    update((d) => ({
      ...d,
      loads: [
        ...d.loads,
        offgridLoadSchema.parse({
          id: newId(),
          name: preset?.name ?? 'Nova carga',
          powerW: preset?.powerW ?? 100,
          hoursPerDay: preset?.hoursPerDay ?? 4,
          ...(preset ?? {}),
        }),
      ],
    }));
  const load = results.load;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Cargas</CardTitle>
          <CardDescription>
            Potência, quantidade, horas por dia e janela de uso. A partida (surto) vale para
            motores; “crítica” marca o que precisa funcionar sempre.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!readOnly ? (
            <div className="flex flex-wrap gap-2" aria-label="Cargas comuns">
              {PRESETS.map((p) => (
                <Button key={p.name} size="sm" variant="outline" onClick={() => add(p)}>
                  <Plus /> {p.name}
                </Button>
              ))}
              <Button size="sm" onClick={() => add()}>
                <Plus /> Outra carga
              </Button>
            </div>
          ) : null}
          {design.loads.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma carga cadastrada.</p>
          ) : null}
          {design.loads.map((l, index) => (
            <fieldset
              key={l.id}
              className="grid gap-3 rounded border p-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <legend className="px-1 text-sm font-medium">Carga {index + 1}</legend>
              <div className="grid gap-1">
                <Label htmlFor={`l-name-${l.id}`}>Nome</Label>
                <Input
                  id={`l-name-${l.id}`}
                  disabled={readOnly}
                  value={l.name}
                  onChange={(e) => patchLoad(l.id, { name: e.target.value })}
                />
              </div>
              <NumberField
                id={`l-p-${l.id}`}
                label="Potência"
                unit="W"
                min={0.1}
                disabled={readOnly}
                value={l.powerW}
                onChange={(v) => v !== undefined && patchLoad(l.id, { powerW: v })}
              />
              <NumberField
                id={`l-q-${l.id}`}
                label="Quantidade"
                integer
                min={1}
                disabled={readOnly}
                value={l.quantity}
                onChange={(v) => v !== undefined && patchLoad(l.id, { quantity: v })}
              />
              <div className="grid gap-1">
                <Label htmlFor={`l-kind-${l.id}`}>Tipo</Label>
                <NativeSelect
                  id={`l-kind-${l.id}`}
                  disabled={readOnly}
                  value={l.kind}
                  onChange={(e) => patchLoad(l.id, { kind: e.target.value as 'AC' | 'DC' })}
                >
                  <option value="AC">CA (passa pelo inversor)</option>
                  <option value="DC">CC (direto no banco)</option>
                </NativeSelect>
              </div>
              <NumberField
                id={`l-h-${l.id}`}
                label="Horas por dia"
                unit="h"
                min={0}
                max={24}
                disabled={readOnly}
                value={l.hoursPerDay}
                onChange={(v) => v !== undefined && patchLoad(l.id, { hoursPerDay: v })}
              />
              <NumberField
                id={`l-s-${l.id}`}
                label="Início da janela"
                unit="h"
                integer
                min={0}
                max={23}
                disabled={readOnly}
                value={l.windowStartHour}
                onChange={(v) => v !== undefined && patchLoad(l.id, { windowStartHour: v })}
              />
              <NumberField
                id={`l-e-${l.id}`}
                label="Fim da janela"
                unit="h"
                integer
                min={1}
                max={24}
                disabled={readOnly}
                value={l.windowEndHour}
                onChange={(v) => v !== undefined && patchLoad(l.id, { windowEndHour: v })}
              />
              <NumberField
                id={`l-u-${l.id}`}
                label="Fator de partida"
                min={1}
                max={12}
                disabled={readOnly}
                value={l.surgeFactor}
                hint="1 = sem pico; motores 3 a 6"
                onChange={(v) => v !== undefined && patchLoad(l.id, { surgeFactor: v })}
              />
              <NumberField
                id={`l-sim-${l.id}`}
                label="Simultaneidade"
                min={0}
                max={1}
                disabled={readOnly}
                value={l.simultaneity}
                hint="0 a 1 no pico"
                onChange={(v) => v !== undefined && patchLoad(l.id, { simultaneity: v })}
              />
              <label className="flex items-center gap-2 self-end text-sm">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={l.critical}
                  onChange={(e) => patchLoad(l.id, { critical: e.target.checked })}
                />
                Carga crítica
              </label>
              {!readOnly ? (
                <Button
                  className="self-end justify-self-end"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remover ${l.name}`}
                  onClick={() =>
                    update((d) => ({ ...d, loads: d.loads.filter((x) => x.id !== l.id) }))
                  }
                >
                  <Trash2 /> Remover
                </Button>
              ) : null}
            </fieldset>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Perfil de consumo</CardTitle>
          <CardDescription>
            Mês de maior consumo:{' '}
            {
              ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][
                load.criticalMonthIndex
              ]
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Energia diária</dt>
            <dd>
              {formatNumber(load.dailyWh, 0)} Wh (CA {formatNumber(load.dailyAcWh, 0)} · CC{' '}
              {formatNumber(load.dailyDcWh, 0)})
            </dd>
            <dt>Energia crítica</dt>
            <dd>{formatNumber(load.criticalDailyWh, 0)} Wh/dia</dd>
            <dt>Pico</dt>
            <dd>{formatNumber(load.peakW, 0)} W</dd>
            <dt>Partida (surto)</dt>
            <dd>{formatNumber(load.surgeW, 0)} W</dd>
            <dt>Potência instalada</dt>
            <dd>{formatNumber(load.installedW, 0)} W</dd>
            <dt>Consumo noturno</dt>
            <dd>{formatNumber(load.nightFraction * 100, 0)}%</dd>
          </dl>
          <LoadCurveChart hourlyWh={load.hourlyWh} />
        </CardContent>
      </Card>
    </div>
  );
}
