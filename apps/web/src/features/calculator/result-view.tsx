import { lazy, Suspense, type ReactNode } from 'react';
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import type {
  CalculationAlert,
  ParsedQuickCalculationInput,
  QuickCalculationInput,
  QuickCalculationResult,
} from '@voltex/solar-engine';
import {
  cn,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@voltex/ui';
import {
  ALERT_SEVERITY_LABELS,
  ALERT_TITLES,
  GENERATION_CLASS_LABELS,
  HSP_SOURCE_LABELS,
  PERFORMANCE_RATIO_SOURCE_LABELS,
  TRAFFIC_LIGHT_DESCRIPTIONS,
  TRAFFIC_LIGHT_LABELS,
} from '@/i18n/labels';
import {
  formatCents,
  formatKwh,
  formatKwp,
  formatNumber,
  formatPercent,
  formatYears,
} from '@/lib/format';

const Charts = lazy(() => import('./charts-section'));

export const TRAFFIC_BADGE = { GREEN: 'green', YELLOW: 'yellow', RED: 'red' } as const;

export function TrafficLightBadge({ light }: { light: keyof typeof TRAFFIC_BADGE }) {
  return <Badge variant={TRAFFIC_BADGE[light]}>{TRAFFIC_LIGHT_LABELS[light]}</Badge>;
}

const SEVERITY_ORDER = { BLOCKING: 0, WARNING: 1, INFO: 2 } as const;
const SEVERITY_ICON = { BLOCKING: OctagonAlert, WARNING: AlertTriangle, INFO: Info } as const;
const SEVERITY_VARIANT = { BLOCKING: 'destructive', WARNING: 'warning', INFO: 'info' } as const;

function AlertList({ alerts }: { alerts: CalculationAlert[] }) {
  if (alerts.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum alerta para este cálculo.</p>;
  const sorted = [...alerts].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return (
    <ul className="space-y-2">
      {sorted.map((alert) => {
        const Icon = SEVERITY_ICON[alert.severity];
        return (
          <li key={alert.code}>
            <Alert variant={SEVERITY_VARIANT[alert.severity]}>
              <Icon className="size-4" aria-hidden />
              <AlertTitle>
                {ALERT_TITLES[alert.code]}{' '}
                <span className="font-normal text-muted-foreground">
                  · {ALERT_SEVERITY_LABELS[alert.severity]}
                </span>
              </AlertTitle>
              <AlertDescription>{alert.message}</AlertDescription>
            </Alert>
          </li>
        );
      })}
    </ul>
  );
}

function Kpi({
  label,
  value,
  hint,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn('rounded-lg border bg-card', compact ? 'p-3' : 'p-4')}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 font-semibold tabular-nums', compact ? 'text-base' : 'text-xl')}>
        {value}
      </dd>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Assumption({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** Consumo mensal para o gráfico: se menos de 12 meses foram informados, usa a média nos 12. */
export const consumptionSeries = (
  input: Pick<ParsedQuickCalculationInput, 'consumptionMonthlyKwh'> | QuickCalculationInput,
  result: QuickCalculationResult,
): number[] =>
  input.consumptionMonthlyKwh.length === 12
    ? input.consumptionMonthlyKwh
    : Array<number>(12).fill(result.averageMonthlyConsumptionKwh);

interface ResultViewProps {
  result: QuickCalculationResult;
  input: Pick<ParsedQuickCalculationInput, 'consumptionMonthlyKwh'> | QuickCalculationInput;
  /** Versão enxuta para o preview do wizard: sem gráficos nem premissas. */
  compact?: boolean;
}

/** Resultado do cálculo: semáforo, indicadores, alertas, gráficos e premissas. Usado no wizard e nas páginas salvas. */
export function ResultView({ result, input, compact = false }: ResultViewProps) {
  const a = result.assumptions;
  return (
    <div className="space-y-6">
      <section
        aria-label="Semáforo de pré-viabilidade"
        className={cn(
          'flex gap-3 rounded-lg border bg-card p-4',
          compact
            ? 'flex-col items-start'
            : 'flex-col items-start sm:flex-row sm:flex-wrap sm:items-center',
        )}
      >
        <TrafficLightBadge light={result.trafficLight} />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {TRAFFIC_LIGHT_DESCRIPTIONS[result.trafficLight]}
        </p>
        <p className="text-xs text-muted-foreground">
          Confiança da análise: <strong>{formatNumber(result.confidenceScore, 0)}%</strong>
        </p>
      </section>

      <dl className={cn('grid gap-3', compact ? 'grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3')}>
        <Kpi
          compact={compact}
          label="Potência instalada"
          value={formatKwp(result.installedPowerKwp)}
          hint={`${result.moduleCount} módulos · ${formatNumber(result.estimatedAreaM2, 1)} m² · ${GENERATION_CLASS_LABELS[result.generationClass]}`}
        />
        <Kpi
          compact={compact}
          label="Geração anual"
          value={formatKwh(result.annualGenerationKwh)}
          hint={`${formatPercent(result.compensationRatio)} do consumo compensável`}
        />
        <Kpi
          compact={compact}
          label="Investimento estimado"
          value={formatCents(result.investmentCents)}
        />
        <Kpi
          compact={compact}
          label="Economia no 1º ano"
          value={formatCents(result.firstYearSavingsCents)}
        />
        <Kpi
          compact={compact}
          label="Payback simples"
          value={formatYears(result.simplePaybackYears)}
          hint={`Com fluxo de caixa: ${formatYears(result.cashFlowPaybackYears)}`}
        />
        <Kpi
          compact={compact}
          label={`Economia em ${a.horizonYears} anos`}
          value={formatCents(result.accumulatedSavingsCents)}
        />
      </dl>

      <section aria-labelledby="alerts-title" className="space-y-3">
        <h2 id="alerts-title" className="text-base font-semibold">
          Alertas e pontos de atenção
        </h2>
        <AlertList alerts={result.alerts} />
      </section>

      {compact ? null : (
        <>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <Charts result={result} consumptionKwh={consumptionSeries(input, result)} />
          </Suspense>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Premissas usadas</CardTitle>
              <CardDescription>
                O resultado depende destes valores. Mude-os para ver como o cálculo se comporta.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 md:grid-cols-2">
                <Assumption
                  label="Performance Ratio (PR)"
                  value={`${formatNumber(a.performanceRatio, 3)} · ${PERFORMANCE_RATIO_SOURCE_LABELS[a.performanceRatioSource]}`}
                />
                <Assumption label="Origem da irradiação" value={HSP_SOURCE_LABELS[a.hspSource]} />
                <Assumption
                  label="HSP médio"
                  value={`${formatNumber(result.averageHsp, 2)} kWh/m²·dia`}
                />
                <Assumption
                  label="Custo de disponibilidade"
                  value={formatKwh(a.availabilityCostKwh)}
                />
                <Assumption
                  label="Consumo médio mensal"
                  value={formatKwh(result.averageMonthlyConsumptionKwh)}
                />
                <Assumption
                  label="Consumo compensável por mês"
                  value={formatKwh(result.compensableMonthlyKwh)}
                />
                <Assumption label="Tarifa" value={`${formatCents(a.tariffCentsPerKwh)}/kWh`} />
                <Assumption
                  label="Reajuste tarifário anual"
                  value={formatPercent(a.tariffEscalationRate, 1)}
                />
                <Assumption
                  label="Degradação anual dos módulos"
                  value={formatPercent(a.moduleDegradationRate, 2)}
                />
                <Assumption
                  label="Módulo"
                  value={`${formatNumber(a.modulePowerWp, 0)} Wp · ${formatNumber(a.moduleAreaM2, 2)} m²`}
                />
                <Assumption label="Horizonte" value={`${a.horizonYears} anos`} />
                {result.recommendedTiltDegrees !== null ? (
                  <Assumption
                    label="Inclinação recomendada"
                    value={`${formatNumber(result.recommendedTiltDegrees, 0)}°`}
                  />
                ) : null}
                {a.tiltDegrees !== null ? (
                  <Assumption
                    label="Inclinação informada"
                    value={`${formatNumber(a.tiltDegrees, 0)}°`}
                  />
                ) : null}
                {a.roofAzimuthDegrees !== null ? (
                  <Assumption
                    label="Azimute informado"
                    value={`${formatNumber(a.roofAzimuthDegrees, 0)}°`}
                  />
                ) : null}
              </dl>
            </CardContent>
          </Card>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Estimativa preliminar de pré-viabilidade. Não substitui o projeto executivo nem a análise da
        distribuidora.
      </p>
    </div>
  );
}
