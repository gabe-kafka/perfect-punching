/**
 * Client-side DXF ingest.
 *
 * Two-stage pipeline:
 *   1. scanDxfLayers(text) → inventory every layer with entity counts,
 *      geometry stats, and a suggested role (slab / columns / walls /
 *      column-labels / ignore) based on layer name + geometry.  No
 *      classification decisions are made yet.
 *   2. ingestDxfWithMapping(text, mapping) → actually ingest entities
 *      according to the caller-supplied role per layer.
 *
 * The UI uses these two steps directly so the user can confirm / override
 * the suggested mapping before any data is classified.
 *
 * `ingestDxf(text)` is a back-compat convenience that scans and applies
 * the suggested mapping in one go — used by headless harnesses that
 * don't have a UI to ask the user.
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
  block?: string;
}

export type LayerRole =
  | "slab"
  | "columns"
  | "walls"
  | "column-labels"
  | "ignore";

export const ALL_ROLES: LayerRole[] = [
  "slab",
  "columns",
  "walls",
  "column-labels",
  "ignore",
];

export interface LayerInfo {
  /** Normalized (uppercase, trimmed) layer name. */
  name: string;
  entityCounts: Record<string, number>;
  totalEntities: number;
  closedPolylineCount: number;
  openPolylineCount: number;
  lineCount: number;
  pointCount: number;
  textCount: number;
  /** Largest enclosed area (sq-in) of any closed polyline on this layer. */
  maxPolygonAreaIn2?: number;
  /** Average edge segment length in inches — distinguishes fat slab polygons from narrow wall runs. */
  avgSegmentLengthIn?: number;
  /** Average aspect ratio (long/short bbox side) of closed polylines on this layer. ~1 = column-like, ≫1 = wall-like. */
  avgClosedPolyAspectRatio?: number;
  suggestedRole: LayerRole;
  suggestionReason: string;
}

/** Normalized layer name → role. */
export type LayerMapping = Record<string, LayerRole>;

export interface DxfScan {
  layers: LayerInfo[];
  totalBounds: { minX: number; minY: number; maxX: number; maxY: number };
  suggestedMapping: LayerMapping;
}

export interface IngestResult {
  slabs: Slab[];
  columns: Column[];
  walls: Wall[];
  texts: { layer: string; position: Vec2; text: string }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  stats: {
    layersFound: string[];
    entityCounts: Record<string, number>;
    columnsBeforeDedup: number;
    /** The mapping that was applied (normalized layer -> role). */
    appliedMapping: LayerMapping;
  };
}

const NORM = (s: string) => s.trim().toUpperCase();

// ---- Geometry helpers ----

function ringArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
}

function segmentLengths(pts: Vec2[], closed: boolean): number[] {
  const out: number[] = [];
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    out.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return out;
}

// ---- Scan: parse once, inventory layers ----

export function scanDxfLayers(text: string): DxfScan {
  const helper = new Helper(text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const denorm: DxfEntity[] = (helper as any).denormalised ?? [];

  const perLayer = new Map<string, {
    entityCounts: Record<string, number>;
    closedPolys: Vec2[][];
    openPolys: Vec2[][];
    lines: [Vec2, Vec2][];
    points: number;
    texts: number;
    /** Sum of closed-poly aspect ratios (long/short bbox side). Used downstream to tell columns (~1) from walls (≫1). */
    aspectSum: number;
    aspectCount: number;
  }>();

  let minX = +Infinity, minY = +Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  const bump = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const e of denorm) {
    const layer = NORM(e.layer ?? "");
    let rec = perLayer.get(layer);
    if (!rec) {
      rec = { entityCounts: {}, closedPolys: [], openPolys: [], lines: [], points: 0, texts: 0, aspectSum: 0, aspectCount: 0 };
      perLayer.set(layer, rec);
    }
    rec.entityCounts[e.type] = (rec.entityCounts[e.type] ?? 0) + 1;

    if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      const ring = (e.vertices ?? []).map((v) => [v.x, v.y] as Vec2);
      ring.forEach(([x, y]) => bump(x, y));
      if (ring.length >= 2) {
        if (e.closed && ring.length >= 3) {
          rec.closedPolys.push(ring);
          const xs = ring.map((p) => p[0]);
          const ys = ring.map((p) => p[1]);
          const bx = Math.max(...xs) - Math.min(...xs);
          const by = Math.max(...ys) - Math.min(...ys);
          const long = Math.max(bx, by), short = Math.max(Math.min(bx, by), 1e-6);
          rec.aspectSum += long / short;
          rec.aspectCount += 1;
        } else rec.openPolys.push(ring);
      }
    } else if (e.type === "LINE") {
      const a: Vec2 = [e.start?.x ?? 0, e.start?.y ?? 0];
      const b: Vec2 = [e.end?.x ?? 0, e.end?.y ?? 0];
      bump(a[0], a[1]); bump(b[0], b[1]);
      rec.lines.push([a, b]);
    } else if (e.type === "POINT") {
      const x = e.x ?? e.position?.x ?? 0;
      const y = e.y ?? e.position?.y ?? 0;
      bump(x, y);
      rec.points += 1;
    } else if (e.type === "TEXT" || e.type === "MTEXT") {
      rec.texts += 1;
    }
  }

  if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 100; }

  // Per-layer stats
  const layers: LayerInfo[] = [];
  for (const [name, rec] of perLayer) {
    const totalEntities = Object.values(rec.entityCounts).reduce((a, b) => a + b, 0);
    const closedPolylineCount = rec.closedPolys.length;
    const openPolylineCount = rec.openPolys.length;
    const maxPolygonAreaIn2 = closedPolylineCount > 0
      ? Math.max(...rec.closedPolys.map(ringArea))
      : undefined;
    const allSegs = [
      ...rec.closedPolys.flatMap(p => segmentLengths(p, true)),
      ...rec.openPolys.flatMap(p => segmentLengths(p, false)),
      ...rec.lines.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])),
    ];
    const avgSegmentLengthIn = allSegs.length > 0
      ? allSegs.reduce((a, b) => a + b, 0) / allSegs.length
      : undefined;

    const avgClosedPolyAspectRatio = rec.aspectCount > 0
      ? rec.aspectSum / rec.aspectCount
      : undefined;
    const info: LayerInfo = {
      name,
      entityCounts: rec.entityCounts,
      totalEntities,
      closedPolylineCount,
      openPolylineCount,
      lineCount: rec.lines.length,
      pointCount: rec.points,
      textCount: rec.texts,
      maxPolygonAreaIn2,
      avgSegmentLengthIn,
      avgClosedPolyAspectRatio,
      suggestedRole: "ignore",
      suggestionReason: "",
    };
    const [role, reason] = suggestRole(info);
    info.suggestedRole = role;
    info.suggestionReason = reason;
    layers.push(info);
  }
  layers.sort((a, b) => a.name.localeCompare(b.name));

  const suggestedMapping: LayerMapping = {};
  for (const L of layers) suggestedMapping[L.name] = L.suggestedRole;

  return {
    layers,
    totalBounds: { minX, minY, maxX, maxY },
    suggestedMapping,
  };
}

// ---- Suggestion heuristics ----

function suggestRole(L: LayerInfo): [LayerRole, string] {
  const name = L.name;

  // Name-based, strongest signal.
  if (/(^|[_\-\s])(slab|floor|sog|boundary|outline)([_\-\s]|$)/i.test(name) &&
      L.closedPolylineCount > 0) {
    return ["slab", "layer name + has closed polyline"];
  }
  if (/(label|tag|txt|id|mark)/i.test(name) && L.textCount > 0) {
    return ["column-labels", "layer name + TEXT entities"];
  }
  if (/(^|[_\-\s])(col(umn)?s?|clm)([_\-\s]|$)/i.test(name)) {
    return ["columns", "layer name matches column pattern"];
  }
  if (/(^|[_\-\s])(wall|sw|shear)([_\-\s]|$)/i.test(name)) {
    return ["walls", "layer name matches wall pattern"];
  }

  // Geometry-based fallback.
  if (L.maxPolygonAreaIn2 !== undefined && L.maxPolygonAreaIn2 > 144 * 50) {
    // Closed polygon bigger than ~50 sq-ft → most likely the slab boundary.
    return ["slab", `largest closed polygon ≈ ${(L.maxPolygonAreaIn2 / 144).toFixed(0)} sq-ft`];
  }
  if (L.pointCount >= 3 && L.closedPolylineCount === 0 && L.lineCount === 0) {
    return ["columns", `${L.pointCount} POINT entities only`];
  }
  // Disambiguate closed-polyline walls from columns by aspect ratio.
  // Columns are roughly square-ish (aspect ≲ 2). Walls are long and
  // thin (aspect ≳ 3).  Use the layer-averaged aspect so one outlier
  // column among many wall runs doesn't flip the suggestion.
  if (L.closedPolylineCount >= 1 && L.avgClosedPolyAspectRatio !== undefined) {
    const ar = L.avgClosedPolyAspectRatio;
    if (ar >= 3) {
      return ["walls", `${L.closedPolylineCount} closed polylines, avg aspect ratio ${ar.toFixed(1)} (long+thin)`];
    }
    if (L.closedPolylineCount >= 3 &&
        (L.maxPolygonAreaIn2 === undefined || L.maxPolygonAreaIn2 < 144 * 16)) {
      return ["columns", `${L.closedPolylineCount} small closed polylines, aspect ${ar.toFixed(1)}`];
    }
  }
  if (L.lineCount >= 4 && L.lineCount >= L.closedPolylineCount) {
    return ["walls", `${L.lineCount} LINE entities`];
  }

  return ["ignore", "no name match + geometry ambiguous"];
}

// ---- Mapping-driven ingest ----

export function ingestDxfWithMapping(
  text: string,
  mapping: LayerMapping,
): IngestResult {
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
  const bump = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  let slabCounter = 0;
  let columnCounter = 0;
  let wallCounter = 0;

  for (const e of denorm) {
    const layer = NORM(e.layer ?? "");
    layersFound.add(layer);
    entityCounts[e.type] = (entityCounts[e.type] ?? 0) + 1;

    const role = mapping[layer] ?? "ignore";
    if (role === "ignore") continue;

    if (role === "slab") {
      if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
        const ring = (e.vertices ?? []).map((v) => [v.x, v.y] as Vec2);
        if (ring.length >= 3) {
          ring.forEach(([x, y]) => bump(x, y));
          slabs.push({ id: `S${slabCounter++}`, polygon: { outer: ring }, layer });
        }
      }
      continue;
    }

    if (role === "columns") {
      if (e.type === "POINT") {
        const x = e.x ?? e.position?.x ?? 0;
        const y = e.y ?? e.position?.y ?? 0;
        bump(x, y);
        columnsRaw.push({
          id: `C${columnCounter++}`,
          position: [x, y],
          c1: 12,
          c2: 12,
          layer,
        });
      } else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
        const ring = (e.vertices ?? []).map((v) => [v.x, v.y] as Vec2);
        if (ring.length >= 3) {
          const xs = ring.map(([x]) => x);
          const ys = ring.map(([, y]) => y);
          const cx = xs.reduce((a, b) => a + b, 0) / ring.length;
          const cy = ys.reduce((a, b) => a + b, 0) / ring.length;
          const c1 = Math.max(...xs) - Math.min(...xs);
          const c2 = Math.max(...ys) - Math.min(...ys);
          bump(cx, cy);
          columnsRaw.push({
            id: `C${columnCounter++}`,
            position: [cx, cy],
            c1,
            c2,
            layer,
          });
        }
      }
      continue;
    }

    if (role === "walls") {
      if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
        const pts = (e.vertices ?? []).map((v) => [v.x, v.y] as Vec2);
        if (pts.length >= 2) {
          pts.forEach(([x, y]) => bump(x, y));
          walls.push({
            id: `W${wallCounter++}`,
            points: pts,
            closed: !!e.closed,
            layer,
          });
        }
      } else if (e.type === "LINE") {
        const a: Vec2 = [e.start?.x ?? 0, e.start?.y ?? 0];
        const b: Vec2 = [e.end?.x ?? 0, e.end?.y ?? 0];
        bump(a[0], a[1]); bump(b[0], b[1]);
        walls.push({ id: `W${wallCounter++}`, points: [a, b], layer });
      }
      continue;
    }

    if (role === "column-labels") {
      if (e.type === "TEXT" || e.type === "MTEXT") {
        const x = e.x ?? e.position?.x ?? 0;
        const y = e.y ?? e.position?.y ?? 0;
        const t = (e.string ?? e.text ?? "").trim();
        if (t) {
          bump(x, y);
          texts.push({ layer, position: [x, y], text: t });
        }
      }
      continue;
    }
  }

  // Dedupe columns within 3" (tributary convention).
  const TOL = 3;
  const columnsBeforeDedup = columnsRaw.length;
  const columns: Column[] = [];
  for (const c of columnsRaw) {
    const near = columns.find(
      (k) => Math.hypot(k.position[0] - c.position[0], k.position[1] - c.position[1]) < TOL,
    );
    if (!near) columns.push(c);
  }
  columns.forEach((c, i) => { c.id = `C${i + 1}`; });

  // Attach the nearest column-label TEXT to each column (within 36").
  for (const t of texts) {
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
      appliedMapping: mapping,
    },
  };
}

// ---- Back-compat: scan + apply suggested ----

export function ingestDxf(text: string): IngestResult {
  const scan = scanDxfLayers(text);
  return ingestDxfWithMapping(text, scan.suggestedMapping);
}
