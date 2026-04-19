/**
 * Client-side DXF ingest. Maps to the layer conventions used by the
 * tributary-plate-slab-local project so existing DXFs work unchanged.
 *
 *   SLAB         LWPOLYLINE / LINE                   slab boundary
 *   COLUMN-REAL  POINT                               column centers
 *   COLUMN-LABEL TEXT                                column IDs
 *   FLOOR LABELS TEXT / MTEXT                        floor IDs
 *   SHEAR-WALL   INSERT (exploded), LINE, LWPOLYLINE walls
 *
 * Columns are POINT entities only — no size info in the DXF. Sizes
 * come from per-project inputs (defaultC1 / defaultC2) or per-column
 * UI overrides downstream.
 *
 * INSUNITS = 1 (inches). All output is in inches.
 */
import { Helper } from "dxf";
import type { Column, Slab, Vec2, Wall } from "./types";

interface DxfEntity {
  type: string;
  layer: string;
  vertices?: Array<{ x: number; y: number; z?: number }>;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  position?: { x: number; y: number };
  x?: number;
  y?: number;
  string?: string;
  text?: string;
  closed?: boolean;
  // INSERT
  block?: string;
}

export interface IngestResult {
  slabs: Slab[];
  columns: Column[];
  walls: Wall[];
  /** Free TEXT entities — column labels and floor labels live here. */
  texts: { layer: string; position: Vec2; text: string }[];
  /** Bounds of all geometry, for camera framing. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Stats for diagnostics. */
  stats: {
    layersFound: string[];
    entityCounts: Record<string, number>;
    columnsBeforeDedup: number;
  };
}

const NORM = (s: string) => s.trim().toUpperCase();

/** Layer-name patterns we accept (forgiving of variants). */
const SLAB_LAYERS    = ["SLAB", "BOUNDARY"];
const COLUMN_LAYERS  = ["COLUMN-REAL", "COLUMNS", "COLUMN", "POINTS"];
const COL_LBL_LAYERS = ["COLUMN-LABEL", "COLUMN_LABEL", "COLUMN-LABELS"];
const FLOOR_LAYERS   = ["FLOOR LABELS", "FLOOR-LABELS", "FLOOR_LABELS", "FLOOR NUMBER"];
const WALL_LAYERS    = ["SHEAR-WALL", "WALL", "WALLS"];

const matchLayer = (entityLayer: string, candidates: string[]): boolean =>
  candidates.includes(NORM(entityLayer));

/** Parse the DXF text into our internal model. */
export function ingestDxf(text: string): IngestResult {
  // dxf-helper exposes a parsed AST under .parsed and a denormalized
  // entity list under .denormalised (after INSERT explosion).
  const helper = new Helper(text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const denorm: DxfEntity[] = (helper as any).denormalised ?? [];

  const layersFound = new Set<string>();
  const entityCounts: Record<string, number> = {};

  const slabs: Slab[] = [];
  const columnsRaw: Column[] = [];
  const walls: Wall[] = [];
  const texts: IngestResult["texts"] = [];

  let minX = +Infinity, minY = +Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  const updateBounds = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  let slabCounter = 0;
  let columnCounter = 0;
  let wallCounter = 0;

  for (const e of denorm) {
    const layer = e.layer ?? "";
    layersFound.add(layer);
    entityCounts[e.type] = (entityCounts[e.type] ?? 0) + 1;

    // ---- SLAB ----
    if (matchLayer(layer, SLAB_LAYERS)) {
      if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
        const ring = (e.vertices ?? []).map((v) => [v.x, v.y] as Vec2);
        if (ring.length >= 3) {
          ring.forEach(([x, y]) => updateBounds(x, y));
          slabs.push({
            id: `S${slabCounter++}`,
            polygon: { outer: ring },
          });
        }
      } else if (e.type === "LINE") {
        // Lines on SLAB layer are usually edges of a polygon that we'd
        // need to chain. Skip for now — most modern DXFs use LWPOLYLINE.
      }
      continue;
    }

    // ---- COLUMNS (POINT entities) ----
    if (matchLayer(layer, COLUMN_LAYERS)) {
      if (e.type === "POINT") {
        const x = e.x ?? e.position?.x ?? 0;
        const y = e.y ?? e.position?.y ?? 0;
        updateBounds(x, y);
        columnsRaw.push({
          id: `C${columnCounter++}`,
          position: [x, y],
          c1: 12,  // placeholder — overridden by ProjectInputs.defaultC1
          c2: 12,
        });
      } else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
        // Some DXFs draw columns as closed polygons — extract centroid + bbox dims.
        const ring = (e.vertices ?? []).map((v) => [v.x, v.y] as Vec2);
        if (ring.length >= 3) {
          const xs = ring.map(([x]) => x);
          const ys = ring.map(([, y]) => y);
          const cx = xs.reduce((a, b) => a + b, 0) / ring.length;
          const cy = ys.reduce((a, b) => a + b, 0) / ring.length;
          const c1 = Math.max(...xs) - Math.min(...xs);
          const c2 = Math.max(...ys) - Math.min(...ys);
          updateBounds(cx, cy);
          columnsRaw.push({
            id: `C${columnCounter++}`,
            position: [cx, cy],
            c1,
            c2,
          });
        }
      }
      continue;
    }

    // ---- COLUMN LABELS ----
    if (matchLayer(layer, COL_LBL_LAYERS) || matchLayer(layer, FLOOR_LAYERS)) {
      if (e.type === "TEXT" || e.type === "MTEXT") {
        const x = e.x ?? e.position?.x ?? 0;
        const y = e.y ?? e.position?.y ?? 0;
        const text = (e.string ?? e.text ?? "").trim();
        if (text) {
          updateBounds(x, y);
          texts.push({ layer: NORM(layer), position: [x, y], text });
        }
      }
      continue;
    }

    // ---- WALLS ----
    if (matchLayer(layer, WALL_LAYERS)) {
      if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
        const pts = (e.vertices ?? []).map((v) => [v.x, v.y] as Vec2);
        if (pts.length >= 2) {
          pts.forEach(([x, y]) => updateBounds(x, y));
          walls.push({
            id: `W${wallCounter++}`,
            points: pts,
            closed: !!e.closed,
          });
        }
      } else if (e.type === "LINE") {
        const a: Vec2 = [e.start?.x ?? 0, e.start?.y ?? 0];
        const b: Vec2 = [e.end?.x ?? 0,   e.end?.y ?? 0];
        updateBounds(a[0], a[1]); updateBounds(b[0], b[1]);
        walls.push({ id: `W${wallCounter++}`, points: [a, b] });
      }
      continue;
    }
  }

  // Dedup columns within 0.25 ft = 3 in (Tributary convention)
  const TOL = 3;
  const columnsBeforeDedup = columnsRaw.length;
  const columns: Column[] = [];
  for (const c of columnsRaw) {
    const near = columns.find(
      (k) => Math.hypot(k.position[0] - c.position[0], k.position[1] - c.position[1]) < TOL,
    );
    if (!near) columns.push(c);
  }

  // Renumber columns sequentially from 1
  columns.forEach((c, i) => {
    c.id = `C${i + 1}`;
  });

  // Attach the nearest column-label TEXT to each column (within 36" of its centroid).
  for (const t of texts) {
    if (!COL_LBL_LAYERS.includes(t.layer)) continue;
    let nearest: Column | null = null;
    let bestD = Infinity;
    for (const c of columns) {
      const d = Math.hypot(c.position[0] - t.position[0], c.position[1] - t.position[1]);
      if (d < bestD) { bestD = d; nearest = c; }
    }
    if (nearest && bestD < 36) {
      nearest.id = t.text.replace(/[^A-Za-z0-9]/g, "");
    }
  }

  if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 100; }

  return {
    slabs,
    columns,
    walls,
    texts,
    bounds: { minX, minY, maxX, maxY },
    stats: {
      layersFound: [...layersFound].sort(),
      entityCounts,
      columnsBeforeDedup,
    },
  };
}
