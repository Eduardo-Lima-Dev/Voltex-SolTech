import { useMutation } from '@tanstack/react-query';
import { Wand2 } from 'lucide-react';
import { useState } from 'react';
import type { OffgridSuggestion } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  NativeSelect,
  Spinner,
  toast,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatNumber } from '@/lib/format';
import { NumberField } from '../../engine/editor/number-field';
import { MONTHS, SYSTEM_TYPE_LABELS } from '../labels';
import { useOffgrid } from './offgrid-context';

/** Etapa 3: premissas, recurso solar, dimensionamento pelo mês crítico e sugestão do catálogo. */
export function PremisesStep() {
  const { design, update, readOnly, results, version, labelOf } = useOffgrid();
  const { sizing, resource } = results;
  const [suggestions, setSuggestions] = useState<OffgridSuggestion[] | null>(null);

  const suggest = useMutation({
    mutationFn: () => endpoints.offgrid.suggest(version.id, design),
    onSuccess: (list) => {
      setSuggestions(list);
      if (list.length === 0)
        toast.info('Nenhuma combinação do catálogo aprovado atende estas cargas.');
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível sugerir.')),
  });
  const apply = (s: OffgridSuggestion) => {
    update((d) => ({
      ...d,
      arrays: [
        {
          id: d.arrays[0]?.id ?? 'a1',
          name: d.arrays[0]?.name ?? 'Arranjo 1',
          moduleId: s.moduleId,
          modulesInSeries: s.modulesInSeries,
          parallelStrings: s.parallelStrings,
          azimuthDegrees: d.arrays[0]?.azimuthDegrees ?? resource.azimuthDegrees ?? 0,
          tiltDegrees: d.arrays[0]?.tiltDegrees ?? resource.tiltDegrees ?? 15,
          shadingLossPct: d.arrays[0]?.shadingLossPct ?? 0,
          ...(d.arrays[0]?.positionM ? { positionM: d.arrays[0].positionM } : {}),
        },
        ...d.arrays.slice(1),
      ],
      bank: {
        ...d.bank,
        batteryId: s.batteryId,
        seriesCount: s.batterySeries,
        parallelCount: s.batteryParallel,
      },
      controllerId: s.controllerId ?? undefined,
      inverterId: s.inverterId,
      inverterCount: s.inverterCount,
    }));
    toast.success('Sugestão aplicada: revise as etapas seguintes.');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Premissas</CardTitle>
          <CardDescription>
            Tipo de sistema, tensão do banco, autonomia e redutores do dimensionamento.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="og-system">Tipo de sistema</Label>
            <NativeSelect
              id="og-system"
              disabled={readOnly}
              value={design.systemType}
              onChange={(e) =>
                update((d) => ({ ...d, systemType: e.target.value as 'OFFGRID' | 'HYBRID' }))
              }
            >
              {(['OFFGRID', 'HYBRID'] as const).map((t) => (
                <option key={t} value={t}>
                  {SYSTEM_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="og-voltage">Tensão do banco (V)</Label>
            <NativeSelect
              id="og-voltage"
              disabled={readOnly}
              value={design.systemVoltageV}
              onChange={(e) =>
                update((d) => ({ ...d, systemVoltageV: Number(e.target.value) as 12 | 24 | 48 }))
              }
            >
              {[12, 24, 48].map((v) => (
                <option key={v} value={v}>
                  {v} V
                </option>
              ))}
            </NativeSelect>
          </div>
          <NumberField
            id="og-autonomy"
            label="Autonomia de projeto"
            unit="dias"
            min={0.5}
            max={14}
            disabled={readOnly}
            value={design.autonomyDays}
            onChange={(v) => v !== undefined && update((d) => ({ ...d, autonomyDays: v }))}
            hint={
              sizing.suggestedAutonomyDays !== null
                ? `Referência do manual: ${formatNumber(sizing.suggestedAutonomyDays, 2)} dias`
                : undefined
            }
          />
          <NumberField
            id="og-red1"
            label="Redutor 1 (temperatura, sujeira, mismatch)"
            min={0.3}
            max={1}
            optional
            disabled={readOnly}
            value={design.red1}
            onChange={(v) => update((d) => ({ ...d, red1: v }))}
            hint={`Em uso: ${formatNumber(sizing.red1, 2)} (vazio = valor da regra)`}
          />
          <NumberField
            id="og-red2"
            label="Redutor 2 (cabos e controlador)"
            min={0.3}
            max={1}
            optional
            disabled={readOnly}
            value={design.red2}
            onChange={(v) => update((d) => ({ ...d, red2: v }))}
            hint={`Em uso: ${formatNumber(sizing.red2, 2)}`}
          />
          <NumberField
            id="og-etabat"
            label="Eficiência do banco"
            min={0.5}
            max={1}
            optional
            disabled={readOnly}
            value={design.batteryEfficiency}
            onChange={(v) => update((d) => ({ ...d, batteryEfficiency: v }))}
            hint={`Em uso: ${formatNumber(sizing.batteryEfficiency, 2)}`}
          />
          <NumberField
            id="og-etainv"
            label="Eficiência do inversor"
            min={0.5}
            max={1}
            optional
            disabled={readOnly}
            value={design.inverterEfficiency}
            onChange={(v) => update((d) => ({ ...d, inverterEfficiency: v }))}
            hint={`Em uso: ${formatNumber(sizing.inverterEfficiency, 2)}`}
          />
          <NumberField
            id="og-albedo"
            label="Albedo do solo"
            min={0}
            max={1}
            optional
            disabled={readOnly}
            value={design.albedo}
            onChange={(v) => update((d) => ({ ...d, albedo: v }))}
            hint="Vazio ignora a reflexão do solo"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recurso solar e dimensionamento</CardTitle>
          <CardDescription>
            Método do mês crítico (CRESESB): o mês de projeto é {MONTHS[resource.designMonthIndex]},
            com {formatNumber(resource.hspDesign, 2)} kWh/m²·dia no plano.
            {resource.source === 'SYNTHETIC'
              ? ' Recurso estimado da climatologia mensal; para a série horária, escolha a série na etapa Simulação.'
              : ''}
            {resource.source === 'NONE' ? ' Sem clima: busque-o na etapa Local.' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1 text-xs sm:grid-cols-6" aria-label="HSP por mês">
            {MONTHS.map((m, i) => (
              <span key={m}>
                {m}: {formatNumber(resource.hspMonthly[i] ?? 0, 2)}
              </span>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
            <dt>Energia do banco por dia</dt>
            <dd>{formatNumber(sizing.energyRequiredWh, 0)} Wh</dd>
            <dt>Potência FV de pico</dt>
            <dd>
              {Number.isFinite(sizing.pvPowerWp) ? `${formatNumber(sizing.pvPowerWp, 0)} Wp` : '—'}
              {sizing.moduleCount ? ` (${sizing.moduleCount} módulos)` : ''}
            </dd>
            <dt>Banco necessário</dt>
            <dd>
              {sizing.bankWhRequired !== null
                ? `${formatNumber(sizing.bankWhRequired, 0)} Wh · ${formatNumber(sizing.bankAhRequired ?? 0, 0)} Ah`
                : 'escolha a bateria'}
            </dd>
            <dt>Inversor mínimo</dt>
            <dd>
              {formatNumber(sizing.inverterContinuousW, 0)} W · surto{' '}
              {formatNumber(sizing.inverterSurgeW, 0)} W
            </dd>
          </dl>
          {!readOnly ? (
            <Button variant="outline" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
              {suggest.isPending ? <Spinner /> : <Wand2 />} Sugerir configurações do catálogo
            </Button>
          ) : null}
          {suggestions && suggestions.length > 0 ? (
            <ul className="space-y-2" aria-label="Configurações sugeridas">
              {suggestions.map((s, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
                >
                  <div className="space-y-1">
                    <p className="font-medium">
                      {labelOf(s.moduleId)} · {s.modulesInSeries} em série × {s.parallelStrings} (
                      {formatNumber(s.pvPowerWp, 0)} Wp)
                    </p>
                    <p className="text-muted-foreground">
                      {labelOf(s.batteryId)} × {s.batterySeries * s.batteryParallel} (
                      {formatNumber(s.bankNominalWh, 0)} Wh) · {labelOf(s.inverterId)}
                      {s.inverterCount > 1 ? ` × ${s.inverterCount}` : ''} ·{' '}
                      {s.controllerId ? labelOf(s.controllerId) : 'MPPT embutido'}
                    </p>
                    <p className="flex flex-wrap gap-2">
                      {s.lolpPct !== null ? (
                        <Badge variant={s.lolpPct <= 5 ? 'green' : 'yellow'}>
                          perda de carga {formatNumber(s.lolpPct, 2)}%
                        </Badge>
                      ) : null}
                      {s.capexCents !== null ? (
                        <Badge variant="secondary">
                          {(s.capexCents / 100).toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })}
                        </Badge>
                      ) : null}
                      {s.notes.map((n) => (
                        <Badge key={n} variant="yellow">
                          {n}
                        </Badge>
                      ))}
                    </p>
                  </div>
                  {!readOnly ? (
                    <Button size="sm" onClick={() => apply(s)}>
                      Usar esta
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
