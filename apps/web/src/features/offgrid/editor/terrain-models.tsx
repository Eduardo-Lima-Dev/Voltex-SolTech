import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  CanvasTexture,
  type Group,
  ExtrudeGeometry,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
} from 'three';
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
  /** Cor escolhida pela pessoa para o corpo do objeto (#rrggbb). */
  color?: string | undefined;
}

const mat = (color: string, extra: object = {}) => ({
  color,
  roughness: 0.85,
  metalness: 0.02,
  ...extra,
});

function House({ width: w, depth: d, height: h, color }: ModelProps) {
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
        <meshStandardMaterial {...mat(color ?? '#f2e6c9')} />
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

function PowerRoom({ width: w, depth: d, height: h, color }: ModelProps) {
  const doorH = Math.min(2.1, h * 0.85);
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...mat(color ?? '#cfd8dc', { roughness: 0.6 })} />
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

function Generator({ width: w, depth: d, height: h, color }: ModelProps) {
  return (
    <group>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[w * 1.05, 0.12, d * 1.05]} />
        <meshStandardMaterial {...mat('#37474f')} />
      </mesh>
      <mesh position={[0, 0.12 + (h - 0.12) / 2, 0]} castShadow>
        <boxGeometry args={[w, h - 0.12, d]} />
        <meshStandardMaterial {...mat(color ?? '#f9a825', { roughness: 0.55, metalness: 0.15 })} />
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

function Tank({ width: w, depth: d, height: h, color }: ModelProps) {
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
        <meshStandardMaterial {...mat(color ?? '#4fc3f7', { roughness: 0.4 })} />
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

function Tree({ width: w, height: h, color }: ModelProps) {
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
          [0, trunk + r * 0.7, 0, 1, color ?? '#388e3c'],
          [r * 0.35, trunk + r * 0.35, r * 0.2, 0.75, color ?? '#2e7d32'],
          [-r * 0.3, trunk + r * 0.5, -r * 0.25, 0.7, color ?? '#43a047'],
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

function Crate({ width: w, depth: d, height: h, color }: ModelProps) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...mat(color ?? '#a1887f', { roughness: 0.95 })} />
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

function Container({ width: w, depth: d, height: h, color }: ModelProps) {
  const ribs = Math.max(6, Math.floor(w / 0.35));
  const body = color ?? '#1f6fb2';
  return (
    <group>
      <mesh position={[0, h / 2 + 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h - 0.2, d]} />
        <meshStandardMaterial {...mat(body, { roughness: 0.55, metalness: 0.25 })} />
      </mesh>
      {[...Array(ribs).keys()].flatMap((i) =>
        [-1, 1].map((side) => (
          <mesh
            key={`${i}${side}`}
            position={[-w / 2 + ((i + 0.5) * w) / ribs, h / 2 + 0.1, side * (d / 2 + 0.015)]}
          >
            <boxGeometry args={[0.07, h - 0.4, 0.03]} />
            <meshStandardMaterial {...mat(body, { roughness: 0.5, metalness: 0.3 })} />
          </mesh>
        )),
      )}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[sx * (w / 2 - 0.08), h / 2 + 0.1, sz * (d / 2 - 0.08)]}
            castShadow
          >
            <boxGeometry args={[0.16, h - 0.2, 0.16]} />
            <meshStandardMaterial {...mat('#37474f', { metalness: 0.5 })} />
          </mesh>
        )),
      )}
      {[-0.25, 0.25].map((k) => (
        <mesh key={k} position={[w / 2 + 0.02, h / 2 + 0.1, k * d]}>
          <boxGeometry args={[0.04, h - 0.5, 0.06]} />
          <meshStandardMaterial {...mat('#cfd8dc', { metalness: 0.8 })} />
        </mesh>
      ))}
    </group>
  );
}

function Shed({ width: w, depth: d, height: h, color }: ModelProps) {
  const wallH = h * 0.72;
  const roofH = h - wallH;
  const roof = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-d / 2 - 0.3, 0);
    shape.lineTo(d / 2 + 0.3, 0);
    shape.lineTo(0, roofH);
    shape.closePath();
    const geo = new ExtrudeGeometry(shape, { depth: w + 0.6, bevelEnabled: false });
    geo.translate(0, 0, -(w + 0.6) / 2);
    return geo;
  }, [w, d, roofH]);
  return (
    <group>
      <mesh position={[0, wallH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, wallH, d]} />
        <meshStandardMaterial {...mat(color ?? '#b0bec5', { metalness: 0.3, roughness: 0.6 })} />
      </mesh>
      <mesh
        position={[0, wallH, 0]}
        rotation={[0, Math.PI / 2, 0]}
        geometry={roof}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial {...mat('#607d8b', { metalness: 0.5, roughness: 0.45 })} />
      </mesh>
      <mesh position={[0, wallH * 0.42, d / 2 + 0.03]}>
        <boxGeometry args={[Math.min(5, w * 0.4), wallH * 0.82, 0.07]} />
        <meshStandardMaterial {...mat('#455a64', { metalness: 0.5 })} />
      </mesh>
    </group>
  );
}

function Greenhouse({ width: w, depth: d, height: h, color }: ModelProps) {
  const arches = Math.max(3, Math.floor(w / 1.5));
  return (
    <group>
      <group scale={[1, h / (d / 2), 1]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[d / 2, d / 2, w, 24, 1, true, 0, Math.PI]} />
          <meshStandardMaterial
            color={color ?? '#e8f5e9'}
            transparent
            opacity={0.38}
            roughness={0.15}
            side={2}
          />
        </mesh>
      </group>
      {[...Array(arches + 1).keys()].map((i) => (
        <mesh key={i} position={[-w / 2 + (i * w) / arches, 0, 0]} scale={[1, h / (d / 2), 1]}>
          <torusGeometry args={[d / 2, 0.04, 6, 24, Math.PI]} />
          <meshStandardMaterial {...mat('#eceff1', { metalness: 0.5 })} />
        </mesh>
      ))}
      {[-0.28, 0, 0.28].map((k) => (
        <mesh key={k} position={[0, 0.15, k * d]}>
          <boxGeometry args={[w * 0.9, 0.3, 0.35]} />
          <meshStandardMaterial {...mat('#4caf50')} />
        </mesh>
      ))}
    </group>
  );
}

function Silo({ width: w, depth: d, height: h, color }: ModelProps) {
  const r = Math.min(w, d) / 2;
  const bodyH = h * 0.82;
  return (
    <group>
      <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, bodyH, 32]} />
        <meshStandardMaterial {...mat(color ?? '#cfd8dc', { metalness: 0.5, roughness: 0.4 })} />
      </mesh>
      {[0.25, 0.5, 0.75].map((k) => (
        <mesh key={k} position={[0, bodyH * k, 0]}>
          <cylinderGeometry args={[r * 1.01, r * 1.01, 0.08, 32]} />
          <meshStandardMaterial {...mat('#90a4ae', { metalness: 0.6 })} />
        </mesh>
      ))}
      <mesh position={[0, bodyH + (h - bodyH) / 2, 0]} castShadow>
        <coneGeometry args={[r * 1.04, h - bodyH, 32]} />
        <meshStandardMaterial {...mat('#78909c', { metalness: 0.5 })} />
      </mesh>
      <mesh position={[r + 0.05, bodyH / 2, 0]}>
        <boxGeometry args={[0.08, bodyH, 0.5]} />
        <meshStandardMaterial {...mat('#455a64', { metalness: 0.6 })} />
      </mesh>
    </group>
  );
}

function WindTurbine({ height: h, width: w, color }: ModelProps) {
  const rotor = useRef<Group>(null);
  useFrame((_, dt) => {
    if (rotor.current) rotor.current.rotation.z -= dt * 0.9;
  });
  const bladeLen = Math.max(1.5, h * 0.3);
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[Math.max(0.08, w * 0.07), Math.max(0.16, w * 0.14), h, 16]} />
        <meshStandardMaterial {...mat(color ?? '#eceff1', { roughness: 0.4 })} />
      </mesh>
      <mesh position={[0, h, 0.25]} castShadow>
        <boxGeometry args={[0.35, 0.35, 0.9]} />
        <meshStandardMaterial {...mat('#cfd8dc')} />
      </mesh>
      <group ref={rotor} position={[0, h, 0.75]}>
        <mesh>
          <sphereGeometry args={[0.2, 16, 12]} />
          <meshStandardMaterial {...mat('#b0bec5')} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation={[0, 0, (i * 2 * Math.PI) / 3]}>
            <mesh position={[0, bladeLen / 2 + 0.2, 0]} castShadow>
              <boxGeometry args={[0.18, bladeLen, 0.04]} />
              <meshStandardMaterial {...mat('#fafafa', { roughness: 0.3 })} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

function Tower({ height: h, width: w, color }: ModelProps) {
  const base = Math.max(0.6, w);
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
          position={[(sx as number) * base * 0.25, h / 2, (sz as number) * base * 0.25]}
          castShadow
        >
          <cylinderGeometry args={[0.025, 0.04, h, 6]} />
          <meshStandardMaterial {...mat(color ?? '#d32f2f', { metalness: 0.4 })} />
        </mesh>
      ))}
      {[0.2, 0.4, 0.6, 0.8].map((k) => (
        <mesh key={k} position={[0, h * k, 0]} castShadow>
          <boxGeometry args={[base * 0.55 * (1 - k * 0.5), 0.04, base * 0.55 * (1 - k * 0.5)]} />
          <meshStandardMaterial {...mat('#eceff1')} />
        </mesh>
      ))}
      <mesh position={[0.25, h * 0.92, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.05, 20]} />
        <meshStandardMaterial {...mat('#fafafa', { metalness: 0.3 })} />
      </mesh>
      <mesh position={[0, h + 0.1, 0]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshStandardMaterial color="#ff1744" emissive="#ff1744" emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

function Well({ width: w, height: h, color }: ModelProps) {
  const r = w / 2;
  return (
    <group>
      <mesh position={[0, h * 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r * 1.05, h * 0.6, 20]} />
        <meshStandardMaterial {...mat(color ?? '#9e9e9e', { roughness: 1 })} />
      </mesh>
      <mesh position={[0, h * 0.58, 0]}>
        <cylinderGeometry args={[r * 0.78, r * 0.78, 0.04, 20]} />
        <meshStandardMaterial {...mat('#0d47a1', { roughness: 0.2, metalness: 0.4 })} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * r * 0.95, h * 0.85, 0]} castShadow>
          <boxGeometry args={[0.07, h * 0.6, 0.07]} />
          <meshStandardMaterial {...mat('#6d4c41')} />
        </mesh>
      ))}
      <mesh position={[0, h * 1.12, 0]} castShadow>
        <boxGeometry args={[r * 2.3, 0.07, 0.1]} />
        <meshStandardMaterial {...mat('#5d4037')} />
      </mesh>
    </group>
  );
}

function Pool({ width: w, depth: d, color }: ModelProps) {
  return (
    <group>
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[w + 0.5, 0.06, d + 0.5]} />
        <meshStandardMaterial {...mat('#e0e0e0')} />
      </mesh>
      <mesh position={[0, 0.075, 0]} receiveShadow>
        <boxGeometry args={[w, 0.03, d]} />
        <meshStandardMaterial
          color={color ?? '#29b6f6'}
          roughness={0.08}
          metalness={0.3}
          transparent
          opacity={0.9}
        />
      </mesh>
    </group>
  );
}

function Vehicle({ width: w, depth: d, height: h, color }: ModelProps) {
  const wheel = Math.min(0.36, h * 0.28);
  return (
    <group>
      <mesh position={[0, wheel + h * 0.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h * 0.44, d]} />
        <meshStandardMaterial {...mat(color ?? '#c62828', { roughness: 0.3, metalness: 0.55 })} />
      </mesh>
      <mesh position={[-w * 0.05, wheel + h * 0.66, 0]} castShadow>
        <boxGeometry args={[w * 0.5, h * 0.36, d * 0.88]} />
        <meshStandardMaterial {...mat('#90caf9', { roughness: 0.1, metalness: 0.5 })} />
      </mesh>
      {[-0.32, 0.32].flatMap((x) =>
        [-1, 1].map((z) => (
          <mesh
            key={`${x}${z}`}
            position={[x * w, wheel, z * (d / 2)]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[wheel, wheel, 0.22, 16]} />
            <meshStandardMaterial {...mat('#212121')} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Wall({ width: w, depth: d, height: h, color }: ModelProps) {
  const posts = Math.max(2, Math.floor(w / 2.5) + 1);
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, Math.max(d, 0.15)]} />
        <meshStandardMaterial {...mat(color ?? '#bcaaa4', { roughness: 0.95 })} />
      </mesh>
      {[...Array(posts).keys()].map((i) => (
        <mesh key={i} position={[-w / 2 + (i * w) / (posts - 1), h / 2 + 0.05, 0]} castShadow>
          <boxGeometry args={[0.28, h + 0.1, Math.max(d, 0.15) + 0.1]} />
          <meshStandardMaterial {...mat('#8d6e63')} />
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
  CONTAINER: Container,
  SHED: Shed,
  GREENHOUSE: Greenhouse,
  SILO: Silo,
  WIND_TURBINE: WindTurbine,
  TOWER: Tower,
  WELL: Well,
  POOL: Pool,
  VEHICLE: Vehicle,
  WALL: Wall,
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
