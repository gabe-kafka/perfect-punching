/**
 * Plate FEA internal types.
 *
 * Convention (Batoz 1980):
 *   w(x,y) out-of-plane displacement (positive up, consistent with
 *          "applied downward pressure q produces +w downward => we use
 *          q as positive downward and w as positive downward").
 *   theta_x ≈ ∂w/∂x (rotation of normal about y-axis, in Batoz notation beta_x)
 *   theta_y ≈ ∂w/∂y (rotation of normal about x-axis, in Batoz notation beta_y)
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

export interface FEAMesh {
  nodes: FEANode[];
  elements: FEAElement[];
  /** Column id -> node index it was welded to. */
  columnNodes: Map<string, number>;
  /** Set of node indices that are wall-supported (pinned in w). */
  wallNodes: Set<number>;
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
  /** Spring about the global x-axis (resists theta_y). */
  kAboutX: number;
  /** Spring about the global y-axis (resists theta_x). */
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
