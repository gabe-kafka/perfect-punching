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
}

export interface ColumnResult {
  columnId: string;
  type: ColumnType;
  tributaryAreaIn2: number;
  /** lb */
  vu: number;
  /** lb-in */
  mu: number;
  b0: number;
  jc: number;
  vuMaxPsi: number;
  phiVcPsi: number;
  dcr: number;
}
