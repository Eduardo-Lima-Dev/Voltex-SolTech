import { Html, OrbitControls, QuadraticBezierLine, Sky } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type ElementRef } from 'react';
import { BoxGeometry, MathUtils } from 'three';
import type { OffgridLayoutElement } from '@voltex/shared';
import { ElementModel, SolarArray } from './terrain-models';
import type { SceneArray } from './scene-math';

type OrbitControlsImpl = ElementRef<typeof OrbitControls>;

export type TerrainView = 'iso' | 'top' | 'front';
export type TerrainSelection = { type: 'element' | 'array'; id: string } | null;

export interface TerrainRun {
  id: string;
  kind: 'DC_PV' | 'DC_BANK' | 'AC_LOAD' | 'AC_GENERATOR' | 'AC_GRID';
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface Props {
  lot: { widthM: number; depthM: number };
  elements: readonly OffgridLayoutElement[];
  arrays: readonly (SceneArray & { name: string })[];
  runs: readonly TerrainRun[];
  sun: { azimuthDegrees: number; elevationDegrees: number };
  shadows: boolean;
  selected: TerrainSelection;
  view: TerrainView;
  readOnly: boolean;
  onSelect: (selection: TerrainSelection) => void;
  onMove: (type: 'element' | 'array', id: string, x: number, y: number) => void;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Coordenadas do projeto (x leste, y norte) para o three (x leste, y para cima, z para o sul). */
const at = (x: number, y: number, z = 0): [number, number, number] => [x, z, -y];

/** Posiciona a câmera nas vistas prontas. */
function CameraRig({
  view,
  size,
  controls,
}: {
  view: TerrainView;
  size: number;
  controls: React.RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  useEffect(() => {
    const d = size * 1.15;
    const pos: Record<TerrainView, [number, number, number]> = {
      iso: [d * 0.75, d * 0.65, d * 0.85],
      top: [0, d * 1.35, 0.001],
      front: [0, d * 0.28, d * 1.25],
    };
    camera.position.set(...pos[view]);
    camera.lookAt(0, 0, 0);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [view, size, camera, controls]);
  return null;
}

/** Cena 3D realista do terreno: modelos, sol com sombras, céu, cabos e arraste dos objetos pelo chão. */
export default function TerrainCanvas({
  lot,
  elements,
  arrays,
  runs,
  sun,
  shadows,
  selected,
  view,
  readOnly,
  onSelect,
  onMove,
}: Props) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const [drag, setDrag] = useState<{
    type: 'element' | 'array';
    id: string;
    dx: number;
    dy: number;
  } | null>(null);
  const size = Math.max(lot.widthM, lot.depthM);
  const elevation = Math.max(0, sun.elevationDegrees);
  const a = rad(sun.azimuthDegrees);
  const e = rad(Math.max(3, sun.elevationDegrees));
  const sunDir: [number, number, number] = [
    Math.sin(a) * Math.cos(e),
    Math.sin(e),
    -Math.cos(a) * Math.cos(e),
  ];
  const up = sun.elevationDegrees > 2;
  const centerOf = (type: 'element' | 'array', id: string) =>
    type === 'element'
      ? elements.find((x) => x.id === id)?.positionM
      : arrays.find((x) => x.id === id)?.center;

  const begin = (type: 'element' | 'array', id: string, point: { x: number; z: number }) => {
    onSelect({ type, id });
    if (readOnly) return;
    const c = centerOf(type, id);
    if (!c) return;
    setDrag({
      type,
      id,
      dx: c.x - (point.x + lot.widthM / 2),
      dy: c.y - -(point.z - lot.depthM / 2),
    });
  };

  return (
    <Canvas
      shadows={shadows ? 'soft' : false}
      camera={{ fov: 42, near: 0.5, far: 2000, position: [size, size * 0.8, size] }}
      onPointerMissed={() => onSelect(null)}
      onPointerUp={() => setDrag(null)}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      aria-label="Cena 3D do terreno"
    >
      <Sky
        sunPosition={[sunDir[0] * 100, sunDir[1] * 100, sunDir[2] * 100]}
        turbidity={up ? 4 : 12}
        rayleigh={up ? 1.2 : 0.2}
      />
      <hemisphereLight args={['#bfdcff', '#5f7a45', up ? 0.55 : 0.18]} />
      <ambientLight intensity={up ? 0.25 : 0.1} />
      <directionalLight
        castShadow={shadows}
        position={[sunDir[0] * size * 2, sunDir[1] * size * 2, sunDir[2] * size * 2]}
        intensity={up ? MathUtils.clamp(elevation / 25, 0.25, 1) * 2.6 : 0}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-size}
        shadow-camera-right={size}
        shadow-camera-top={size}
        shadow-camera-bottom={-size}
        shadow-camera-near={1}
        shadow-camera-far={size * 6}
        shadow-bias={-0.0004}
      />

      {/* O terreno fica centrado na origem: tudo vive dentro deste grupo. */}
      <group position={[-lot.widthM / 2, 0, lot.depthM / 2]}>
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[lot.widthM / 2, 0, -lot.depthM / 2]}
          receiveShadow
          onPointerMove={(ev) => {
            if (!drag) return;
            ev.stopPropagation();
            onMove(
              drag.type,
              drag.id,
              ev.point.x + lot.widthM / 2 + drag.dx,
              -(ev.point.z - lot.depthM / 2) + drag.dy,
            );
          }}
        >
          <planeGeometry
            args={[lot.widthM, lot.depthM, Math.round(lot.widthM / 5), Math.round(lot.depthM / 5)]}
          />
          <meshStandardMaterial color="#8bc34a" roughness={1} />
        </mesh>
        <gridHelper
          args={[
            Math.max(lot.widthM, lot.depthM),
            Math.max(lot.widthM, lot.depthM) / 5,
            '#5a8f2a',
            '#6fa63a',
          ]}
          position={[lot.widthM / 2, 0.02, -lot.depthM / 2]}
          scale={[
            lot.widthM / Math.max(lot.widthM, lot.depthM),
            1,
            lot.depthM / Math.max(lot.widthM, lot.depthM),
          ]}
        />
        {/* Terreno ao redor */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[lot.widthM / 2, -0.05, -lot.depthM / 2]}
          receiveShadow
        >
          <planeGeometry args={[size * 8, size * 8]} />
          <meshStandardMaterial color="#9ccc65" roughness={1} />
        </mesh>

        {elements.map((el) => {
          const isSel = selected?.type === 'element' && selected.id === el.id;
          return (
            <group
              key={el.id}
              position={at(el.positionM.x, el.positionM.y)}
              rotation={[0, -rad(el.rotationDeg), 0]}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                begin('element', el.id, ev.point);
              }}
            >
              <ElementModel
                kind={el.kind}
                width={el.widthM}
                depth={el.depthM}
                height={Math.max(el.heightM, 0.2)}
              />
              {isSel ? (
                <lineSegments position={[0, Math.max(el.heightM, 0.2) / 2, 0]}>
                  <edgesGeometry
                    args={[
                      new BoxGeometry(
                        el.widthM + 0.2,
                        Math.max(el.heightM, 0.2) + 0.2,
                        el.depthM + 0.2,
                      ),
                    ]}
                  />
                  <lineBasicMaterial color="#facc15" />
                </lineSegments>
              ) : null}
              <Html
                position={[0, Math.max(el.heightM, 0.2) + 1, 0]}
                center
                style={{ pointerEvents: 'none' }}
              >
                <span className="rounded bg-black/65 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white">
                  {el.name}
                </span>
              </Html>
            </group>
          );
        })}

        {arrays.map((ar) => {
          const isSel = selected?.type === 'array' && selected.id === ar.id;
          return (
            <group
              key={ar.id}
              position={at(ar.center.x, ar.center.y)}
              rotation={[0, -rad(ar.azimuthDegrees), 0]}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                begin('array', ar.id, ev.point);
              }}
            >
              <SolarArray
                columns={ar.columns}
                rows={ar.rows}
                widthM={ar.widthM}
                slopeM={ar.slopeM}
                tiltDegrees={ar.tiltDegrees}
                baseHeightM={ar.baseHeightM}
              />
              {isSel ? (
                <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry
                    args={[
                      Math.hypot(ar.widthM, ar.slopeM) / 2 + 0.2,
                      Math.hypot(ar.widthM, ar.slopeM) / 2 + 0.35,
                      40,
                    ]}
                  />
                  <meshBasicMaterial color="#facc15" />
                </mesh>
              ) : null}
              <Html
                position={[0, ar.slopeM * Math.sin(rad(ar.tiltDegrees)) + 1, 0]}
                center
                style={{ pointerEvents: 'none' }}
              >
                <span className="rounded bg-sky-900/80 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white">
                  {ar.name}
                </span>
              </Html>
            </group>
          );
        })}

        {runs.map((run) => {
          const overhead = run.kind === 'AC_GRID';
          const from = at(run.from.x, run.from.y, overhead ? 6.5 : 0.08);
          const to = at(run.to.x, run.to.y, overhead ? 2.5 : 0.08);
          const mid = at(
            (run.from.x + run.to.x) / 2,
            (run.from.y + run.to.y) / 2,
            overhead ? 3.5 : 0.08,
          );
          return (
            <QuadraticBezierLine
              key={run.id}
              start={from}
              end={to}
              mid={mid}
              color={run.kind === 'DC_PV' || run.kind === 'DC_BANK' ? '#e53935' : '#1e88e5'}
              lineWidth={3}
              dashed={run.kind !== 'DC_PV'}
              dashSize={0.6}
              gapSize={0.35}
            />
          );
        })}
      </group>

      <OrbitControls
        ref={controls}
        makeDefault
        enabled={!drag}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={4}
        maxDistance={size * 5}
        enableDamping
      />
      <CameraRig view={view} size={size} controls={controls} />
    </Canvas>
  );
}
