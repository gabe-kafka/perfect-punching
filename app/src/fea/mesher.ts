/**
 * Constrained Delaunay triangulation of the slab for plate FEA.
 *
 * Strategy:
 *   1. Densify slab outer boundary + holes to a target edge length.
 *   2. Collect steiner points: column centers, wall sample points,
 *      plus an interior grid for bulk coverage.
 *   3. Feed to poly2tri (constrained Delaunay with holes + steiner points).
 *   4. Map returned triangles to FEAMesh node indices.
 *
 * We also store per-column and per-wall node indices so the boundary-
 * condition stage knows which nodes to pin / spring.
 */
import poly2tri from "poly2tri";
import type { Column, Polygon, Vec2, Wall } from "../lib/types.ts";
import type { FEAMesh, FEANode, FEAElement } from "./types.ts";

export interface MeshOptions {
  /** Target edge length (in). Smaller = finer mesh. */
  targetEdge: number;
  /** Wall sampling spacing (in). */
  wallSpacing?: number;
  /** Add interior grid points at this spacing (in). */
  interiorSpacing?: number;
}

export function buildMesh(
  slab: Polygon,
  columns: Column[],
  walls: Wall[],
  opts: MeshOptions,
): FEAMesh {
  const {
    targetEdge,
    wallSpacing = targetEdge,
    interiorSpacing = targetEdge * 1.5,
  } = opts;

  // ---- Boundary points (outer ring + holes) ----
  const outerPts = densifyRing(slab.outer, targetEdge);
  const holePts = (slab.holes ?? []).map(h => densifyRing(h, targetEdge));

  // ---- Column steiner points: centroid + 4 corner samples inside the
  //      c1 x c2 footprint so the rigid-patch constraint has slaves to
  //      enforce on.  Placed at 80% of the half-dimension to keep them
  //      clearly inside the footprint.
  const colPts: Vec2[] = [];
  for (const c of columns) {
    const [cx, cy] = c.position;
    const dx = (c.c1 / 2) * 0.8;
    const dy = (c.c2 / 2) * 0.8;
    colPts.push([cx, cy]);
    colPts.push([cx - dx, cy - dy]);
    colPts.push([cx + dx, cy - dy]);
    colPts.push([cx + dx, cy + dy]);
    colPts.push([cx - dx, cy + dy]);
  }

  // ---- Wall sample points ----
  const wallPts: Vec2[] = [];
  for (const w of walls) {
    const pts = w.points;
    const n = pts.length;
    const last = w.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(len / wallSpacing));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        wallPts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
  }

  // ---- Interior grid points ----
  const xs = slab.outer.map(p => p[0]);
  const ys = slab.outer.map(p => p[1]);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const interiorPts: Vec2[] = [];
  for (let y = minY + interiorSpacing / 2; y < maxY; y += interiorSpacing) {
    for (let x = minX + interiorSpacing / 2; x < maxX; x += interiorSpacing) {
      const p: Vec2 = [x, y];
      if (!pointInsideSlab(p, slab)) continue;
      interiorPts.push(p);
    }
  }

  // Merge + dedupe so poly2tri doesn't die on coincident points
  const allSteiner = dedupe([...colPts, ...wallPts, ...interiorPts], 1e-4);

  // First drop any Steiner point that lies ON a slab-boundary segment
  // (segment, not just vertex): walls running along a slab edge create
  // this pathology, and poly2tri rejects collinear steiners on a
  // constrained edge ("EdgeEvent: Collinear not supported!").
  const onBoundarySteiner = (p: Vec2): boolean => {
    const tol = targetEdge * 0.35;
    for (let i = 0; i < slab.outer.length; i++) {
      const a = slab.outer[i], b = slab.outer[(i + 1) % slab.outer.length];
      if (pointToSegDist(p, a, b) < tol) return true;
    }
    for (const h of slab.holes ?? []) {
      for (let i = 0; i < h.length; i++) {
        const a = h[i], b = h[(i + 1) % h.length];
        if (pointToSegDist(p, a, b) < tol) return true;
      }
    }
    return false;
  };
  const steinerInterior = allSteiner.filter(p => !onBoundarySteiner(p));

  const outerDedup = dedupeAgainst(outerPts, steinerInterior, targetEdge * 0.3);
  const holeDedup = holePts.map(h => dedupeAgainst(h, [...steinerInterior, ...outerDedup], targetEdge * 0.3));

  // Final dedupe between steiners and the (now-locked) boundary.
  const allBoundary = [...outerDedup, ...holeDedup.flat()];
  const safeSteiner = dedupeAgainst(steinerInterior, allBoundary, targetEdge * 0.3);

  // ---- poly2tri ----
  const outerContour = outerDedup.map(([x, y]) => new poly2tri.Point(x, y));
  const swctx = new poly2tri.SweepContext(outerContour);
  for (const h of holeDedup) {
    swctx.addHole(h.map(([x, y]) => new poly2tri.Point(x, y)));
  }
  for (const p of safeSteiner) {
    swctx.addPoint(new poly2tri.Point(p[0], p[1]));
  }
  swctx.triangulate();
  const triangles = swctx.getTriangles();

  // ---- Collect unique nodes + build elements ----
  const nodeMap = new Map<string, number>();
  const nodes: FEANode[] = [];
  const key = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const pushNode = (x: number, y: number): number => {
    const k = key(x, y);
    const hit = nodeMap.get(k);
    if (hit !== undefined) return hit;
    const idx = nodes.length;
    nodes.push({ x, y });
    nodeMap.set(k, idx);
    return idx;
  };

  const elements: FEAElement[] = [];
  for (const tri of triangles) {
    const p0 = tri.getPoint(0);
    const p1 = tri.getPoint(1);
    const p2 = tri.getPoint(2);
    let n0 = pushNode(p0.x, p0.y);
    let n1 = pushNode(p1.x, p1.y);
    let n2 = pushNode(p2.x, p2.y);
    // Ensure CCW
    const signedArea = 0.5 * (
      (nodes[n1].x - nodes[n0].x) * (nodes[n2].y - nodes[n0].y) -
      (nodes[n2].x - nodes[n0].x) * (nodes[n1].y - nodes[n0].y)
    );
    if (signedArea < 0) { [n1, n2] = [n2, n1]; }
    const area = Math.abs(signedArea);
    if (area < 1e-6) continue; // skip degenerate
    elements.push({ n: [n0, n1, n2], area });
  }

  // ---- Map columns to nearest nodes (should be exact since they were steiner pts) ----
  const columnNodes = new Map<string, number>();
  for (const c of columns) {
    const idx = nearestNode(nodes, c.position);
    columnNodes.set(c.id, idx);
  }

  // ---- Wall nodes: all nodes close to any wall segment ----
  const wallNodes = new Set<number>();
  for (const w of walls) {
    const pts = w.points;
    const n = pts.length;
    const last = w.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      for (let ni = 0; ni < nodes.length; ni++) {
        const p: Vec2 = [nodes[ni].x, nodes[ni].y];
        if (pointToSegDist(p, a, b) < targetEdge * 0.35) {
          wallNodes.add(ni);
        }
      }
    }
  }

  // Exclude column nodes from wall set so each column is only pinned at its own column node
  for (const ci of columnNodes.values()) wallNodes.delete(ci);

  return { nodes, elements, columnNodes, wallNodes };
}

// ---- Helpers ----

function densifyRing(ring: Vec2[], target: number): Vec2[] {
  const out: Vec2[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    out.push(a);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.floor(len / target));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

function dedupe(pts: Vec2[], tol: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    let keep = true;
    for (const q of out) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) < tol) { keep = false; break; }
    }
    if (keep) out.push(p);
  }
  return out;
}

function dedupeAgainst(pts: Vec2[], against: Vec2[], tol: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    let keep = true;
    for (const q of against) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) < tol) { keep = false; break; }
    }
    if (keep) out.push(p);
  }
  return out;
}

function pointInsideSlab(p: Vec2, slab: Polygon): boolean {
  if (!pointInRing(p, slab.outer)) return false;
  for (const h of slab.holes ?? []) if (pointInRing(p, h)) return false;
  return true;
}

function pointInRing(p: Vec2, r: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1];
    const xj = r[j][0], yj = r[j][1];
    const intersect =
      ((yi > p[1]) !== (yj > p[1])) &&
      (p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function nearestNode(nodes: FEANode[], p: Vec2): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i].x - p[0]) ** 2 + (nodes[i].y - p[1]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function pointToSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len2 || 1);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
