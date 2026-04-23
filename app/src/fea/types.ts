/**
 * Plate FEA internal types.
 *
 * Convention (Batoz 1980 / right-hand rule):
 *   w(x,y) out-of-plane displacement. Positive w is downward, matching
 *          the sign of an applied downward pressure q.
 *   theta_x = -dw/dy   (rotation about x-axis)
 *   theta_y = +dw/dx   (rotation about y-axis)
 *
 * Nodal DOF order: [w, theta_x, theta_y].
 * Global DOF index for node i: 3*i + [0|1|2].
 */

export interface FEANode {
  x: number;  // in
  y: number;  // in
}

export interface FEAElement {
  /** Node indices, CCW. */
  n: [number, number, number];
  /** Signed area (positive for CCW). */
  area: number;
}

export interface FEAMeshQuality {
  /** poly2tri retry tier that succeeded. 0 = full Steiner set, 3 = boundary+centroids only. */
  tierUsed: number;
  /** Human-readable label of the tier that won. */
  tierLabel: string;
  /** Count of Steiner points dropped relative to tier 0's full set. */
  droppedSteiners: number;
}

export interface FEAMesh {
  nodes: FEANode[];
  elements: FEAElement[];
  /** Column id -> node index it was welded to. */
  columnNodes: Map<string, number>;
  /** Set of node indices that are wall-supported (pinned in w). */
  wallNodes: Set<number>;
  /** Quality info from the triangulation retry ladder. */
  quality: FEAMeshQuality;
}

export interface FEAMaterial {
  /** Young's modulus, psi. */
  E: number;
  /** Poisson's ratio. */
  nu: number;
  /** Plate thickness (in). */
  h: number;
}

/** Rotational springs per column (about each principal axis), lb-in/rad. */
export interface FEAColumnSpring {
  id: string;
  nodeIndex: number;
  /** Spring about the global x-axis, resists theta_x. */
  kAboutX: number;
  /** Spring about the global y-axis, resists theta_y. */
  kAboutY: number;
}

export interface FEAResult {
  /** Global nodal displacement vector, length 3*nodes.length. */
  u: Float64Array;
  /** Per-column reactions and transferred moments. */
  columns: Map<string, {
    /** Vertical reaction at the column node, lb. Positive upward. */
    Vu: number;
    /** Unbalanced moment transferred to column about the global X-axis, lb-in. */
    muAboutX: number;
    /** About the global Y-axis, lb-in. */
    muAboutY: number;
    /** Deflection at the column node, in. */
    wAtCol: number;
  }>;
  /** Diagnostics. */
  diagnostics: {
    nNodes: number;
    nElements: number;
    nDOF: number;
    nConstrained: number;
    cgIterations: number;
    residualNorm: number;
    equilibriumError: number; // |sum(reactions) - total load| / total load
  };
}

/** Sparse matrix in CSR-like triplet form for assembly. */
export interface Triplet {
  i: number;
  j: number;
  v: number;
}
