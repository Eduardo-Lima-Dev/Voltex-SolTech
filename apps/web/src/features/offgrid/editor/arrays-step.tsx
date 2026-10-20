import { Plus, Trash2 } from 'lucide-react';
import type { OffgridArray } from '@voltex/shared';
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
} from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { EquipmentSearch } from '../../engine/editor/equipment-search';
import { NumberField } from '../../engine/editor/number-field';
import { CHECK_BADGE, CHECK_LABEL } from '../labels';
import { useOffgrid } from './offgrid-context';

const CODES = [
  'VOC_COLD',
  'VMPP',
  'ARRAY_BELOW',
  'PWM_CANNOT',
  'CONTROLLER_CURRENT',
  'CONTROLLER_POWER',
  'DESIGN_TMIN',
];

/** Etapa 4: arranjos fotovoltaicos (módulo, strings, orientação e sombra). */
export function ArraysStep() {
  const { design, update, readOnly, results, labelOf } = useOffgrid();
  const patch = (id: string, p: Partial<OffgridArray>) =>
    update((d) => ({ ...d, arrays: d.arrays.map((a) => (a.id === id ? { ...a, ...p } : a)) }));
  const add = () =>
    update((d) => ({
      ...d,
      arrays: [
        ...d.arrays,
        {
          id: `a${Math.random().toString(36).slice(2, 7)}`,
          name: `Arranjo ${d.arrays.length + 1}`,
          modulesInSeries: 1,
          parallelStrings: 1,
          azimuthDegrees: results.resource.azimuthDegrees ?? 0,
          tiltDegrees: results.resource.tiltDegrees ?? 15,
          shadingLossPct: 0,
        },
      ],
    }));
  const relevant = results.checks.filter((c) => CODES.some((p) => c.code.startsWith(p)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Arranjos fotovoltaicos</CardTitle>
        <CardDescription>
          Módulos em série definem a tensão (Voc a frio dentro do controlador); strings em paralelo
          definem a corrente. Potência total: {formatNumber(results.selected?.pvPowerWp ?? 0, 0)} Wp
          (necessário:{' '}
          {Number.isFinite(results.sizing.pvPowerWp)
            ? formatNumber(results.sizing.pvPowerWp, 0)
            : '—'}{' '}
          Wp).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {design.arrays.map((a) => (
          <fieldset
            key={a.id}
            className="grid gap-3 rounded border p-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <legend className="px-1 text-sm font-medium">{a.name}</legend>
            <div className="grid gap-1">
              <Label htmlFor={`a-name-${a.id}`}>Nome</Label>
              <Input
                id={`a-name-${a.id}`}
                disabled={readOnly}
                value={a.name}
                onChange={(e) => patch(a.id, { name: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-2">
              <EquipmentSearch
                kind="MODULE"
                label={`Módulo (atual: ${labelOf(a.moduleId)})`}
                disabled={readOnly}
                onPick={(id) => patch(a.id, { moduleId: id })}
              />
            </div>
            <NumberField
              id={`a-s-${a.id}`}
              label="Módulos em série"
              integer
              min={1}
              max={40}
              disabled={readOnly}
              value={a.modulesInSeries}
              onChange={(v) => v !== undefined && patch(a.id, { modulesInSeries: v })}
            />
            <NumberField
              id={`a-p-${a.id}`}
              label="Strings em paralelo"
              integer
              min={1}
              max={50}
              disabled={readOnly}
              value={a.parallelStrings}
              onChange={(v) => v !== undefined && patch(a.id, { parallelStrings: v })}
            />
            <NumberField
              id={`a-az-${a.id}`}
              label="Azimute"
              unit="°"
              min={0}
              max={359.9}
              disabled={readOnly}
              value={a.azimuthDegrees}
              hint="0° = norte"
              onChange={(v) => v !== undefined && patch(a.id, { azimuthDegrees: v })}
            />
            <NumberField
              id={`a-t-${a.id}`}
              label="Inclinação"
              unit="°"
              min={0}
              max={90}
              disabled={readOnly}
              value={a.tiltDegrees}
              onChange={(v) => v !== undefined && patch(a.id, { tiltDegrees: v })}
            />
            <NumberField
              id={`a-sh-${a.id}`}
              label="Perda por sombra"
              unit="%"
              min={0}
              max={100}
              disabled={readOnly}
              value={a.shadingLossPct}
              onChange={(v) => v !== undefined && patch(a.id, { shadingLossPct: v })}
            />
            {!readOnly ? (
              <Button
                className="self-end justify-self-end"
                variant="ghost"
                size="sm"
                aria-label={`Remover ${a.name}`}
                onClick={() =>
                  update((d) => ({ ...d, arrays: d.arrays.filter((x) => x.id !== a.id) }))
                }
              >
                <Trash2 /> Remover
              </Button>
            ) : null}
          </fieldset>
        ))}
        {!readOnly ? (
          <Button variant="outline" onClick={add}>
            <Plus /> Adicionar arranjo
          </Button>
        ) : null}
        {relevant.length > 0 ? (
          <ul className="space-y-1 text-sm" aria-label="Verificações do arranjo">
            {relevant.map((c, i) => (
              <li key={`${c.code}-${i}`} className="flex gap-2">
                <Badge variant={CHECK_BADGE[c.severity]}>{CHECK_LABEL[c.severity]}</Badge>
                {c.message}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
