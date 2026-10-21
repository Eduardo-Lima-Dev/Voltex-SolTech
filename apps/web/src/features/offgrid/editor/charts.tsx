import { MONTHS } from '../labels';

const W = 320;
const H = 120;
const PAD = { l: 34, r: 8, t: 8, b: 20 };

function scale(max: number) {
  const top = max <= 0 ? 1 : max;
  return { top, y: (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b) };
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function Frame({
  label,
  children,
  top,
  unit,
}: {
  label: string;
  children: React.ReactNode;
  top: number;
  unit: string;
}) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      className="h-36 w-full rounded border bg-card"
    >
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="stroke-border" />
      <text x={2} y={PAD.t + 6} fontSize={7} className="fill-muted-foreground">
        {fmt(top)} {unit}
      </text>
      {children}
    </svg>
  );
}

/** Curva de carga do dia típico: energia (Wh) em cada hora. */
export function LoadCurveChart({ hourlyWh }: { hourlyWh: number[] }) {
  const { top, y } = scale(Math.max(...hourlyWh, 0));
  const bw = (W - PAD.l - PAD.r) / 24;
  return (
    <Frame label="Curva de carga do dia típico" top={top} unit="Wh">
      {hourlyWh.map((v, h) => (
        <rect
          key={h}
          x={PAD.l + h * bw + 1}
          y={y(v)}
          width={bw - 2}
          height={H - PAD.b - y(v)}
          className="fill-primary/70"
        >
          <title>{`${h} h: ${fmt(v)} Wh`}</title>
        </rect>
      ))}
      {[0, 6, 12, 18].map((h) => (
        <text key={h} x={PAD.l + h * bw} y={H - 6} fontSize={7} className="fill-muted-foreground">
          {h} h
        </text>
      ))}
    </Frame>
  );
}

function path(values: number[], y: (v: number) => number, count: number): string {
  const step = (W - PAD.l - PAD.r) / Math.max(1, count - 1);
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(PAD.l + i * step).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
}

/** Dia típico: FV e carga (kW) e estado de carga da bateria (%). */
export function TypicalDayChart({
  pvKw,
  loadKw,
  socPct,
}: {
  pvKw: number[];
  loadKw: number[];
  socPct: number[];
}) {
  const { top, y } = scale(Math.max(...pvKw, ...loadKw, 0.001));
  const soc = scale(100);
  return (
    <div className="space-y-1">
      <Frame label="Dia típico: geração, carga e estado de carga" top={top} unit="kW">
        <path d={path(pvKw, y, 24)} className="fill-none stroke-amber-500" strokeWidth={1.5} />
        <path d={path(loadKw, y, 24)} className="fill-none stroke-primary" strokeWidth={1.5} />
        <path
          d={path(socPct, soc.y, 24)}
          className="fill-none stroke-emerald-600"
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      </Frame>
      <p className="text-xs text-muted-foreground">
        <span className="text-amber-600">━ geração FV</span> ·{' '}
        <span className="text-primary">━ carga</span> ·{' '}
        <span className="text-emerald-700">┅ SOC do banco (0–100%)</span>
      </p>
    </div>
  );
}

/** Geração e consumo por mês (kWh). */
export function MonthlyBars({ pv, load }: { pv: number[]; load: number[] }) {
  const { top, y } = scale(Math.max(...pv, ...load, 0));
  const bw = (W - PAD.l - PAD.r) / 12;
  return (
    <div className="space-y-1">
      <Frame label="Geração e consumo por mês" top={top} unit="kWh">
        {MONTHS.map((m, i) => (
          <g key={m}>
            <rect
              x={PAD.l + i * bw + 1}
              y={y(pv[i] ?? 0)}
              width={bw / 2 - 1}
              height={H - PAD.b - y(pv[i] ?? 0)}
              className="fill-amber-500/80"
            >
              <title>{`${m}: FV ${fmt(pv[i] ?? 0)} kWh`}</title>
            </rect>
            <rect
              x={PAD.l + i * bw + bw / 2}
              y={y(load[i] ?? 0)}
              width={bw / 2 - 1}
              height={H - PAD.b - y(load[i] ?? 0)}
              className="fill-primary/70"
            >
              <title>{`${m}: carga ${fmt(load[i] ?? 0)} kWh`}</title>
            </rect>
            <text x={PAD.l + i * bw + 1} y={H - 6} fontSize={7} className="fill-muted-foreground">
              {m}
            </text>
          </g>
        ))}
      </Frame>
      <p className="text-xs text-muted-foreground">
        <span className="text-amber-600">■ geração FV</span> ·{' '}
        <span className="text-primary">■ consumo</span>
      </p>
    </div>
  );
}

/** SOC mínimo de cada dia do ano (%). */
export function SocYearChart({ values }: { values: number[] }) {
  const { top, y } = scale(100);
  return (
    <Frame label="Estado de carga mínimo de cada dia do ano" top={top} unit="%">
      <path
        d={path(values, y, values.length)}
        className="fill-none stroke-emerald-600"
        strokeWidth={1}
      />
      <text x={PAD.l} y={H - 6} fontSize={7} className="fill-muted-foreground">
        jan
      </text>
      <text x={W - 28} y={H - 6} fontSize={7} className="fill-muted-foreground">
        dez
      </text>
    </Frame>
  );
}
