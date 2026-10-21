import { Plus, Trash2 } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import type { Obstacle, Surface } from '@voltex/shared';
import { solarPosition } from '@voltex/solar-engine';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
} from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { LayoutPreview } from './charts';
import { useEditor } from './editor-context';
import { NumberField } from './number-field';
import {
  buildScene,
  obstacleBox,
  obstacleFromPoint,
  planOutline,
  projectScene,
  resolveCenters,
  snapTo,
  surfacePoint,
  type PolygonKind,
} from './scene-3d-math';
import { defaultSurface } from './surfaces-step';

const FILL: Record<PolygonKind, string> = {
  GROUND: 'fill-muted stroke-border',
  SHADOW: 'fill-foreground/25 stroke-none',
  ROOF: 'fill-secondary stroke-foreground/50',
  MODULE: 'fill-primary/80 stroke-primary-foreground',
  OBSTACLE: 'fill-warning/70 stroke-foreground/60',
};

const DATES = [
  { id: '03-20', label: '20 de março (equinócio)' },
  { id: '06-21', label: '21 de junho (inverno)' },
  { id: '09-22', label: '22 de setembro (equinócio)' },
  { id: '12-21', label: '21 de dezembro (verão)' },
];

interface Selection {
  surfaceId: string;
  obstacleId?: string;
}

const pts = (points: { x: number; y: number }[]) => points.map((p) => `${p.x},${-p.y}`).join(' ');

/** Estúdio visual do projeto: planta 2D editável (arrastar superfícies e obstáculos) e cena 3D com órbita, zoom e sombra. */
export function VisualizationStep() {
  const { design, update, readOnly, results, goToStep } = useEditor();
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [yaw, setYaw] = useState(25);
  const [pitch, setPitch] = useState(35);
  const [zoom, setZoom] = useState(1);
  const [date, setDate] = useState('12-21');
  const [hour, setHour] = useState(11);
  const [selected, setSelected] = useState<Selection | null>(null);
  const drag = useRef<{
    kind: 'surface' | 'obstacle' | 'orbit';
    id: string;
    surfaceId?: string;
    moved: boolean;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  } | null>(null);
  const planRef = useRef<SVGSVGElement | null>(null);

  const sun = useMemo(() => {
    // Hora local do Brasil (UTC−3): o instante UTC é a hora local mais 3.
    const at = new Date(`2025-${date}T${String(hour + 3).padStart(2, '0')}:00:00Z`);
    const position = solarPosition({
      at,
      latitudeDegrees: design.site.latitude,
      longitudeDegrees: design.site.longitude,
    });
    return { azimuthDegrees: position.azimuthDegrees, elevationDegrees: position.elevationDegrees };
  }, [date, hour, design.site.latitude, design.site.longitude]);

  const centers = useMemo(() => resolveCenters(design.surfaces), [design.surfaces]);
  const scene = useMemo(
    () => projectScene(buildScene(design.surfaces, results.layout, sun), yaw, pitch),
    [design.surfaces, results.layout, sun, yaw, pitch],
  );

  const patchSurface = (id: string, fn: (s: Surface) => Surface) =>
    update((d) => ({ ...d, surfaces: d.surfaces.map((s) => (s.id === id ? fn(s) : s)) }));
  const patchObstacle = (surfaceId: string, id: string, fn: (o: Obstacle) => Obstacle) =>
    patchSurface(surfaceId, (s) => ({
      ...s,
      obstacles: s.obstacles.map((o) => (o.id === id ? fn(o) : o)),
    }));

  /** Posição do ponteiro na planta (m), com o norte para cima. */
  const planPoint = (event: PointerEvent<SVGElement>): { x: number; y: number } | null => {
    const svg = planRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (!svg || !ctm) return null;
    const p = svg.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const local = p.matrixTransform(ctm.inverse());
    return { x: local.x, y: -local.y };
  };

  const moveSurface = (id: string, to: { x: number; y: number }) =>
    patchSurface(id, (s) => ({ ...s, positionM: { x: snapTo(to.x, 0.1), y: snapTo(to.y, 0.1) } }));
  const moveObstacle = (surfaceId: string, id: string, to: { x: number; y: number }) => {
    const index = design.surfaces.findIndex((s) => s.id === surfaceId);
    const center = centers[index];
    if (!center) return;
    const { azimuthDegrees, distanceM } = obstacleFromPoint(to, center);
    patchObstacle(surfaceId, id, (o) => ({
      ...o,
      azimuthDegrees: Math.min(359.9, azimuthDegrees),
      distanceM,
    }));
  };

  const onPlanPointerDown = (
    event: PointerEvent<SVGElement>,
    kind: 'surface' | 'obstacle',
    surfaceId: string,
    id: string,
  ) => {
    setSelected(kind === 'surface' ? { surfaceId } : { surfaceId, obstacleId: id });
    if (readOnly) return;
    drag.current = {
      kind,
      id,
      surfaceId,
      moved: false,
      x: event.clientX,
      y: event.clientY,
      yaw,
      pitch,
    };
    (event.currentTarget as SVGElement).setPointerCapture?.(event.pointerId);
  };
  const onPlanPointerMove = (event: PointerEvent<SVGElement>) => {
    const d = drag.current;
    if (!d || (d.kind !== 'surface' && d.kind !== 'obstacle')) return;
    const point = planPoint(event);
    if (!point) return;
    d.moved = true;
    if (d.kind === 'surface') moveSurface(d.id, point);
    else moveObstacle(d.surfaceId as string, d.id, point);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  /** Teclado: setas movem 0,1 m (Shift: 1 m). */
  const onKey = (
    event: KeyboardEvent<SVGElement>,
    kind: 'surface' | 'obstacle',
    surfaceId: string,
    id: string,
  ) => {
    if (readOnly) return;
    const step = event.shiftKey ? 1 : 0.1;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    const index = design.surfaces.findIndex((s) => s.id === surfaceId);
    const center = centers[index];
    if (!center) return;
    if (kind === 'surface')
      moveSurface(id, { x: center.x + (delta[0] ?? 0), y: center.y + (delta[1] ?? 0) });
    else {
      const surface = design.surfaces[index] as Surface;
      const obstacle = surface.obstacles.find((o) => o.id === id);
      if (!obstacle) return;
      const a = (obstacle.azimuthDegrees * Math.PI) / 180;
      moveObstacle(surfaceId, id, {
        x: center.x + Math.sin(a) * obstacle.distanceM + (delta[0] ?? 0),
        y: center.y + Math.cos(a) * obstacle.distanceM + (delta[1] ?? 0),
      });
    }
  };

  /** Órbita da câmera 3D: arrastar o fundo gira; a roda do mouse aproxima. */
  const onSceneDown = (event: PointerEvent<SVGSVGElement>) => {
    drag.current = {
      kind: 'orbit',
      id: '',
      moved: false,
      x: event.clientX,
      y: event.clientY,
      yaw,
      pitch,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onSceneMove = (event: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.kind !== 'orbit') return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setYaw(Math.round(((d.yaw + dx * 0.5 + 540) % 360) - 180));
    setPitch(Math.round(Math.min(90, Math.max(5, d.pitch + dy * 0.4))));
  };
  const onWheel = (event: WheelEvent<SVGSVGElement>) =>
    setZoom((z) => Math.min(4, Math.max(0.5, z * (event.deltaY < 0 ? 1.1 : 0.9))));

  const addSurface = () => {
    const surface = defaultSurface(design.site.latitude, design.surfaces.length + 1);
    // Entra ao lado da última, em cima de nenhuma outra.
    const last = centers.at(-1);
    const next = {
      ...surface,
      positionM: last ? { x: snapTo(last.x + surface.widthM + 2, 0.1), y: last.y } : { x: 0, y: 0 },
    };
    update((d) => ({ ...d, surfaces: [...d.surfaces, next] }));
    setSelected({ surfaceId: next.id });
  };
  const addObstacle = (surfaceId: string) => {
    const id = `ob-${Math.random().toString(36).slice(2, 8)}`;
    patchSurface(surfaceId, (s) => ({
      ...s,
      obstacles: [
        ...s.obstacles,
        {
          id,
          name: 'Obstáculo',
          azimuthDegrees: 90,
          distanceM: Math.max(4, s.widthM / 2 + 1.5),
          heightM: 2,
          widthM: 1,
        },
      ],
    }));
    setSelected({ surfaceId, obstacleId: id });
  };

  if (design.surfaces.length === 0)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Visualização 2D e 3D</CardTitle>
          <CardDescription>
            Ainda não há superfícies. Adicione a primeira para ver a planta e a cena em 3D.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          {!readOnly ? (
            <Button onClick={addSurface}>
              <Plus /> Adicionar superfície
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => goToStep('superficies')}>
            Ir para Superfícies
          </Button>
        </CardContent>
      </Card>
    );

  const selectedSurface = design.surfaces.find((s) => s.id === selected?.surfaceId);
  const selectedObstacle = selectedSurface?.obstacles.find((o) => o.id === selected?.obstacleId);
  const selectedIndex = selectedSurface ? design.surfaces.indexOf(selectedSurface) : -1;

  // Limites da planta (com margem) para o viewBox; y invertido (norte para cima).
  const planXs: number[] = [];
  const planYs: number[] = [];
  design.surfaces.forEach((s, i) => {
    const c = centers[i]!;
    planOutline(s, c).forEach((p) => {
      planXs.push(p.x);
      planYs.push(p.y);
    });
    s.obstacles.forEach((o) =>
      obstacleBox(o, c).base.forEach((p) => {
        planXs.push(p.x);
        planYs.push(p.y);
      }),
    );
  });
  const pad = 2;
  const minX = Math.min(...planXs) - pad;
  const maxX = Math.max(...planXs) + pad;
  const minY = Math.min(...planYs) - pad;
  const maxY = Math.max(...planYs) + pad;
  const planBox = `${minX} ${-maxY} ${maxX - minX} ${maxY - minY}`;

  const [bx, by, bw, bh] = scene.viewBox.split(' ').map(Number) as [number, number, number, number];
  const zoomedBox = `${bx! + (bw! - bw! / zoom) / 2} ${by! + (bh! - bh! / zoom) / 2} ${bw! / zoom} ${bh! / zoom}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Visualização 2D e 3D</CardTitle>
          <CardDescription>
            Planta do local (norte para cima) e cena 3D.{' '}
            {readOnly
              ? 'Esta versão está congelada: só visualização.'
              : 'Arraste superfícies e obstáculos na planta (ou use as setas do teclado) e salve para recalcular.'}{' '}
            Os números vêm do mesmo cálculo do projeto.
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
              2D (planta)
            </Button>
            <Button
              variant={mode === '3d' ? 'default' : 'outline'}
              aria-pressed={mode === '3d'}
              onClick={() => setMode('3d')}
            >
              3D (cena)
            </Button>
            {!readOnly ? (
              <>
                <Button variant="outline" onClick={addSurface}>
                  <Plus /> Adicionar superfície
                </Button>
                <Button
                  variant="outline"
                  disabled={!selectedSurface}
                  onClick={() => selectedSurface && addObstacle(selectedSurface.id)}
                >
                  <Plus /> Adicionar obstáculo
                </Button>
              </>
            ) : null}
          </div>

          {mode === '2d' ? (
            <svg
              ref={planRef}
              role="img"
              aria-label={`Planta com ${design.surfaces.length} superfície(s)`}
              viewBox={planBox}
              className="h-auto max-h-[34rem] w-full touch-none rounded border bg-card"
              onPointerMove={onPlanPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {/* Grade de 5 m e seta do norte. */}
              {Array.from(
                { length: Math.floor((maxX - minX) / 5) + 1 },
                (_, i) => Math.ceil(minX / 5) * 5 + i * 5,
              ).map((x) => (
                <line
                  key={`gx${x}`}
                  x1={x}
                  x2={x}
                  y1={-maxY}
                  y2={-minY}
                  className="stroke-border"
                  strokeWidth={0.05}
                />
              ))}
              {Array.from(
                { length: Math.floor((maxY - minY) / 5) + 1 },
                (_, i) => Math.ceil(minY / 5) * 5 + i * 5,
              ).map((y) => (
                <line
                  key={`gy${y}`}
                  x1={minX}
                  x2={maxX}
                  y1={-y}
                  y2={-y}
                  className="stroke-border"
                  strokeWidth={0.05}
                />
              ))}
              <g aria-hidden transform={`translate(${minX + 1.2} ${-maxY + 2.2})`}>
                <polygon points="0,-1.4 0.5,0.3 0,0 -0.5,0.3" className="fill-foreground" />
                <text y={1.4} fontSize={0.9} textAnchor="middle" className="fill-foreground">
                  N
                </text>
              </g>
              <text
                x={maxX - 0.3}
                y={-minY - 0.4}
                fontSize={0.7}
                textAnchor="end"
                className="fill-muted-foreground"
              >
                grade: 5 m
              </text>

              {design.surfaces.map((surface, index) => {
                const center = centers[index]!;
                const layout = results.layout.find((l) => l.surfaceId === surface.id);
                const isSelected = selected?.surfaceId === surface.id && !selected.obstacleId;
                const sb = surface.setbackM;
                return (
                  <g key={surface.id}>
                    <polygon
                      role="button"
                      tabIndex={0}
                      aria-label={`Superfície ${surface.name}`}
                      aria-pressed={isSelected}
                      points={pts(planOutline(surface, center))}
                      className={`cursor-move fill-secondary ${isSelected ? 'stroke-primary' : 'stroke-foreground/50'}`}
                      strokeWidth={isSelected ? 0.15 : 0.08}
                      onPointerDown={(e) => onPlanPointerDown(e, 'surface', surface.id, surface.id)}
                      onKeyDown={(e) => onKey(e, 'surface', surface.id, surface.id)}
                      onFocus={() => setSelected({ surfaceId: surface.id })}
                    />
                    {(layout?.rects ?? []).map((r, i) => (
                      <polygon
                        key={i}
                        className="pointer-events-none fill-primary/80 stroke-primary-foreground"
                        strokeWidth={0.03}
                        points={pts([
                          surfacePoint(
                            surface,
                            center,
                            sb.left + r.x - surface.widthM / 2,
                            surface.depthM - (sb.top + r.y) - r.h,
                          ),
                          surfacePoint(
                            surface,
                            center,
                            sb.left + r.x - surface.widthM / 2 + r.w,
                            surface.depthM - (sb.top + r.y) - r.h,
                          ),
                          surfacePoint(
                            surface,
                            center,
                            sb.left + r.x - surface.widthM / 2 + r.w,
                            surface.depthM - (sb.top + r.y),
                          ),
                          surfacePoint(
                            surface,
                            center,
                            sb.left + r.x - surface.widthM / 2,
                            surface.depthM - (sb.top + r.y),
                          ),
                        ])}
                      />
                    ))}
                    <text
                      x={center.x}
                      y={-center.y}
                      fontSize={0.8}
                      textAnchor="middle"
                      className="pointer-events-none fill-foreground"
                    >
                      {surface.name}
                    </text>
                    {surface.obstacles.map((o) => {
                      const base = obstacleBox(o, center).base;
                      const sel = selected?.obstacleId === o.id;
                      return (
                        <polygon
                          key={o.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Obstáculo ${o.name}`}
                          aria-pressed={sel}
                          points={pts(base)}
                          className={`cursor-move fill-warning/70 ${sel ? 'stroke-primary' : 'stroke-foreground/60'}`}
                          strokeWidth={sel ? 0.15 : 0.08}
                          onPointerDown={(e) => onPlanPointerDown(e, 'obstacle', surface.id, o.id)}
                          onKeyDown={(e) => onKey(e, 'obstacle', surface.id, o.id)}
                          onFocus={() => setSelected({ surfaceId: surface.id, obstacleId: o.id })}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="space-y-3">
              <svg
                role="img"
                aria-label={`Cena 3D com ${design.surfaces.length} superfície(s)`}
                viewBox={zoomedBox}
                className="h-auto max-h-[32rem] w-full touch-none rounded border bg-card"
                onPointerDown={onSceneDown}
                onPointerMove={onSceneMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                onWheel={onWheel}
              >
                {scene.polygons.map((poly, i) => {
                  const isSel =
                    poly.surfaceId !== undefined &&
                    selected?.surfaceId === poly.surfaceId &&
                    (poly.kind === 'ROOF' ||
                      (poly.obstacleId !== undefined && selected.obstacleId === poly.obstacleId));
                  return (
                    <polygon
                      key={i}
                      className={`${FILL[poly.kind]} ${isSel ? 'stroke-primary' : ''}`}
                      strokeWidth={isSel ? 0.12 : 0.04}
                      points={poly.points.map((p) => `${p.x},${p.y}`).join(' ')}
                      onClick={() => {
                        if (drag.current?.moved || !poly.surfaceId) return;
                        setSelected(
                          poly.obstacleId
                            ? { surfaceId: poly.surfaceId, obstacleId: poly.obstacleId }
                            : { surfaceId: poly.surfaceId },
                        );
                      }}
                    >
                      {poly.label ? <title>{poly.label}</title> : null}
                    </polygon>
                  );
                })}
              </svg>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="grid gap-1">
                  <Label htmlFor="cam-yaw">Girar</Label>
                  <input
                    id="cam-yaw"
                    type="range"
                    min={-180}
                    max={180}
                    value={yaw}
                    onChange={(e) => setYaw(Number(e.target.value))}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="cam-pitch">Inclinar a câmera</Label>
                  <input
                    id="cam-pitch"
                    type="range"
                    min={5}
                    max={90}
                    value={pitch}
                    onChange={(e) => setPitch(Number(e.target.value))}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="cam-zoom">Aproximar</Label>
                  <input
                    id="cam-zoom"
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.1}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="sun-date">Data do sol</Label>
                  <NativeSelect
                    id="sun-date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  >
                    {DATES.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="sun-hour">Hora local: {hour}h</Label>
                  <input
                    id="sun-hour"
                    type="range"
                    min={5}
                    max={19}
                    value={hour}
                    onChange={(e) => setHour(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setYaw(0);
                    setPitch(20);
                    setZoom(1);
                  }}
                >
                  Frente (sul)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setYaw(25);
                    setPitch(35);
                    setZoom(1);
                  }}
                >
                  Isométrica
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setYaw(0);
                    setPitch(90);
                    setZoom(1);
                  }}
                >
                  De cima
                </Button>
                <span className="text-muted-foreground">
                  Sol: altura {formatNumber(sun.elevationDegrees, 1)}° · azimute{' '}
                  {formatNumber(sun.azimuthDegrees, 0)}°
                  {sun.elevationDegrees < 2 ? ' (sol abaixo do horizonte: sem sombra)' : ''}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Arraste a cena para girar, use a roda do mouse para aproximar e clique numa
                superfície ou obstáculo para selecioná-lo. Amarelo: obstáculos · cinza escuro:
                sombra no chão.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSurface ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selectedObstacle
                ? `Obstáculo: ${selectedObstacle.name}`
                : `Superfície: ${selectedSurface.name}`}
            </CardTitle>
            <CardDescription>
              {selectedObstacle
                ? 'Direção e distância são medidas a partir do centro da superfície (arraste na planta para ajustar).'
                : 'Posição do centro na planta (m): leste (x) e norte (y).'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedObstacle ? (
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <div className="grid gap-1">
                  <Label htmlFor="vz-ob-name">Nome</Label>
                  <Input
                    id="vz-ob-name"
                    disabled={readOnly}
                    value={selectedObstacle.name}
                    onChange={(e) =>
                      patchObstacle(selectedSurface.id, selectedObstacle.id, (o) => ({
                        ...o,
                        name: e.target.value,
                      }))
                    }
                  />
                </div>
                <NumberField
                  id="vz-ob-h"
                  label="Altura"
                  unit="m"
                  min={-50}
                  max={200}
                  disabled={readOnly}
                  value={selectedObstacle.heightM}
                  onChange={(v) =>
                    v !== undefined &&
                    patchObstacle(selectedSurface.id, selectedObstacle.id, (o) => ({
                      ...o,
                      heightM: v,
                    }))
                  }
                />
                <NumberField
                  id="vz-ob-w"
                  label="Largura"
                  unit="m"
                  min={0.05}
                  max={500}
                  disabled={readOnly}
                  value={selectedObstacle.widthM}
                  onChange={(v) =>
                    v !== undefined &&
                    patchObstacle(selectedSurface.id, selectedObstacle.id, (o) => ({
                      ...o,
                      widthM: v,
                    }))
                  }
                />
                <NumberField
                  id="vz-ob-d"
                  label="Distância"
                  unit="m"
                  min={0.1}
                  max={500}
                  disabled={readOnly}
                  value={selectedObstacle.distanceM}
                  onChange={(v) =>
                    v !== undefined &&
                    patchObstacle(selectedSurface.id, selectedObstacle.id, (o) => ({
                      ...o,
                      distanceM: v,
                    }))
                  }
                />
                <NumberField
                  id="vz-ob-a"
                  label="Direção (0° = norte)"
                  unit="°"
                  min={0}
                  max={359.9}
                  disabled={readOnly}
                  value={selectedObstacle.azimuthDegrees}
                  onChange={(v) =>
                    v !== undefined &&
                    patchObstacle(selectedSurface.id, selectedObstacle.id, (o) => ({
                      ...o,
                      azimuthDegrees: v,
                    }))
                  }
                />
                {!readOnly ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-end"
                    onClick={() => {
                      patchSurface(selectedSurface.id, (s) => ({
                        ...s,
                        obstacles: s.obstacles.filter((o) => o.id !== selectedObstacle.id),
                      }));
                      setSelected({ surfaceId: selectedSurface.id });
                    }}
                  >
                    <Trash2 /> Remover obstáculo
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <div className="grid gap-1">
                  <Label htmlFor="vz-name">Nome</Label>
                  <Input
                    id="vz-name"
                    disabled={readOnly}
                    value={selectedSurface.name}
                    onChange={(e) =>
                      patchSurface(selectedSurface.id, (s) => ({ ...s, name: e.target.value }))
                    }
                  />
                </div>
                <NumberField
                  id="vz-w"
                  label="Largura"
                  unit="m"
                  min={0.5}
                  max={500}
                  disabled={readOnly}
                  value={selectedSurface.widthM}
                  onChange={(v) =>
                    v !== undefined &&
                    patchSurface(selectedSurface.id, (s) => ({ ...s, widthM: v }))
                  }
                />
                <NumberField
                  id="vz-d"
                  label="Profundidade"
                  unit="m"
                  min={0.5}
                  max={500}
                  disabled={readOnly}
                  value={selectedSurface.depthM}
                  onChange={(v) =>
                    v !== undefined &&
                    patchSurface(selectedSurface.id, (s) => ({ ...s, depthM: v }))
                  }
                />
                <NumberField
                  id="vz-tilt"
                  label="Inclinação"
                  unit="°"
                  min={0}
                  max={90}
                  disabled={readOnly}
                  value={selectedSurface.tiltDegrees}
                  onChange={(v) =>
                    v !== undefined &&
                    patchSurface(selectedSurface.id, (s) => ({ ...s, tiltDegrees: v }))
                  }
                />
                <NumberField
                  id="vz-az"
                  label="Azimute (0° = norte)"
                  unit="°"
                  min={0}
                  max={359.9}
                  disabled={readOnly}
                  value={selectedSurface.azimuthDegrees}
                  onChange={(v) =>
                    v !== undefined &&
                    patchSurface(selectedSurface.id, (s) => ({ ...s, azimuthDegrees: v }))
                  }
                />
                <NumberField
                  id="vz-x"
                  label="Posição leste (x)"
                  unit="m"
                  min={-2000}
                  max={2000}
                  disabled={readOnly}
                  value={centers[selectedIndex]?.x}
                  onChange={(v) =>
                    v !== undefined &&
                    moveSurface(selectedSurface.id, { x: v, y: centers[selectedIndex]?.y ?? 0 })
                  }
                />
                <NumberField
                  id="vz-y"
                  label="Posição norte (y)"
                  unit="m"
                  min={-2000}
                  max={2000}
                  disabled={readOnly}
                  value={centers[selectedIndex]?.y}
                  onChange={(v) =>
                    v !== undefined &&
                    moveSurface(selectedSurface.id, { x: centers[selectedIndex]?.x ?? 0, y: v })
                  }
                />
              </div>
            )}
            <LayoutPreview
              surface={selectedSurface}
              layout={results.layout.find((l) => l.surfaceId === selectedSurface.id)}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Clique numa superfície ou obstáculo para ver e editar os detalhes.
        </p>
      )}
    </div>
  );
}
