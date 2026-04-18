/**
 * ACI 318 §8.4.2.3 / R8.4.4.2.3 math for the Hanson & Hanson (1968)
 * eccentric-shear decomposition.
 *
 * Units: inches, pounds, pound-inches, psi.
 *
 * Convention:
 *   - The slab lies horizontally in the x-y plane.
 *   - z is "up", with the top of the slab at z = 0 and the bottom at z = -h.
 *   - The column passes vertically through the slab along the z axis.
 *   - The critical section is a rectangular prismatic shell offset d/2 from
 *     each column face, extending through the full slab depth.
 *   - Moment vector M_u lies in the slab plane (x-y) at angle theta from +x.
 *   - b1 refers to the section side parallel to x; b2 parallel to y.
 */

export interface Geometry {
  c1: number;  // column side parallel to x (in)
  c2: number;  // column side parallel to y (in)
  h:  number;  // total slab thickness (in)
  d:  number;  // effective slab depth (in)
}

export const b1 = (g: Geometry) => g.c1 + g.d;
export const b2 = (g: Geometry) => g.c2 + g.d;
export const b0 = (g: Geometry) => 2 * (b1(g) + b2(g));

/** Generic γf for span/b1 along a side of length B1, b2 along a side of length B2. */
function gammaF_(B1: number, B2: number): number {
  return 1 / (1 + (2 / 3) * Math.sqrt(B1 / B2));
}

/** γf (gamma-f) when the moment spans in the x-direction (b1 parallel to span). */
export const gammaFSpanX = (g: Geometry) => gammaF_(b1(g), b2(g));
/** γv (gamma-v) when the moment spans in the x-direction. */
export const gammaVSpanX = (g: Geometry) => 1 - gammaFSpanX(g);

/** γf when the moment spans in the y-direction. */
export const gammaFSpanY = (g: Geometry) => gammaF_(b2(g), b1(g));
export const gammaVSpanY = (g: Geometry) => 1 - gammaFSpanY(g);

/**
 * Jc for bending with the moment span along x (stresses vary with x).
 * Interior rectangular column, per ACI 318 R8.4.4.2.3 form:
 *
 *   Jc = (d·B1³)/6  +  (B1·d³)/6  +  (B2·d·B1²)/2
 */
export function jcSpanX(g: Geometry): number {
  const B1 = b1(g), B2 = b2(g), D = g.d;
  return (D * B1 ** 3) / 6 + (B1 * D ** 3) / 6 + (B2 * D * B1 ** 2) / 2;
}

/** Jc for bending with the moment span along y. */
export function jcSpanY(g: Geometry): number {
  const B1 = b1(g), B2 = b2(g), D = g.d;
  return (D * B2 ** 3) / 6 + (B2 * D ** 3) / 6 + (B1 * D * B2 ** 2) / 2;
}

/**
 * Combined shear stress v_u at point (x, y) on the critical-section perimeter.
 * M_u is applied at angle theta in the slab plane; decomposed into components
 * along x and y, each contributing independently with its own γv and Jc.
 *
 *   v_u = V_u/(b0·d)
 *       + γv_x · (M_u cos θ) · x / Jc_span_x
 *       + γv_y · (M_u sin θ) · y / Jc_span_y
 */
export function stressAt(
  x: number, y: number,
  vu: number, mu: number, theta: number,
  g: Geometry,
): number {
  const direct = vu / (b0(g) * g.d);
  const Mx = mu * Math.cos(theta);
  const My = mu * Math.sin(theta);
  const eccX = (gammaVSpanX(g) * Mx * x) / jcSpanX(g);
  const eccY = (gammaVSpanY(g) * My * y) / jcSpanY(g);
  return direct + eccX + eccY;
}

/** Evenly spaced midpoints around the top perimeter of the critical section. */
export function perimeterSamples(
  g: Geometry, nPerSide = 9,
): Array<[number, number]> {
  const B1 = b1(g), B2 = b2(g);
  const xs = Array.from({ length: nPerSide }, (_, i) =>
    -B1 / 2 + ((i + 0.5) * B1) / nPerSide);
  const ys = Array.from({ length: nPerSide }, (_, i) =>
    -B2 / 2 + ((i + 0.5) * B2) / nPerSide);
  const pts: Array<[number, number]> = [];
  for (const x of xs)                 pts.push([x, -B2 / 2]);
  for (const y of ys)                 pts.push([+B1 / 2, y]);
  for (const x of [...xs].reverse())  pts.push([x, +B2 / 2]);
  for (const y of [...ys].reverse())  pts.push([-B1 / 2, y]);
  return pts;
}

/** Peak |v_u| on the perimeter for given demands and geometry. */
export function peakStress(
  vu: number, mu: number, theta: number, g: Geometry,
): number {
  const pts = perimeterSamples(g, 40);
  let peak = 0;
  for (const [x, y] of pts) {
    const v = stressAt(x, y, vu, mu, theta, g);
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  return peak;
}

/**
 * Two-way shear capacity φ·v_c per ACI 318 §22.6.5.2
 * (no shear reinforcement, normal-weight concrete, λ = λ_s = 1). Returns psi.
 */
export function phiVc(
  g: Geometry, fcPsi = 4000, phi = 0.75, alphaS = 40,
): number {
  const beta = Math.max(g.c1, g.c2) / Math.min(g.c1, g.c2);
  const sq = Math.sqrt(fcPsi);
  const t1 = 4 * sq;
  const t2 = (2 + 4 / beta) * sq;
  const t3 = (alphaS * g.d / b0(g) + 2) * sq;
  return phi * Math.min(t1, t2, t3);
}

/** Demand/capacity ratio: v_u,max / φ·v_c. */
export function dcr(
  vu: number, mu: number, theta: number, g: Geometry,
): number {
  return peakStress(vu, mu, theta, g) / phiVc(g);
}
