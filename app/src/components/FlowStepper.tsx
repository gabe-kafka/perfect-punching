/**
 * Digital Twin Builder flow stepper.  Renders 3 connected step cards
 * side-by-side so the user can see the whole path from twin creation
 * through punching analysis.  Past steps are filled dark (done), the
 * current step is filled blue (active), future steps are dimmed but
 * still visible ("looming") so they draw the eye forward.
 */
import { Fragment } from "react";

export type FlowStep = 1 | 2 | 3;

const STEPS: { n: FlowStep; title: string; caption: string }[] = [
  { n: 1, title: "Material + System", caption: "what you're designing" },
  { n: 2, title: "Upload DXF",        caption: "floor-plan geometry" },
  { n: 3, title: "Generate + Analyze",caption: "extrude + run punching" },
];

export function FlowStepper({
  current,
  compact = false,
}: {
  current: FlowStep;
  compact?: boolean;
}) {
  return (
    <div className={"flex items-stretch " + (compact ? "gap-1" : "gap-2")}>
      {STEPS.map((s, i) => {
        const state: "done" | "active" | "future" =
          s.n < current ? "done" : s.n === current ? "active" : "future";
        return (
          <Fragment key={s.n}>
            <StepCard step={s} state={state} compact={compact} />
            {i < STEPS.length - 1 && (
              <div
                className={
                  "flex items-center " +
                  (s.n < current ? "text-ink" : "text-muted/50")
                }
              >
                <span className={compact ? "text-[9px]" : "text-[11px]"}>→</span>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function StepCard({
  step, state, compact,
}: {
  step: { n: FlowStep; title: string; caption: string };
  state: "done" | "active" | "future";
  compact: boolean;
}) {
  const base = compact ? "px-2 py-1" : "px-3 py-2";
  const styleClass =
    state === "active"
      ? "border-accentBlue bg-accentBlue text-paper"
      : state === "done"
      ? "border-ink bg-ink text-paper"
      : "border-border bg-paper text-muted";
  return (
    <div className={`flex-1 min-w-0 border ${styleClass} ${base}`}>
      <div
        className={
          (compact ? "text-[8px]" : "text-[9px]") +
          " uppercase tracking-[0.18em] opacity-80"
        }
      >
        Step {step.n} of 3{state === "done" ? " · done" : state === "future" ? " · looming" : ""}
      </div>
      <div className={(compact ? "text-[10px]" : "text-[12px]") + " font-semibold truncate"}>
        {step.title}
      </div>
    </div>
  );
}
