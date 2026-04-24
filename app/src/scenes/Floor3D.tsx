import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera, Line, Html } from "@react-three/drei";
import type { Column, ColumnResult, Polygon, Slab, Wall } from "../lib/types";
import { layerColor } from "../lib/layer-colors";

const INK = "#1A1A1A";
const MUTED = "#6B6B6B";
const GREEN = "#16A34A";
const AMBER = "#D97706";
const RED = "#DC2626";
const WALL = "#0057FF";

interface Props {
  slab: Polygon | null;
  columns: Column[];
  walls: Wall[];
  results: Map<string, ColumnResult>;
  hSlabIn: number;
  /** Wall extrusion height (in). Defaults to 144" (12 ft story). */
  wallHeightIn?: number;
  selectedColumn: string | null;
  onSelect: (id: string | null) => void;
  /** Raw DXF outlines to draw at the slab-top plane before anything is "generated". */
  outlineSlab?: Slab | null;
  outlineColumns?: Column[];
  outlineWalls?: Wall[];
}

export function Floor3D({ slab, columns, walls, results, hSlabIn, wallHeightIn = 144, selectedColumn, onSelect, outlineSlab, outlineColumns, outlineWalls }: Props) {
  const bounds = useMemo(
    () => computeBounds(slab ?? outlineSlab?.polygon ?? null, columns.length ? columns : outlineColumns ?? [], walls.length ? walls : outlineWalls ?? []),
    [slab, columns, walls, outlineSlab, outlineColumns, outlineWalls],
  );
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
        {outlineSlab && !slab && (
          <OutlinePolygon polygon={outlineSlab.polygon} color={layerColor(outlineSlab.layer)} />
        )}
        {(outlineColumns ?? []).filter(c => columns.find(cc => cc.id === c.id) === undefined)
          .map((c) => <OutlineBox key={`o-${c.id}`} column={c} color={layerColor(c.layer)} />)}
        {(outlineWalls ?? []).filter(w => walls.find(ww => ww.id === w.id) === undefined)
          .map((w) => <OutlineWall key={`o-${w.id}`} wall={w} color={layerColor(w.layer)} />)}
        {walls.map((w) => (
          <WallViz key={w.id} wall={w} hSlabIn={hSlabIn} heightIn={wallHeightIn} />
        ))}
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

function computeBounds(slab: Polygon | null, columns: Column[], walls: Wall[]) {
  let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
  const bump = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  if (slab) {
    for (const [x, y] of slab.outer) bump(x, y);
  }
  for (const c of columns) bump(c.position[0], c.position[1]);
  for (const w of walls) {
    for (const [x, y] of w.points) bump(x, y);
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

// ---- Outline helpers (draw un-generated DXF linework at the slab-top plane) ----

function OutlinePolygon({ polygon, color }: { polygon: Polygon; color: string }) {
  const z = 0.2;
  const pts: [number, number, number][] = polygon.outer.map((p) => [p[0], p[1], z]);
  pts.push([polygon.outer[0][0], polygon.outer[0][1], z]);
  return (
    <group>
      <Line points={pts} color={color} lineWidth={1.5} />
      {(polygon.holes ?? []).map((h, i) => {
        const hp: [number, number, number][] = h.map((p) => [p[0], p[1], z]);
        hp.push([h[0][0], h[0][1], z]);
        return <Line key={i} points={hp} color={color} lineWidth={1.5} />;
      })}
    </group>
  );
}

function OutlineBox({ column, color }: { column: Column; color: string }) {
  const z = 0.2;
  const [cx, cy] = column.position;
  const hx = column.c1 / 2, hy = column.c2 / 2;
  const pts: [number, number, number][] = [
    [cx - hx, cy - hy, z],
    [cx + hx, cy - hy, z],
    [cx + hx, cy + hy, z],
    [cx - hx, cy + hy, z],
    [cx - hx, cy - hy, z],
  ];
  return <Line points={pts} color={color} lineWidth={1.2} />;
}

function OutlineWall({ wall, color }: { wall: Wall; color: string }) {
  const z = 0.2;
  const pts: [number, number, number][] = wall.points.map((p) => [p[0], p[1], z]);
  if (wall.closed && pts.length >= 3) pts.push([wall.points[0][0], wall.points[0][1], z]);
  if (pts.length < 2) return null;
  return <Line points={pts} color={color} lineWidth={1.2} />;
}

function WallViz({ wall, hSlabIn, heightIn }: { wall: Wall; hSlabIn: number; heightIn: number }) {
  // Walls hang below the slab, matching columns.  Slab occupies
  // z = -hSlabIn to 0; wall top meets slab bottom at z = -hSlabIn, wall
  // bottom at z = -hSlabIn - heightIn.
  const shape = useMemo(() => {
    if (!(wall.closed && wall.points.length >= 3)) return null;
    const s = new THREE.Shape();
    s.moveTo(wall.points[0][0], wall.points[0][1]);
    for (let i = 1; i < wall.points.length; i++) {
      s.lineTo(wall.points[i][0], wall.points[i][1]);
    }
    s.closePath();
    return s;
  }, [wall]);

  const geom = useMemo(() => {
    if (!shape) return null;
    const g = new THREE.ExtrudeGeometry(shape, { depth: heightIn, bevelEnabled: false });
    // ExtrudeGeometry builds along +z from 0 to heightIn.  Shift the
    // whole thing down so the top lands at the slab bottom.
    g.translate(0, 0, -hSlabIn - heightIn);
    return g;
  }, [shape, heightIn, hSlabIn]);

  const edges = useMemo(() => (geom ? new THREE.EdgesGeometry(geom, 20) : null), [geom]);

  if (geom && edges) {
    return (
      <group>
        <mesh geometry={geom} renderOrder={0}>
          <meshBasicMaterial color={WALL} transparent opacity={0.3} />
        </mesh>
        <lineSegments geometry={edges} renderOrder={1}>
          <lineBasicMaterial color={WALL} />
        </lineSegments>
      </group>
    );
  }

  // Open polyline — draw centerline as a line at the slab bottom.
  const pts: [number, number, number][] = wall.points.map((p) => [p[0], p[1], -hSlabIn - 0.05]);
  if (pts.length < 2) return null;
  return <Line points={pts} color={WALL} lineWidth={2} />;
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
