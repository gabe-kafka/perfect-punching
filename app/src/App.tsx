import { Component, useMemo, useState, type ReactNode } from "react";
import { ingestDxf, type IngestResult } from "./lib/dxf-ingest";
import { largest, pointInRing } from "./lib/geom";
import { tributaryAreas } from "./lib/voronoi";
import { classifyColumns } from "./lib/classify";
import { checkPunching } from "./lib/punching";
import { unbalancedMoments } from "./lib/efm";
import { unbalancedMomentsFEA, type FEAUnbalanced } from "./fea/plate-fea";
import type { ColumnResult, ProjectInputs } from "./lib/types";
import { Floor3D } from "./scenes/Floor3D";
import { InputsPanel } from "./components/InputsPanel";
import { ResultsTable } from "./components/ResultsTable";
import { exportExcel, exportDxf, downloadBlob } from "./lib/exports";

const DEFAULT_INPUTS: ProjectInputs = {
  fcPsi: 5000,
  hIn: 8,
  dIn: 7,
  deadPsf: 30,
  livePsf: 50,
  defaultC1: 24,
  defaultC2: 24,
  phi: 0.75,
  columnHeightIn: 144,
  columnFarEndFixity: "fixed",
  concreteNu: 0.2,
  meshTargetEdgeIn: 24,
};

type SolverDiagnostics =
  | { mode: "fea"; nNodes: number; nElements: number; iters: number; residual: number; equilibriumErrPct: number; elapsedMs: number; totalLoadKip: number; colSumKip: number; wallSumKip: number }
  | { mode: "efm"; reason: string }
  | null;

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("[App crash]", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "monospace", fontSize: 12, color: "#900", whiteSpace: "pre-wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>App render error:</div>
          <div>{this.state.error.message}</div>
          <details style={{ marginTop: 12 }}>
            <summary>stack</summary>
            <div>{this.state.error.stack}</div>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const [inputs, setInputs] = useState<ProjectInputs>(DEFAULT_INPUTS);
  const [ingest, setIngest] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [useFEA, setUseFEA] = useState(true);

  const slab = useMemo(() => {
    if (!ingest) return null;
    return largest(ingest.slabs.map((s) => s.polygon));
  }, [ingest]);

  // Apply default column sizes to ingested columns AND drop columns that
  // lie outside the slab polygon.  Phantom POINTs (grid dots, setting-
  // out marks, duplicate drafting entities) on the COLUMN-REAL layer
  // otherwise pollute:
  //   - tributaryAreas  (get 0 area but still clutter the column list)
  //   - efm.findSpans   (show up as "nearest neighbor" for real columns'
  //                      ray searches, producing huge spans → huge Mu)
  //   - the FEA mesher  (column centroid Steiner point outside the slab
  //                      gets dropped by pointInsideSlab and the rigid
  //                      patch loses its master).
  // A tiny inward tolerance (−1 in) keeps columns truly on the boundary
  // inside; anything more than 1 in outside the polygon is dropped.
  const columns = useMemo(() => {
    if (!ingest) return [];
    const outer = slab?.outer;
    const holes = slab?.holes ?? [];
    const inside = (p: [number, number]) => {
      if (!outer) return true;
      if (!pointInRing(p, outer)) return false;
      for (const h of holes) if (pointInRing(p, h)) return false;
      return true;
    };
    return ingest.columns
      .filter(c => inside(c.position))
      .map(c => ({
        ...c,
        c1: c.c1 || inputs.defaultC1,
        c2: c.c2 || inputs.defaultC2,
      }));
  }, [ingest, slab, inputs.defaultC1, inputs.defaultC2]);

  const { results, solverDiag, feaPerColumn } = useMemo<{
    results: ColumnResult[];
    solverDiag: SolverDiagnostics;
    feaPerColumn: Map<string, FEAUnbalanced> | null;
  }>(() => {
    if (!slab || columns.length === 0) return { results: [], solverDiag: null, feaPerColumn: null };
    classifyColumns(slab, columns);
    const tribMap = tributaryAreas(slab, columns, ingest?.walls ?? [], 12);
    columns.forEach((c) => {
      c.tributaryArea = tribMap.get(c.id) ?? 0;
    });
    const wu_psi = (1.2 * inputs.deadPsf + 1.6 * inputs.livePsf) / 144;

    if (useFEA) {
      try {
        const fea = unbalancedMomentsFEA(slab, columns, ingest?.walls ?? [], wu_psi, inputs);
        const d = fea.diagnostics;
        const diag: SolverDiagnostics = {
          mode: "fea",
          nNodes: d.nNodes,
          nElements: d.nElements,
          iters: d.cgIterations,
          residual: d.residual,
          equilibriumErrPct: d.equilibriumError * 100,
          elapsedMs: d.elapsedMs,
          totalLoadKip: d.totalLoad / 1000,
          colSumKip: d.colReactionSum / 1000,
          wallSumKip: d.wallReactionSum / 1000,
        };
        const rs = columns.map((c) => {
          const m = fea.perColumn.get(c.id);
          return checkPunching(c, inputs, m?.mu2, m?.mu3, slab, m?.Vu);
        });
        return { results: rs, solverDiag: diag, feaPerColumn: fea.perColumn };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const muMap = unbalancedMoments(slab, columns, ingest?.walls ?? [], wu_psi);
        const rs = columns.map((c) => {
          const m = muMap.get(c.id);
          return checkPunching(c, inputs, m?.mu2, m?.mu3, slab);
        });
        return { results: rs, solverDiag: { mode: "efm", reason: `FEA failed: ${msg}` }, feaPerColumn: null };
      }
    }

    const muMap = unbalancedMoments(slab, columns, ingest?.walls ?? [], wu_psi);
    const rs = columns.map((c) => {
      const m = muMap.get(c.id);
      return checkPunching(c, inputs, m?.mu2, m?.mu3, slab);
    });
    return { results: rs, solverDiag: { mode: "efm", reason: "FEA disabled in toolbar" }, feaPerColumn: null };
  }, [slab, columns, inputs, ingest?.walls, useFEA]);

  const resultsMap = useMemo(
    () => new Map(results.map((r) => [r.columnId, r])),
    [results],
  );

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const ing = ingestDxf(text);
      setIngest(ing);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadDemo = async () => {
    setError(null);
    try {
      const r = await fetch("/test-input.dxf");
      const text = await r.text();
      const ing = ingestDxf(text);
      setIngest(ing);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyDebugReport = () => {
    const lines: string[] = [];
    lines.push(`# Perfect Punching — debug report`);
    lines.push(`Date: ${new Date().toISOString()}`);
    lines.push(`Solver: ${solverDiag?.mode ?? "none"}`);
    if (solverDiag?.mode === "fea") {
      lines.push(`Mesh: ${solverDiag.nNodes} nodes, ${solverDiag.nElements} elements`);
      lines.push(`CG: ${solverDiag.iters} iters, residual ${solverDiag.residual.toExponential(2)}`);
      lines.push(`Equilibrium: ${solverDiag.equilibriumErrPct.toFixed(4)}%`);
      lines.push(`Load: total ${solverDiag.totalLoadKip.toFixed(2)} kip, cols ${solverDiag.colSumKip.toFixed(2)}, walls ${solverDiag.wallSumKip.toFixed(2)}`);
    }
    lines.push(``);
    lines.push(`Inputs: fc=${inputs.fcPsi}  h=${inputs.hIn}  d=${inputs.dIn}  DL=${inputs.deadPsf}  LL=${inputs.livePsf}  defaultCol=${inputs.defaultC1}x${inputs.defaultC2}`);
    const wu_psi = (1.2*inputs.deadPsf + 1.6*inputs.livePsf)/144;
    lines.push(`wu = ${wu_psi.toFixed(3)} psi (${(wu_psi*144).toFixed(0)} psf factored)`);
    lines.push(``);
    lines.push(`Per column (FEA diagnostic):`);
    lines.push(`id\ttype\tc1\tc2\tVu_kip\tMu2_kipin\tMu3_kipin\tMu_res_kipin\tb0\tDCR\ttheta_x\ttheta_y\tK_x_lbin_rad\tK_y_lbin_rad\tpatchSlaves\tmasterOffset_in`);
    for (const r of results) {
      const c = columns.find(cc => cc.id === r.columnId);
      const f = feaPerColumn?.get(r.columnId);
      const row = [
        r.columnId, r.type,
        c?.c1 ?? "",
        c?.c2 ?? "",
        (r.vu/1000).toFixed(2),
        (r.mu2/1000).toFixed(1),
        (r.mu3/1000).toFixed(1),
        (r.mu/1000).toFixed(1),
        r.b0.toFixed(1),
        r.dcr.toFixed(3),
        f?.thetaX?.toExponential(2) ?? "-",
        f?.thetaY?.toExponential(2) ?? "-",
        f?.kAboutX?.toExponential(2) ?? "-",
        f?.kAboutY?.toExponential(2) ?? "-",
        f?.patchSlaves ?? "-",
        f?.masterOffsetIn?.toFixed(2) ?? "-",
      ];
      lines.push(row.join("\t"));
    }
    const text = lines.join("\n");
    navigator.clipboard.writeText(text).then(
      () => alert(`Copied ${results.length}-column debug report to clipboard.`),
      () => alert(`Copy failed — text dumped to console.`),
    );
    // eslint-disable-next-line no-console
    console.log(text);
  };

  return (
    <div className="h-full grid" style={{ gridTemplateRows: "auto 1fr" }}>
      <Header
        ingest={ingest}
        onFile={handleFile}
        onDemo={loadDemo}
        useFEA={useFEA}
        onToggleFEA={() => setUseFEA(v => !v)}
        onCopyDebug={copyDebugReport}
        onExportExcel={() =>
          downloadBlob(exportExcel(results, columns), "punching-results.xlsx")
        }
        onExportDxf={() =>
          downloadBlob(exportDxf(slab, columns, results), "punching-results.dxf")
        }
        canExport={results.length > 0}
      />

      <div
        className="grid gap-3 p-3"
        style={{ gridTemplateColumns: "320px 1fr 380px", minHeight: 0 }}
      >
        <div className="flex flex-col gap-3 min-h-0 overflow-auto">
          <InputsPanel inputs={inputs} onChange={setInputs} />
          {solverDiag && <SolverPanel diag={solverDiag} />}
          {ingest && <Diagnostics ingest={ingest} droppedPhantoms={ingest.columns.length - columns.length} keptColumns={columns.length} />}
          {error && (
            <div className="border border-accentRed text-accentRed p-2 text-[10px] font-mono">
              {error}
            </div>
          )}
        </div>

        <div className="min-h-0">
          <Floor3D
            slab={slab}
            columns={columns}
            results={resultsMap}
            hSlabIn={inputs.hIn}
            selectedColumn={selected}
            onSelect={setSelected}
          />
        </div>

        <div className="min-h-0">
          <ResultsTable results={results} selected={selected} onSelect={setSelected} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

function Header({
  ingest, onFile, onDemo, useFEA, onToggleFEA, onCopyDebug, onExportExcel, onExportDxf, canExport,
}: {
  ingest: IngestResult | null;
  onFile: (f: File) => void;
  onDemo: () => void;
  useFEA: boolean;
  onToggleFEA: () => void;
  onCopyDebug: () => void;
  onExportExcel: () => void;
  onExportDxf: () => void;
  canExport: boolean;
}) {
  return (
    <header className="border-b border-ink px-3 py-2 flex items-center gap-3 text-[11px]">
      <div className="text-[9px] uppercase tracking-[0.24em] text-muted">Perfect Punching</div>
      <div className="font-semibold">DXF · Punching Shear · Per-Column DCR</div>
      <div className="flex-1" />
      <button
        onClick={onToggleFEA}
        className={`border px-2 py-1 uppercase tracking-wider text-[10px] ${useFEA ? "border-accentRed bg-accentRed/10 text-accentRed" : "border-ink hover:bg-subtle"}`}
        title="Toggle plate FEA solver"
      >
        {useFEA ? "Solver: FEA" : "Solver: EFM-lite"}
      </button>
      <label className="border border-ink px-2 py-1 cursor-pointer hover:bg-subtle uppercase tracking-wider text-[10px]">
        Upload DXF
        <input
          type="file"
          accept=".dxf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.currentTarget.value = "";
          }}
        />
      </label>
      <button onClick={onDemo} className="border border-ink px-2 py-1 hover:bg-subtle uppercase tracking-wider text-[10px]">
        Load Demo DXF
      </button>
      <button
        onClick={onCopyDebug}
        disabled={!canExport}
        className="border border-ink px-2 py-1 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-subtle uppercase tracking-wider text-[10px]"
        title="Copy per-column FEA diagnostics (theta, K_rot, patchSlaves) to clipboard"
      >
        Copy Debug
      </button>
      <button
        onClick={onExportExcel}
        disabled={!canExport}
        className="border border-ink px-2 py-1 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-subtle uppercase tracking-wider text-[10px]"
      >
        Export Excel
      </button>
      <button
        onClick={onExportDxf}
        disabled={!canExport}
        className="border border-ink px-2 py-1 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-subtle uppercase tracking-wider text-[10px]"
      >
        Export DXF
      </button>
      {ingest && (
        <span className="text-[9px] text-muted">
          {ingest.slabs.length} slab · {ingest.columns.length} ingested cols · {ingest.walls.length} walls
        </span>
      )}
    </header>
  );
}

function SolverPanel({ diag }: { diag: SolverDiagnostics }) {
  if (!diag) return null;
  if (diag.mode === "efm") {
    return (
      <div className="border border-ink">
        <div className="border-b border-border px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-muted">
          Solver · EFM-lite
        </div>
        <div className="p-3 text-[10px] font-mono text-muted">{diag.reason}</div>
      </div>
    );
  }
  const equilOk = Math.abs(diag.equilibriumErrPct) < 0.1;
  return (
    <div className="border border-ink">
      <div className="border-b border-border px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-muted">
        Solver · Plate FEA (DKT)
      </div>
      <div className="p-3 text-[10px] font-mono space-y-1">
        <div>
          <span className="text-muted">mesh: </span>
          {diag.nNodes} nodes · {diag.nElements} elements
        </div>
        <div>
          <span className="text-muted">solve: </span>
          {diag.iters} CG iters · res {diag.residual.toExponential(1)} · {diag.elapsedMs.toFixed(0)} ms
        </div>
        <div>
          <span className="text-muted">load: </span>
          {diag.totalLoadKip.toFixed(1)} kip total · columns {diag.colSumKip.toFixed(1)} · walls {diag.wallSumKip.toFixed(1)}
        </div>
        <div>
          <span className="text-muted">equilibrium: </span>
          <span className={equilOk ? "" : "text-accentRed"}>
            {diag.equilibriumErrPct.toFixed(4)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function Diagnostics({ ingest, droppedPhantoms, keptColumns }: { ingest: IngestResult; droppedPhantoms: number; keptColumns: number }) {
  return (
    <div className="border border-ink">
      <div className="border-b border-border px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-muted">
        DXF Diagnostics
      </div>
      <div className="p-3 text-[10px] font-mono space-y-1">
        <div>
          <span className="text-muted">layers: </span>
          {ingest.stats.layersFound.join(", ") || "—"}
        </div>
        <div>
          <span className="text-muted">columns (raw → dedup): </span>
          {ingest.stats.columnsBeforeDedup} → {ingest.columns.length}
        </div>
        <div>
          <span className="text-muted">in-slab / phantom: </span>
          <span className={droppedPhantoms > 0 ? "text-accentAmber" : ""}>
            {keptColumns} / {droppedPhantoms} dropped
          </span>
        </div>
        <div>
          <span className="text-muted">entities: </span>
          {Object.entries(ingest.stats.entityCounts)
            .map(([k, v]) => `${k}:${v}`)
            .join("  ")}
        </div>
        <div>
          <span className="text-muted">bounds: </span>
          {`(${ingest.bounds.minX.toFixed(0)}, ${ingest.bounds.minY.toFixed(0)}) → (${ingest.bounds.maxX.toFixed(0)}, ${ingest.bounds.maxY.toFixed(0)}) in`}
        </div>
      </div>
    </div>
  );
}
