import type { DxfScan, LayerInfo, LayerMapping, LayerRole } from "../lib/dxf-ingest";
import { ALL_ROLES } from "../lib/dxf-ingest";

const ROLE_LABELS: Record<LayerRole, string> = {
  slab: "Slab boundary",
  columns: "Columns",
  walls: "Walls",
  "column-labels": "Column labels",
  ignore: "Ignore",
};

export function LayerMappingPanel({
  scan,
  mapping,
  onChangeMapping,
  onApply,
  onCancel,
}: {
  scan: DxfScan;
  mapping: LayerMapping;
  onChangeMapping: (next: LayerMapping) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const counts = summarize(scan.layers, mapping);
  const ready = counts.slab > 0 && counts.columns > 0;

  const setRole = (layer: string, role: LayerRole) =>
    onChangeMapping({ ...mapping, [layer]: role });

  return (
    <div className="h-full w-full flex flex-col">
      <div className="border-b border-ink px-4 py-3 flex items-center gap-4">
        <div>
          <div className="text-[9px] uppercase tracking-[0.28em] text-muted">Step 1 of 2</div>
          <div className="text-sm font-semibold">Assign layers</div>
        </div>
        <div className="flex-1" />
        <RoleBadge label="slab" count={counts.slab} required />
        <RoleBadge label="columns" count={counts.columns} required />
        <RoleBadge label="walls" count={counts.walls} />
        <button
          type="button"
          onClick={onCancel}
          className="border border-ink px-3 py-1 text-[10px] uppercase tracking-wider hover:bg-subtle"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={!ready}
          className={
            "border px-3 py-1 text-[10px] uppercase tracking-wider " +
            (ready
              ? "border-accentBlue bg-accentBlue text-paper hover:opacity-90"
              : "border-border text-muted cursor-not-allowed")
          }
          title={ready ? "Apply mapping and ingest" : "Need at least one slab layer and one columns layer"}
        >
          Apply → Analyze
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11px] font-mono">
          <thead className="sticky top-0 bg-paper border-b border-border">
            <tr className="text-[9px] uppercase tracking-wider text-muted">
              <Th>Layer</Th>
              <Th>Entities</Th>
              <Th>Geometry</Th>
              <Th>Suggestion</Th>
              <Th>Role</Th>
            </tr>
          </thead>
          <tbody>
            {scan.layers.map((L) => {
              const current = mapping[L.name] ?? "ignore";
              const matchesSuggestion = current === L.suggestedRole;
              return (
                <tr key={L.name} className="border-b border-border/40">
                  <Td>
                    <span className="font-semibold">{L.name || "(no layer)"}</span>
                  </Td>
                  <Td>
                    <span className="text-muted">
                      {Object.entries(L.entityCounts)
                        .map(([t, n]) => `${t}×${n}`)
                        .join("  ")}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-muted text-[10px]">
                      {describeGeometry(L)}
                    </span>
                  </Td>
                  <Td>
                    <span className={matchesSuggestion ? "text-accentGreen" : "text-muted"}>
                      {ROLE_LABELS[L.suggestedRole]}
                    </span>
                    <span className="text-muted text-[10px] block">{L.suggestionReason}</span>
                  </Td>
                  <Td>
                    <select
                      value={current}
                      onChange={(e) => setRole(L.name, e.target.value as LayerRole)}
                      className="border border-ink px-2 py-1 text-[11px] bg-paper"
                    >
                      {ALL_ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!ready && (
        <div className="border-t border-accentAmber bg-accentAmber/10 text-accentAmber px-4 py-2 text-[11px] font-mono">
          Assign at least one <b>slab</b> layer and one <b>columns</b> layer before applying.
        </div>
      )}
    </div>
  );
}

function summarize(layers: LayerInfo[], mapping: LayerMapping) {
  let slab = 0, columns = 0, walls = 0, labels = 0, ignore = 0;
  for (const L of layers) {
    const r = mapping[L.name] ?? "ignore";
    if (r === "slab") slab++;
    else if (r === "columns") columns++;
    else if (r === "walls") walls++;
    else if (r === "column-labels") labels++;
    else ignore++;
  }
  return { slab, columns, walls, labels, ignore };
}

function RoleBadge({
  label, count, required,
}: { label: string; count: number; required?: boolean }) {
  const ok = count > 0;
  const color = ok ? "text-accentGreen border-accentGreen" : required ? "text-accentRed border-accentRed" : "text-muted border-border";
  return (
    <div className={`border ${color} px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider`}>
      {label} · {count}
    </div>
  );
}

function describeGeometry(L: LayerInfo): string {
  const bits: string[] = [];
  if (L.closedPolylineCount) bits.push(`${L.closedPolylineCount} closed poly`);
  if (L.openPolylineCount) bits.push(`${L.openPolylineCount} open poly`);
  if (L.lineCount) bits.push(`${L.lineCount} line`);
  if (L.pointCount) bits.push(`${L.pointCount} pt`);
  if (L.textCount) bits.push(`${L.textCount} text`);
  const parts = [bits.join(", ") || "—"];
  if (L.maxPolygonAreaIn2 !== undefined) {
    parts.push(`max poly ≈ ${(L.maxPolygonAreaIn2 / 144).toFixed(1)} ft²`);
  }
  if (L.avgClosedPolyAspectRatio !== undefined) {
    parts.push(`aspect ${L.avgClosedPolyAspectRatio.toFixed(1)} (${L.avgClosedPolyAspectRatio >= 3 ? "thin → wall-like" : "square → column-like"})`);
  }
  if (L.avgSegmentLengthIn !== undefined) {
    parts.push(`avg seg ≈ ${L.avgSegmentLengthIn.toFixed(1)}"`);
  }
  return parts.join("  •  ");
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-top">{children}</td>;
}
