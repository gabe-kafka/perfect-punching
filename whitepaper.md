# Perfect Punching — Physics White Paper

## The problem

A two-way concrete plate slab bears on columns. At each column, two demands act at the slab–column interface:

1. **Direct shear** $V_u$ — the vertical reaction.
2. **Unbalanced moment** $M_u$ — the moment the slab cannot distribute evenly between opposite column strips, transferred into the column.

$M_u$ arises whenever spans, loads, or stiffnesses are asymmetric across the column. Even "symmetric" layouts produce $M_u$ under pattern live loads.

## Moment transfer split

The unbalanced moment transfers to the column by two mechanisms (ACI 318 §8.4.2.3):

$$ M_u = M_f + M_v $$

- $M_f = \gamma_f \, M_u$ — by **flexure** across an effective strip ($c_2 + 3h$).
- $M_v = \gamma_v \, M_u$ — by **eccentricity of shear** on the critical section.

$$ \gamma_f = \frac{1}{1 + \tfrac{2}{3}\sqrt{b_1/b_2}}, \qquad \gamma_v = 1 - \gamma_f $$

$b_1$ = critical-section dimension parallel to the moment span; $b_2$ = perpendicular dimension.

$M_v$ is what makes punching a **two-way shear** problem, not a one-way beam problem.

## Critical section

A surface offset by $d/2$ from the column face, through the full slab depth $d$ (effective depth). Perimeter $b_0$ closes around interior columns but **truncates** at slab edges, reentrant corners, and openings within $4h$ of the column (§22.6.4.3). Perimeter length and centroid shift accordingly — this is why robust 3D geometry matters.

## Combined shear stress

On the critical section, under $V_u + M_v$:

$$ v_u(\theta) = \frac{V_u}{b_0\,d} \pm \frac{\gamma_v\, M_u\, c}{J_c} $$

- $c$ = distance from the critical-section centroid to the point of interest.
- $J_c$ = polar moment of inertia of the critical section about its centroid (§R8.4.4.2.3).

$v_u$ peaks at the face furthest from the centroid in the direction of $M_u$. For edge/corner columns, the centroid shifts away from the free edge, amplifying the peak stress.

## Capacity

Two-way shear strength without shear reinforcement (§22.6.5.2):

$$ \phi v_c = \phi \cdot \lambda_s\, \lambda\, \min\!\left(4\sqrt{f'_c},\ (2+\tfrac{4}{\beta})\sqrt{f'_c},\ (\alpha_s\tfrac{d}{b_0}+2)\sqrt{f'_c}\right) $$

- $\beta$ = long/short column dimension ratio.
- $\alpha_s$ = 40 (interior), 30 (edge), 20 (corner).
- $\lambda_s$ = size-effect factor.
- Units: psi with $f'_c$ in psi.

## Demand-to-capacity ratio

$$ \text{DCR} = \frac{v_{u,\max}}{\phi v_c} $$

Governing when $\text{DCR} > 1.0$. Designer responses: thicken slab, add drop panel/shear cap, add shear reinforcement (studs), enlarge column.

## What Perfect Punching computes, in order

1. **Slab + columns + loads** → geometry and load pattern in.
2. **Plate-bending analysis** → $V_u$, $M_u$ per column. (Method TBD: EFM for regular layouts, FEA for general.)
3. **Critical section** → 3D offset shell from each column face, truncated by slab boundary via B-rep Booleans (opencascade.js).
4. **Geometric properties** → $b_0$, $c$, $J_c$ from the truncated section — accurate, not mesh-approximated.
5. **Stress distribution** $v_u(\theta)$ → rendered as a gradient on the critical-section surface.
6. **Capacity** $\phi v_c$ → ACI 318 §22.6.5 per column.
7. **DCR** → color-coded in the 3D viewport; numerical results table.

## Why the geometry kernel matters here

$b_0$, $c$, and $J_c$ all come from integrals over the critical-section surface. If the section is truncated (edge/corner/opening), those integrals run over a B-rep Boolean result. Mesh-based CSG gives visually acceptable but numerically wrong perimeters and centroids at the exact places — reentrant corners, sliver edges — where punching is most critical. OCCT's exact B-rep makes the capacity calculation as accurate as the code equation itself allows.

## References

- ACI 318-19, Chapter 22 §§ 8.4.2, 22.6.
- MacGregor & Wight, *Reinforced Concrete: Mechanics and Design*, Ch. 13.
- Nilson, Darwin, Dolan, *Design of Concrete Structures*, Ch. 13.
