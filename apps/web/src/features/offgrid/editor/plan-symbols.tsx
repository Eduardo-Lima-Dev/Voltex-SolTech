import type { LayoutElementKind } from '@voltex/shared';

/**
 * Símbolos de cada objeto vistos de cima na planta 2D (SVG): telhado com cumeeira e telhas, casa de máquinas com raio,
 * gerador com ventoinha, poste com cruzeta, caixa d'água, árvore e caixote. Desenhados no centro (0, 0), com a
 * largura no eixo x e a profundidade no eixo y.
 */
export function ElementSymbol({
  kind,
  w,
  d,
  selected,
  color,
}: {
  kind: LayoutElementKind;
  w: number;
  d: number;
  selected: boolean;
  color?: string | undefined;
}) {
  const hw = w / 2;
  const hd = d / 2;
  const edge = selected ? 'stroke-yellow-400' : 'stroke-slate-700';
  const sw = selected ? 0.3 : 0.1;
  switch (kind) {
    case 'HOUSE': {
      const lines = Math.max(3, Math.floor(d / 0.7));
      return (
        <g>
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            className={`fill-red-800/80 ${edge}`}
            strokeWidth={sw}
          />
          <rect x={-hw} y={-hd} width={w} height={hd} className="fill-red-700/70" />
          {[...Array(lines).keys()].map((i) => (
            <line
              key={i}
              x1={-hw}
              x2={hw}
              y1={-hd + ((i + 1) * d) / (lines + 1)}
              y2={-hd + ((i + 1) * d) / (lines + 1)}
              className="stroke-red-950/30"
              strokeWidth={0.06}
            />
          ))}
          <line x1={-hw} x2={hw} y1={0} y2={0} className="stroke-red-950/70" strokeWidth={0.18} />
          <rect
            x={hw * 0.45}
            y={-hd * 0.6}
            width={Math.min(0.6, w * 0.08)}
            height={Math.min(0.6, w * 0.08)}
            className="fill-stone-400 stroke-stone-700"
            strokeWidth={0.05}
          />
        </g>
      );
    }
    case 'POWER_ROOM':
      return (
        <g>
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            className={`fill-slate-300 ${edge}`}
            strokeWidth={sw}
          />
          <rect
            x={-hw * 0.82}
            y={-hd * 0.82}
            width={w * 0.82}
            height={d * 0.82}
            className="fill-slate-200 stroke-slate-500"
            strokeWidth={0.05}
          />
          <path
            d={`M${-0.15 * w} ${-0.3 * d} L${0.05 * w} ${-0.02 * d} L${-0.05 * w} ${-0.02 * d} L${0.15 * w} ${0.3 * d} L${-0.05 * w} ${0.0} L${0.05 * w} ${0.0} Z`}
            className="fill-yellow-400 stroke-yellow-700"
            strokeWidth={0.06}
          />
        </g>
      );
    case 'GENERATOR':
      return (
        <g>
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            rx={0.1}
            className={`fill-yellow-400 ${edge}`}
            strokeWidth={sw}
          />
          <circle cx={-hw * 0.35} cy={0} r={Math.min(hw, hd) * 0.55} className="fill-slate-700" />
          {[0, 60, 120].map((a) => (
            <line
              key={a}
              x1={-hw * 0.35 - Math.min(hw, hd) * 0.45 * Math.cos((a * Math.PI) / 180)}
              y1={-Math.min(hw, hd) * 0.45 * Math.sin((a * Math.PI) / 180)}
              x2={-hw * 0.35 + Math.min(hw, hd) * 0.45 * Math.cos((a * Math.PI) / 180)}
              y2={Math.min(hw, hd) * 0.45 * Math.sin((a * Math.PI) / 180)}
              className="stroke-slate-300"
              strokeWidth={0.06}
            />
          ))}
          <rect
            x={hw * 0.3}
            y={-hd * 0.5}
            width={hw * 0.5}
            height={hd}
            className="fill-slate-900"
          />
        </g>
      );
    case 'GRID_POLE':
      return (
        <g>
          <line
            x1={-0.9}
            x2={0.9}
            y1={0}
            y2={0}
            className={`${selected ? 'stroke-yellow-400' : 'stroke-stone-700'}`}
            strokeWidth={0.14}
          />
          <circle r={0.28} className={`fill-stone-500 ${edge}`} strokeWidth={sw} />
          <circle
            cx={0.42}
            cy={0}
            r={0.18}
            className="fill-slate-400 stroke-slate-700"
            strokeWidth={0.05}
          />
        </g>
      );
    case 'TANK': {
      const r = Math.min(hw, hd);
      return (
        <g>
          <circle r={r} className={`fill-sky-300 ${edge}`} strokeWidth={sw} />
          <circle r={r * 0.72} className="fill-sky-500" />
          <circle r={r * 0.25} className="fill-sky-800" />
        </g>
      );
    }
    case 'TREE': {
      const r = Math.min(hw, hd);
      return (
        <g>
          <circle r={r} className={`fill-green-700/90 ${edge}`} strokeWidth={sw} />
          <circle cx={-r * 0.3} cy={-r * 0.25} r={r * 0.55} className="fill-green-600" />
          <circle cx={r * 0.32} cy={r * 0.2} r={r * 0.45} className="fill-green-500" />
          <circle r={r * 0.12} className="fill-amber-900" />
        </g>
      );
    }
    case 'CONTAINER':
      return (
        <g>
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            className={edge}
            strokeWidth={sw}
            fill={color ?? '#1f6fb2'}
          />
          {[...Array(Math.max(4, Math.floor(w / 0.5))).keys()].map((i) => (
            <line
              key={i}
              x1={-hw + ((i + 1) * w) / Math.max(4, Math.floor(w / 0.5) + 1)}
              x2={-hw + ((i + 1) * w) / Math.max(4, Math.floor(w / 0.5) + 1)}
              y1={-hd}
              y2={hd}
              stroke="rgba(0,0,0,0.25)"
              strokeWidth={0.05}
            />
          ))}
        </g>
      );
    case 'SHED':
      return (
        <g>
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            className={edge}
            strokeWidth={sw}
            fill={color ?? '#b0bec5'}
          />
          <line x1={-hw} x2={hw} y1={0} y2={0} className="stroke-slate-600" strokeWidth={0.15} />
          {[...Array(Math.max(3, Math.floor(w / 1.2))).keys()].map((i) => (
            <line
              key={i}
              x1={-hw + ((i + 1) * w) / Math.max(3, Math.floor(w / 1.2) + 1)}
              x2={-hw + ((i + 1) * w) / Math.max(3, Math.floor(w / 1.2) + 1)}
              y1={-hd}
              y2={hd}
              stroke="rgba(0,0,0,0.18)"
              strokeWidth={0.05}
            />
          ))}
        </g>
      );
    case 'GREENHOUSE':
      return (
        <g>
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            className={edge}
            strokeWidth={sw}
            fill={color ?? '#c8e6c9'}
            fillOpacity={0.7}
          />
          {[-0.3, 0, 0.3].map((k) => (
            <rect
              key={k}
              x={-hw * 0.9}
              y={k * d - 0.2}
              width={w * 0.9}
              height={0.4}
              fill="#4caf50"
            />
          ))}
        </g>
      );
    case 'SILO': {
      const r = Math.min(hw, hd);
      return (
        <g>
          <circle r={r} className={edge} strokeWidth={sw} fill={color ?? '#cfd8dc'} />
          <circle r={r * 0.6} fill="rgba(0,0,0,0.12)" />
          <circle r={r * 0.12} fill="#546e7a" />
        </g>
      );
    }
    case 'WIND_TURBINE': {
      const r = Math.max(1, Math.min(4, w * 1.6));
      return (
        <g>
          {[0, 120, 240].map((a) => (
            <line
              key={a}
              x1={0}
              y1={0}
              x2={r * Math.sin((a * Math.PI) / 180)}
              y2={-r * Math.cos((a * Math.PI) / 180)}
              stroke={color ?? '#90a4ae'}
              strokeWidth={0.22}
            />
          ))}
          <circle r={0.35} className={edge} strokeWidth={sw} fill="#eceff1" />
        </g>
      );
    }
    case 'TOWER':
      return (
        <g>
          <rect
            x={-Math.max(0.4, hw)}
            y={-Math.max(0.4, hd)}
            width={Math.max(0.8, w)}
            height={Math.max(0.8, d)}
            className={edge}
            strokeWidth={sw}
            fill="none"
          />
          <line
            x1={-Math.max(0.4, hw)}
            y1={-Math.max(0.4, hd)}
            x2={Math.max(0.4, hw)}
            y2={Math.max(0.4, hd)}
            stroke={color ?? '#d32f2f'}
            strokeWidth={0.1}
          />
          <line
            x1={Math.max(0.4, hw)}
            y1={-Math.max(0.4, hd)}
            x2={-Math.max(0.4, hw)}
            y2={Math.max(0.4, hd)}
            stroke={color ?? '#d32f2f'}
            strokeWidth={0.1}
          />
          <circle r={0.18} fill="#ff1744" />
        </g>
      );
    case 'WELL': {
      const r = Math.min(hw, hd);
      return (
        <g>
          <circle r={r} className={edge} strokeWidth={sw} fill={color ?? '#9e9e9e'} />
          <circle r={r * 0.68} fill="#0d47a1" />
        </g>
      );
    }
    case 'POOL':
      return (
        <g>
          <rect
            x={-hw - 0.25}
            y={-hd - 0.25}
            width={w + 0.5}
            height={d + 0.5}
            rx={0.4}
            fill="#e0e0e0"
          />
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            rx={0.3}
            className={edge}
            strokeWidth={sw}
            fill={color ?? '#29b6f6'}
          />
          <path
            d={`M${-hw * 0.6} ${-d * 0.1} q ${w * 0.15} ${-0.4} ${w * 0.3} 0 t ${w * 0.3} 0`}
            stroke="rgba(255,255,255,0.7)"
            strokeWidth={0.08}
            fill="none"
          />
        </g>
      );
    case 'VEHICLE':
      return (
        <g>
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            rx={0.35}
            className={edge}
            strokeWidth={sw}
            fill={color ?? '#c62828'}
          />
          <rect
            x={-hw * 0.45}
            y={-hd * 0.8}
            width={w * 0.45}
            height={d * 0.8 * 2 * 0.5 + d * 0.3}
            rx={0.2}
            fill="#90caf9"
          />
        </g>
      );
    case 'WALL':
      return (
        <g>
          <rect
            x={-hw}
            y={-Math.max(0.15, hd)}
            width={w}
            height={Math.max(0.3, d)}
            className={edge}
            strokeWidth={sw}
            fill={color ?? '#bcaaa4'}
          />
          {[...Array(Math.max(2, Math.floor(w / 2.5) + 1)).keys()].map((i) => (
            <rect
              key={i}
              x={-hw + (i * w) / Math.max(1, Math.max(2, Math.floor(w / 2.5) + 1) - 1) - 0.14}
              y={-0.3}
              width={0.28}
              height={0.6}
              fill="#8d6e63"
            />
          ))}
        </g>
      );
    default:
      return (
        <g>
          <rect
            x={-hw}
            y={-hd}
            width={w}
            height={d}
            className={`fill-amber-700/80 ${edge}`}
            strokeWidth={sw}
          />
          <line
            x1={-hw}
            y1={-hd}
            x2={hw}
            y2={hd}
            className="stroke-amber-950/60"
            strokeWidth={0.08}
          />
          <line
            x1={hw}
            y1={-hd}
            x2={-hw}
            y2={hd}
            className="stroke-amber-950/60"
            strokeWidth={0.08}
          />
        </g>
      );
  }
}
