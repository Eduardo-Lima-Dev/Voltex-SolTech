import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PublicProposalScenarioDto } from '@voltex/shared';
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

export default function ProposalCharts({
  scenario,
  color,
}: {
  scenario: PublicProposalScenarioDto;
  color: string;
}) {
  const monthly = MONTH_LABELS.map((month, i) => ({
    month,
    Geração: scenario.monthlyGenerationKwh[i] ?? 0,
  }));
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <figure className="space-y-2">
        <figcaption className="text-sm font-medium">Geração estimada por mês (kWh)</figcaption>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={TICK} />
              <YAxis tick={TICK} width={48} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value) => [formatKwh(Number(value)), 'Geração']}
              />
              <Bar dataKey="Geração" fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className="space-y-2">
        <figcaption className="text-sm font-medium">Resultado acumulado (R$)</figcaption>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={scenario.cashFlow}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="year" tick={TICK} />
              <YAxis tick={TICK} width={64} tickFormatter={(v) => formatCentsCompact(Number(v))} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(year) => `Ano ${year}`}
                formatter={(value) => [formatCents(Number(value)), 'Acumulado']}
              />
              <Area
                dataKey="cumulativeCents"
                stroke={color}
                fill={color}
                fillOpacity={0.2}
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  );
}
