import { useMemo } from 'react';
import { CanvasTexture, ExtrudeGeometry, RepeatWrapping, Shape, SRGBColorSpace } from 'three';
import type { LayoutElementKind } from '@voltex/shared';

/**
 * Modelos 3D das construções do terreno, montados com formas básicas do three.js (sem arquivos externos): casa com
 * telhado de duas águas, casa de máquinas com porta metálica, gerador, poste de rede com transformador, caixa d'água
 * elevada, árvore e caixote. Cada modelo ocupa exatamente `width × height × depth` (largura em x, profundidade em z).
 */
interface ModelProps {
  width: number;
  depth: number;
  height: number;
}

const mat = (color: string, extra: object = {}) => ({
  color,
  roughness: 0.85,
  metalness: 0.02,
  ...extra,
});

function House({ width: w, depth: d, height: h }: ModelProps) {
  const wallH = Math.max(0.5, h * 0.68);
  const roofH = Math.max(0.2, h - wallH);
  const overhang = 0.35;
  const roof = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-d / 2 - overhang, 0);
    shape.lineTo(d / 2 + overhang, 0);
    shape.lineTo(0, roofH);
    shape.closePath();
    const geo = new ExtrudeGeometry(shape, { depth: w + overhang * 2, bevelEnabled: false });
    geo.translate(0, 0, -(w + overhang * 2) / 2);
    return geo;
  }, [w, d, roofH]);
  const doorH = Math.min(2.1, wallH * 0.85);
  return (
    <group>
      <mesh position={[0, wallH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, wallH, d]} />
        <meshStandardMaterial {...mat('#f2e6c9')} />
      </mesh>
      {/* Rodapé */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[w + 0.06, 0.3, d + 0.06]} />
        <meshStandardMaterial {...mat('#bcae8f')} />
      </mesh>
      <mesh
        position={[0, wallH, 0]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow
        receiveShadow
        geometry={roof}
      >
        <meshStandardMaterial {...mat('#b5533c', { roughness: 0.7 })} />
      </mesh>
      {/* Porta e janelas na frente (z positivo) e atrás */}
      <mesh position={[-w * 0.18, doorH / 2, d / 2 + 0.03]} castShadow>
        <boxGeometry args={[0.95, doorH, 0.08]} />
        <meshStandardMaterial {...mat('#6d4c41')} />
      </mesh>
      {[0.28, -0.05].map((k) => (
        <mesh key={k} position={[w * k + (k > 0 ? 0.2 : 0), wallH * 0.55, d / 2 + 0.03]}>
          <boxGeometry args={[Math.min(1.2, w * 0.2), wallH * 0.36, 0.08]} />
          <meshStandardMaterial {...mat('#8ecae6', { roughness: 0.15, metalness: 0.4 })} />
        </mesh>
      ))}
      {[-0.25, 0.25].map((k) => (
        <mesh key={k} position={[w * k, wallH * 0.55, -d / 2 - 0.03]}>
          <boxGeometry args={[Math.min(1.2, w * 0.2), wallH * 0.36, 0.08]} />
          <meshStandardMaterial {...mat('#8ecae6', { roughness: 0.15, metalness: 0.4 })} />
        </mesh>
      ))}
      <mesh position={[w * 0.3, wallH + roofH * 0.7, -d * 0.1]} castShadow>
        <boxGeometry args={[0.45, roofH * 0.9, 0.45]} />
        <meshStandardMaterial {...mat('#a1887f')} />
      </mesh>
    </group>
  );
}

function PowerRoom({ width: w, depth: d, height: h }: ModelProps) {
  const doorH = Math.min(2.1, h * 0.85);
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...mat('#cfd8dc', { roughness: 0.6 })} />
      </mesh>
      <mesh position={[0, h + 0.06, 0]} castShadow>
        <boxGeometry args={[w + 0.3, 0.12, d + 0.3]} />
        <meshStandardMaterial {...mat('#546e7a', { roughness: 0.5, metalness: 0.3 })} />
      </mesh>
      {/* Porta dupla metálica com nervuras */}
      <mesh position={[0, doorH / 2, d / 2 + 0.03]}>
        <boxGeometry args={[Math.min(1.6, w * 0.6), doorH, 0.07]} />
        <meshStandardMaterial {...mat('#455a64', { metalness: 0.5, roughness: 0.4 })} />
      </mesh>
      {[-0.3, 0, 0.3].map((k) => (
        <mesh key={k} position={[k * Math.min(1.6, w * 0.6) * 0.8, doorH / 2, d / 2 + 0.08]}>
          <boxGeometry args={[0.04, doorH * 0.9, 0.03]} />
          <meshStandardMaterial {...mat('#263238')} />
        </mesh>
      ))}
      {/* Placa de risco elétrico */}
      <mesh position={[w * 0.32, h * 0.7, d / 2 + 0.04]}>
        <boxGeometry args={[0.35, 0.35, 0.03]} />
        <meshStandardMaterial
          {...mat('#ffd600', { emissive: '#ffb300', emissiveIntensity: 0.25 })}
        />
      </mesh>
      {/* Venezianas */}
      {[0.15, 0.25, 0.35].map((k) => (
        <mesh key={k} position={[-w * 0.33, h * (0.4 + k), d / 2 + 0.03]}>
          <boxGeometry args={[0.5, 0.04, 0.04]} />
          <meshStandardMaterial {...mat('#37474f')} />
        </mesh>
      ))}
    </group>
  );
}

function Generator({ width: w, depth: d, height: h }: ModelProps) {
  return (
    <group>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[w * 1.05, 0.12, d * 1.05]} />
        <meshStandardMaterial {...mat('#37474f')} />
      </mesh>
      <mesh position={[0, 0.12 + (h - 0.12) / 2, 0]} castShadow>
        <boxGeometry args={[w, h - 0.12, d]} />
        <meshStandardMaterial {...mat('#f9a825', { roughness: 0.55, metalness: 0.15 })} />
      </mesh>
      <mesh position={[-w * 0.25, h + 0.18, -d * 0.2]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.4, 12]} />
        <meshStandardMaterial {...mat('#212121', { metalness: 0.6 })} />
      </mesh>
      <mesh position={[w * 0.25, h * 0.55, d / 2 + 0.02]}>
        <boxGeometry args={[w * 0.35, h * 0.35, 0.04]} />
        <meshStandardMaterial {...mat('#263238')} />
      </mesh>
    </group>
  );
}

function Pole({ height: h }: ModelProps) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.14, h, 12]} />
        <meshStandardMaterial {...mat('#8d6e63', { roughness: 0.95 })} />
      </mesh>
      <mesh position={[0, h - 0.3, 0]} castShadow>
        <boxGeometry args={[1.5, 0.1, 0.1]} />
        <meshStandardMaterial {...mat('#5d4037')} />
      </mesh>
      {[-0.65, 0, 0.65].map((x) => (
        <mesh key={x} position={[x, h - 0.15, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.05, 0.2, 8]} />
          <meshStandardMaterial {...mat('#eceff1', { roughness: 0.3 })} />
        </mesh>
      ))}
      <mesh position={[0.28, h * 0.78, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.18, 0.5, 16]} />
        <meshStandardMaterial {...mat('#78909c', { metalness: 0.4, roughness: 0.5 })} />
      </mesh>
    </group>
  );
}

function Tank({ width: w, depth: d, height: h }: ModelProps) {
  const r = Math.min(w, d) / 2;
  const legH = h * 0.4;
  const bodyH = h * 0.6;
  return (
    <group>
      {[
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sz]) => (
        <mesh
          key={`${sx}${sz}`}
          position={[(sx as number) * r * 0.7, legH / 2, (sz as number) * r * 0.7]}
          castShadow
        >
          <boxGeometry args={[0.1, legH, 0.1]} />
          <meshStandardMaterial {...mat('#607d8b', { metalness: 0.5 })} />
        </mesh>
      ))}
      <mesh position={[0, legH + bodyH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, bodyH, 28]} />
        <meshStandardMaterial {...mat('#4fc3f7', { roughness: 0.4 })} />
      </mesh>
      <mesh position={[0, legH + bodyH + 0.07, 0]} castShadow>
        <cylinderGeometry args={[r * 0.92, r, 0.14, 28]} />
        <meshStandardMaterial {...mat('#0277bd')} />
      </mesh>
      <mesh position={[0, legH + bodyH + 0.2, 0]}>
        <cylinderGeometry args={[r * 0.25, r * 0.25, 0.1, 16]} />
        <meshStandardMaterial {...mat('#01579b')} />
      </mesh>
    </group>
  );
}

function Tree({ width: w, height: h }: ModelProps) {
  const r = w / 2;
  const trunk = h * 0.38;
  return (
    <group>
      <mesh position={[0, trunk / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.12, r * 0.18, trunk, 10]} />
        <meshStandardMaterial {...mat('#6d4c41', { roughness: 1 })} />
      </mesh>
      {(
        [
          [0, trunk + r * 0.7, 0, 1, '#388e3c'],
          [r * 0.35, trunk + r * 0.35, r * 0.2, 0.75, '#2e7d32'],
          [-r * 0.3, trunk + r * 0.5, -r * 0.25, 0.7, '#43a047'],
        ] as const
      ).map(([x, y, z, s, color], i) => (
        <mesh key={i} position={[x, y, z]} scale={s} castShadow receiveShadow>
          <icosahedronGeometry args={[r, 1]} />
          <meshStandardMaterial {...mat(color, { flatShading: true })} />
        </mesh>
      ))}
    </group>
  );
}

function Crate({ width: w, depth: d, height: h }: ModelProps) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...mat('#a1887f', { roughness: 0.95 })} />
      </mesh>
      {[0.2, 0.5, 0.8].map((k) => (
        <mesh key={k} position={[0, h * k, d / 2 + 0.01]}>
          <boxGeometry args={[w * 1.01, h * 0.08, 0.03]} />
          <meshStandardMaterial {...mat('#795548')} />
        </mesh>
      ))}
    </group>
  );
}

const MODELS: Record<LayoutElementKind, (p: ModelProps) => React.ReactElement> = {
  HOUSE: House,
  POWER_ROOM: PowerRoom,
  GENERATOR: Generator,
  GRID_POLE: Pole,
  TANK: Tank,
  TREE: Tree,
  OTHER: Crate,
};

export function ElementModel({ kind, ...props }: ModelProps & { kind: LayoutElementKind }) {
  const Model = MODELS[kind];
  return <Model {...props} />;
}

/** Textura das células do painel: grade de células azuis com barramentos prateados. */
function usePanelTexture(columns: number, rows: number) {
  return useMemo(() => {
    const cell = 48;
    const c = document.createElement('canvas');
    c.width = columns * cell;
    c.height = rows * cell;
    const g = c.getContext('2d');
    if (g) {
      for (let i = 0; i < columns; i++)
        for (let j = 0; j < rows; j++) {
          const x = i * cell;
          const y = j * cell;
          const grad = g.createLinearGradient(x, y, x + cell, y + cell);
          grad.addColorStop(0, '#1b3a6b');
          grad.addColorStop(1, '#0d2147');
          g.fillStyle = grad;
          g.fillRect(x + 2, y + 2, cell - 4, cell - 4);
          g.strokeStyle = 'rgba(200,215,235,0.55)';
          g.lineWidth = 1;
          for (let k = 1; k < 4; k++) {
            g.beginPath();
            g.moveTo(x + 2, y + (cell / 4) * k);
            g.lineTo(x + cell - 2, y + (cell / 4) * k);
            g.stroke();
          }
          g.beginPath();
          g.moveTo(x + cell / 2, y + 2);
          g.lineTo(x + cell / 2, y + cell - 2);
          g.stroke();
        }
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }, [columns, rows]);
}

export function SolarArray({
  columns,
  rows,
  widthM,
  slopeM,
  tiltDegrees,
  baseHeightM,
}: {
  columns: number;
  rows: number;
  widthM: number;
  slopeM: number;
  tiltDegrees: number;
  baseHeightM: number;
}) {
  const texture = usePanelTexture(columns, rows);
  const tilt = (tiltDegrees * Math.PI) / 180;
  const lift = baseHeightM + (slopeM / 2) * Math.sin(tilt) + 0.15;
  const high = (slopeM / 2) * Math.sin(tilt) * 2 + baseHeightM + 0.15;
  const run = slopeM * Math.cos(tilt);
  return (
    <group>
      <group position={[0, lift, 0]} rotation={[-tilt, 0, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[widthM + 0.06, 0.05, slopeM + 0.06]} />
          <meshStandardMaterial {...mat('#cfd8dc', { metalness: 0.7, roughness: 0.35 })} />
        </mesh>
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[widthM, slopeM]} />
          <meshStandardMaterial map={texture} roughness={0.2} metalness={0.5} />
        </mesh>
      </group>
      {/* Estrutura: pés na borda baixa e na alta */}
      {[-1, 1].flatMap((sx) =>
        [
          { z: -run / 2 + 0.1, h: baseHeightM + 0.15 },
          { z: run / 2 - 0.1, h: high },
        ].map((leg, i) => (
          <mesh key={`${sx}-${i}`} position={[sx * widthM * 0.35, leg.h / 2, leg.z]} castShadow>
            <boxGeometry args={[0.07, leg.h, 0.07]} />
            <meshStandardMaterial {...mat('#90a4ae', { metalness: 0.6 })} />
          </mesh>
        )),
      )}
    </group>
  );
}
