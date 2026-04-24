import { useEffect, useRef, useState } from "react";
import type { ProjectInputs } from "../lib/types";
import {
  DEFAULT_CONCRETE_UNIT_WEIGHT_PCF,
  slabSelfWeightPsf,
  totalDeadPsf,
} from "../lib/load-combos";

export function InputsPanel({
  inputs, onChange,
}: {
  inputs: ProjectInputs;
  onChange: (next: ProjectInputs) => void;
}) {
  const set = <K extends keyof ProjectInputs>(k: K, v: ProjectInputs[K]) =>
    onChange({ ...inputs, [k]: v });

  const selfWeight = slabSelfWeightPsf(inputs);
  const totalDL = totalDeadPsf(inputs);

  return (
    <div className="border border-ink">
      <div className="border-b border-border px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-muted">
        Project Inputs
      </div>
      <div className="grid grid-cols-2 gap-3 p-3 text-[11px]">
        <Field label="f'_c (psi)">
          <NumberInput value={inputs.fcPsi} onChange={(v) => set("fcPsi", v)} />
        </Field>
        <Field label="phi">
          <NumberInput step="0.05" value={inputs.phi} onChange={(v) => set("phi", v)} />
        </Field>
        <Field label="h slab (in)">
          <NumberInput step="0.5" value={inputs.hIn} onChange={(v) => set("hIn", v)} />
        </Field>
        <Field label="d (in)">
          <NumberInput step="0.5" value={inputs.dIn} onChange={(v) => set("dIn", v)} />
        </Field>
        <Field label="SDL (psf)">
          <NumberInput value={inputs.deadPsf} onChange={(v) => set("deadPsf", v)} />
        </Field>
        <Field label="live (psf)">
          <NumberInput value={inputs.livePsf} onChange={(v) => set("livePsf", v)} />
        </Field>
        <Field label="γ_c concrete (pcf)">
          <NumberInput
            value={inputs.concreteUnitWeightPcf ?? DEFAULT_CONCRETE_UNIT_WEIGHT_PCF}
            onChange={(v) => set("concreteUnitWeightPcf", v)}
          />
        </Field>
        <Field label="self-weight (psf)">
          <ReadOnlyValue value={selfWeight.toFixed(1)} hint="= h × γ_c" />
        </Field>
        <Field label="total DL (psf)">
          <ReadOnlyValue value={totalDL.toFixed(1)} hint="= SDL + self-weight" />
        </Field>
        <Field label="fcs (f'c reducer)">
          <NumberInput step="0.05" value={inputs.fcsFactor ?? 1.0}
            onChange={(v) => set("fcsFactor", v)} />
        </Field>
      </div>
      <div className="border-t border-border px-3 py-2 text-[10px]">
        <div className="flex items-start gap-2">
          <input
            id="aci-assumptions"
            type="checkbox"
            checked={inputs.applyAciDesignAssumptions ?? true}
            onChange={(e) => set("applyAciDesignAssumptions", e.target.checked)}
            className="appearance-none w-3 h-3 mt-0.5 border border-ink checked:bg-ink cursor-pointer shrink-0"
            style={{ borderRadius: 0 }}
          />
          <label htmlFor="aci-assumptions" className="flex-1 cursor-pointer leading-tight">
            Apply ACI 318-19 design conventions
            <span className="text-muted"> — γf auto-boosts per Table 8.4.2.2.4 where direct-shear gate passes, and |Mu| is floored at 0.3·Mo at corner columns only (DDM pattern-loading lower bound). Attestation: column-strip rebar is tension-controlled per §8.4.2.2.5.</span>
          </label>
          <a
            href="/aci-design-assumptions.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accentBlue underline text-[10px] shrink-0"
          >
            whitepaper
          </a>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyValue({ value, hint }: { value: string; hint?: string }) {
  return (
    <div
      className="px-2 py-1 border border-border bg-subtle/40 text-muted text-[11px] tabular-nums"
      title={hint}
    >
      {value}
    </div>
  );
}

function NumberInput({
  value, onChange, step,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  const [text, setText] = useState<string>(() => String(value));
  const lastCommitted = useRef(value);

  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value;
      setText(String(value));
    }
  }, [value]);

  return (
    <input
      type="number"
      step={step}
      value={text}
      onChange={(e) => {
        const s = e.target.value;
        setText(s);
        if (s === "") return;
        const n = Number(s);
        if (Number.isFinite(n)) {
          lastCommitted.current = n;
          onChange(n);
        }
      }}
      onBlur={() => {
        const n = Number(text);
        if (text === "" || !Number.isFinite(n)) {
          setText(String(value));
        }
      }}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[8px] uppercase tracking-[0.16em] text-muted">{label}</span>
      {children}
    </label>
  );
}
