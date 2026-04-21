/** All distances in inches. */

export type Vec2 = [number, number];

/** Closed polygon ring, no closing duplicate. */
export type Ring = Vec2[];

/** Polygon with optional interior holes (openings). */
export interface Polygon {
  outer: Ring;
  holes?: Ring[];
}

export interface Slab {
  id: string;
  polygon: Polygon;
  /** Floor label this slab belongs to (e.g., "12", "ROOF"). */
  floor?: string;
}

export type ColumnType = "interior" | "edge" | "corner";

export interface Column {
  id: string;
  /** Centroid in DXF coords (inches). */
  position: Vec2;
  /** Rectangular footprint sides (inches). */
  c1: number;
  c2: number;
  /** Computed after classification. */
  type?: ColumnType;
  /** Tributary area (in²) — assigned at analysis time. */
  tributaryArea?: number;
  /** Floor this column belongs to. */
  floor?: string;
}

export interface Wall {
  id: string;
  /** Polyline points. */
  points: Vec2[];
  closed?: boolean;
}

/** Per-project material/load inputs. */
export interface ProjectInputs {
  fcPsi: number;     // f'_c specified concrete strength
  hIn: number;       // slab thickness
  dIn: number;       // effective depth (h - cover)
  deadPsf: number;   // dead load (excludes self-weight; we add)
  livePsf: number;   // live load
  defaultC1: number; // default column dim if DXF lacks size
  defaultC2: number;
  /** Phi reduction factor (default 0.75). */
  phi: number;
  /**
   * Concrete shear strength reduction factor applied to f'_c inside the
   * two-way shear capacity equation: vc = 4 * sqrt(fcs * f'_c).
   * Default 1.0 (ACI 318 direct). Set 0.8 to match SAFE's internal default.
   */
  fcsFactor?: number;
  /** Column height (in), used for rotational-spring stiffness. Default 144 (12 ft). */
  columnHeightIn?: number;
  /** Column end fixity at the far end: "fixed" (4EI/L) or "pinned" (3EI/L). Default "fixed". */
  columnFarEndFixity?: "fixed" | "pinned";
  /** Concrete Poisson's ratio. Default 0.2. */
  concreteNu?: number;
  /** FEA mesh target edge length (in). If omitted, derived from d and column spacing. */
  meshTargetEdgeIn?: number;
}

export interface ColumnResult {
  columnId: string;
  type: ColumnType;
  tributaryAreaIn2: number;
  /** lb */
  vu: number;
  /** lb-in — resultant of (mu2, mu3). Kept for legacy table rendering. */
  mu: number;
  /** lb-in — about local 2 axis (about X for un-rotated column). */
  mu2: number;
  /** lb-in — about local 3 axis (about Y for un-rotated column). */
  mu3: number;
  b0: number;
  /** Legacy single-axis value: Jc about the 3-axis. */
  jc: number;
  /** Polar moment of inertia of critical section about each axis. */
  jc2: number;
  jc3: number;
  vuMaxPsi: number;
  phiVcPsi: number;
  dcr: number;
}
