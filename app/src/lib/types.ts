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
  /** DXF layer this slab was ingested from. */
  layer?: string;
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
  /** DXF layer this column was ingested from. */
  layer?: string;
}

export interface Wall {
  id: string;
  /** Polyline points. */
  points: Vec2[];
  closed?: boolean;
  /** DXF layer this wall was ingested from. */
  layer?: string;
}

/** Per-project material/load inputs. */
export interface ProjectInputs {
  fcPsi: number;     // f'_c specified concrete strength
  hIn: number;       // slab thickness
  dIn: number;       // effective depth (h - cover)
  /** Superimposed dead load (psf). Slab self-weight is added automatically from hIn × concreteUnitWeightPcf. */
  deadPsf: number;
  livePsf: number;   // live load
  /** Concrete unit weight (pcf) used to compute slab self-weight. Default 150 (normal-weight). Set 0 to disable self-weight. */
  concreteUnitWeightPcf?: number;
  /** Deprecated: column dims now come from ingested footprints (POLYLINE bboxes) or a 12" placeholder for POINT-based columns. Kept for back-compat only. */
  defaultC1?: number;
  defaultC2?: number;
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
  /**
   * Combined ACI-consistent design assumption: (1) γf auto-boosts per
   * Table 8.4.2.2.4 where the direct-shear gate passes, and (2) the
   * 0.3·Mo DDM floor is enforced on |Mu| per column per axis.  User
   * attests column-strip rebar is tension-controlled per §8.4.2.2.5
   * when this is enabled.  Defaults to `true`.
   */
  applyAciDesignAssumptions?: boolean;
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
  /** 0.3·Mo floor applied to |mu2|? Diagnostic only — the stored mu2 already reflects the floor. */
  mu2FloorApplied?: boolean;
  /** 0.3·Mo floor applied to |mu3|? */
  mu3FloorApplied?: boolean;
  /** 0.3·Mo floor value used for mu2 (lb-in). */
  mu2FloorValue?: number;
  /** 0.3·Mo floor value used for mu3 (lb-in). */
  mu3FloorValue?: number;
}
