/**
 * Digital Twin Builder — stage 3.  After the twin is assembled (DXF
 * ingested + layers mapped), show the twin summary and let the user
 * pick a design workflow.
 */

export type WorkflowId = "punching";

export function WorkflowSelectPanel({
  slabCount, columnCount, wallCount,
  onChooseWorkflow,
  onBackToMapping,
}: {
  slabCount: number;
  columnCount: number;
  wallCount: number;
  onChooseWorkflow: (id: WorkflowId) => void;
  onBackToMapping: () => void;
}) {
  return (
    <div className="h-full w-full p-6 overflow-auto">
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <div className="text-[9px] uppercase tracking-[0.28em] text-muted">
            Step 3 of 3 · Digital Twin ready
          </div>
          <div className="text-sm font-semibold mt-1">
            Pick a design workflow
          </div>
        </div>

        <div className="border border-ink p-3 text-[11px] font-mono">
          <div className="text-[9px] uppercase tracking-[0.18em] text-muted mb-1">
            Twin summary
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Stat label="material" value="concrete" />
            <Stat label="slabs" value={String(slabCount)} />
            <Stat label="columns" value={String(columnCount)} />
            <Stat label="walls" value={String(wallCount)} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <WorkflowCard
            title="Punching Shear"
            subtitle="ACI 318-19 · Plate FEA + per-column DCR"
            active
            onClick={() => onChooseWorkflow("punching")}
          />
          <WorkflowCard
            title="Flexural Design"
            subtitle="Design-strip moments, column strip reinforcement"
            disabled
          />
          <WorkflowCard
            title="One-Way Shear"
            subtitle="Beam-shear check at d from support"
            disabled
          />
          <WorkflowCard
            title="Deflection"
            subtitle="Immediate + long-term, ACI 318-19 §24.2"
            disabled
          />
        </div>

        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider">
          <button
            type="button"
            onClick={onBackToMapping}
            className="border border-ink px-3 py-1.5 hover:bg-subtle"
          >
            ← change layers
          </button>
          <span className="text-muted">
            More workflows arriving as the twin matures
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="text-[12px]">{value}</div>
    </div>
  );
}

function WorkflowCard({
  title, subtitle, active, disabled, onClick,
}: {
  title: string;
  subtitle: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "text-left border p-4 transition-colors " +
        (disabled
          ? "border-border text-muted cursor-not-allowed"
          : active
          ? "border-accentBlue hover:bg-accentBlue/5"
          : "border-ink hover:bg-subtle")
      }
    >
      <div className="flex items-center justify-between mb-1">
        <div className={"text-[12px] font-semibold " + (active ? "text-accentBlue" : "")}>
          {title}
        </div>
        {active && (
          <span className="text-[9px] uppercase tracking-wider text-accentBlue">
            enter →
          </span>
        )}
        {disabled && (
          <span className="text-[9px] uppercase tracking-wider text-muted">
            coming soon
          </span>
        )}
      </div>
      <div className="text-[10px] text-muted">{subtitle}</div>
    </button>
  );
}
