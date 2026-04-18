# Perfect Punching — PRD

## Problem

Structural engineers designing two-way concrete plate slabs must verify **punching shear** capacity at every column. The governing quantity is the **unbalanced moment** transferred between slab and column, which amplifies the shear stress around the critical section. Today this is done by hand, in spreadsheets, or inside expensive desktop software (SAFE, RAM Concept). There is no focused, browser-native tool that accepts arbitrary slab geometry and outputs the unbalanced moment → punching demand → capacity check pipeline with clear, inspectable visuals.

## Goal

A browser-native tool that, given any two-way plate slab geometry and column layout, computes the unbalanced moments transferred to each column and performs a code-compliant punching shear check. The 3D visualization must be first-class, so the engineer can see the slab, columns, critical sections, and utilization at a glance.

## Non-goals (v1)

- Full FEA of the slab (no plate-bending solver initially; use simplified methods).
- Beam-slab systems, drop panels, post-tensioning (later versions).
- Reinforcement detailing, rebar placement.
- Production BIM import (Revit, IFC) — v1 accepts simplified geometry input.
- Multi-user collaboration.

## Users

- **Primary:** structural engineers sizing concrete floor slabs.
- **Secondary:** students and educators learning punching shear behavior visually.

## Success criteria

1. User can define (or import) a slab with columns in under 2 minutes.
2. Tool reports unbalanced moment Mᵤ at each column within ±5% of a hand-calc benchmark.
3. Tool reports punching shear DCR (demand/capacity ratio) per ACI 318 §22.6 for each column.
4. 3D viewport shows slab, columns, critical sections, and color-coded DCR in real time.
5. Runs entirely in the browser (no backend required for v1).

## Scope — v1

### Step 1 — Unbalanced moments at columns

The centerpiece of v1. Given:
- Slab outline (2D polygon, plus thickness)
- Column positions + cross-section (rect or circular)
- Load pattern (uniform dead + live initially)
- Support conditions (interior / edge / corner columns auto-classified by geometry)

Compute the unbalanced moment Mᵤ transferred to each column. Method options (decide one for v1):
- **Direct Design Method** (ACI 318 §8.10) — simplest, restrictive geometry requirements.
- **Equivalent Frame Method** (ACI 318 §8.11) — more general, handles irregular layouts.
- **Coefficient method** for regular grids as a quick check.

Preferred for v1: **Equivalent Frame Method**, since it handles irregular geometry — which is exactly where users will want a tool.

### Step 2 — Punching shear check

Per ACI 318 §22.6:
- Compute b₀ (critical section perimeter at d/2 from column face).
- Compute γᵥ (fraction of unbalanced moment transferred by eccentricity of shear).
- Compute combined shear stress vᵤ from direct Vᵤ + Mᵤ·γᵥ.
- Compute capacity φvc (two-way shear strength).
- Report DCR = vᵤ / φvc.

### Step 3 — Visualization

- 3D viewport (Three.js + React Three Fiber).
- Slab as extruded solid, columns as prisms/cylinders through the slab.
- Critical sections as wireframe boxes around each column.
- DCR-colored column heatmap (green → yellow → red).
- Moment arrows at each column showing Mᵤ magnitude and direction.
- Orbit controls, pan, zoom, section cut.

## Architecture

### Geometry kernel

**opencascade.js** (OCCT compiled to WASM). Baked in from day one.

Rationale: slab geometries can get irregular — openings, re-entrant corners, odd column layouts. Three.js meshes + `three-bvh-csg` struggle with robust Booleans on edge cases (sliver faces, near-tangent geometry). OCCT gives true B-rep, reliable Boolean ops, offset curves (useful for critical-section perimeters), and STEP/IGES import later.

Tradeoff accepted: ~30 MB WASM payload. Loaded once, cached by browser. Alternatives (Manifold, three-bvh-csg) evaluated and rejected for robustness.

### Rendering

**Three.js** via **React Three Fiber** + **drei** helpers. OCCT shapes are tessellated (via OCCT's mesher) into Three.js BufferGeometry for display.

### UI framework

**Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS**. Matches the pattern from the Tributary project.

### State & solver

Client-side only in v1. Equivalent Frame Method implemented in TypeScript. No backend needed. Results computed on geometry change.

### Input formats

- **v1:** browser-side form (slab outline coords, column list, loads) + JSON import/export.
- **v1.1:** DXF ingest (reuse patterns from `tributary-plate-slab-local`).
- **v2:** STEP/IGES via OCCT, then IFC.

## Code / standard

ACI 318 (US) for v1. Eurocode 2 and CSA A23.3 deferred.

## Open questions

1. Equivalent Frame Method vs. a real plate-bending FEA — latter is more general but adds solver complexity. Start with EFM?
2. How are loads specified — uniform only, or per-panel patch loads in v1?
3. Units — US customary only or SI toggle in v1?
4. Is there a "benchmark problem" (textbook example) to validate against before shipping?

## Milestones

- **M0 — Scaffold:** Next.js + R3F + opencascade.js loaded, blank 3D scene with a test OCCT box.
- **M1 — Geometry input:** form-based slab + column definition, renders in 3D.
- **M2 — Unbalanced moments:** EFM implementation, Mᵤ per column, shown as arrows.
- **M3 — Punching check:** critical section, γᵥ, vᵤ, φvc, DCR, color map.
- **M4 — Polish:** JSON import/export, hand-calc validation, shareable URLs.
- **M5 — DXF ingest:** pull in real drawings.
