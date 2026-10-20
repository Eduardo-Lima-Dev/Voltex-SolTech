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
import { NumberField } from './number-field';
import { useEditor } from './editor-context';

/** Configura a série da Central; o cálculo oficial ocorre no servidor para não expor a série 8760 ao navegador. */
export function SimulationStep() {
  const { design, update, readOnly, results } = useEditor();
  const simulation = design.simulation;
  const result = results.simulation;
  const set = (patch: NonNullable<typeof simulation>) =>
    update((current) => ({ ...current, simulation: patch }));
  const enabled = Boolean(simulation);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Simulação horária</CardTitle>
          <CardDescription>
            Usa a série de irradiância e temperatura em cache na Central de Dados. A transposição,
            sombra, temperatura de célula e clipping são calculados no servidor ao salvar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              disabled={readOnly}
              onChange={(event) =>
                event.target.checked
                  ? set({
                      source: 'nasa-power',
                      year: 2025,
                      lossPct: 14,
                      inverterEfficiencyPct: 96,
                      comparisonWarningPct: 15,
                    })
                  : update((current) => ({ ...current, simulation: undefined }))
              }
            />
            Calcular com série horária
          </label>
          {simulation ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="grid gap-1">
                <Label htmlFor="simulation-source">Fonte</Label>
                <NativeSelect
                  id="simulation-source"
                  value={simulation.source}
                  disabled={readOnly}
                  onChange={(event) =>
                    set({ ...simulation, source: event.target.value as 'nasa-power' | 'pvgis' })
                  }
                >
                  <option value="nasa-power">NASA POWER</option>
                  <option value="pvgis">PVGIS (JRC)</option>
                </NativeSelect>
              </div>
              <NumberField
                id="simulation-year"
                label="Ano da série"
                min={2005}
                max={2100}
                value={simulation.year}
                disabled={readOnly}
                onChange={(value) => value !== undefined && set({ ...simulation, year: value })}
              />
              <NumberField
                id="simulation-loss"
                label="Perdas CC agregadas"
                unit="%"
                min={0}
                max={99}
                value={simulation.lossPct}
                disabled={readOnly}
                onChange={(value) => value !== undefined && set({ ...simulation, lossPct: value })}
              />
              <NumberField
                id="simulation-efficiency"
                label="Eficiência do inversor"
                unit="%"
                min={1}
                max={100}
                value={simulation.inverterEfficiencyPct}
                disabled={readOnly}
                onChange={(value) =>
                  value !== undefined && set({ ...simulation, inverterEfficiencyPct: value })
                }
              />
              <NumberField
                id="simulation-reference"
                label="Referência anual PVGIS"
                unit="kWh"
                optional
                min={1}
                value={simulation.pvgisReferenceEnergyKwh}
                disabled={readOnly}
                onChange={(value) => set({ ...simulation, pvgisReferenceEnergyKwh: value })}
              />
              <NumberField
                id="simulation-albedo"
                label="Albedo do solo"
                optional
                min={0}
                max={1}
                value={simulation.albedo}
                disabled={readOnly}
                onChange={(value) => set({ ...simulation, albedo: value })}
              />
              <NumberField
                id="simulation-calculator"
                label="Referência anual do Calculator"
                unit="kWh"
                optional
                min={1}
                value={simulation.calculatorReferenceEnergyKwh}
                disabled={readOnly}
                onChange={(value) => set({ ...simulation, calculatorReferenceEnergyKwh: value })}
              />
              <NumberField
                id="simulation-warning"
                label="Alerta de diferença"
                unit="%"
                min={0}
                max={100}
                value={simulation.comparisonWarningPct}
                disabled={readOnly}
                onChange={(value) =>
                  value !== undefined && set({ ...simulation, comparisonWarningPct: value })
                }
              />
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Resultado oficial</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Badge
            variant={
              result?.status === 'INVALID'
                ? 'destructive'
                : result?.status === 'INCOMPLETE'
                  ? 'yellow'
                  : 'green'
            }
          >
            {result?.status ?? 'INCOMPLETE'}
          </Badge>
          <div className="grid gap-2 sm:grid-cols-3">
            <p>
              Geração:{' '}
              <strong>
                {result?.energyKwh === null || result?.energyKwh === undefined
                  ? '—'
                  : `${formatNumber(result.energyKwh, 0)} kWh`}
              </strong>
            </p>
            <p>
              Clipping:{' '}
              <strong>
                {result?.clippingKwh === null || result?.clippingKwh === undefined
                  ? '—'
                  : `${formatNumber(result.clippingKwh, 1)} kWh`}
              </strong>
            </p>
            <p>
              PR:{' '}
              <strong>
                {result?.performanceRatio === null || result?.performanceRatio === undefined
                  ? '—'
                  : formatNumber(result.performanceRatio * 100, 1) + '%'}
              </strong>
            </p>
          </div>
          {result?.comparisons && result.comparisons.length > 0 ? (
            <table className="w-full text-left">
              <caption className="mb-1 text-left font-medium">Comparação independente</caption>
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Geração de referência</th>
                  <th>Diferença do projeto</th>
                </tr>
              </thead>
              <tbody>
                {result.comparisons.map((c) => (
                  <tr key={c.source}>
                    <td>{c.source === 'PVGIS' ? 'PVGIS' : 'Calculator (preliminar)'}</td>
                    <td>{formatNumber(c.referenceKwh, 0)} kWh</td>
                    <td>
                      {c.deltaPct > 0 ? '+' : ''}
                      {formatNumber(c.deltaPct, 1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <SimulationCharts />
          {result?.warnings.map((warning) => (
            <p key={warning} className="rounded border border-warning/50 bg-warning/10 p-2">
              {warning}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Geração × consumo por mês, perfil do dia típico e cascata de perdas (SVG, sem biblioteca). */
function SimulationCharts() {
  const { results, design } = useEditor();
  const sim = results.simulation;
  if (!sim) return null;
  const consumption = design.economics?.monthlyConsumptionKwh;
  const monthly = sim.monthlyKwh;
  const day = sim.typicalDayKw;
  const losses = sim.losses;
  const maxMonth = Math.max(1, ...(monthly ?? []), consumption ?? 0);
  const maxDay = Math.max(0.001, ...(day ?? []));
  const maxLoss = Math.max(1, ...(losses ?? []).map((l) => Math.abs(l.kwh)));
  return (
    <div className="space-y-4">
      {monthly ? (
        <figure>
          <figcaption className="mb-1 font-medium">
            Geração mensal{consumption ? ' × consumo' : ''} (kWh)
          </figcaption>
          <svg
            role="img"
            aria-label="Geração mensal comparada ao consumo"
            viewBox="0 0 240 70"
            className="h-40 w-full rounded border bg-card"
          >
            {monthly.map((value, i) => (
              <g key={i}>
                <rect
                  x={i * 20 + 3}
                  y={60 - (value / maxMonth) * 55}
                  width={14}
                  height={(value / maxMonth) * 55}
                  className="fill-primary/70"
                />
                <text
                  x={i * 20 + 10}
                  y={68}
                  fontSize={5}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                >
                  {MONTHS[i]}
                </text>
              </g>
            ))}
            {consumption ? (
              <line
                x1={0}
                x2={240}
                y1={60 - (consumption / maxMonth) * 55}
                y2={60 - (consumption / maxMonth) * 55}
                className="stroke-destructive"
                strokeDasharray="3 2"
                strokeWidth={0.6}
              />
            ) : null}
          </svg>
        </figure>
      ) : null}
      {day ? (
        <figure>
          <figcaption className="mb-1 font-medium">
            Dia típico: potência CA média por hora (kW)
          </figcaption>
          <svg
            role="img"
            aria-label="Perfil de geração do dia típico"
            viewBox="0 0 240 60"
            className="h-32 w-full rounded border bg-card"
          >
            {day.map((value, h) => (
              <rect
                key={h}
                x={h * 10 + 1}
                y={52 - (value / maxDay) * 48}
                width={8}
                height={(value / maxDay) * 48}
                className="fill-primary/70"
              />
            ))}
            {[0, 6, 12, 18].map((h) => (
              <text
                key={h}
                x={h * 10 + 5}
                y={59}
                fontSize={5}
                textAnchor="middle"
                className="fill-muted-foreground"
              >
                {h}h
              </text>
            ))}
          </svg>
        </figure>
      ) : null}
      {losses ? (
        <div>
          <h4 className="mb-1 font-medium">Cascata de perdas (kWh/ano)</h4>
          <ul className="space-y-1" aria-label="Diagrama de perdas">
            {losses.map((item) => (
              <li key={item.id} className="grid grid-cols-[16rem_1fr_6rem] items-center gap-2">
                <span>{item.label}</span>
                <span
                  className={
                    item.kwh < 0
                      ? 'block h-3 rounded bg-destructive/60'
                      : 'block h-3 rounded bg-primary/70'
                  }
                  style={{ width: `${(Math.abs(item.kwh) / maxLoss) * 100}%` }}
                  role="presentation"
                />
                <span className="text-right">{formatNumber(item.kwh, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
