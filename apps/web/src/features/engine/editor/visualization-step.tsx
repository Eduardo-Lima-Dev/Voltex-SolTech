import { useMemo, useState } from 'react';
import { solarPosition } from '@voltex/solar-engine';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  NativeSelect,
} from '@voltex/ui';
import { formatNumber } from '@/lib/format';
import { LayoutPreview } from './charts';
import { useEditor } from './editor-context';
import { buildScene, projectScene, type PolygonKind } from './scene-3d-math';

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

/** Visualização do projeto: planta 2D de cada superfície e cena 3D girável com módulos, obstáculos e sombra. */
export function VisualizationStep() {
  const { design, results, goToStep } = useEditor();
  const [mode, setMode] = useState<'2d' | '3d'>('3d');
  const [yaw, setYaw] = useState(25);
  const [pitch, setPitch] = useState(35);
  const [date, setDate] = useState('12-21');
  const [hour, setHour] = useState(11);

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

  const scene = useMemo(
    () => projectScene(buildScene(design.surfaces, results.layout, sun), yaw, pitch),
    [design.surfaces, results.layout, sun, yaw, pitch],
  );

  if (design.surfaces.length === 0)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Visualização 2D e 3D</CardTitle>
          <CardDescription>
            Ainda não há superfícies. Modele o telhado ou a laje para ver a planta e a cena em 3D.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => goToStep('superficies')}>
            Ir para Superfícies
          </Button>
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Visualização 2D e 3D</CardTitle>
          <CardDescription>
            Planta de cada superfície com o layout dos módulos e uma cena 3D que você pode girar,
            com os obstáculos e a sombra deles para a data e hora escolhidas. Os números vêm do
            mesmo cálculo do projeto.
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
          </div>

          {mode === '2d' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {design.surfaces.map((surface) => {
                const layout = results.layout.find((l) => l.surfaceId === surface.id);
                return (
                  <figure key={surface.id} className="space-y-1">
                    <figcaption className="text-sm font-medium">
                      {surface.name}: {layout?.moduleCount ?? 0} módulos
                      {layout?.powerKwp != null ? ` · ${formatNumber(layout.powerKwp, 2)} kWp` : ''}
                    </figcaption>
                    <LayoutPreview surface={surface} layout={layout} />
                  </figure>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              <svg
                role="img"
                aria-label={`Cena 3D com ${design.surfaces.length} superfície(s)`}
                viewBox={scene.viewBox}
                className="h-auto max-h-[32rem] w-full rounded border bg-card"
              >
                {scene.polygons.map((poly, i) => (
                  <polygon
                    key={i}
                    className={FILL[poly.kind]}
                    strokeWidth={0.04}
                    points={poly.points.map((p) => `${p.x},${p.y}`).join(' ')}
                  >
                    {poly.label ? <title>{poly.label}</title> : null}
                  </polygon>
                ))}
              </svg>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                Azul: módulos · amarelo: obstáculos · cinza escuro: sombra dos obstáculos no chão.
                Norte aponta para o fundo da cena na visão “Frente (sul)”.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
