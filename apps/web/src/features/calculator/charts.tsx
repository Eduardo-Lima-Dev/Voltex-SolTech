import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { YearlyProjection } from '@voltex/solar-engine';
import { MONTH_LABELS } from '@/i18n/labels';
import { formatCents, formatCentsCompact, formatKwh } from '@/lib/format';

const GRID = 'var(--border)';
const TICK = { fill: 'var(--muted-foreground)', fontSize: 12 };
const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  color: 'var(--popover-foreground)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
};

/** Geração estimada × consumo médio, mês a mês. */
export function GenerationChart({
  generationKwh,
  consumptionKwh,
}: {
  generationKwh: number[];
  consumptionKwh: number[];
}) {
  const data = MONTH_LABELS.map((month, i) => ({
    month,
    Geração: generationKwh[i] ?? 0,
    Consumo: consumptionKwh[i] ?? 0,
  }));
  return (
    <div
      className="h-64 w-full"
      role="img"
      aria-label="Gráfico de geração estimada e consumo por mês"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={TICK} tickLine={false} axisLine={false} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => formatKwh(Number(value))}
            cursor={{ fill: 'var(--accent)' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Geração" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Consumo" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Fluxo de caixa acumulado: cruza o zero no payback. Ano 0 = investimento. */
export function CashFlowChart({
  cashFlow,
  investmentCents,
}: {
  cashFlow: YearlyProjection[];
  investmentCents: number;
}) {
  const data = [
    { year: 0, Acumulado: -investmentCents },
    ...cashFlow.map((row) => ({ year: row.year, Acumulado: row.cumulativeCents })),
  ];
  return (
    <div
      className="h-64 w-full"
      role="img"
      aria-label="Gráfico do fluxo de caixa acumulado por ano"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="year" tick={TICK} tickLine={false} axisLine={false} />
          <YAxis
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v: number) => formatCentsCompact(v)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => formatCents(Number(value))}
            labelFormatter={(year) => `Ano ${year}`}
          />
          <Area
            type="monotone"
            dataKey="Acumulado"
            stroke="var(--chart-1)"
            fill="var(--chart-2)"
            fillOpacity={0.25}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
