import { useState } from "react";
import { HeroScene, DecompositionTriptych } from "./scenes";
import { Controls, Readout, EquationsStrip } from "./ui";
import type { Geometry } from "./math";

/** Default fixtures: interior rectangular column 12" x 24", 8" slab, d = h − 1". */
const GEOM: Geometry = { c1: 12, c2: 24, h: 8, d: 7 };

export default function App() {
  const [vuKip, setVuKip] = useState(120);
  const [muKipFt, setMuKipFt] = useState(100);
  const [thetaDeg, setThetaDeg] = useState(0);

  // unit conversions passed into scenes
  const vu = vuKip * 1000;                // lb
  const mu = muKipFt * 12 * 1000;         // lb-in
  const theta = (thetaDeg * Math.PI) / 180;

  return (
    <div className="max-w-[1240px] mx-auto px-6 py-8 space-y-6">
      <header className="space-y-1 pb-2 border-b border-ink">
        <h1 className="text-2xl font-bold tracking-tight">
          Perfect Punching — Hanson &amp; Hanson decomposition
        </h1>
        <p className="text-sm text-muted max-w-2xl">
          Interactive illustration of the ACI 318 §8.4.2.3 eccentric-shear model.
          Drag the sliders to vary <em>V<sub>u</sub></em>, |<em>M<sub>u</sub></em>|,
          and the moment direction θ. Every arrow length is computed from the code equation —
          panel (d) is exactly the sum of panels (b) and (c).
        </p>
      </header>

      <section className="space-y-2">
        <div className="text-xs uppercase tracking-[0.18em] text-muted">
          (a) Moment transfer at the slab–column interface
        </div>
        <HeroScene geom={GEOM} vu={vu} mu={mu} theta={theta} />
      </section>

      <section className="space-y-2">
        <div className="text-xs uppercase tracking-[0.18em] text-muted">
          Superposition on the critical-section perimeter
        </div>
        <DecompositionTriptych geom={GEOM} vu={vu} mu={mu} theta={theta} />
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <Controls
          vuKip={vuKip} muKipFt={muKipFt} thetaDeg={thetaDeg}
          onChange={(patch) => {
            if (patch.vuKip    !== undefined) setVuKip(patch.vuKip);
            if (patch.muKipFt  !== undefined) setMuKipFt(patch.muKipFt);
            if (patch.thetaDeg !== undefined) setThetaDeg(patch.thetaDeg);
          }}
        />
        <Readout geom={GEOM} vuKip={vuKip} muKipFt={muKipFt} thetaDeg={thetaDeg} />
      </section>

      <section>
        <EquationsStrip />
      </section>

      <footer className="pt-4 text-xs text-muted border-t border-ink">
        Geometry: interior column 12″×24″, slab thickness h = 8″ (effective depth
        d ≈ {GEOM.d.toFixed(2)}″). Orientation is locked to a horizontal plate;
        scroll to zoom.
        Reference: Hanson & Hanson (1968), PCA Journal, Vol. 10 No. 1.
      </footer>
    </div>
  );
}
