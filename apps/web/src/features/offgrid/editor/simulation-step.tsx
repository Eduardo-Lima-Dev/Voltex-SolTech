import { WEATHER_SERIES_FIRST_YEAR, WEATHER_SERIES_LAST_YEAR } from '@voltex/shared';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  NativeSelect,
} from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { NumberField } from '../../engine/editor/number-field';
import { CHECK_BADGE, CHECK_LABEL, RESULT_STATUS_BADGE, RESULT_STATUS_LABELS } from '../labels';
import { MonthlyBars, SocYearChart, TypicalDayChart } from './charts';
import { useOffgrid } from './offgrid-context';

const years = Array.from(
  { length: WEATHER_SERIES_LAST_YEAR - WEATHER_SERIES_FIRST_YEAR + 1 },
  (_, i) => WEATHER_SERIES_LAST_YEAR - i,
);

/** Etapa 8: simulação horária, confiabilidade e teste de estresse. */
export function SimulationStep() {
  const { design, update, readOnly, results } = useOffgrid();
  const sim = results.simulation;
  const stress = results.stress;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Simulação horária</CardTitle>
          <CardDescription>
            Balanço de energia hora a hora por um ano: FV → cargas → gerador/rede → banco. O
            resultado oficial vem do servidor ao salvar (com a série da Central); a prévia usa a
            climatologia mensal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor="sim-source">Série horária da Central</Label>
              <NativeSelect
                id="sim-source"
                disabled={readOnly}
                value={
                  design.simulation ? `${design.simulation.source}:${design.simulation.year}` : ''
                }
                onChange={(e) => {
                  const [source, year] = e.target.value.split(':');
                  update((d) => ({
                    ...d,
                    simulation: e.target.value
                      ? { source: source as 'nasa-power' | 'pvgis', year: Number(year) }
                      : undefined,
                  }));
                }}
              >
                <option value="">Climatologia mensal (ano sintético)</option>
                {(['nasa-power', 'pvgis'] as const).flatMap((source) =>
                  years.slice(0, 3).map((year) => (
                    <option key={`${source}-${year}`} value={`${source}:${year}`}>
                      {source === 'nasa-power' ? 'NASA POWER' : 'PVGIS'} {year}
                    </option>
                  )),
                )}
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={RESULT_STATUS_BADGE[results.status]}>
              {RESULT_STATUS_LABELS[results.status]}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Recurso solar:{' '}
              {results.resource.source === 'SERIES'
                ? 'série horária'
                : results.resource.source === 'SYNTHETIC'
                  ? 'ano sintético'
                  : 'indisponível'}
            </span>
          </div>
          {sim ? (
            <>
              <dl className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
                <dt>Geração FV</dt>
                <dd>{formatNumber(sim.pvKwh, 0)} kWh/ano</dd>
                <dt>Consumo / atendido</dt>
                <dd>
                  {formatNumber(sim.loadKwh, 0)} / {formatNumber(sim.servedKwh, 0)} kWh
                </dd>
                <dt>Perda de carga</dt>
                <dd>
                  {formatNumber(sim.lolpPct, 2)}% das horas · {formatNumber(sim.unmetKwh, 1)} kWh
                </dd>
                <dt>Maior falha seguida</dt>
                <dd>{sim.longestOutageHours} h</dd>
                <dt>SOC mínimo</dt>
                <dd>{formatNumber(sim.minSocPct, 1)}%</dd>
                <dt>Ciclos por ano</dt>
                <dd>{formatNumber(sim.batteryCycles, 0)}</dd>
                <dt>Vida estimada do banco</dt>
                <dd>
                  {sim.batteryLifeYears !== null
                    ? `${formatNumber(sim.batteryLifeYears, 1)} anos`
                    : '—'}
                </dd>
                <dt>Energia desperdiçada</dt>
                <dd>{formatNumber(sim.curtailedKwh, 0)} kWh</dd>
                {sim.generatorHours > 0 ? (
                  <>
                    <dt>Gerador</dt>
                    <dd>
                      {sim.generatorHours} h · {formatNumber(sim.generatorKwh, 0)} kWh ·{' '}
                      {formatNumber(sim.fuelLiters, 0)} L
                    </dd>
                  </>
                ) : null}
                {sim.gridKwh > 0 ? (
                  <>
                    <dt>Rede</dt>
                    <dd>{formatNumber(sim.gridKwh, 0)} kWh (sem injeção)</dd>
                  </>
                ) : null}
              </dl>
              <div className="grid gap-4 lg:grid-cols-2">
                <TypicalDayChart
                  pvKw={sim.typicalDay.pvKw}
                  loadKw={sim.typicalDay.loadKw}
                  socPct={sim.typicalDay.socPct}
                />
                <MonthlyBars pv={sim.monthly.pvKwh} load={sim.monthly.loadKwh} />
                <SocYearChart values={sim.dailyMinSocPct} />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Complete arranjo, banco, controlador e inversor para simular.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Teste de estresse sazonal</CardTitle>
          <CardDescription>
            Dias nublados seguidos no mês de projeto, com crescimento de carga.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <label className="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={design.stress.enabled}
                onChange={(e) =>
                  update((d) => ({ ...d, stress: { ...d.stress, enabled: e.target.checked } }))
                }
              />
              Executar
            </label>
            <NumberField
              id="st-days"
              label="Dias nublados seguidos"
              integer
              min={1}
              max={14}
              disabled={readOnly}
              value={design.stress.cloudyDays}
              onChange={(v) =>
                v !== undefined && update((d) => ({ ...d, stress: { ...d.stress, cloudyDays: v } }))
              }
            />
            <NumberField
              id="st-irr"
              label="Sol nesses dias"
              min={0}
              max={1}
              disabled={readOnly}
              value={design.stress.irradianceFactor}
              hint="0,3 = 30% do normal"
              onChange={(v) =>
                v !== undefined &&
                update((d) => ({ ...d, stress: { ...d.stress, irradianceFactor: v } }))
              }
            />
            <NumberField
              id="st-growth"
              label="Crescimento da carga"
              unit="%"
              min={0}
              max={200}
              disabled={readOnly}
              value={design.stress.loadGrowthPct}
              onChange={(v) =>
                v !== undefined &&
                update((d) => ({ ...d, stress: { ...d.stress, loadGrowthPct: v } }))
              }
            />
          </div>
          {stress ? (
            <p className="text-sm">
              <Badge variant={stress.survives ? 'green' : 'yellow'}>
                {stress.survives ? 'Atende' : 'Não atende'}
              </Badge>{' '}
              {stress.survives
                ? `Suporta ${stress.cloudyDays} dia(s) nublados seguidos sem perda de carga (SOC mínimo ${formatNumber(stress.minSocPct, 1)}%).`
                : `Faltam ${formatNumber(stress.unmetKwh, 2)} kWh${stress.hoursToDepletion !== null ? `; o banco esgota após ${stress.hoursToDepletion} h` : ''}. Autonomia efetiva: ${formatNumber(stress.autonomyDaysEffective, 2)} dia(s).`}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {results.checks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Todas as verificações</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm" aria-label="Verificações do projeto">
              {results.checks.map((c, i) => (
                <li key={`${c.code}-${i}`} className="flex gap-2">
                  <Badge variant={CHECK_BADGE[c.severity]}>{CHECK_LABEL[c.severity]}</Badge>
                  {c.message}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
