import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { formatNumber } from '@/lib/format';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Análise de carga e consumo: fatura, cargas levantadas e a potência sugerida (indicativa) para cobrir o consumo. */
export function LoadPanel({ projectId }: { projectId: string }) {
  const load = useQuery({
    queryKey: ['engineering', 'load', projectId],
    queryFn: () => endpoints.engineering.loadAnalysis(projectId),
  });
  if (load.isPending) return <Skeleton className="h-48 w-full" />;
  if (load.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar a análise.</p>;
  const d = load.data;
  const max = Math.max(1, ...d.monthly.map((m) => m.kwh));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Análise de carga e consumo</CardTitle>
        <CardDescription>
          Primeira etapa do dimensionamento (EnergIF EF-R01): consumo da fatura, cargas da visita e
          a potência que cobriria o consumo médio. É uma sugestão indicativa: o projeto técnico
          define o sistema.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-4">
          <div className="rounded border p-3">
            <dt className="text-xs text-muted-foreground">Consumo médio</dt>
            <dd className="text-xl font-semibold">
              {d.averageKwh === null ? '—' : `${formatNumber(d.averageKwh, 0)} kWh/mês`}
            </dd>
          </div>
          <div className="rounded border p-3">
            <dt className="text-xs text-muted-foreground">Maior mês</dt>
            <dd className="text-xl font-semibold">
              {d.maxKwh === null ? '—' : `${formatNumber(d.maxKwh, 0)} kWh`}
            </dd>
          </div>
          <div className="rounded border p-3">
            <dt className="text-xs text-muted-foreground">Cargas levantadas</dt>
            <dd className="text-xl font-semibold">
              {d.loadsMonthlyKwh > 0 ? `${formatNumber(d.loadsMonthlyKwh, 0)} kWh/mês` : '—'}
            </dd>
          </div>
          <div className="rounded border p-3">
            <dt className="text-xs text-muted-foreground">Potência sugerida</dt>
            <dd className="text-xl font-semibold">
              {d.suggestedKwp === null ? '—' : `${formatNumber(d.suggestedKwp, 2)} kWp`}
            </dd>
          </div>
        </dl>
        {d.monthly.length > 0 ? (
          <svg
            role="img"
            aria-label="Consumo mensal da fatura"
            viewBox={`0 0 ${d.monthly.length * 20} 70`}
            className="h-36 w-full rounded border bg-card"
          >
            {d.monthly.map((m, i) => (
              <g key={m.month}>
                <rect
                  x={i * 20 + 3}
                  y={58 - (m.kwh / max) * 52}
                  width={14}
                  height={(m.kwh / max) * 52}
                  className="fill-primary/70"
                >
                  <title>{`${m.month}: ${formatNumber(m.kwh, 0)} kWh`}</title>
                </rect>
                <text
                  x={i * 20 + 10}
                  y={67}
                  fontSize={5}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                >
                  {MONTHS[Number(m.month.slice(5, 7)) - 1] ?? m.month.slice(5)}
                </text>
              </g>
            ))}
          </svg>
        ) : null}
        {d.loads.length > 0 ? (
          <ul className="space-y-1 text-sm" aria-label="Cargas levantadas">
            {d.loads.map((l) => (
              <li key={l.id} className="flex justify-between">
                <span>{l.name}</span>
                <span className="tabular-nums">{formatNumber(l.monthlyKwh, 1)} kWh/mês</span>
              </li>
            ))}
          </ul>
        ) : null}
        {d.annualYieldKwhPerKwp ? (
          <p className="text-xs text-muted-foreground">
            Rendimento usado: {formatNumber(d.annualYieldKwhPerKwp, 0)} kWh/kWp·ano (do cálculo
            preliminar do CRM).
          </p>
        ) : null}
        {d.notes.map((n) => (
          <p key={n} className="rounded border border-warning/50 bg-warning/10 p-2 text-sm">
            {n}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
