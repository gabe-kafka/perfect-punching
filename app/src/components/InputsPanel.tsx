import type { ProjectInputs } from "../lib/types";

export function InputsPanel({
  inputs, onChange,
}: {
  inputs: ProjectInputs;
  onChange: (next: ProjectInputs) => void;
}) {
  const set = <K extends keyof ProjectInputs>(k: K, v: ProjectInputs[K]) =>
    onChange({ ...inputs, [k]: v });

  return (
    <div className="border border-ink">
      <div className="border-b border-border px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-muted">
        Project Inputs
      </div>
      <div className="grid grid-cols-2 gap-3 p-3 text-[11px]">
        <Field label="f'_c (psi)">
          <input type="number" value={inputs.fcPsi}
            onChange={(e) => set("fcPsi", Number(e.target.value))} />
        </Field>
        <Field label="phi">
          <input type="number" step="0.05" value={inputs.phi}
            onChange={(e) => set("phi", Number(e.target.value))} />
        </Field>
        <Field label="h slab (in)">
          <input type="number" step="0.5" value={inputs.hIn}
            onChange={(e) => set("hIn", Number(e.target.value))} />
        </Field>
        <Field label="d (in)">
          <input type="number" step="0.5" value={inputs.dIn}
            onChange={(e) => set("dIn", Number(e.target.value))} />
        </Field>
        <Field label="dead (psf)">
          <input type="number" value={inputs.deadPsf}
            onChange={(e) => set("deadPsf", Number(e.target.value))} />
        </Field>
        <Field label="live (psf)">
          <input type="number" value={inputs.livePsf}
            onChange={(e) => set("livePsf", Number(e.target.value))} />
        </Field>
        <Field label="default c1 (in)">
          <input type="number" value={inputs.defaultC1}
            onChange={(e) => set("defaultC1", Number(e.target.value))} />
        </Field>
        <Field label="default c2 (in)">
          <input type="number" value={inputs.defaultC2}
            onChange={(e) => set("defaultC2", Number(e.target.value))} />
        </Field>
      </div>
    </div>
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
