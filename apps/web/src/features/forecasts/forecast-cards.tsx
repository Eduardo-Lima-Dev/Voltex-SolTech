import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { formatCents, formatDate, formatKwh, formatPercent } from '@/lib/format';

const key = (name: string, extra?: string) => ['forecast', name, extra] as const;

/** Resultado de uma previsão: pronto, ou "dados insuficientes" com a amostra e o mínimo da empresa. */
function ForecastShell<T extends { status: string }>({
  title,
  description,
  query,
  children,
}: {
  title: string;
  description: string;
  query: { isPending: boolean; isError: boolean; data?: T };
  children: (data: Extract<T, { status: 'OK' }>) => ReactNode;
}) {
  if (query.isError) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {title}
          <Badge variant="outline">Previsão</Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {query.isPending ? <Skeleton className="h-16 w-full" /> : null}
        {query.data && query.data.status === 'INSUFFICIENT_SAMPLE' ? (
          <p className="text-muted-foreground">
            Dados insuficientes: há {(query.data as unknown as { sample: number }).sample} no
            histórico e o mínimo da empresa é{' '}
            {(query.data as unknown as { required: number }).required}.
          </p>
        ) : null}
        {query.data && query.data.status === 'OK'
          ? children(query.data as Extract<T, { status: 'OK' }>)
          : null}
      </CardContent>
    </Card>
  );
}

export function ReceivablesForecastCard() {
  const query = useQuery({
    queryKey: key('receivables'),
    queryFn: () => endpoints.forecasts.receivables(),
  });
  return (
    <ForecastShell
      title="Quanto deve entrar nos próximos 90 dias"
      description="Parcelas em aberto datadas pelo atraso com que a própria empresa já recebeu. Faixa: melhor, esperado e pior cenário."
      query={query}
    >
      {(f) => (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['Melhor cenário', f.withinHorizon.best],
                ['Esperado', f.withinHorizon.expected],
                ['Pior cenário', f.withinHorizon.worst],
              ] as const
            ).map(([label, cents]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatCents(cents)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Em aberto: {formatCents(f.openCents)}. Sem data possível (mais atrasadas do que o
            histórico): {formatCents(f.unplacedCents)}. Base: {f.sample} parcelas pagas.
          </p>
        </>
      )}
    </ForecastShell>
  );
}

export function FunnelForecastCard() {
  const query = useQuery({ queryKey: key('funnel'), queryFn: () => endpoints.forecasts.funnel() });
  return (
    <ForecastShell
      title="Fechamento esperado do funil"
      description="Pipeline aberto × taxa de ganho histórica da etapa de cada oportunidade, com faixa de 95%."
      query={query}
    >
      {(f) => (
        <>
          <p>
            Taxa geral de ganho: <strong>{formatPercent(f.overallWinRate, 0)}</strong> ({f.sample}{' '}
            encerradas).
          </p>
          {f.months.length > 0 ? (
            <ul aria-label="Fechamento previsto por mês" className="divide-y">
              {f.months.map((m) => (
                <li key={m.month} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{m.month}</span>
                  <span className="tabular-nums">
                    ~{m.expectedCount} · {formatCents(m.expectedCents)}{' '}
                    <span className="text-xs text-muted-foreground">
                      (de {formatCents(m.worstCents)} a {formatCents(m.bestCents)})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {f.undatedCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {f.undatedCount} oportunidade(s) sem data esperada e sem ciclo histórico para estimar.
            </p>
          ) : null}
          {f.stagesUsingOverallRate.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Etapas com pouco histórico usam a taxa geral: {f.stagesUsingOverallRate.join(', ')}.
            </p>
          ) : null}
        </>
      )}
    </ForecastShell>
  );
}

export function InstallationsForecastCard() {
  const query = useQuery({
    queryKey: key('installations'),
    queryFn: () => endpoints.forecasts.installations(),
  });
  return (
    <ForecastShell
      title="Conclusão das instalações em andamento"
      description="Pelo tempo médio que as instalações concluídas ficaram em cada situação."
      query={query}
    >
      {(f) => {
        const atRisk = f.installations.filter((i) => i.atRisk);
        const dates = f.installations.map((i) => i.estimatedDoneOn).sort();
        return (
          <>
            <p>
              {f.installations.length} em andamento; <strong>{atRisk.length}</strong> já passaram do
              tempo normal da situação em que estão.
            </p>
            {dates.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Conclusões previstas de {formatDate(dates[0]!)} a{' '}
                {formatDate(dates[dates.length - 1]!)}. Base: {f.sample} instalações concluídas.
              </p>
            ) : null}
          </>
        );
      }}
    </ForecastShell>
  );
}

export function GenerationForecastCard({ projectCode }: { projectCode: string }) {
  const query = useQuery({
    queryKey: key('generation', projectCode),
    queryFn: () => endpoints.forecasts.generation(projectCode),
  });
  return (
    <ForecastShell
      title="Geração do mês"
      description="Esperado do projeto aprovado × desempenho real recente da usina."
      query={query}
    >
      {(f) => (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Desempenho recente</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatPercent(f.performanceRatio, 0)} do esperado
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Projeção do mês</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatKwh(f.monthProjectedKwh)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Esperado no mês</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatKwh(f.monthExpectedKwh)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Até a última leitura ({formatDate(f.lastReadingOn)}): {formatKwh(f.monthToDateKwh)}.
            Base: {f.sample} dias com leitura.
          </p>
        </>
      )}
    </ForecastShell>
  );
}
