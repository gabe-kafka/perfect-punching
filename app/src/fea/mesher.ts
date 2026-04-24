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

  // ---- Column footprint seeds + column-local refinement ----
  //
  // The centroid is always a Steiner.  We also seed an 8-point ring inside
  // the c1 x c2 footprint (4 sides + 4 corners, each at 80% of the
  // half-dimension) so the rigid-patch constraint has 4-9 slaves per
  // column.  On top of that we add 8 ring points at ~1.5 x footprint
  // radius to refine the mesh immediately around each column — without
  // this, interior-grid spacing (~1.5 * targetEdge) leaves the plate
  // under-resolved at the free-edge side of edge/corner columns, and
  // the recovered Mu inflates.
  //
  // Every candidate is filtered through pointInsideSlab so points that
  // would sit outside the slab (or inside a hole) are dropped.  For edge
  // columns this cleanly leaves the patch asymmetric on the free side,
  // as it should be.
  // Split into two tiers so the triangulation-retry path can drop the
  // outer refinement ring without losing the rigid-patch slaves.
  const colPtsTight: Vec2[] = []; // 0.8x ring — patch slaves
  const colPtsRefine: Vec2[] = []; // 1.5x ring — mesh refinement only
  for (const c of columns) {
    const [cx, cy] = c.position;
    const hx = c.c1 / 2, hy = c.c2 / 2;
    const tight: Vec2[] = [
      [cx - hx*0.8, cy - hy*0.8],
      [cx + hx*0.8, cy - hy*0.8],
      [cx + hx*0.8, cy + hy*0.8],
      [cx - hx*0.8, cy + hy*0.8],
      [cx,          cy - hy*0.8],
      [cx + hx*0.8, cy],
      [cx,          cy + hy*0.8],
      [cx - hx*0.8, cy],
    ];
    const refine: Vec2[] = [
      [cx - hx*1.5, cy - hy*1.5],
      [cx + hx*1.5, cy - hy*1.5],
      [cx + hx*1.5, cy + hy*1.5],
      [cx - hx*1.5, cy + hy*1.5],
      [cx,          cy - hy*1.5],
      [cx + hx*1.5, cy],
      [cx,          cy + hy*1.5],
      [cx - hx*1.5, cy],
    ];
    for (const p of tight) if (pointInsideSlab(p, slab)) colPtsTight.push(p);
    for (const p of refine) if (pointInsideSlab(p, slab)) colPtsRefine.push(p);
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

  // ---- Column centroids: always in the mesh, but nudged inward ----
  //
  // Column centroids must be in the mesh so the rigid-patch master sits
  // at the column (previously they were silently dropped by
  // onBoundarySteiner when near the slab edge, which disabled the
  // patch).  But a centroid that lies ON or very close to a slab-
  // boundary segment makes poly2tri throw "EdgeEvent: Collinear not
  // supported!" because the Steiner point is effectively on a
  // constrained edge.
  //
  // Fix: if a centroid is within `minBoundaryGap` of any boundary
  // segment, move it perpendicular to that segment by enough to restore
  // the gap.  The master node ends up slightly offset from the column's
  // physical centroid; the rigid-patch lever-arm math handles that
  // correctly because levers are computed from actual mesh positions.
  const minBoundaryGap = targetEdge * 0.5;
  const allSegs: [Vec2, Vec2][] = [];
  for (let i = 0; i < slab.outer.length; i++) {
    allSegs.push([slab.outer[i], slab.outer[(i + 1) % slab.outer.length]]);
  }
  for (const h of slab.holes ?? []) {
    for (let i = 0; i < h.length; i++) allSegs.push([h[i], h[(i + 1) % h.length]]);
  }
  // Iteratively push a point away from the closest boundary segment until
  // every segment is at least minBoundaryGap away.  Near concave corners
  // one nudge can push the point closer to a *different* segment, so we
  // loop (cap iterations and bail if it's not converging).
  const nudgeInward = (p: Vec2): Vec2 => {
    let q = p;
    for (let iter = 0; iter < 6; iter++) {
      let bestDist = Infinity;
      let bestSeg: [Vec2, Vec2] | null = null;
      for (const s of allSegs) {
        const d = pointToSegDist(q, s[0], s[1]);
        if (d < bestDist) { bestDist = d; bestSeg = s; }
      }
      if (bestDist >= minBoundaryGap || !bestSeg) return q;
      const [a, b] = bestSeg;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-9) return q;
      const nxA = -dy / L, nyA = dx / L;
      const shift = minBoundaryGap - bestDist + 1e-2;
      const candA: Vec2 = [q[0] + nxA * shift, q[1] + nyA * shift];
      if (pointInsideSlab(candA, slab)) { q = candA; continue; }
      const candB: Vec2 = [q[0] - nxA * shift, q[1] - nyA * shift];
      if (pointInsideSlab(candB, slab)) { q = candB; continue; }
      return q;
    }
    return q;
  };
  const columnCentroids: Vec2[] = columns.map(c => nudgeInward(c.position));

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

  const centroidsUnique = dedupe(columnCentroids, 1e-4);
  const nearCentroid = (p: Vec2) =>
    centroidsUnique.some(c => Math.hypot(c[0]-p[0], c[1]-p[1]) < 1e-4);

  const tightFiltered = dedupe(colPtsTight.filter(p => !nearCentroid(p) && !onBoundarySteiner(p)), 1e-4);
  const refineFiltered = dedupe(colPtsRefine.filter(p => !nearCentroid(p) && !onBoundarySteiner(p)), 1e-4);
  const bulkFiltered = dedupe([...wallPts, ...interiorPts].filter(p => !onBoundarySteiner(p)), 1e-4);

  // Try progressively simpler Steiner sets until poly2tri succeeds.
  // poly2tri's finalization can throw (null triangle -> getConstrainedEdgeCW)
  // when a Steiner lands essentially on a constrained edge.  The column
  // centroid is whitelisted (it MUST be in the mesh as the rigid-patch
  // master) and is the hardest to drop — so centroids are always included
  // and the refine/tight/bulk tiers are stripped in order on retry.
  const tiers: Vec2[][] = [
    [...bulkFiltered, ...tightFiltered, ...refineFiltered], // full
    [...bulkFiltered, ...tightFiltered],                    // drop refine ring
    [...bulkFiltered],                                      // drop tight ring too
    [],                                                     // centroids + boundary only
  ];

  let triangles: ReturnType<InstanceType<typeof poly2tri.SweepContext>["getTriangles"]> | null = null;
  let lastErr: unknown = null;
  let winningTier = -1;
  let winningDropped = 0;
  let winningLabel = "";
  // Boundary is sacred — we never drop boundary vertices, because doing
  // so mutates the slab polygon (dropping a corner vertex can create
  // self-intersecting or collinear edges that poly2tri rejects with a
  // null-triangle crash in finalizationPolygon).  Instead, we only drop
  // Steiners that conflict with the boundary, and we trust that the
  // centroid nudge + onBoundarySteiner filter already kept the interior
  // Steiner set far enough away to be safe.
  const outerKept = outerPts;
  const holeKept = holePts;
  const allBoundary = [...outerKept, ...holeKept.flat()];

  for (let attempt = 0; attempt < tiers.length; attempt++) {
    const extras = tiers[attempt];
    const safeSteiner = [
      ...centroidsUnique,
      ...dedupeAgainst(extras, allBoundary, targetEdge * 0.3),
    ];

    try {
      const outerContour = outerKept.map(([x, y]) => new poly2tri.Point(x, y));
      const swctx = new poly2tri.SweepContext(outerContour);
      for (const h of holeKept) {
        swctx.addHole(h.map(([x, y]) => new poly2tri.Point(x, y)));
      }
      for (const p of safeSteiner) {
        swctx.addPoint(new poly2tri.Point(p[0], p[1]));
      }
      swctx.triangulate();
      triangles = swctx.getTriangles();
      const tierName = ["full", "no-refine-ring", "no-tight-ring", "centroids-only"][attempt] ?? `tier ${attempt}`;
      winningTier = attempt;
      winningLabel = tierName;
      winningDropped = tiers[0].length - extras.length;
      // eslint-disable-next-line no-console
      console.log(`[mesher] poly2tri ok at tier ${attempt} (${tierName}, ${extras.length} extras kept)`);
      break;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const label = ["full", "no-refine-ring", "no-tight-ring", "centroids-only"][attempt] ?? `tier ${attempt}`;
      // eslint-disable-next-line no-console
      console.warn(`[mesher] tier ${attempt} (${label}, ${extras.length} extras) failed: ${msg}`);
    }
  }
  if (!triangles) {
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`mesher: poly2tri failed on all retries (${msg})`);
  }

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

  // ---- Map columns to nearest nodes ----
  // Use the (possibly nudged) centroid position that we actually put in
  // the mesh, not the raw column position.  Otherwise a column whose
  // centroid got nudged inward would have its "master" pointed at a
  // different nearby node — silently disabling the rigid patch.
  const columnNodes = new Map<string, number>();
  for (let i = 0; i < columns.length; i++) {
    const target = columnCentroids[i];
    columnNodes.set(columns[i].id, nearestNode(nodes, target));
  }

  // ---- Wall nodes ----
  // Open walls: pin any node within a band of the centerline.
  // Closed walls (footprints): pin every node INSIDE the footprint —
  // without this, a thick closed wall has unpinned interior nodes and
  // the FEA treats them as compliant, inflating Vu at nearby columns.
  const wallNodes = new Set<number>();
  for (const w of walls) {
    const pts = w.points;
    const n = pts.length;
    if (w.closed && n >= 3) {
      for (let ni = 0; ni < nodes.length; ni++) {
        const p: Vec2 = [nodes[ni].x, nodes[ni].y];
        if (pointInRing(p, pts)) {
          wallNodes.add(ni);
          continue;
        }
        // Also include the thin band immediately outside so a polyline
        // drawn at the slab-wall interface still pins its edge nodes.
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          if (pointToSegDist(p, a, b) < targetEdge * 0.35) {
            wallNodes.add(ni);
            break;
          }
        }
      }
    } else {
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
  }

  // Exclude column nodes from wall set so each column is only pinned at its own column node
  for (const ci of columnNodes.values()) wallNodes.delete(ci);

  return {
    nodes,
    elements,
    columnNodes,
    wallNodes,
    quality: {
      tierUsed: winningTier,
      tierLabel: winningLabel,
      droppedSteiners: winningDropped,
    },
  };
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
