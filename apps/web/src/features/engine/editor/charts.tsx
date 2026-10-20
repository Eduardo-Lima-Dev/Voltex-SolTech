import type {
  SiteDesign,
  SurfaceLayoutResult,
  SurfaceShadingResult,
  Surface,
} from '@voltex/shared';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Prévia 2D do layout: contorno da superfície, área útil (recuos) e os módulos. */
export function LayoutPreview({
  surface,
  layout,
}: {
  surface: Surface;
  layout: SurfaceLayoutResult | undefined;
}) {
  const W = surface.widthM;
  const D = surface.depthM;
  const pad = Math.max(W, D) * 0.06;
  const sb = surface.setbackM;
  const rects = layout?.rects ?? [];
  const label = `Prévia do layout de ${surface.name}: ${layout?.moduleCount ?? 0} módulos em ${layout?.rows ?? 0} fileiras`;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-pad} ${-pad} ${W + pad * 2} ${D + pad * 2 + Math.max(W, D) * 0.05}`}
      className="h-auto w-full max-w-xl rounded border bg-card"
    >
      <rect
        x={0}
        y={0}
        width={W}
        height={D}
        className="fill-muted stroke-foreground/50"
        strokeWidth={W * 0.004}
      />
      <rect
        x={sb.left}
        y={sb.top}
        width={Math.max(0, W - sb.left - sb.right)}
        height={Math.max(0, D - sb.top - sb.bottom)}
        className="fill-none stroke-muted-foreground"
        strokeDasharray={`${W * 0.01} ${W * 0.01}`}
        strokeWidth={W * 0.003}
      />
      {rects.map((r, i) => (
        <rect
          key={i}
          x={sb.left + r.x}
          y={sb.top + r.y}
          width={r.w}
          height={r.h}
          className="fill-primary/70 stroke-primary-foreground"
          strokeWidth={W * 0.002}
        />
      ))}
      <text
        x={W / 2}
        y={D + pad * 1.6}
        textAnchor="middle"
        fontSize={Math.max(W, D) * 0.04}
        className="fill-foreground"
      >
        {`${W.toLocaleString('pt-BR')} m × ${D.toLocaleString('pt-BR')} m`}
      </text>
      <text
        x={0}
        y={-pad * 0.3}
        fontSize={Math.max(W, D) * 0.035}
        className="fill-muted-foreground"
      >
        {surface.kind === 'PITCHED' ? 'cumeeira' : 'fundos'}
      </text>
    </svg>
  );
}

/** Carta solar: trajetória do sol por mês (altura × azimute), o horizonte e os obstáculos; pontos vermelhos estão à sombra. */
export function SunChart({
  shading,
  horizon,
}: {
  shading: SurfaceShadingResult;
  horizon: SiteDesign['horizon'];
}) {
  const W = 640;
  const H = 280;
  const m = { l: 36, r: 12, t: 12, b: 30 };
  const x = (az: number) => m.l + (az / 360) * (W - m.l - m.r);
  const y = (el: number) => H - m.b - (el / 90) * (H - m.t - m.b);
  const shadedCount = shading.sunPaths.reduce(
    (n, p) => n + p.points.filter((pt) => pt.shaded).length,
    0,
  );
  return (
    <svg
      role="img"
      aria-label={`Carta solar: ${shadedCount} pontos da trajetória do sol à sombra em 12 meses`}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full rounded border bg-card"
    >
      {[0, 30, 60, 90].map((el) => (
        <g key={el}>
          <line x1={m.l} x2={W - m.r} y1={y(el)} y2={y(el)} className="stroke-border" />
          <text
            x={m.l - 6}
            y={y(el) + 3}
            textAnchor="end"
            fontSize={10}
            className="fill-muted-foreground"
          >
            {el}°
          </text>
        </g>
      ))}
      {[
        [0, 'N'],
        [90, 'L'],
        [180, 'S'],
        [270, 'O'],
        [360, 'N'],
      ].map(([az, name]) => (
        <g key={String(az)}>
          <line
            x1={x(Number(az))}
            x2={x(Number(az))}
            y1={m.t}
            y2={H - m.b}
            className="stroke-border"
          />
          <text
            x={x(Number(az))}
            y={H - 12}
            textAnchor="middle"
            fontSize={11}
            className="fill-muted-foreground"
          >
            {name}
          </text>
        </g>
      ))}
      {horizon ? (
        <polygon
          className="fill-muted-foreground/30"
          points={[
            `${x(0)},${y(0)}`,
            ...horizon.points.map((p) => `${x(p.azimuthDegrees)},${y(p.heightDegrees)}`),
            `${x(360)},${y(0)}`,
          ].join(' ')}
        />
      ) : null}
      {shading.obstacles.map((o, i) => {
        const from = o.azimuthDegrees - o.halfWidthDegrees;
        const to = o.azimuthDegrees + o.halfWidthDegrees;
        const segments: [number, number][] =
          from < 0
            ? [
                [0, to],
                [360 + from, 360],
              ]
            : to > 360
              ? [
                  [from, 360],
                  [0, to - 360],
                ]
              : [[from, to]];
        return segments.map(([a, b], j) => (
          <rect
            key={`${i}-${j}`}
            x={x(a)}
            y={y(o.topElevationDegrees)}
            width={Math.max(1, x(b) - x(a))}
            height={y(0) - y(o.topElevationDegrees)}
            className="fill-destructive/25 stroke-destructive"
          />
        ));
      })}
      {shading.sunPaths.map((path) => {
        const pts = [...path.points].sort((a, b) => a.azimuthDegrees - b.azimuthDegrees);
        const solstice = path.month === 5 || path.month === 11;
        return (
          <g key={path.month}>
            <polyline
              fill="none"
              className="stroke-primary"
              strokeOpacity={solstice ? 1 : 0.45}
              strokeWidth={solstice ? 2 : 1}
              points={pts.map((p) => `${x(p.azimuthDegrees)},${y(p.elevationDegrees)}`).join(' ')}
            />
            {pts
              .filter((p) => p.shaded)
              .map((p, i) => (
                <circle
                  key={i}
                  cx={x(p.azimuthDegrees)}
                  cy={y(p.elevationDegrees)}
                  r={2.5}
                  className="fill-destructive"
                />
              ))}
            {solstice && pts[0] ? (
              <text
                x={x(pts[0].azimuthDegrees)}
                y={y(pts[0].elevationDegrees) - 4}
                fontSize={10}
                className="fill-foreground"
              >
                {MONTHS[path.month]}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** Perda mensal por sombra (%), em barras. */
export function MonthlyLossBars({ values }: { values: number[] }) {
  const max = Math.max(5, ...values);
  const W = 420;
  const H = 120;
  const bw = W / 12;
  return (
    <svg
      role="img"
      aria-label="Perda mensal por sombra"
      viewBox={`0 0 ${W} ${H + 18}`}
      className="h-auto w-full max-w-md"
    >
      {values.map((v, i) => {
        const h = (v / max) * H;
        return (
          <g key={i}>
            <rect
              x={i * bw + 4}
              y={H - h}
              width={bw - 8}
              height={h}
              className="fill-destructive/70"
            />
            <text
              x={i * bw + bw / 2}
              y={H + 12}
              textAnchor="middle"
              fontSize={9}
              className="fill-muted-foreground"
            >
              {MONTHS[i]}
            </text>
            {v > 0 ? (
              <text
                x={i * bw + bw / 2}
                y={H - h - 2}
                textAnchor="middle"
                fontSize={8}
                className="fill-foreground"
              >
                {v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
