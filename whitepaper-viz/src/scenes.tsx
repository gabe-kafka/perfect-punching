import { useMemo, useRef, useState } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { Line, OrbitControls, OrthographicCamera, Html } from "@react-three/drei";
import * as THREE from "three";
import katex from "katex";
import {
  b0, b1 as B1, b2 as B2,
  perimeterSamples, stressAt,
  type Geometry,
} from "./math";

/* ----------- palette ------------------------------------------------
 * CAD drawings per MIL-STD / ASME Y14.2: monochrome. Hierarchy via
 * line WEIGHT, never color. The surrounding UI keeps the Bloomberg
 * palette (see tailwind.config.ts); only the 3D scene is monochrome.
 * ------------------------------------------------------------------- */
const INK    = "#1A1A1A";
const MUTED  = INK;   // TagLabel text — still black, still readable
const DIMCOL = INK;   // dim / extension / leader lines
const BORDER = "#D4D4D4";
const RED    = "#DC2626";  // applied loads only (forces and moments)
const BG     = "#FFFFFF";

/* Line weights (ASME Y14.2 thick:medium:thin = 4:2:1) */
const LW_THICK  = 2.4;   // visible object edges (slab, column)
const LW_MEDIUM = 1.2;   // hidden-style (critical section), annotation curves
const LW_THIN   = 0.6;   // dimension / extension / leader / tick

/* ----------- scale ----------- */
const SCALE        = 0.08;   // render units per inch
const STRESS_SCALE = 0.06;   // render units per psi of stress arrow
const s = (v: number) => v * SCALE;

/* ================================================================== */
/* Label helpers (drei <Html> overlays, KaTeX for math)                */
/* ================================================================== */

/**
 * Math label rendered as a DOM overlay via drei <Html>.
 * If `alignTo` is supplied, the label is rotated (in screen space) to match
 * the on-screen angle of the 3D line from alignTo[0] to alignTo[1] — so
 * dimension labels track the angle of their dim line.
 */
function MathLabel({
  position, tex, fontSize = 22, color = INK, alignTo,
}: {
  position: [number, number, number];
  tex: string;
  fontSize?: number;
  color?: string;
  alignTo?: [THREE.Vector3, THREE.Vector3];
}) {
  const { camera, size } = useThree();
  const innerRef = useRef<HTMLDivElement>(null);

  const html = useMemo(
    () => katex.renderToString(tex, { throwOnError: false, displayMode: false }),
    [tex],
  );

  // Re-compute the screen angle every frame so labels track a live camera
  // (orbit, zoom). Mutates the DOM transform directly — no React re-render.
  useFrame(() => {
    if (!alignTo || !innerRef.current) return;
    const [A, B] = alignTo;
    const aP = A.clone().project(camera);
    const bP = B.clone().project(camera);
    const dx = (bP.x - aP.x) * size.width / 2;
    const dy = -(bP.y - aP.y) * size.height / 2;
    const t = Math.atan2(dy, dx);
    innerRef.current.style.transform = `rotate(${t}rad)`;
  });

  return (
    <Html position={position} center zIndexRange={[100, 0]}>
      <div
        ref={innerRef}
        style={{
          color,
          fontSize: `${fontSize}px`,
          fontFamily: '"JetBrains Mono", monospace',
          pointerEvents: "none",
          whiteSpace: "nowrap",
          userSelect: "none",
          lineHeight: 1,
          transform: "rotate(0rad)",
          transformOrigin: "center",
          display: "inline-block",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Html>
  );
}

function TagLabel({
  position, text, fontSize = 18, color = MUTED,
}: {
  position: [number, number, number];
  text: string;
  fontSize?: number;
  color?: string;
}) {
  return (
    <Html position={position} center zIndexRange={[100, 0]}>
      <div
        style={{
          color,
          fontSize: `${fontSize}px`,
          fontFamily: '"JetBrains Mono", monospace',
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          userSelect: "none",
        }}
      >
        {text}
      </div>
    </Html>
  );
}

/* ================================================================== */
/* Engineering dimension component                                     */
/* ================================================================== */

/**
 * Engineering-style dimension between two 3D points.
 *
 *   extension line ┐
 *                  │ gap
 *                  │
 *              ────┼──── dim line ────┼──── overrun
 *                  ╳ tick            ╳ tick
 *                       [ label ]
 */
function Dim({
  a, b, offset, label,
  fontSize = 22,
  tickSize = 0.055,
  gap = 0.04,        // 1.5 mm spirit — extension line never touches object
  overrun = 0.06,    // extension line overshoots dim line slightly
}: {
  a: [number, number, number];
  b: [number, number, number];
  offset: [number, number, number];
  label: string;               // KaTeX
  fontSize?: number;
  tickSize?: number;
  gap?: number;
  overrun?: number;
}) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const vo = new THREE.Vector3(...offset);

  const along = vb.clone().sub(va).normalize();
  const perp  = vo.clone().normalize();

  const ext1a = va.clone().addScaledVector(perp, gap);
  const ext1b = va.clone().add(vo).addScaledVector(perp, overrun);
  const ext2a = vb.clone().addScaledVector(perp, gap);
  const ext2b = vb.clone().add(vo).addScaledVector(perp, overrun);

  const dim1 = va.clone().add(vo);
  const dim2 = vb.clone().add(vo);

  // 45° tick: halfway between `along` and `perp`, drawn through each endpoint
  const tickVec = along.clone().add(perp).normalize().multiplyScalar(tickSize);
  const t1a = dim1.clone().add(tickVec);
  const t1b = dim1.clone().sub(tickVec);
  const t2a = dim2.clone().add(tickVec);
  const t2b = dim2.clone().sub(tickVec);

  const mid = dim1.clone().lerp(dim2, 0.5);
  // Offset label clear of the dim line (no background pad — rely on clearance).
  const labelPos = mid.clone().addScaledVector(perp, tickSize * 2.2);

  return (
    <group>
      <Line points={[ext1a, ext1b]} color={INK} lineWidth={LW_THIN} />
      <Line points={[ext2a, ext2b]} color={INK} lineWidth={LW_THIN} />
      <Line points={[dim1, dim2]}   color={INK} lineWidth={LW_THIN} />
      <Line points={[t1a, t1b]}     color={INK} lineWidth={LW_THIN} />
      <Line points={[t2a, t2b]}     color={INK} lineWidth={LW_THIN} />
      <MathLabel
        position={[labelPos.x, labelPos.y, labelPos.z]}
        tex={label}
        fontSize={fontSize}
        alignTo={[dim1.clone(), dim2.clone()]}
      />
    </group>
  );
}

/* ================================================================== */
/* Leader callout (for annotation text with elbow line + anchor dot)    */
/* ================================================================== */

function Leader({
  anchor, labelPos, label, isTex = false,
}: {
  anchor:   [number, number, number];
  labelPos: [number, number, number];
  label:    string;
  isTex?:   boolean;
}) {
  return (
    <group>
      <Line
        points={[new THREE.Vector3(...anchor), new THREE.Vector3(...labelPos)]}
        color={INK}
        lineWidth={LW_THIN}
      />
      <mesh position={anchor}>
        <sphereGeometry args={[0.022, 10, 10]} />
        <meshBasicMaterial color={INK} />
      </mesh>
      {isTex ? (
        <MathLabel position={labelPos} tex={label} fontSize={22} />
      ) : (
        <TagLabel position={labelPos} text={label} fontSize={18} color={INK} />
      )}
    </group>
  );
}

/* ================================================================== */
/* Primitives                                                          */
/* ================================================================== */

function WireBox({
  x1, x2, y1, y2, z1, z2,
  color = INK, lw = 1, dashed = false, depthTest = true,
}: {
  x1: number; x2: number;
  y1: number; y2: number;
  z1: number; z2: number;
  color?: string; lw?: number; dashed?: boolean; depthTest?: boolean;
}) {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const top = [v(x1,y1,z2), v(x2,y1,z2), v(x2,y2,z2), v(x1,y2,z2), v(x1,y1,z2)];
  const bot = [v(x1,y1,z1), v(x2,y1,z1), v(x2,y2,z1), v(x1,y2,z1), v(x1,y1,z1)];
  const vs: [number, number, number, number, number, number][] = [
    [x1,y1,z1, x1,y1,z2],
    [x2,y1,z1, x2,y1,z2],
    [x2,y2,z1, x2,y2,z2],
    [x1,y2,z1, x1,y2,z2],
  ];
  const dashProps = dashed
    ? { dashed: true as const, dashSize: 0.12, gapSize: 0.04 }   // 3:1 per ASME Y14.2
    : {};
  return (
    <group>
      <Line points={top} color={color} lineWidth={lw} depthTest={depthTest} {...dashProps} />
      <Line points={bot} color={color} lineWidth={lw} depthTest={depthTest} {...dashProps} />
      {vs.map((c, i) => (
        <Line
          key={i}
          points={[v(c[0],c[1],c[2]), v(c[3],c[4],c[5])]}
          color={color} lineWidth={lw} depthTest={depthTest} {...dashProps}
        />
      ))}
    </group>
  );
}

/* ================================================================== */
/* Structural elements (wireframe)                                      */
/* ================================================================== */

function Slab({ geom }: { geom: Geometry }) {
  const S = s(Math.max(B1(geom), B2(geom))) * 1.35;
  return (
    <>
      <HlrFace x1={-S} x2={+S} y1={-S} y2={+S} z1={-s(geom.h)} z2={0} />
      <WireBox
        x1={-S} x2={+S} y1={-S} y2={+S}
        z1={-s(geom.h)} z2={0}
        color={INK} lw={LW_THICK}
      />
    </>
  );
}

/** Critical-section shell — height = d (effective depth), not h. Hidden-style. */
function CriticalSection({ geom, dashed = true }: { geom: Geometry; dashed?: boolean }) {
  const hb1 = s(B1(geom)) / 2;
  const hb2 = s(B2(geom)) / 2;
  return (
    <WireBox
      x1={-hb1} x2={+hb1} y1={-hb2} y2={+hb2}
      z1={-s(geom.d)} z2={0}
      color={INK} lw={LW_MEDIUM} dashed={dashed}
      depthTest={false}
    />
  );
}

/** Column sitting below, top flush with slab top surface. */
function Column({ geom }: { geom: Geometry }) {
  const hc1 = s(geom.c1) / 2;
  const hc2 = s(geom.c2) / 2;
  const top = 0;
  const bot = -s(geom.h) - 1.6;
  return (
    <>
      <HlrFace x1={-hc1} x2={+hc1} y1={-hc2} y2={+hc2} z1={bot} z2={top} />
      <WireBox
        x1={-hc1} x2={+hc1} y1={-hc2} y2={+hc2}
        z1={bot} z2={top}
        color={INK} lw={LW_THICK}
      />
    </>
  );
}

/**
 * Invisible box that writes to the depth buffer — pairs with a WireBox
 * drawn on top to give true hidden-line removal: far edges get z-culled
 * behind nearer faces. Polygon-offset prevents z-fighting between the
 * face and its own edges. Pure Three.js — no CAD kernel needed for
 * axis-aligned solids.
 */
function HlrFace({
  x1, x2, y1, y2, z1, z2,
}: {
  x1: number; x2: number; y1: number; y2: number; z1: number; z2: number;
}) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const cz = (z1 + z2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  return (
    <mesh position={[cx, cy, cz]} renderOrder={0}>
      <boxGeometry args={[dx, dy, dz]} />
      <meshBasicMaterial
        colorWrite={false}
        depthWrite
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  );
}

/* ================================================================== */
/* Moment vector (curved arrow, right-hand rule)                        */
/* ================================================================== */

function MomentVector({
  mu, theta, centerZ = 1.5, radius = 0.7, label = true,
}: {
  mu: number; theta: number;
  centerZ?: number; radius?: number; label?: boolean;
}) {
  if (mu <= 0) return null;

  // theta = direction of the moment span in the slab plane (along +x at θ=0).
  // By right-hand rule the moment VECTOR is perpendicular to the span:
  //   u = moment-vector axis (thumb)
  //   v = span direction (lies in the curl plane along with +z)
  const u = new THREE.Vector3(-Math.sin(theta), Math.cos(theta), 0);
  // v flipped: mirrors the curl around the z-z axis (vertical line through center)
  const v = new THREE.Vector3(-Math.cos(theta), -Math.sin(theta), 0);
  const w = new THREE.Vector3(0, 0, 1);
  const center = new THREE.Vector3(0, 0, centerZ);

  const start = -Math.PI / 2 + Math.PI / 10;
  const sweep = Math.PI * 1.72;
  const N = 48;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= N; i++) {
    const t = start + sweep * (i / N);
    points.push(
      center.clone()
        .addScaledVector(v, radius * Math.cos(t))
        .addScaledVector(w, radius * Math.sin(t)),
    );
  }

  const tEnd = start + sweep;
  const tip = points[points.length - 1];
  const tangent = v.clone().multiplyScalar(-Math.sin(tEnd))
    .addScaledVector(w, Math.cos(tEnd))
    .normalize();
  const radial = v.clone().multiplyScalar(Math.cos(tEnd))
    .addScaledVector(w, Math.sin(tEnd))
    .normalize();
  const headLen = Math.max(0.16, radius * 0.28);
  const headHalf = headLen * 0.45;
  const headBase = tip.clone().sub(tangent.clone().multiplyScalar(headLen));
  const headA = headBase.clone().add(radial.clone().multiplyScalar(headHalf));
  const headB = headBase.clone().sub(radial.clone().multiplyScalar(headHalf));

  // Place M_u label at the centroid of the curl so it reads as
  // "this circled symbol = M_u".
  const labelPos = center.clone();

  return (
    <group>
      <Line points={points} color={RED} lineWidth={LW_MEDIUM} />
      <Line points={[headA, tip, headB]} color={RED} lineWidth={LW_MEDIUM} />
      {label && (
        <MathLabel
          position={[labelPos.x, labelPos.y, labelPos.z]}
          tex="M_u" color={RED} fontSize={26}
        />
      )}
    </group>
  );
}

/* ================================================================== */
/* Axial (P_u) — straight downward arrow                                */
/* ================================================================== */

function AxialVector({
  pu, startZ = 1.1, endZ = 0.08, label = true, fontSize = 22,
}: {
  pu: number; startZ?: number; endZ?: number; label?: boolean; fontSize?: number;
}) {
  if (pu <= 0) return null;
  const tail = new THREE.Vector3(0, 0, startZ);
  const tip  = new THREE.Vector3(0, 0, endZ);
  const headLen = 0.16;
  const w = 0.07;
  const headBase = new THREE.Vector3(0, 0, endZ + headLen);
  return (
    <group>
      <Line points={[tail, tip]} color={RED} lineWidth={LW_THICK} />
      <Line
        points={[
          headBase.clone().add(new THREE.Vector3(+w, 0, 0)),
          tip,
          headBase.clone().add(new THREE.Vector3(-w, 0, 0)),
        ]}
        color={RED} lineWidth={LW_THICK}
      />
      <Line
        points={[
          headBase.clone().add(new THREE.Vector3(0, +w, 0)),
          tip,
          headBase.clone().add(new THREE.Vector3(0, -w, 0)),
        ]}
        color={RED} lineWidth={LW_THICK}
      />
      {label && (
        <MathLabel
          position={[0.35, 0, startZ + 0.05]}
          tex="P_u" color={RED} fontSize={fontSize}
        />
      )}
    </group>
  );
}

/* ================================================================== */
/* Stress arrows (triptych)                                             */
/* ================================================================== */

function StressArrow({
  origin, length, direction, color = RED,
}: {
  origin: [number, number, number];
  length: number;
  direction: 1 | -1;
  color?: string;
}) {
  if (length < 0.002) return null;
  const tail = new THREE.Vector3(...origin);
  const tip = new THREE.Vector3(origin[0], origin[1], origin[2] - direction * length);
  const headL = Math.min(0.1, Math.max(0.04, length * 0.32));
  const headBase = tip.clone();
  headBase.z += direction * headL;
  const w = 0.035;
  return (
    <group>
      <Line points={[tail, tip]} color={color} lineWidth={LW_MEDIUM} />
      <Line points={[headBase.clone().add(new THREE.Vector3(+w, 0, 0)), tip,
                     headBase.clone().add(new THREE.Vector3(-w, 0, 0))]}
            color={color} lineWidth={LW_MEDIUM} />
      <Line points={[headBase.clone().add(new THREE.Vector3(0, +w, 0)), tip,
                     headBase.clone().add(new THREE.Vector3(0, -w, 0))]}
            color={color} lineWidth={LW_MEDIUM} />
    </group>
  );
}

function StressArrows({
  geom, vu, mu, theta,
}: {
  geom: Geometry; vu: number; mu: number; theta: number;
}) {
  const samples = useMemo(() => perimeterSamples(geom, 9), [geom]);
  const zTop = 0;
  return (
    <group>
      {samples.map(([x, y], i) => {
        const stress = stressAt(x, y, vu, mu, theta, geom);
        const len = Math.abs(stress) * STRESS_SCALE;
        const dir: 1 | -1 = stress >= 0 ? 1 : -1;
        return (
          <StressArrow
            key={i}
            origin={[s(x), s(y), zTop]}
            length={len}
            direction={dir}
          />
        );
      })}
    </group>
  );
}

/* ================================================================== */
/* Scene frame                                                          */
/* ================================================================== */

function SceneFrame({
  children, height = 380, zoom: initialZoom = 80,
  cameraPosition = [5, -8, 5.5], rotate = false,
}: {
  children: React.ReactNode;
  height?: number;
  zoom?: number;
  cameraPosition?: [number, number, number];
  rotate?: boolean;
}) {
  const [zoom, setZoom] = useState(initialZoom);
  const bumpIn  = () => setZoom((z) => Math.min(z * 1.2, 600));
  const bumpOut = () => setZoom((z) => Math.max(z / 1.2, 15));
  const reset   = () => setZoom(initialZoom);

  return (
    <div
      className="relative border border-ink"
      style={{ height, touchAction: rotate ? "none" : "pan-y" }}
    >
      <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={[BG]} />
        <OrthographicCamera
          makeDefault
          position={cameraPosition}
          up={[0, 0, 1]}
          zoom={zoom}
          near={-50}
          far={50}
        />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableRotate={rotate}
          enableZoom={false}
          minPolarAngle={rotate ? 0.05 : undefined}
          maxPolarAngle={rotate ? Math.PI / 2 - 0.05 : undefined}
        />
        <ambientLight intensity={0.95} />
        {children}
      </Canvas>

      <div className="absolute top-2 right-2 flex flex-col">
        <ZoomBtn onClick={bumpIn}  label="+" />
        <ZoomBtn onClick={reset}   label="⌂" title="reset zoom" />
        <ZoomBtn onClick={bumpOut} label="−" />
      </div>

      {rotate && (
        <div className="absolute bottom-2 left-2 text-[9px] uppercase tracking-[0.18em] text-muted select-none">
          drag to orbit · plate stays level
        </div>
      )}
    </div>
  );
}

function ZoomBtn({
  onClick, label, title,
}: {
  onClick: () => void; label: string; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 bg-paper border border-ink text-ink font-mono text-sm leading-none hover:bg-ink hover:text-paper -mb-px last:mb-0 flex items-center justify-center"
    >
      {label}
    </button>
  );
}

/* ================================================================== */
/* Hero scene — setup + dimensions                                      */
/* ================================================================== */

export interface SceneProps {
  geom: Geometry;
  vu: number;
  mu: number;
  theta: number;
}

export function HeroScene(props: SceneProps) {
  const g = props.geom;

  const hc1 = s(g.c1) / 2;
  const hc2 = s(g.c2) / 2;
  const hb1 = s(B1(g)) / 2;
  const hb2 = s(B2(g)) / 2;
  const hh  = s(g.h);
  const hd  = s(g.d);

  // offsets for dim lines (render units)
  const planOffsetA = 0.70;  // inner (c_1, c_2)
  const planOffsetB = 1.25;  // outer (b_1, b_2)
  const elevOffset  = 0.30;  // beyond slab edge for vertical dims

  return (
    <SceneFrame height={480} zoom={70} cameraPosition={[6, -9, 6]} rotate>
      <Slab geom={g} />
      <CriticalSection geom={g} />
      <Column geom={g} />
      <AxialVector pu={props.vu} startZ={1.25} endZ={0.1} fontSize={22} />
      <MomentVector mu={props.mu} theta={props.theta} centerZ={1.5} radius={0.75} />

      {/* ---- plan dimensions (in -y direction) ---- */}
      <Dim
        a={[-hc1, -hc2, 0]}
        b={[+hc1, -hc2, 0]}
        offset={[0, -planOffsetA, 0]}
        label="c_1"
      />
      <Dim
        a={[-hb1, -hb2, 0]}
        b={[+hb1, -hb2, 0]}
        offset={[0, -planOffsetB, 0]}
        label="b_1"
      />

      {/* ---- plan dimensions (in +x direction) ---- */}
      <Dim
        a={[+hc1, -hc2, 0]}
        b={[+hc1, +hc2, 0]}
        offset={[+planOffsetA, 0, 0]}
        label="c_2"
      />
      <Dim
        a={[+hb1, -hb2, 0]}
        b={[+hb1, +hb2, 0]}
        offset={[+planOffsetB, 0, 0]}
        label="b_2"
      />

      {/* ---- d/2 offset: proper Dim lifted above the slab so extension
             lines (in +z) don't collide with the plan-view dims ------- */}
      <Dim
        a={[+hc1, 0, 0]}
        b={[+hb1, 0, 0]}
        offset={[0, 0, +0.32]}
        label={`d/2 = ${(g.d / 2).toFixed(2)}''`}
        tickSize={0.04}
        fontSize={18}
      />

      {/* ---- elevation dimensions (vertical, at front-right slab edge) ---- */}
      <Dim
        a={[+hb1 + elevOffset, -s(Math.max(B1(g), B2(g))) * 1.35, 0]}
        b={[+hb1 + elevOffset, -s(Math.max(B1(g), B2(g))) * 1.35, -hh]}
        offset={[0.30, 0, 0]}
        label="h"
      />
      <Dim
        a={[+hb1 + elevOffset, -s(Math.max(B1(g), B2(g))) * 1.35, 0]}
        b={[+hb1 + elevOffset, -s(Math.max(B1(g), B2(g))) * 1.35, -hd]}
        offset={[0.64, 0, 0]}
        label="d"
      />

      {/* ---- callouts ---- */}
      <Leader
        anchor={[-hb1, +hb2 * 0.4, 0]}
        labelPos={[-hb1 - 1.0, +hb2 + 0.7, 0.4]}
        label="critical section"
      />
      <Leader
        anchor={[-hb1, -hb2, 0]}
        labelPos={[-hb1 - 1.4, -hb2 - 1.2, 0.5]}
        label={`b_0 = 2(b_1 + b_2) = ${b0(g).toFixed(1)}''`}
        isTex
      />
    </SceneFrame>
  );
}

/* ================================================================== */
/* Decomposition triptych                                               */
/* ================================================================== */

export function DecompositionTriptych(props: SceneProps) {
  const panels = [
    { key: "direct", title: "(b) P_u alone",      vu: props.vu, mu: 0,        showPu: true,  showMu: false },
    { key: "moment", title: "(c) γ_v M_u alone",  vu: 0,        mu: props.mu, showPu: false, showMu: true  },
    { key: "total",  title: "(d) P_u + γ_v M_u",  vu: props.vu, mu: props.mu, showPu: true,  showMu: true  },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {panels.map((p) => (
        <div key={p.key}>
          <SceneFrame height={280} zoom={70} cameraPosition={[5, -7, 4.5]}>
            <CriticalSection geom={props.geom} />
            <StressArrows geom={props.geom} vu={p.vu} mu={p.mu} theta={props.theta} />
            {p.showPu && (
              <AxialVector pu={p.vu} startZ={1.15} endZ={0.15} fontSize={20} />
            )}
            {p.showMu && (
              <MomentVector
                mu={p.mu} theta={props.theta}
                centerZ={0.9} radius={0.4} label
              />
            )}
          </SceneFrame>
          <div className="mt-1 text-xs font-mono tracking-wide text-ink">
            {p.title}
          </div>
        </div>
      ))}
    </div>
  );
}
