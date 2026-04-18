import { useMemo } from "react";
import katex from "katex";
import {
  b0, gammaFSpanX, gammaVSpanX, gammaFSpanY, gammaVSpanY,
  jcSpanX, jcSpanY, peakStress, phiVc, dcr,
  type Geometry,
} from "./math";

export function Tex({ children, display = false }: { children: string; display?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(children, { displayMode: display, throwOnError: false }),
    [children, display],
  );
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Controls({
  vuKip, muKipFt, thetaDeg,
  onChange,
}: {
  vuKip: number; muKipFt: number; thetaDeg: number;
  onChange: (patch: { vuKip?: number; muKipFt?: number; thetaDeg?: number }) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 p-4 border border-ink bg-paper">
      <Slider
        label={<><Tex>V_u</Tex> &nbsp; (kip)</>}
        value={vuKip} min={0} max={300} step={1}
        onChange={(v) => onChange({ vuKip: v })}
        display={`${vuKip.toFixed(0)}`}
      />
      <Slider
        label={<><Tex>{"|M_u|"}</Tex> &nbsp; (kip·ft)</>}
        value={muKipFt} min={0} max={250} step={1}
        onChange={(v) => onChange({ muKipFt: v })}
        display={`${muKipFt.toFixed(0)}`}
      />
      <Slider
        label={<><Tex>{"\\theta_{M_u}"}</Tex> &nbsp; (degrees, theta)</>}
        value={thetaDeg} min={0} max={360} step={1}
        onChange={(v) => onChange({ thetaDeg: v })}
        display={`${thetaDeg.toFixed(0)}°`}
      />
    </div>
  );
}

function Slider({
  label, value, min, max, step, onChange, display,
}: {
  label: React.ReactNode;
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-xs uppercase tracking-[0.12em] text-muted">{label}</label>
        <span className="text-sm font-mono">{display}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full"
      />
    </div>
  );
}

export function Readout({
  geom, vuKip, muKipFt, thetaDeg,
}: {
  geom: Geometry; vuKip: number; muKipFt: number; thetaDeg: number;
}) {
  const vu = vuKip * 1000;
  const mu = muKipFt * 12 * 1000;
  const theta = (thetaDeg * Math.PI) / 180;
  const gfX = gammaFSpanX(geom);
  const gvX = gammaVSpanX(geom);
  const gfY = gammaFSpanY(geom);
  const gvY = gammaVSpanY(geom);
  const JcX = jcSpanX(geom);
  const JcY = jcSpanY(geom);
  const B0 = b0(geom);
  const vuDirect = vu / (B0 * geom.d);
  const vPeak = peakStress(vu, mu, theta, geom);
  const phiVcVal = phiVc(geom);
  const dcrVal = dcr(vu, mu, theta, geom);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 p-4 border border-ink bg-paper text-sm font-mono">
      <Row label={<Tex>{"\\gamma_f \\;(\\text{span } x)"}</Tex>} value={gfX.toFixed(3)} />
      <Row label={<Tex>{"\\gamma_v \\;(\\text{span } x)"}</Tex>} value={gvX.toFixed(3)} />
      <Row label={<Tex>{"\\gamma_f \\;(\\text{span } y)"}</Tex>} value={gfY.toFixed(3)} />
      <Row label={<Tex>{"\\gamma_v \\;(\\text{span } y)"}</Tex>} value={gvY.toFixed(3)} />
      <Row label={<Tex>b_0</Tex>} value={`${B0.toFixed(1)} in`} />
      <Row label={<Tex>{"J_c \\;(\\text{span } x)"}</Tex>} value={`${JcX.toExponential(2)} in⁴`} />
      <Row label={<Tex>{"J_c \\;(\\text{span } y)"}</Tex>} value={`${JcY.toExponential(2)} in⁴`} />
      <Row label={<Tex>{"V_u/(b_0 d)"}</Tex>} value={`${vuDirect.toFixed(1)} psi`} />
      <Row label={<Tex>{"v_{u,\\max}"}</Tex>} value={`${vPeak.toFixed(1)} psi`} />
      <Row label={<Tex>{"\\phi v_c"}</Tex>} value={`${phiVcVal.toFixed(1)} psi`} />
      <Row
        label={<span className="font-semibold">DCR</span>}
        value={
          <span className={dcrVal > 1 ? "text-accentRed font-bold" : "text-accentGreen"}>
            {dcrVal.toFixed(3)}
          </span>
        }
      />
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink/20 pb-1">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * Notation — a dense, always-visible variable glossary. Grouped by role.
 * Every Greek letter named on first use.
 */
export function Notation() {
  return (
    <div className="border border-ink bg-paper">
      <div className="border-b border-border px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-muted">
        Notation
      </div>
      <table className="w-full text-[11px] font-mono leading-tight">
        <tbody>
          <GroupRow title="Demand" />
          <DefRow sym="V_u" desc="factored shear demand transferred at the column" />
          <DefRow sym="|M_u|" desc="magnitude of the unbalanced moment transferred" />
          <DefRow sym="\theta" descPre="(theta) " desc="direction of M_u vector in the slab plane, measured from +x" />

          <GroupRow title="Geometry" />
          <DefRow sym="c_1, c_2" desc="column side dimensions parallel / perpendicular to moment span" />
          <DefRow sym="h" desc="total slab thickness" />
          <DefRow sym="d" desc="effective slab depth ≈ h − 1″ cover" />
          <DefRow sym="b_1, b_2" desc="critical-section side lengths;  b_1 = c_1 + d,  b_2 = c_2 + d" />
          <DefRow sym="b_0" desc="critical-section perimeter;  b_0 = 2(b_1 + b_2)" />
          <DefRow sym="d/2" desc="offset from each column face to the critical section" />

          <GroupRow title="Moment transfer (ACI 318 §8.4.2.3)" />
          <DefRow sym="\gamma_f" descPre="(gamma-f) " desc="fraction of M_u transferred by flexure across strip c_2 + 3h" />
          <DefRow sym="\gamma_v" descPre="(gamma-v) " desc="fraction of M_u transferred by eccentric shear;  \gamma_v = 1 − \gamma_f" />
          <DefRow sym="J_c" desc="polar moment of inertia of the critical section about its centroid" />

          <GroupRow title="Capacity (ACI 318 §22.6.5)" />
          <DefRow sym="\phi" descPre="(phi) " desc="strength reduction factor for shear (= 0.75)" />
          <DefRow sym="\lambda" descPre="(lambda) " desc="lightweight-concrete modification factor (= 1 for normal weight)" />
          <DefRow sym="\lambda_s" descPre="(lambda-s) " desc="size-effect factor, depth-dependent" />
          <DefRow sym="\alpha_s" descPre="(alpha-s) " desc="column-position factor: 40 interior, 30 edge, 20 corner" />
          <DefRow sym="\beta" descPre="(beta) " desc="ratio of long-to-short column dimension" />
          <DefRow sym="f'_c" desc="specified concrete compressive strength" />

          <GroupRow title="Stress / result" />
          <DefRow sym="v_u(\theta)" desc="shear stress demand around the critical-section perimeter" />
          <DefRow sym="v_{u,\max}" desc="peak demand along the perimeter (governs check)" />
          <DefRow sym="\phi v_c" desc="two-way shear capacity per ACI 318 eq. 22.6.5.2" />
          <DefRow sym="\mathrm{DCR}" desc="demand / capacity ratio;  v_{u,\max} ÷ (\phi v_c)" />
        </tbody>
      </table>
    </div>
  );
}

function GroupRow({ title }: { title: string }) {
  return (
    <tr>
      <td
        colSpan={2}
        className="px-3 pt-3 pb-1 text-[8px] uppercase tracking-[0.22em] text-muted border-t border-border first:border-t-0"
      >
        {title}
      </td>
    </tr>
  );
}

function DefRow({ sym, desc, descPre }: { sym: string; desc: string; descPre?: string }) {
  return (
    <tr className="hover:bg-subtle/60">
      <td className="px-3 py-[3px] align-baseline w-[26%] whitespace-nowrap border-t border-border/60">
        <Tex>{sym}</Tex>
      </td>
      <td className="px-3 py-[3px] align-baseline text-ink border-t border-border/60">
        {descPre && <span className="text-muted">{descPre}</span>}
        {desc}
      </td>
    </tr>
  );
}

export function EquationsStrip() {
  return (
    <div className="p-4 border border-ink bg-paper space-y-4">
      <div>
        <Tex display>
          {"M_u \\;=\\; \\underbrace{\\gamma_f M_u}_{\\text{flexure}} \\;+\\; \\underbrace{\\gamma_v M_u}_{\\text{shear eccentricity}}"}
        </Tex>
      </div>
      <div>
        <Tex display>
          {"\\gamma_f = \\frac{1}{1 + \\tfrac{2}{3}\\sqrt{b_1/b_2}}, \\qquad \\gamma_v = 1 - \\gamma_f"}
        </Tex>
      </div>
      <div>
        <Tex display>
          {"v_u(\\theta) \\;=\\; \\underbrace{\\tfrac{V_u}{b_0\\,d}}_{\\text{panel (b)}} \\;\\pm\\; \\underbrace{\\tfrac{\\gamma_v\\,M_u\\,c}{J_c}}_{\\text{panel (c)}}"}
        </Tex>
      </div>
      <div className="text-xs text-muted italic">
        Hanson & Hanson (1968) · ACI 318 §8.4.2.3. Greek: <Tex>\gamma_f</Tex> (gamma-f),
        <Tex>{"\\;\\gamma_v"}</Tex> (gamma-v), <Tex>{"\\;\\theta"}</Tex> (theta),
        <Tex>{"\\;\\phi"}</Tex> (phi).
      </div>
    </div>
  );
}
