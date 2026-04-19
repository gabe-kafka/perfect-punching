import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera, Line, Html } from "@react-three/drei";
import type { Column, ColumnResult, Polygon } from "../lib/types";

const INK = "#1A1A1A";
const MUTED = "#6B6B6B";
const GREEN = "#16A34A";
const AMBER = "#D97706";
const RED = "#DC2626";

interface Props {
  slab: Polygon | null;
  columns: Column[];
  results: Map<string, ColumnResult>;
  hSlabIn: number;
  selectedColumn: string | null;
  onSelect: (id: string | null) => void;
}

export function Floor3D({ slab, columns, results, hSlabIn, selectedColumn, onSelect }: Props) {
  const bounds = useMemo(() => computeBounds(slab, columns), [slab, columns]);
  const SCALE = useMemo(() => boundsScale(bounds), [bounds]);

  return (
    <div className="relative h-full w-full border border-ink">
      <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={["#FFFFFF"]} />
        <OrthographicCamera
          makeDefault
          position={[bounds.cx + 4000 * SCALE, bounds.cy - 6000 * SCALE, 4000 * SCALE]}
          up={[0, 0, 1]}
          zoom={1}
          near={-50000}
          far={50000}
        />
        <OrbitControls
          makeDefault
          enablePan
          enableRotate
          enableZoom
          minPolarAngle={0.05}
          maxPolarAngle={Math.PI / 2 - 0.05}
          target={[bounds.cx, bounds.cy, 0]}
        />
        <ambientLight intensity={0.95} />

        {slab && <SlabSolid slab={slab} hIn={hSlabIn} scale={SCALE} />}
        {columns.map((c) => (
          <ColumnViz
            key={c.id}
            column={c}
            result={results.get(c.id)}
            scale={SCALE}
            hSlabIn={hSlabIn}
            selected={c.id === selectedColumn}
            onClick={() => onSelect(c.id === selectedColumn ? null : c.id)}
          />
        ))}
      </Canvas>
    </div>
  );
}

function computeBounds(slab: Polygon | null, columns: Column[]) {
  let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
  if (slab) {
    for (const [x, y] of slab.outer) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  for (const c of columns) {
    const [x, y] = c.position;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) { minX = minY = -100; maxX = maxY = 100; }
  return {
    minX, minY, maxX, maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
}

function boundsScale(b: ReturnType<typeof computeBounds>) {
  // Render scale: shrink the largest dimension to about 8 ortho-zoom units.
  return 1; // we use ortho zoom on camera setup; geometry stays in DXF inches
}

function SlabSolid({ slab, hIn, scale }: { slab: Polygon; hIn: number; scale: number }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    const r = slab.outer;
    s.moveTo(r[0][0], r[0][1]);
    for (let i = 1; i < r.length; i++) s.lineTo(r[i][0], r[i][1]);
    s.closePath();
    for (const hole of slab.holes ?? []) {
      const path = new THREE.Path();
      path.moveTo(hole[0][0], hole[0][1]);
      for (let i = 1; i < hole.length; i++) path.lineTo(hole[i][0], hole[i][1]);
      path.closePath();
      s.holes.push(path);
    }
    return s;
  }, [slab]);

  const geom = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: hIn,
      bevelEnabled: false,
    });
    g.translate(0, 0, -hIn);
    return g;
  }, [shape, hIn]);

  const edges = useMemo(() => new THREE.EdgesGeometry(geom, 20), [geom]);

  return (
    <group scale={scale}>
      <mesh geometry={geom} renderOrder={0}>
        <meshBasicMaterial colorWrite={false} depthWrite polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      <lineSegments geometry={edges} renderOrder={1}>
        <lineBasicMaterial color={INK} />
      </lineSegments>
    </group>
  );
}

function ColumnViz({
  column, result, scale, hSlabIn, selected, onClick,
}: {
  column: Column;
  result?: ColumnResult;
  scale: number;
  hSlabIn: number;
  selected: boolean;
  onClick: () => void;
}) {
  const colorByDcr = result ? dcrColor(result.dcr) : MUTED;
  const colTop = -hSlabIn;        // column top meets slab bottom
  const colBot = colTop - 12 * 12; // 12 ft below
  const cx = column.position[0];
  const cy = column.position[1];

  return (
    <group scale={scale}>
      {/* Column solid (extruded box) */}
      <mesh position={[cx, cy, (colTop + colBot) / 2]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <boxGeometry args={[column.c1, column.c2, colTop - colBot]} />
        <meshBasicMaterial color={selected ? "#0057FF" : colorByDcr} transparent opacity={0.55} />
      </mesh>
      <lineSegments position={[cx, cy, (colTop + colBot) / 2]}>
        <edgesGeometry args={[new THREE.BoxGeometry(column.c1, column.c2, colTop - colBot)]} />
        <lineBasicMaterial color={INK} />
      </lineSegments>

      {/* Column label floating above slab */}
      <Html
        position={[cx, cy, 6]}
        center
        zIndexRange={[100, 0]}
      >
        <div
          style={{
            color: result ? colorByDcr : MUTED,
            fontSize: "11px",
            fontFamily: '"JetBrains Mono", monospace',
            background: "rgba(255,255,255,0.85)",
            padding: "1px 4px",
            border: `1px solid ${selected ? "#0057FF" : "transparent"}`,
            cursor: "pointer",
            userSelect: "none",
            whiteSpace: "nowrap",
          }}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
          {column.id}{result ? ` · ${result.dcr.toFixed(2)}` : ""}
        </div>
      </Html>
    </group>
  );
}

function dcrColor(dcr: number): string {
  if (dcr <= 0.85) return GREEN;
  if (dcr <= 1.0) return AMBER;
  return RED;
}
