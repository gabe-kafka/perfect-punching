/**
 * Digital Twin Builder — stage 1.
 *
 * A floating, draggable card.  Top row shows three material pills
 * (concrete / steel / CLT).  Selecting a material branches to its
 * structural-system children below via an SVG tee.  For now only
 * Concrete → Flat plate is enabled; everything else is "coming soon".
 */
import { useRef, useState } from "react";

export type TwinMaterial = "concrete" | "steel" | "clt";
export type TwinSystem =
  | "flat-plate-ordinary-walls"
  | "two-way-drop-panels"
  | "pt-plate";

export function TwinSetupPanel({
  material,
  system,
  onChange,
  onContinue,
  onClose,
  canClose,
}: {
  material: TwinMaterial | null;
  system: TwinSystem | null;
  onChange: (m: TwinMaterial | null, s: TwinSystem | null) => void;
  onContinue: () => void;
  onClose: () => void;
  canClose: boolean;
}) {
  const [pos, setPos] = useState({ x: 40, y: 40 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const startDrag = (e: React.PointerEvent) => {
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
  };
  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
  };

  const canContinue = material === "concrete" && system === "flat-plate-ordinary-walls";

  return (
    <div className="h-full w-full relative overflow-hidden pointer-events-none">
      <div
        className="absolute border border-ink bg-paper shadow-2xl pointer-events-auto"
        style={{ left: pos.x, top: pos.y, width: 620 }}
      >
        <header
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          className="cursor-move bg-ink text-paper px-4 py-2 flex items-baseline gap-3 select-none"
        >
          <span className="text-[12px] font-semibold tracking-wider">
            DIGITAL TWIN BUILDER
          </span>
          <span className="flex-1" />
          <span className="text-[9px] opacity-70 mr-2">
            pick your material + system
          </span>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            disabled={!canClose}
            className={
              "w-6 h-6 flex items-center justify-center text-[14px] leading-none " +
              (canClose
                ? "hover:bg-paper/20 cursor-pointer"
                : "opacity-30 cursor-not-allowed")
            }
            aria-label="Close Digital Twin Builder"
          >
            ×
          </button>
        </header>

        <div className="p-5">
          <div className="grid grid-cols-3 gap-3">
            <MaterialPill
              id="concrete"
              label="concrete"
              selected={material === "concrete"}
              onClick={() => onChange("concrete", material === "concrete" ? system : null)}
            />
            <MaterialPill id="steel" label="steel" disabled />
            <MaterialPill id="clt" label="CLT" disabled />
          </div>

          {material === "concrete" && (
            <>
              <Branch />
              <div className="grid grid-cols-3 gap-3">
                <SystemPill
                  label="flat plate"
                  selected={system === "flat-plate-ordinary-walls"}
                  onClick={() => onChange("concrete", "flat-plate-ordinary-walls")}
                />
                <SystemPill label="2-way with drop panels" disabled />
                <SystemPill label="post-tensioned plate" disabled />
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

function MaterialPill({
  id, label, selected, disabled, onClick,
}: {
  id: string;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "border px-3 py-3 text-center " +
        (disabled
          ? "border-border text-muted cursor-not-allowed"
          : selected
          ? "border-ink bg-ink text-paper"
          : "border-ink hover:bg-subtle")
      }
    >
      <div className={(selected && !disabled ? "text-paper" : "") + " text-[13px] font-semibold"}>
        {label}
      </div>
      {disabled && (
        <div className="text-[9px] uppercase tracking-[0.16em] text-muted mt-0.5">
          coming soon
        </div>
      )}
    </button>
  );
}

function SystemPill({
  label, selected, disabled, onClick,
}: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "border px-3 py-3 text-center " +
        (disabled
          ? "border-border text-muted cursor-not-allowed"
          : selected
          ? "border-accentBlue bg-accentBlue text-paper"
          : "border-ink hover:bg-subtle")
      }
    >
      <div className="text-[11px] font-semibold leading-tight">{label}</div>
      {disabled && (
        <div className="text-[8px] uppercase tracking-[0.16em] text-muted mt-0.5">
          coming soon
        </div>
      )}
    </button>
  );
}

function Branch() {
  // The grid is 3 equal columns with 12px gaps.  Inside width is
  // 620 − 40 (padding) = 580; each col center sits at 1/6, 3/6, 5/6
  // of 580 ≈ 97, 290, 483.  Concrete occupies col 1 so its vertical
  // drop is at x=97; systems span cols 1..3.
  return (
    <svg
      width="100%"
      viewBox="0 0 580 40"
      className="my-2"
      preserveAspectRatio="none"
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0,0 L 10,5 L 0,10 Z" fill="#1A1A1A" />
        </marker>
      </defs>
      <path d="M 97,0 L 97,14" stroke="#1A1A1A" strokeWidth="1.5" fill="none" />
      <path d="M 97,14 L 483,14" stroke="#1A1A1A" strokeWidth="1.5" fill="none" />
      <path d="M 97,14 L 97,34"  stroke="#1A1A1A" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
      <path d="M 290,14 L 290,34" stroke="#1A1A1A" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
      <path d="M 483,14 L 483,34" stroke="#1A1A1A" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
    </svg>
  );
}
