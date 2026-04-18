import { useState } from "react";
import { HeroScene, DecompositionTriptych } from "./scenes";
import { Controls, Readout, EquationsStrip, Notation } from "./ui";
import type { Geometry } from "./math";

/** Default fixtures: interior rectangular column 12" x 24", 8" slab, d = h − 1". */
const GEOM: Geometry = { c1: 12, c2: 24, h: 8, d: 7 };

export default function App() {
  const [vuKip, setVuKip] = useState(10);
  const [muKipFt, setMuKipFt] = useState(15);
  const [thetaDeg, setThetaDeg] = useState(0);

  // unit conversions passed into scenes
  const vu = vuKip * 1000;                // lb
  const mu = muKipFt * 12 * 1000;         // lb-in
  const theta = (thetaDeg * Math.PI) / 180;

  return (
    <div className="max-w-[1240px] mx-auto px-4 md:px-6 py-5 md:py-6 space-y-5 md:space-y-6">
      <header className="pb-3 md:pb-4 border-b border-ink">
        <img
          src="/brand.png"
          alt="Gabriel Kafka"
          className="h-10 md:h-[52px] w-auto max-w-full object-contain mb-3 md:mb-4 select-none"
          draggable={false}
        />
        <div className="flex flex-col md:flex-row md:items-baseline md:gap-4">
          <span className="text-[9px] uppercase tracking-[0.24em] text-muted">
            FIG-01 · Perfect Punching
          </span>
          <h1 className="text-base md:text-xl font-semibold tracking-tight">
            Hanson &amp; Hanson eccentric-shear decomposition
          </h1>
        </div>
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

      <section className="grid md:grid-cols-[1fr_1fr] gap-4">
        <EquationsStrip />
        <Notation />
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
