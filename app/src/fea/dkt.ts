/**
 * Discrete Kirchhoff Triangle (DKT) plate-bending element stiffness.
 *
 * Reference: Batoz, Bathe, Ho (1980), "A study of three-node triangular plate
 * bending elements", IJNME 15(12), 1771-1812. Section 3.
 *
 * DOF order per node: [w, theta_x, theta_y] with
 *   theta_x = -d w/dy   (rotation about x-axis, right-hand rule)
 *   theta_y = +d w/dx   (rotation about y-axis, right-hand rule)
 * Element DOFs: [w1,tx1,ty1, w2,tx2,ty2, w3,tx3,ty3].
 *
 * Under this convention, rigid-body modes are:
 *   w = 1           -> u_i = [1, 0, 0]
 *   w = y           -> u_i = [y_i, -1, 0]   (theta_x = -dw/dy = -1)
 *   w = x           -> u_i = [x_i, 0, +1]   (theta_y = +dw/dx = +1)
 *
 * Derivation of mid-edge shape functions (used for the Kirchhoff constraint):
 *   Along edge from node i to node j of length L, w is Hermite-cubic with
 *   end values w_i, w_j and tangential slopes beta_s_i, beta_s_j. Evaluating
 *   dw/ds at the midpoint gives
 *       beta_s_mid = (1.5 / L)(w_j - w_i) - 0.25 (beta_s_i + beta_s_j)
 *   beta_n at the midpoint is the linear average 0.5(beta_n_i + beta_n_j).
 *   Converting back to (beta_x, beta_y) via the edge tangent/normal yields
 *   the Hx/Hy coefficients below. In particular:
 *       coef of w_i in Hx via N_k = +1.5 * a_k          (a_k = -x_ij / L_k^2)
 *       coef of w_j in Hx via N_k = -1.5 * a_k
 *       coef of w_i in Hy via N_k = +1.5 * d_k          (d_k = -y_ij / L_k^2)
 *       coef of w_j in Hy via N_k = -1.5 * d_k
 *
 * Curvature = B · U with
 *   kappa_xx = d beta_x / dx          -> B row 0
 *   kappa_yy = d beta_y / dy          -> B row 1
 *   2 kappa_xy = d beta_x / dy + d beta_y / dx  -> B row 2
 *
 * Bending moment / curvature matrix (Db):
 *   [[D, D nu, 0], [D nu, D, 0], [0, 0, D (1-nu)/2]]   D = E h^3 / (12 (1-nu^2))
 *
 * Ke = integral over element of (B^T Db B) dA, evaluated by 3-point Gauss
 * at the mid-edges of the reference triangle (exact for the quadratic BtDB).
 */

export interface DktCoeffs {
  /** Edge parameters indexed by 4,5,6 (edges 12, 23, 31). */
  a: [number, number, number];  // a4, a5, a6
  b: [number, number, number];
  c: [number, number, number];
  d: [number, number, number];
  e: [number, number, number];
  /** Nodal coordinate differences x21, y21 etc. */
  x21: number; y21: number;
  x32: number; y32: number;
  x13: number; y13: number;
  twoA: number;
}

/** Compute per-edge DKT coefficients. */
export function dktCoeffs(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
): DktCoeffs {
  const x21 = x2 - x1, y21 = y2 - y1;
  const x32 = x3 - x2, y32 = y3 - y2;
  const x13 = x1 - x3, y13 = y1 - y3;
  const twoA = x21 * (-y13) - (-x13) * y21; // = x21*y31 - x31*y21

  // Edge k spans node (k-4+1) to ((k-4+1) mod 3 + 1).
  // Edge 4 = 1->2, Edge 5 = 2->3, Edge 6 = 3->1.
  // Batoz uses xij = xj-xi; so for edge 4 (1->2), xij = x21, yij = y21. Etc.
  const edges: [number, number][] = [
    [x21, y21],  // edge 4 (1-2)
    [x32, y32],  // edge 5 (2-3)
    [x13, y13],  // edge 6 (3-1)
  ];

  const a = [0, 0, 0] as [number, number, number];
  const b = [0, 0, 0] as [number, number, number];
  const c = [0, 0, 0] as [number, number, number];
  const d = [0, 0, 0] as [number, number, number];
  const e = [0, 0, 0] as [number, number, number];
  for (let k = 0; k < 3; k++) {
    const [xij, yij] = edges[k];
    const L2 = xij * xij + yij * yij;
    a[k] = -xij / L2;
    b[k] = 0.75 * xij * yij / L2;
    c[k] = (xij * xij / 4 - yij * yij / 2) / L2;
    d[k] = -yij / L2;
    e[k] = (yij * yij / 4 - xij * xij / 2) / L2;
  }

  return { a, b, c, d, e, x21, y21, x32, y32, x13, y13, twoA };
}

/**
 * Evaluate the 9-long Hx vector (beta_x shape functions) at area-coordinates
 * (xi1, xi2, xi3 = 1-xi1-xi2). Index k in [0,2] of a/b/c/d/e corresponds to
 * edges 4,5,6.
 */
function hxValues(xi1: number, xi2: number, xi3: number, C: DktCoeffs): number[] {
  const N1 = xi1 * (2 * xi1 - 1);
  const N2 = xi2 * (2 * xi2 - 1);
  const N3 = xi3 * (2 * xi3 - 1);
  const N4 = 4 * xi1 * xi2;       // edge 4 (1-2)
  const N5 = 4 * xi2 * xi3;       // edge 5 (2-3)
  const N6 = 4 * xi3 * xi1;       // edge 6 (3-1)

  const [a4, a5, a6] = C.a;
  const [b4, b5, b6] = C.b;
  const [c4, c5, c6] = C.c;

  return [
    1.5 * (a4 * N4 - a6 * N6),                  // Hx1 (node 1, w)    sign-flipped from original
    b6 * N6 + b4 * N4,                          // Hx2 (node 1, theta_x)
    N1 - c6 * N6 - c4 * N4,                     // Hx3 (node 1, theta_y)
    1.5 * (a5 * N5 - a4 * N4),                  // Hx4 (node 2, w)    sign-flipped
    b4 * N4 + b5 * N5,                          // Hx5 (node 2, theta_x)
    N2 - c4 * N4 - c5 * N5,                     // Hx6 (node 2, theta_y)
    1.5 * (a6 * N6 - a5 * N5),                  // Hx7 (node 3, w)    sign-flipped
    b5 * N5 + b6 * N6,                          // Hx8 (node 3, theta_x)
    N3 - c5 * N5 - c6 * N6,                     // Hx9 (node 3, theta_y)
  ];
}

function hyValues(xi1: number, xi2: number, xi3: number, C: DktCoeffs): number[] {
  const N1 = xi1 * (2 * xi1 - 1);
  const N2 = xi2 * (2 * xi2 - 1);
  const N3 = xi3 * (2 * xi3 - 1);
  const N4 = 4 * xi1 * xi2;
  const N5 = 4 * xi2 * xi3;
  const N6 = 4 * xi3 * xi1;

  const [b4, b5, b6] = C.b;
  const [d4, d5, d6] = C.d;
  const [e4, e5, e6] = C.e;

  return [
    1.5 * (d4 * N4 - d6 * N6),                  // Hy1 (node 1, w)    sign-flipped
    -N1 + e6 * N6 + e4 * N4,
    -b6 * N6 - b4 * N4,
    1.5 * (d5 * N5 - d4 * N4),                  // Hy4 (node 2, w)    sign-flipped
    -N2 + e4 * N4 + e5 * N5,
    -b4 * N4 - b5 * N5,
    1.5 * (d6 * N6 - d5 * N5),                  // Hy7 (node 3, w)    sign-flipped
    -N3 + e5 * N5 + e6 * N6,
    -b5 * N5 - b6 * N6,
  ];
}

/**
 * Partial derivatives of the area-coordinate shape functions N1..N6 w.r.t.
 * xi1, xi2, xi3, treated as independent variables.
 * Returns 3 length-6 arrays: dN/dxi1, dN/dxi2, dN/dxi3.
 */
function dNdXi(xi1: number, xi2: number, xi3: number) {
  return {
    d1: [
      4 * xi1 - 1,  // N1
      0,            // N2
      0,            // N3
      4 * xi2,      // N4
      0,            // N5
      4 * xi3,      // N6
    ],
    d2: [
      0,
      4 * xi2 - 1,
      0,
      4 * xi1,
      4 * xi3,
      0,
    ],
    d3: [
      0,
      0,
      4 * xi3 - 1,
      0,
      4 * xi2,
      4 * xi1,
    ],
  };
}

/**
 * Return B matrix (3 x 9) evaluated at (xi1, xi2, xi3) for the triangle
 * described by coefficients C.
 *
 * B rows:
 *   0: d beta_x / dx
 *   1: d beta_y / dy
 *   2: d beta_x / dy + d beta_y / dx
 */
export function bMatrix(
  xi1: number, xi2: number, xi3: number, C: DktCoeffs,
): number[][] {
  // Derivatives of area coords w.r.t. x, y:
  //   d xi1 / dx = y23 / 2A,  d xi2 / dx = y31 / 2A,  d xi3 / dx = y12 / 2A
  //   d xi1 / dy = x32 / 2A,  d xi2 / dy = x13 / 2A,  d xi3 / dy = x21 / 2A
  // Note y23 = -y32, x32 = -x23 etc. Our coeffs hold x21, y21, x32, y32, x13, y13.
  const y23 = -C.y32;
  const y31 = -C.y13;
  const y12 = -C.y21;
  const x32 = C.x32;
  const x13 = C.x13;
  const x21 = C.x21;
  const twoA = C.twoA;

  // dN/dxi_k for k = 1, 2, 3
  const { d1, d2, d3 } = dNdXi(xi1, xi2, xi3);

  // For each of Hx and Hy: compute d/dxi_k as a linear combination of N derivatives.
  // Helpers to extract the coefficient of each N_i in a given Hx_dof / Hy_dof.
  // We provide explicit expressions to keep this fast and transparent.
  const [a4, a5, a6] = C.a;
  const [b4, b5, b6] = C.b;
  const [c4, c5, c6] = C.c;
  const [d4_, d5_, d6_] = C.d;
  const [e4, e5, e6] = C.e;

  // Matrix of N-coefficients per DOF for Hx (9 rows x 6 cols for N1..N6):
  // Row order matches element DOFs [w1,tx1,ty1,w2,tx2,ty2,w3,tx3,ty3].
  // Rows 0, 3, 6 below are the w-DOF rows. Their signs on the N4/N5/N6
  // columns were flipped relative to an earlier transcription; see the
  // Hermite-cubic derivation in the file header for why.
  const HxCoef: number[][] = [
    [ 0,      0,      0,   1.5*a4,  0, -1.5*a6 ],  // Hx1 (w1)
    [ 0,      0,      0,   b4,      0,  b6     ],  // Hx2
    [ 1,      0,      0,  -c4,      0, -c6     ],  // Hx3
    [ 0,      0,      0,  -1.5*a4,  1.5*a5, 0  ],  // Hx4 (w2)
    [ 0,      0,      0,   b4,      b5,     0  ],  // Hx5
    [ 0,      1,      0,  -c4,     -c5,     0  ],  // Hx6
    [ 0,      0,      0,   0,      -1.5*a5, 1.5*a6 ], // Hx7 (w3)
    [ 0,      0,      0,   0,       b5,      b6     ], // Hx8
    [ 0,      0,      1,   0,      -c5,     -c6     ], // Hx9
  ];
  const HyCoef: number[][] = [
    [ 0,      0,      0,   1.5*d4_, 0, -1.5*d6_ ],  // Hy1 (w1)
    [ -1,     0,      0,   e4,      0,  e6      ],
    [ 0,      0,      0,  -b4,      0, -b6      ],
    [ 0,      0,      0,  -1.5*d4_, 1.5*d5_, 0  ],  // Hy4 (w2)
    [ 0,     -1,      0,   e4,      e5,     0   ],
    [ 0,      0,      0,  -b4,     -b5,     0   ],
    [ 0,      0,      0,   0,      -1.5*d5_, 1.5*d6_ ],  // Hy7 (w3)
    [ 0,      0,     -1,   0,       e5,      e6      ],
    [ 0,      0,      0,   0,      -b5,     -b6      ],
  ];

  const B: number[][] = [new Array(9).fill(0), new Array(9).fill(0), new Array(9).fill(0)];

  for (let dof = 0; dof < 9; dof++) {
    // d Hx / dxi_k
    const Hx1 = dot(HxCoef[dof], d1);
    const Hx2 = dot(HxCoef[dof], d2);
    const Hx3 = dot(HxCoef[dof], d3);
    // d Hy / dxi_k
    const Hy1 = dot(HyCoef[dof], d1);
    const Hy2 = dot(HyCoef[dof], d2);
    const Hy3 = dot(HyCoef[dof], d3);

    // Chain-rule to global (x, y):
    const Hx_x = (Hx1 * y23 + Hx2 * y31 + Hx3 * y12) / twoA;
    const Hx_y = (Hx1 * x32 + Hx2 * x13 + Hx3 * x21) / twoA;
    const Hy_x = (Hy1 * y23 + Hy2 * y31 + Hy3 * y12) / twoA;
    const Hy_y = (Hy1 * x32 + Hy2 * x13 + Hy3 * x21) / twoA;

    B[0][dof] = Hx_x;
    B[1][dof] = Hy_y;
    B[2][dof] = Hx_y + Hy_x;
  }

  return B;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * 9x9 DKT element stiffness matrix.
 *
 * @param x1,y1,x2,y2,x3,y3  nodal coordinates (CCW assumed)
 * @param D   flexural rigidity E h^3 / (12 (1-nu^2)), in lb-in
 * @param nu  Poisson's ratio
 */
export function keDKT(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  D: number, nu: number,
): number[][] {
  const C = dktCoeffs(x1, y1, x2, y2, x3, y3);
  const A = Math.abs(C.twoA) / 2;

  // Db = D * [[1 nu 0],[nu 1 0],[0 0 (1-nu)/2]]
  const Db = [
    [D, D * nu, 0],
    [D * nu, D, 0],
    [0, 0, D * (1 - nu) / 2],
  ];

  // 3-point Gauss at mid-edges of reference triangle, each weight A/3.
  const gp: [number, number, number][] = [
    [0.5, 0.5, 0],
    [0, 0.5, 0.5],
    [0.5, 0, 0.5],
  ];
  const w = A / 3;

  const Ke: number[][] = [];
  for (let i = 0; i < 9; i++) Ke.push(new Array(9).fill(0));

  for (const [xi1, xi2, xi3] of gp) {
    const B = bMatrix(xi1, xi2, xi3, C);
    // DB = Db * B (3 x 9)
    const DB: number[][] = [new Array(9).fill(0), new Array(9).fill(0), new Array(9).fill(0)];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 9; c++) {
        DB[r][c] = Db[r][0] * B[0][c] + Db[r][1] * B[1][c] + Db[r][2] * B[2][c];
      }
    }
    // Ke += w * B^T * DB
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        Ke[i][j] += w * (B[0][i] * DB[0][j] + B[1][i] * DB[1][j] + B[2][i] * DB[2][j]);
      }
    }
  }

  return Ke;
}
