# Hanson & Hanson Visualization — Design Prompt

## Goal

Build the anchor visualization for the *Perfect Punching* project as an
**interactive 3D web page**, not a static figure. It must convince a
structural engineer that the math is right, let a non-expert understand *why*
unbalanced moments matter for punching shear, and double as the tool's
always-correct reference implementation of the Hanson & Hanson decomposition.

The page is the artifact. Static figures for the LaTeX whitepaper are
produced by screenshotting this page at deterministic view angles — so the
code that draws the whitepaper figures and the code that drives the app
viewport are the same code.

## What "Hanson & Hanson" means

Hanson, N. W., and Hanson, J. M. (1968), *Shear and Moment Transfer Between
Concrete Slabs and Columns*, PCA Journal Vol. 10 No. 1 — the paper that
introduced the $\gamma_v$ eccentric-shear formulation codified in ACI 318
§8.4.2.3. The visualization shows that the total shear stress on the critical
section is the **superposition** of two contributions:

1. **Direct shear** $V_u / (b_0 d)$ — uniform around the perimeter.
2. **Eccentric shear** $\gamma_v M_u c / J_c$ — linear, antisymmetric about
   the centroidal axis perpendicular to $M_u$.

Their sum is asymmetric: peak on the face farthest from the critical-section
centroid in the direction of $M_u$. That peak is what governs the punching
check.

## Page layout

A single scrolling page with the following regions, top to bottom:

### 1. Hero scene — single 3D viewport
Column passing through a slab; critical-section shell dashed at $d/2$
through the full slab depth; applied moment $M_u$ as a double-headed red
vector on the column. Orbit controls (drag to rotate, scroll to zoom).
Annotation labels ($\gamma_f M_u$, $\gamma_v M_u$, flexure strip $c_2+3h$)
floating in 3D space, always facing camera. Establishes the object.

### 2. Decomposition triptych — three linked 3D viewports
Three smaller scenes side by side, each showing only the critical-section
shell with arrow-based stress visualization:

- **(b) Direct shear $V_u$ alone** — uniform downward arrows on the top
  perimeter.
- **(c) Eccentric shear $\gamma_v M_u$ alone** — arrows linearly varying
  along $y$; positive-down on one side, negative-up on the other, zero at
  the centroidal axis perpendicular to $M_u$.
- **(d) Total = (b) + (c)** — arrow-wise superposition of the previous two;
  asymmetric with a clear peak.

All three scenes share a synchronized camera (rotating one rotates all) so
the eye confirms (b)+(c)=(d) is literal, not approximate.

### 3. Live controls
Below the triptych, three sliders:

- $V_u$ — direct shear magnitude.
- $|M_u|$ — unbalanced moment magnitude.
- $\theta_{M_u}$ (theta-M-u) — direction of the moment vector in the slab
  plane, 0° to 360°.

As the user drags, all four scenes update in real time. A small readout
panel shows computed $\gamma_f$, $\gamma_v$, $b_0$, $J_c$, and
$v_{u,\max}/\phi v_c$ (the DCR) for the current inputs.

### 4. Equations strip
Compact KaTeX-rendered equations next to the controls, highlighting the
terms the user is driving:

$$ M_u = \gamma_f M_u + \gamma_v M_u $$
$$ v_u(\theta) = \frac{V_u}{b_0 d} \pm \frac{\gamma_v M_u \, c}{J_c} $$

Highlight the $\gamma_v$ term when $|M_u| > 0$; highlight the direct term
always.

## Required conventions

### Geometry (editable via hidden dev controls, fixed defaults for the demo)
- Interior column, $c_1 \times c_2 = 18'' \times 18''$.
- Slab effective depth $d = 9''$.
- Critical section at $d/2$ offset: $b_1 = c_1 + d$, $b_2 = c_2 + d$.
- Perimeter $b_0 = 2(b_1 + b_2)$.

### Stress formula — source of truth for every arrow
$$ v_u(x, y) = \frac{V_u}{b_0 d} \pm \frac{\gamma_v M_{u,x}\, y}{J_{cx}}
                                  \pm \frac{\gamma_v M_{u,y}\, x}{J_{cy}} $$

with $\gamma_f = 1 / (1 + \tfrac{2}{3}\sqrt{b_1/b_2})$ and
$\gamma_v = 1 - \gamma_f$, and $J_{cx}, J_{cy}$ computed per ACI 318
§R8.4.4.2.3 for the current section geometry. No hand-drawn approximations.

### Arrow semantics
- Positive $v_u$ → arrow points downward into the slab top, length ∝ $v_u$.
- Negative $v_u$ → arrow points upward, length ∝ $|v_u|$.
- Color: single near-black for all stress arrows. Do not colorize by sign —
  direction already shows it.

### Greek letter labels
Name every Greek letter on first introduction ("$\gamma_f$ (gamma-f)",
"$\theta$ (theta)"). Applies to UI labels, tooltips, and equation
annotations.

### Camera and projection
- **Orthographic** camera for all four viewports. Perspective breaks
  arrow-length comparisons.
- Default view: isometric (elev ≈ 22°, azim ≈ -58°).
- Orbit enabled; zoom enabled; pan disabled (keeps scenes aligned).

### Visual style
- White background, near-black structure (1.0 pt equivalent).
- Dashed critical section (0.9 pt equivalent, dash pattern ~6/3 px).
- Muted accent palette: $M_u$ vector = deep red; flexure strip = muted blue
  fill at ~15% alpha; eccentric-shear label = muted green.
- No gradients, no shadows, no rainbow colormaps.
- Sans-serif UI chrome; serif or math font inside equation blocks.

## Stack

- **Framework:** Next.js 16 + TypeScript (matches Perfect Punching app stack).
- **3D:** `three` + `@react-three/fiber` + `@react-three/drei` (OrbitControls,
  Html labels, Line, Billboard).
- **Equations:** KaTeX.
- **Styling:** Tailwind; cockpit-flat aesthetic — no rounded corners on UI
  chrome, checkboxes `border-radius: 0`, buttons max `rounded-sm`.
- **Geometry math:** pure TypeScript functions, no kernel needed for this
  page (simple rectangular prisms). The perfect-punching app uses
  opencascade.js for the full tool; the H&H page is a focused subset.
- **Determinism:** any scene must be reproducible from a seed of
  $\{c_1, c_2, d, V_u, M_u, \theta_{M_u}\}$ encoded in the URL, so
  screenshots and shared links produce the same image.

## Output

- Live page deployed at `/whitepaper/hanson-hanson` in the app (or its own
  subdomain if it predates the app).
- A `screenshot` route that renders headless deterministic PNG/PDF at a
  given seed, checked in for LaTeX embed.
- Bundle budget: ≤ 150 KB gzipped JS for this page (three + r3f included).
  WASM kernel is not loaded here.

## Non-negotiables

- Every arrow's length is computed from the ACI 318 formula with the
  current state. No approximations, no hand-tuned constants.
- Panel (d) arrows equal panel (b) arrows plus panel (c) arrows, point by
  point, for every $(V_u, M_u, \theta_{M_u})$ the user can produce.
- Performance: sliders feel live (≥ 30 fps) on a 5-year-old laptop.
- Accessible: keyboard-controllable sliders, readable at 200% browser zoom,
  color choices not dependent on hue discrimination alone.

## What to avoid

- Colormap heatmaps on the critical-section surface. Hanson & Hanson is an
  arrow-based decomposition; colormap hides the superposition insight.
- Perspective projection. Breaks the literal $(b)+(c)=(d)$ reading.
- Over-stylized UI chrome. This is an engineering tool; readability over
  flourish.
- Auto-rotation, breathing animations, parallax. Nothing should move that
  the user did not cause.
- Overloading the hero scene with $C_1/C_2/T_1/T_2$ column-face stress
  labels, reinforcement, rebar detailing, etc. One moment, two transfer
  paths.

## Success criterion

A structural engineer opens the page and within five seconds can:

1. See the column transferring a moment into the slab.
2. Drag $|M_u|$ up and watch the right side of the critical-section
   stress pattern bloom while the left side goes slack — confirming the
   eccentric-shear model with their own hand.
3. Rotate $\theta_{M_u}$ and see the peak walk around the perimeter.
4. Grab the URL, paste it anywhere, and reproduce the exact view.

No other page in the project needs to explain this concept.
