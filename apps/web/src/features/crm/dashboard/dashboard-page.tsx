import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
} from '@voltex/ui';
import { LEAD_SOURCE_LABELS, STAGE_LABELS } from '@/i18n/labels';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { formatCents, formatPercent } from '@/lib/format';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Bars({
  rows,
  label,
}: {
  rows: { key: string; name: string; value: number; extra?: string }[];
  label: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[10rem_1fr_6rem] items-center gap-3 text-sm">
          <span className="truncate">{r.name}</span>
          <span className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums">
            {r.value}
            {r.extra ? <span className="ml-2 text-xs text-muted-foreground">{r.extra}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getTime() - 30 * 86_400_000)));
  const [to, setTo] = useState(isoDay(today));
  const query = {
    from: new Date(`${from}T00:00:00`).toISOString(),
    to: new Date(`${to}T23:59:59`).toISOString(),
  };
  const data = useQuery({
    queryKey: queryKeys.commercialDashboard(query),
    queryFn: () => endpoints.dashboard.commercial(query),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <label htmlFor="dash-from" className="text-sm font-medium">
            De
          </label>
          <Input
            id="dash-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="dash-to" className="text-sm font-medium">
            Até
          </label>
          <Input id="dash-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {data.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : data.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar o painel.</p>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Leads no período" value={String(data.data.totalLeads)} />
            <Kpi
              label="Propostas enviadas"
              value={String(data.data.proposals.sent)}
              hint={`${data.data.proposals.viewed} visualizadas · ${data.data.proposals.accepted} aceitas`}
            />
            <Kpi
              label="Negócios ganhos"
              value={String(data.data.won.count)}
              hint={formatCents(data.data.won.totalCents)}
            />
            <Kpi
              label="Ticket médio"
              value={
                data.data.won.averageTicketCents === null
                  ? '—'
                  : formatCents(data.data.won.averageTicketCents)
              }
              hint="Contratos assinados no período"
            />
          </dl>

          <Card>
            <CardHeader>
              <CardTitle>Leads por origem</CardTitle>
            </CardHeader>
            <CardContent>
              {data.data.leadsBySource.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum lead no período.</p>
              ) : (
                <Bars
                  label="Leads por origem"
                  rows={data.data.leadsBySource.map((l) => ({
                    key: l.source,
                    name: LEAD_SOURCE_LABELS[l.source],
                    value: l.count,
                  }))}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Funil por etapa</CardTitle>
              <CardDescription>
                Oportunidades que chegaram a cada etapa no período e a conversão sobre a etapa
                anterior que teve passagem.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Bars
                label="Funil por etapa"
                rows={data.data.funnel.map((f) => ({
                  key: f.stage,
                  name: STAGE_LABELS[f.stage],
                  value: f.reached,
                  extra:
                    f.conversionFromPrevious === null
                      ? undefined
                      : formatPercent(f.conversionFromPrevious, 0),
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Previsão simples</CardTitle>
              <CardDescription>
                Pipeline aberto agora, pelo preço da cotação mais recente. Não é uma previsão
                estatística.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid gap-3 sm:grid-cols-3">
                <Kpi label="Oportunidades abertas" value={String(data.data.forecast.openCount)} />
                <Kpi
                  label="Valor em aberto"
                  value={formatCents(data.data.forecast.openTotalCents)}
                  hint={`${data.data.forecast.withoutValueCount} sem cotação`}
                />
                <Kpi
                  label="Total ponderado"
                  value={
                    data.data.forecast.weightedTotalCents === null
                      ? '—'
                      : formatCents(data.data.forecast.weightedTotalCents)
                  }
                  hint={
                    data.data.forecast.weightedTotalCents === null
                      ? 'Defina os pesos por etapa da sua empresa para calcular'
                      : 'Pelos pesos definidos pela empresa'
                  }
                />
              </dl>
              {data.data.forecast.byMonth.length > 0 ? (
                <ul aria-label="Fechamento esperado por mês" className="divide-y text-sm">
                  {data.data.forecast.byMonth.map((m) => (
                    <li key={m.month} className="flex justify-between py-2">
                      <span>{m.month}</span>
                      <span>
                        {m.count} · {formatCents(m.totalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {data.data.forecast.withoutExpectedDateCount > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {data.data.forecast.withoutExpectedDateCount} oportunidade(s) sem data de
                  fechamento esperada.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
