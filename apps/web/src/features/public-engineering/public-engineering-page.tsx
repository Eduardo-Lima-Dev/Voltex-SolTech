import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Alert, Skeleton } from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api';
import {
  formatCents,
  formatDate,
  formatKwh,
  formatNumber,
  formatPercent,
  formatYears,
} from '@/lib/format';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-border pt-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Relatório técnico simplificado: o que o cliente final precisa ver do projeto aprovado, sem custos internos. */
export function PublicEngineeringReportPage() {
  const { token = '' } = useParams();
  const report = useQuery({
    queryKey: ['public-engineering', token],
    queryFn: () => endpoints.publicEngineering.get(token),
    retry: false,
  });

  if (report.isPending) return <Skeleton className="mx-auto mt-16 h-64 w-full max-w-3xl" />;
  if (report.isError)
    return (
      <main className="mx-auto max-w-3xl p-6">
        <Alert variant="destructive">{errorMessage(report.error)}</Alert>
      </main>
    );
  const r = report.data;
  const monthly = r.monthlyKwh;
  const max = Math.max(1, ...(monthly ?? []), r.monthlyConsumptionKwh ?? 0);
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{r.companyName}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{r.projectName}</h1>
        <p className="text-sm text-muted-foreground">
          {[r.city, r.state].filter(Boolean).join(' / ')}
          {r.city || r.state ? ' · ' : ''}Projeto técnico aprovado em {formatDate(r.approvedAt)}
        </p>
      </header>

      <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          label="Potência instalada"
          value={r.powerKwp === null ? '—' : `${formatNumber(r.powerKwp, 2)} kWp`}
        />
        <Metric
          label="Módulos"
          value={
            r.moduleAreaM2 === null
              ? String(r.moduleCount)
              : `${r.moduleCount} (${formatNumber(r.moduleAreaM2, 1)} m²)`
          }
        />
        <Metric
          label="Geração anual estimada"
          value={r.annualEnergyKwh === null ? '—' : formatKwh(r.annualEnergyKwh)}
        />
        {r.performanceRatio !== null ? (
          <Metric label="Desempenho do sistema (PR)" value={formatPercent(r.performanceRatio, 0)} />
        ) : null}
        {r.economics ? (
          <>
            <Metric
              label="Economia no 1º ano"
              value={
                r.economics.firstYearSavingsCents === null
                  ? '—'
                  : formatCents(r.economics.firstYearSavingsCents)
              }
            />
            <Metric
              label={`Economia em ${r.economics.horizonYears ?? '—'} anos`}
              value={
                r.economics.accumulatedSavingsCents === null
                  ? '—'
                  : formatCents(r.economics.accumulatedSavingsCents)
              }
            />
            <Metric
              label="Retorno do investimento"
              value={formatYears(r.economics.simplePaybackYears)}
            />
          </>
        ) : null}
      </dl>

      {monthly ? (
        <figure>
          <figcaption className="mb-2 font-medium">
            Geração mensal estimada{r.monthlyConsumptionKwh ? ' e seu consumo' : ''} (kWh)
          </figcaption>
          <svg
            role="img"
            aria-label="Geração mensal estimada comparada ao consumo"
            viewBox="0 0 240 70"
            className="h-48 w-full rounded border bg-card"
          >
            {monthly.map((value, i) => (
              <g key={MONTHS[i]}>
                <rect
                  x={i * 20 + 3}
                  y={60 - (value / max) * 55}
                  width={14}
                  height={(value / max) * 55}
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
            {r.monthlyConsumptionKwh ? (
              <line
                x1={0}
                x2={240}
                y1={60 - (r.monthlyConsumptionKwh / max) * 55}
                y2={60 - (r.monthlyConsumptionKwh / max) * 55}
                className="stroke-destructive"
                strokeDasharray="3 2"
                strokeWidth={0.6}
              />
            ) : null}
          </svg>
        </figure>
      ) : null}

      <footer className="space-y-1 text-xs text-muted-foreground">
        {r.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </footer>
    </main>
  );
}
