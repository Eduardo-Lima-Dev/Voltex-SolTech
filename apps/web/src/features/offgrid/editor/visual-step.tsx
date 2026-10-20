import { Plus, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import {
  LAYOUT_ELEMENT_KINDS,
  type LayoutElementKind,
  type OffgridLayoutElement,
  type OffgridLayoutRun,
} from '@voltex/shared';
import { solarPosition } from '@voltex/solar-engine';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { NumberField } from '../../engine/editor/number-field';
import { snapTo } from '../../engine/editor/scene-3d-math';
import { useOffgrid } from './offgrid-context';
import {
  buildOffgridScene,
  elementCorners,
  projectOffgridScene,
  type OffgridPolygonKind,
  type SceneArray,
} from './scene-math';

export const ELEMENT_LABELS: Record<LayoutElementKind, string> = {
  HOUSE: 'Casa (cargas)',
  POWER_ROOM: 'Casa de máquinas',
  GENERATOR: 'Gerador',
  GRID_POLE: 'Poste da rede',
  TANK: 'Caixa d’água',
  TREE: 'Árvore',
  OTHER: 'Outro objeto',
};

const PRESETS: Record<LayoutElementKind, { widthM: number; depthM: number; heightM: number }> = {
  HOUSE: { widthM: 8, depthM: 6, heightM: 3.5 },
  POWER_ROOM: { widthM: 3, depthM: 3, heightM: 2.5 },
  GENERATOR: { widthM: 1.5, depthM: 1, heightM: 1.2 },
  GRID_POLE: { widthM: 0.3, depthM: 0.3, heightM: 7 },
  TANK: { widthM: 2, depthM: 2, heightM: 3 },
  TREE: { widthM: 3, depthM: 3, heightM: 6 },
  OTHER: { widthM: 2, depthM: 2, heightM: 2 },
};

const FILL: Record<LayoutElementKind, string> = {
  HOUSE: 'fill-amber-200 stroke-amber-700',
  POWER_ROOM: 'fill-blue-300 stroke-blue-800',
  GENERATOR: 'fill-orange-300 stroke-orange-800',
  GRID_POLE: 'fill-zinc-400 stroke-zinc-700',
  TANK: 'fill-cyan-200 stroke-cyan-700',
  TREE: 'fill-green-300 stroke-green-800',
  OTHER: 'fill-stone-300 stroke-stone-700',
};

const POLY_FILL: Record<OffgridPolygonKind, string> = {
  GROUND: 'fill-emerald-100/60 stroke-emerald-700/40',
  LOT: 'fill-none stroke-emerald-700',
  SHADOW: 'fill-black/25',
  SIDE: '',
  TOP: '',
  PANEL: 'fill-sky-900 stroke-sky-950',
  CELL: 'fill-sky-600 stroke-sky-900/70',
};

const DATES = [
  { value: '12-21', label: 'Solstício de verão (21/12)' },
  { value: '03-20', label: 'Equinócio (20/03)' },
  { value: '06-21', label: 'Solstício de inverno (21/06)' },
];

type Selection = { type: 'element' | 'array'; id: string } | null;

const newId = () => `el-${Math.random().toString(36).slice(2, 8)}`;

/** Etapa 8: projeto visual do terreno em planta 2D editável e cena 3D com órbita, zoom e sombra. */
export function VisualStep() {
  const { design, update, readOnly, results } = useOffgrid();
  const layout = design.layout;
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [selected, setSelected] = useState<Selection>(null);
  const [yaw, setYaw] = useState(30);
  const [pitch, setPitch] = useState(40);
  const [zoom, setZoom] = useState(1);
  const [date, setDate] = useState('12-21');
  const [hour, setHour] = useState(9);
  const [shadows, setShadows] = useState(true);
  const planRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<
    | { kind: 'move'; type: 'element' | 'array'; id: string; dx: number; dy: number }
    | { kind: 'orbit'; x: number; y: number; yaw: number; pitch: number }
    | null
  >(null);

  const sun = useMemo(() => {
    const at = new Date(`2025-${date}T${String(hour + 3).padStart(2, '0')}:00:00Z`);
    const p = solarPosition({
      at,
      latitudeDegrees: design.site.latitude,
      longitudeDegrees: design.site.longitude,
    });
    return { azimuthDegrees: p.azimuthDegrees, elevationDegrees: p.elevationDegrees };
  }, [date, hour, design.site.latitude, design.site.longitude]);

  const layoutResult = results.layout;
  const sceneArrays: SceneArray[] = useMemo(
    () =>
      design.arrays.flatMap((a) => {
        const r = layoutResult?.arrays.find((x) => x.id === a.id);
        if (!r) return [];
        const cos = Math.max(0.05, Math.cos((a.tiltDegrees * Math.PI) / 180));
        return [
          {
            id: a.id,
            center: r.centerM,
            azimuthDegrees: a.azimuthDegrees,
            tiltDegrees: a.tiltDegrees,
            columns: a.modulesInSeries,
            rows: a.parallelStrings,
            widthM: r.widthM,
            slopeM: r.depthM / cos,
            baseHeightM: 0,
          },
        ];
      }),
    [design.arrays, layoutResult],
  );
  const polygons = useMemo(
    () =>
      buildOffgridScene({
        lot: { widthM: layout.lotWidthM, depthM: layout.lotDepthM },
        elements: layout.elements,
        arrays: sceneArrays,
        sun,
      }),
    [layout.lotWidthM, layout.lotDepthM, layout.elements, sceneArrays, sun],
  );
  const scene = useMemo(() => projectOffgridScene(polygons, yaw, pitch), [polygons, yaw, pitch]);

  const setLayout = (patch: Partial<typeof layout>) =>
    update((d) => ({ ...d, layout: { ...d.layout, ...patch } }));
  const patchElement = (id: string, patch: Partial<OffgridLayoutElement>) =>
    setLayout({ elements: layout.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const moveTo = (type: 'element' | 'array', id: string, x: number, y: number) => {
    const pos = {
      x: Math.min(layout.lotWidthM, Math.max(0, snapTo(x, 0.1))),
      y: Math.min(layout.lotDepthM, Math.max(0, snapTo(y, 0.1))),
    };
    if (type === 'element') patchElement(id, { positionM: pos });
    else
      update((d) => ({
        ...d,
        arrays: d.arrays.map((a) => (a.id === id ? { ...a, positionM: pos } : a)),
      }));
  };
  const centerOf = (type: 'element' | 'array', id: string): { x: number; y: number } | null =>
    type === 'element'
      ? (layout.elements.find((e) => e.id === id)?.positionM ?? null)
      : (layoutResult?.arrays.find((a) => a.id === id)?.centerM ?? null);

  const planPoint = (event: PointerEvent<SVGElement>): { x: number; y: number } | null => {
    const svg = planRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (!svg || !ctm) return null;
    const p = svg.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const local = p.matrixTransform(ctm.inverse());
    return { x: local.x, y: layout.lotDepthM - local.y };
  };
  const onItemDown = (event: PointerEvent<SVGElement>, type: 'element' | 'array', id: string) => {
    setSelected({ type, id });
    if (readOnly) return;
    const point = planPoint(event);
    const c = centerOf(type, id);
    drag.current = {
      kind: 'move',
      type,
      id,
      dx: point && c ? c.x - point.x : 0,
      dy: point && c ? c.y - point.y : 0,
    };
    (event.currentTarget as SVGElement).setPointerCapture?.(event.pointerId);
  };
  const onPlanMove = (event: PointerEvent<SVGElement>) => {
    const d = drag.current;
    if (!d || d.kind !== 'move') return;
    const point = planPoint(event);
    if (point) moveTo(d.type, d.id, point.x + d.dx, point.y + d.dy);
  };
  const onUp = () => {
    drag.current = null;
  };
  const onKey = (event: KeyboardEvent<SVGElement>, type: 'element' | 'array', id: string) => {
    if (readOnly) return;
    const step = event.shiftKey ? 1 : 0.1;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }[event.key];
    const c = centerOf(type, id);
    if (!delta || !c) return;
    event.preventDefault();
    moveTo(type, id, c.x + (delta[0] ?? 0), c.y + (delta[1] ?? 0));
  };
  const onSceneDown = (event: PointerEvent<SVGSVGElement>) => {
    drag.current = { kind: 'orbit', x: event.clientX, y: event.clientY, yaw, pitch };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onSceneMove = (event: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.kind !== 'orbit') return;
    setYaw(Math.round(((d.yaw + (event.clientX - d.x) * 0.5 + 540) % 360) - 180));
    setPitch(Math.round(Math.min(90, Math.max(5, d.pitch + (event.clientY - d.y) * 0.4))));
  };
  const onWheel = (event: WheelEvent<SVGSVGElement>) =>
    setZoom((z) => Math.min(4, Math.max(0.5, z * (event.deltaY < 0 ? 1.1 : 0.9))));

  const addElement = (kind: LayoutElementKind) => {
    const preset = PRESETS[kind];
    const count = layout.elements.filter((e) => e.kind === kind).length;
    const el: OffgridLayoutElement = {
      id: newId(),
      kind,
      name: count === 0 ? ELEMENT_LABELS[kind] : `${ELEMENT_LABELS[kind]} ${count + 1}`,
      positionM: {
        x: snapTo(layout.lotWidthM / 2 + count * 2, 0.1),
        y: snapTo(layout.lotDepthM / 2, 0.1),
      },
      rotationDeg: 0,
      ...preset,
    };
    setLayout({ elements: [...layout.elements, el] });
    setSelected({ type: 'element', id: el.id });
  };

  const selectedElement =
    selected?.type === 'element' ? layout.elements.find((e) => e.id === selected.id) : undefined;
  const selectedArray =
    selected?.type === 'array' ? design.arrays.find((a) => a.id === selected.id) : undefined;
  const selectedArrayResult = selectedArray
    ? layoutResult?.arrays.find((a) => a.id === selectedArray.id)
    : undefined;

  const room = layout.elements.find((e) => e.kind === 'POWER_ROOM');
  const endpoints = (
    run: OffgridLayoutRun,
  ): [{ x: number; y: number }, { x: number; y: number }] | null => {
    const house = layout.elements.find((e) => e.kind === 'HOUSE');
    const gen = layout.elements.find((e) => e.kind === 'GENERATOR');
    const pole = layout.elements.find((e) => e.kind === 'GRID_POLE');
    if (!room) return null;
    if (run.id.startsWith('pv-')) {
      const c = layoutResult?.arrays.find((a) => a.id === run.id.slice(3))?.centerM;
      return c ? [c, room.positionM] : null;
    }
    if (run.id === 'ac-load' && house) return [room.positionM, house.positionM];
    if (run.id === 'ac-gen' && gen) return [gen.positionM, room.positionM];
    if (run.id === 'ac-grid' && pole) return [pole.positionM, room.positionM];
    return null;
  };
  const cableRuns = (layoutResult?.runs ?? []).flatMap((run) => {
    const e = endpoints(run);
    return e ? [{ run, from: e[0], to: e[1] }] : [];
  });

  const W = layout.lotWidthM;
  const D = layout.lotDepthM;
  const sy = (y: number) => D - y;
  const poly = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${sy(p.y)}`).join(' ');
  const [bx, by, bw, bh] = scene.viewBox.split(' ').map(Number) as [number, number, number, number];
  const zoomedBox = `${bx + (bw - bw / zoom) / 2} ${by + (bh - bh / zoom) / 2} ${bw / zoom} ${bh / zoom}`;
  const gridLines = [...Array(Math.floor(W / 5) + 1).keys()].map((i) => i * 5);
  const gridLinesY = [...Array(Math.floor(D / 5) + 1).keys()].map((i) => i * 5);
  const shadowPolys = polygons.filter((p) => p.kind === 'SHADOW');
  const sunUp = sun.elevationDegrees >= 2;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Projeto visual do terreno</CardTitle>
          <CardDescription>
            Posicione os arranjos, a casa, a casa de máquinas, o gerador e a rede na planta (norte
            para cima). As distâncias viram trajetos de cabo e as construções sombreiam os arranjos.{' '}
            {readOnly
              ? 'Esta versão está congelada: só visualização.'
              : 'Arraste ou use as setas do teclado (Shift move 1 m); salve para recalcular.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Modo de visualização"
          >
            <Button
              variant={mode === '2d' ? 'default' : 'outline'}
              aria-pressed={mode === '2d'}
              onClick={() => setMode('2d')}
            >
              Planta 2D
            </Button>
            <Button
              variant={mode === '3d' ? 'default' : 'outline'}
              aria-pressed={mode === '3d'}
              onClick={() => setMode('3d')}
            >
              Cena 3D
            </Button>
            <span className="mx-2 h-6 w-px bg-border" aria-hidden />
            <div className="grid gap-1">
              <Label htmlFor="vs-date" className="sr-only">
                Data do sol
              </Label>
              <NativeSelect id="vs-date" value={date} onChange={(e) => setDate(e.target.value)}>
                {DATES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="vs-hour">Hora {hour} h</Label>
              <input
                id="vs-hour"
                type="range"
                min={6}
                max={18}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={shadows}
                onChange={(e) => setShadows(e.target.checked)}
              />
              Mostrar sombras
            </label>
            <span className="text-xs text-muted-foreground">
              Sol: {formatNumber(sun.azimuthDegrees, 0)}° / {formatNumber(sun.elevationDegrees, 0)}°{' '}
              {sunUp ? '' : '(abaixo do horizonte)'}
            </span>
          </div>

          {!readOnly ? (
            <div className="flex flex-wrap gap-2" aria-label="Adicionar à planta">
              {LAYOUT_ELEMENT_KINDS.map((kind) => (
                <Button key={kind} size="sm" variant="outline" onClick={() => addElement(kind)}>
                  <Plus /> {ELEMENT_LABELS[kind]}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
            {mode === '2d' ? (
              <svg
                ref={planRef}
                role="group"
                aria-label="Planta do terreno"
                viewBox={`-3 -3 ${W + 6} ${D + 6}`}
                className="w-full touch-none rounded border bg-card"
                onPointerMove={onPlanMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) setSelected(null);
                }}
              >
                <rect
                  x={0}
                  y={0}
                  width={W}
                  height={D}
                  className="fill-emerald-50 stroke-emerald-700"
                  strokeWidth={0.15}
                />
                {gridLines.map((x) => (
                  <g key={`gx${x}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={0}
                      y2={D}
                      className="stroke-emerald-700/15"
                      strokeWidth={0.05}
                    />
                    <text
                      x={x}
                      y={D + 1.4}
                      fontSize={0.9}
                      textAnchor="middle"
                      className="fill-muted-foreground"
                    >
                      {x}
                    </text>
                  </g>
                ))}
                {gridLinesY.map((y) => (
                  <g key={`gy${y}`}>
                    <line
                      x1={0}
                      x2={W}
                      y1={sy(y)}
                      y2={sy(y)}
                      className="stroke-emerald-700/15"
                      strokeWidth={0.05}
                    />
                    <text
                      x={-0.5}
                      y={sy(y) + 0.3}
                      fontSize={0.9}
                      textAnchor="end"
                      className="fill-muted-foreground"
                    >
                      {y}
                    </text>
                  </g>
                ))}
                {shadows
                  ? shadowPolys.map((p, i) => (
                      <polygon key={i} points={poly(p.points)} className="fill-black/20" />
                    ))
                  : null}
                {cableRuns.map(({ run, from, to }) => (
                  <g key={run.id}>
                    <line
                      x1={from.x}
                      y1={sy(from.y)}
                      x2={to.x}
                      y2={sy(to.y)}
                      className={run.kind === 'DC_PV' ? 'stroke-red-600' : 'stroke-blue-700'}
                      strokeWidth={0.18}
                      strokeDasharray={run.kind === 'DC_PV' ? undefined : '0.6 0.4'}
                    />
                    <text
                      x={(from.x + to.x) / 2}
                      y={sy((from.y + to.y) / 2) - 0.4}
                      fontSize={0.9}
                      textAnchor="middle"
                      className="fill-foreground"
                    >
                      {formatNumber(run.distanceM, 1)} m
                    </text>
                  </g>
                ))}
                {layout.elements.map((e) => {
                  const isSel = selected?.type === 'element' && selected.id === e.id;
                  return (
                    <g
                      key={e.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`${e.name}, ${ELEMENT_LABELS[e.kind]}`}
                      aria-pressed={isSel}
                      onPointerDown={(ev) => onItemDown(ev, 'element', e.id)}
                      onKeyDown={(ev) => onKey(ev, 'element', e.id)}
                      onFocus={() => setSelected({ type: 'element', id: e.id })}
                      className="cursor-move outline-none"
                    >
                      <polygon
                        points={poly(elementCorners(e))}
                        className={FILL[e.kind]}
                        strokeWidth={isSel ? 0.3 : 0.12}
                      />
                      <text
                        x={e.positionM.x}
                        y={sy(e.positionM.y) + 0.3}
                        fontSize={0.9}
                        textAnchor="middle"
                        className="pointer-events-none fill-foreground"
                      >
                        {e.name}
                      </text>
                    </g>
                  );
                })}
                {design.arrays.map((a) => {
                  const r = layoutResult?.arrays.find((x) => x.id === a.id);
                  if (!r) return null;
                  const isSel = selected?.type === 'array' && selected.id === a.id;
                  const cw = r.widthM / a.modulesInSeries;
                  const rh = r.depthM / a.parallelStrings;
                  return (
                    <g
                      key={a.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`Arranjo ${a.name}`}
                      aria-pressed={isSel}
                      transform={`translate(${r.centerM.x} ${sy(r.centerM.y)}) rotate(${a.azimuthDegrees})`}
                      onPointerDown={(ev) => onItemDown(ev, 'array', a.id)}
                      onKeyDown={(ev) => onKey(ev, 'array', a.id)}
                      onFocus={() => setSelected({ type: 'array', id: a.id })}
                      className="cursor-move outline-none"
                    >
                      <rect
                        x={-r.widthM / 2}
                        y={-r.depthM / 2}
                        width={r.widthM}
                        height={r.depthM}
                        className="fill-sky-800 stroke-sky-950"
                        strokeWidth={isSel ? 0.3 : 0.1}
                      />
                      {[...Array(a.modulesInSeries - 1).keys()].map((i) => (
                        <line
                          key={`c${i}`}
                          x1={-r.widthM / 2 + (i + 1) * cw}
                          x2={-r.widthM / 2 + (i + 1) * cw}
                          y1={-r.depthM / 2}
                          y2={r.depthM / 2}
                          className="stroke-sky-300/70"
                          strokeWidth={0.05}
                        />
                      ))}
                      {[...Array(a.parallelStrings - 1).keys()].map((i) => (
                        <line
                          key={`r${i}`}
                          x1={-r.widthM / 2}
                          x2={r.widthM / 2}
                          y1={-r.depthM / 2 + (i + 1) * rh}
                          y2={-r.depthM / 2 + (i + 1) * rh}
                          className="stroke-sky-300/70"
                          strokeWidth={0.05}
                        />
                      ))}
                      <path
                        d={`M0 ${r.depthM / 2 + 0.2} L0 ${r.depthM / 2 + 1.1} M-0.3 ${r.depthM / 2 + 0.8} L0 ${r.depthM / 2 + 1.1} L0.3 ${r.depthM / 2 + 0.8}`}
                        className="stroke-sky-900"
                        strokeWidth={0.12}
                        fill="none"
                      />
                    </g>
                  );
                })}
                {design.arrays.map((a) => {
                  const r = layoutResult?.arrays.find((x) => x.id === a.id);
                  return r ? (
                    <text
                      key={`t${a.id}`}
                      x={r.centerM.x}
                      y={sy(r.centerM.y) + 0.3}
                      fontSize={0.9}
                      textAnchor="middle"
                      className="pointer-events-none fill-white"
                    >
                      {a.name}
                    </text>
                  ) : null;
                })}
                <g aria-label="Norte" transform={`translate(${W - 1.5} 2)`}>
                  <path
                    d="M0 1.2 L0 -1.2 M-0.5 -0.5 L0 -1.2 L0.5 -0.5"
                    className="stroke-foreground"
                    strokeWidth={0.15}
                    fill="none"
                  />
                  <text x={0} y={2.4} fontSize={1} textAnchor="middle" className="fill-foreground">
                    N
                  </text>
                </g>
                <g aria-label="Escala" transform={`translate(1 ${D - 1})`}>
                  <line
                    x1={0}
                    x2={5}
                    y1={0}
                    y2={0}
                    className="stroke-foreground"
                    strokeWidth={0.2}
                  />
                  <text
                    x={2.5}
                    y={-0.4}
                    fontSize={0.9}
                    textAnchor="middle"
                    className="fill-foreground"
                  >
                    5 m
                  </text>
                </g>
              </svg>
            ) : (
              <div className="space-y-2">
                <svg
                  role="img"
                  aria-label="Cena 3D do terreno"
                  viewBox={zoomedBox}
                  className="h-[28rem] w-full cursor-grab touch-none rounded border bg-card active:cursor-grabbing"
                  onPointerDown={onSceneDown}
                  onPointerMove={onSceneMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                  onWheel={onWheel}
                >
                  {scene.polygons
                    .filter((p) => shadows || p.kind !== 'SHADOW')
                    .map((p, i) => (
                      <polygon
                        key={i}
                        points={p.points.map((q) => `${q.x},${q.y}`).join(' ')}
                        className={
                          p.elementKind
                            ? `${FILL[p.elementKind]} ${p.kind === 'SIDE' ? 'opacity-80' : ''}`
                            : POLY_FILL[p.kind]
                        }
                        strokeWidth={0.08}
                        onPointerDown={(ev) => {
                          if (p.ref) {
                            ev.stopPropagation();
                            setSelected(p.ref);
                          }
                        }}
                      />
                    ))}
                  {cableRuns.map(({ run, from, to }) => {
                    const a = scene.project({ x: from.x, y: from.y, z: 0.1 });
                    const b = scene.project({ x: to.x, y: to.y, z: 0.1 });
                    return (
                      <line
                        key={run.id}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        className={run.kind === 'DC_PV' ? 'stroke-red-600' : 'stroke-blue-700'}
                        strokeWidth={0.2}
                        strokeDasharray={run.kind === 'DC_PV' ? undefined : '0.6 0.4'}
                      />
                    );
                  })}
                  {layout.elements.map((e) => {
                    const p = scene.project({
                      x: e.positionM.x,
                      y: e.positionM.y,
                      z: e.heightM + 0.6,
                    });
                    return (
                      <text
                        key={e.id}
                        x={p.x}
                        y={p.y}
                        fontSize={1}
                        textAnchor="middle"
                        className="pointer-events-none fill-foreground"
                      >
                        {e.name}
                      </text>
                    );
                  })}
                </svg>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Label htmlFor="vs-yaw">Giro {yaw}°</Label>
                  <input
                    id="vs-yaw"
                    type="range"
                    min={-180}
                    max={180}
                    value={yaw}
                    onChange={(e) => setYaw(Number(e.target.value))}
                  />
                  <Label htmlFor="vs-pitch">Altura da câmera {pitch}°</Label>
                  <input
                    id="vs-pitch"
                    type="range"
                    min={5}
                    max={90}
                    value={pitch}
                    onChange={(e) => setPitch(Number(e.target.value))}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Afastar"
                    onClick={() => setZoom((z) => Math.max(0.5, z / 1.2))}
                  >
                    <ZoomOut />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Aproximar"
                    onClick={() => setZoom((z) => Math.min(4, z * 1.2))}
                  >
                    <ZoomIn />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Arraste a cena para girar; a roda aproxima.
                  </span>
                </div>
              </div>
            )}

            <aside
              className="space-y-3 rounded border p-3 text-sm"
              aria-label="Detalhes da seleção"
            >
              {selectedElement ? (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{ELEMENT_LABELS[selectedElement.kind]}</h3>
                    {!readOnly ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remover ${selectedElement.name}`}
                        onClick={() => {
                          setLayout({
                            elements: layout.elements.filter((e) => e.id !== selectedElement.id),
                          });
                          setSelected(null);
                        }}
                      >
                        <Trash2 /> Remover
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="el-name">Nome</Label>
                    <Input
                      id="el-name"
                      disabled={readOnly}
                      value={selectedElement.name}
                      onChange={(e) => patchElement(selectedElement.id, { name: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      id="el-x"
                      label="Leste (X)"
                      unit="m"
                      disabled={readOnly}
                      value={selectedElement.positionM.x}
                      onChange={(v) =>
                        v !== undefined &&
                        patchElement(selectedElement.id, {
                          positionM: { ...selectedElement.positionM, x: v },
                        })
                      }
                    />
                    <NumberField
                      id="el-y"
                      label="Norte (Y)"
                      unit="m"
                      disabled={readOnly}
                      value={selectedElement.positionM.y}
                      onChange={(v) =>
                        v !== undefined &&
                        patchElement(selectedElement.id, {
                          positionM: { ...selectedElement.positionM, y: v },
                        })
                      }
                    />
                    <NumberField
                      id="el-w"
                      label="Largura"
                      unit="m"
                      min={0.1}
                      disabled={readOnly}
                      value={selectedElement.widthM}
                      onChange={(v) =>
                        v !== undefined && patchElement(selectedElement.id, { widthM: v })
                      }
                    />
                    <NumberField
                      id="el-d"
                      label="Profundidade"
                      unit="m"
                      min={0.1}
                      disabled={readOnly}
                      value={selectedElement.depthM}
                      onChange={(v) =>
                        v !== undefined && patchElement(selectedElement.id, { depthM: v })
                      }
                    />
                    <NumberField
                      id="el-h"
                      label="Altura"
                      unit="m"
                      min={0}
                      disabled={readOnly}
                      value={selectedElement.heightM}
                      hint="0 não sombreia"
                      onChange={(v) =>
                        v !== undefined && patchElement(selectedElement.id, { heightM: v })
                      }
                    />
                    <NumberField
                      id="el-r"
                      label="Giro"
                      unit="°"
                      min={0}
                      max={359.9}
                      disabled={readOnly}
                      value={selectedElement.rotationDeg}
                      onChange={(v) =>
                        v !== undefined && patchElement(selectedElement.id, { rotationDeg: v })
                      }
                    />
                  </div>
                </>
              ) : selectedArray && selectedArrayResult ? (
                <>
                  <h3 className="font-medium">Arranjo {selectedArray.name}</h3>
                  <p className="text-muted-foreground">
                    {selectedArray.modulesInSeries} em série × {selectedArray.parallelStrings}{' '}
                    strings · {formatNumber(selectedArrayResult.widthM, 1)} ×{' '}
                    {formatNumber(selectedArrayResult.depthM, 1)} m · azimute{' '}
                    {formatNumber(selectedArray.azimuthDegrees, 0)}° · inclinação{' '}
                    {formatNumber(selectedArray.tiltDegrees, 0)}°
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      id="ar-x"
                      label="Leste (X)"
                      unit="m"
                      disabled={readOnly}
                      value={selectedArrayResult.centerM.x}
                      onChange={(v) =>
                        v !== undefined &&
                        moveTo('array', selectedArray.id, v, selectedArrayResult.centerM.y)
                      }
                    />
                    <NumberField
                      id="ar-y"
                      label="Norte (Y)"
                      unit="m"
                      disabled={readOnly}
                      value={selectedArrayResult.centerM.y}
                      onChange={(v) =>
                        v !== undefined &&
                        moveTo('array', selectedArray.id, selectedArrayResult.centerM.x, v)
                      }
                    />
                  </div>
                  <p>
                    Sombra das construções:{' '}
                    <strong>{formatNumber(selectedArrayResult.annualShadingLossPct, 1)}%</strong> da
                    componente direta ao ano ({selectedArrayResult.shadingObstacles} objeto(s)).
                  </p>
                  {!readOnly ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        update((d) => ({
                          ...d,
                          arrays: d.arrays.map((a) =>
                            a.id === selectedArray.id
                              ? { ...a, shadingLossPct: selectedArrayResult.annualShadingLossPct }
                              : a,
                          ),
                        }))
                      }
                    >
                      Usar como perda por sombra ({formatNumber(selectedArray.shadingLossPct, 1)}%
                      hoje)
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">
                  Selecione um objeto na planta para ver e editar os detalhes.
                </p>
              )}
            </aside>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Terreno e cabos</CardTitle>
          <CardDescription>
            Premissas da estimativa. A queda máxima é escolha sua; a capacidade de condução e a
            aprovação do cabo seguem a regra de cabos (não aplicada aqui).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              id="lot-w"
              label="Terreno: largura (leste)"
              unit="m"
              min={5}
              disabled={readOnly}
              value={layout.lotWidthM}
              onChange={(v) => v !== undefined && setLayout({ lotWidthM: v })}
            />
            <NumberField
              id="lot-d"
              label="Terreno: profundidade (norte)"
              unit="m"
              min={5}
              disabled={readOnly}
              value={layout.lotDepthM}
              onChange={(v) => v !== undefined && setLayout({ lotDepthM: v })}
            />
            <NumberField
              id="lot-slack"
              label="Folga do percurso"
              unit="%"
              min={0}
              disabled={readOnly}
              value={layout.cableSlackPct}
              onChange={(v) => v !== undefined && setLayout({ cableSlackPct: v })}
            />
            <NumberField
              id="lot-bank"
              label="Banco → inversor"
              unit="m"
              min={0.1}
              disabled={readOnly}
              value={layout.bankToInverterM}
              onChange={(v) => v !== undefined && setLayout({ bankToInverterM: v })}
            />
            <NumberField
              id="lot-dc"
              label="Queda máx. CC dos módulos"
              unit="%"
              min={0.1}
              disabled={readOnly}
              value={layout.maxDropPctDc}
              onChange={(v) => v !== undefined && setLayout({ maxDropPctDc: v })}
            />
            <NumberField
              id="lot-bk"
              label="Queda máx. banco"
              unit="%"
              min={0.1}
              disabled={readOnly}
              value={layout.maxDropPctBank}
              onChange={(v) => v !== undefined && setLayout({ maxDropPctBank: v })}
            />
            <NumberField
              id="lot-ac"
              label="Queda máx. CA"
              unit="%"
              min={0.1}
              disabled={readOnly}
              value={layout.maxDropPctAc}
              onChange={(v) => v !== undefined && setLayout({ maxDropPctAc: v })}
            />
          </div>
          {layoutResult && layoutResult.runs.length > 0 ? (
            <>
              <Table aria-label="Trajetos de cabo">
                <TableHeader>
                  <TableRow>
                    <TableHead>Trajeto</TableHead>
                    <TableHead>Distância</TableHead>
                    <TableHead>Corrente</TableHead>
                    <TableHead>Tensão</TableHead>
                    <TableHead>Seção mínima</TableHead>
                    <TableHead>Seção comercial</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {layoutResult.runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        {run.from} → {run.to}
                      </TableCell>
                      <TableCell>{formatNumber(run.distanceM, 1)} m</TableCell>
                      <TableCell>{formatNumber(run.currentA, 1)} A</TableCell>
                      <TableCell>{formatNumber(run.voltageV, 0)} V</TableCell>
                      <TableCell>{formatNumber(run.minSectionMm2, 1)} mm²</TableCell>
                      <TableCell>
                        {run.suggestedSectionMm2 !== null ? (
                          <>
                            {run.suggestedSectionMm2} mm²{' '}
                            <span className="text-xs text-muted-foreground">
                              (queda {formatNumber(run.dropPctAtSuggested ?? 0, 2)}%)
                            </span>
                          </>
                        ) : (
                          <Badge variant="red">acima de 240 mm²</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  Cabo total estimado: {formatNumber(layoutResult.totalCableM, 1)} m (ida; cada
                  trecho tem dois condutores)
                </span>
                {!readOnly ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      update((d) => ({
                        ...d,
                        arrays: d.arrays.map((a) => {
                          const run = layoutResult.runs.find((r) => r.id === `pv-${a.id}`);
                          return run ? { ...a, cableLengthM: run.distanceM } : a;
                        }),
                      }))
                    }
                  >
                    Aplicar distâncias aos arranjos
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
          {layoutResult && layoutResult.warnings.length > 0 ? (
            <ul className="space-y-1 text-sm" aria-label="Avisos da planta">
              {layoutResult.warnings.map((w) => (
                <li key={w} className="flex gap-2">
                  <Badge variant="yellow">Aviso</Badge>
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
