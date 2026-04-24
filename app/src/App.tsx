import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ingestDxfWithMapping,
  scanDxfLayers,
  type DxfScan,
  type IngestResult,
  type LayerMapping,
} from "./lib/dxf-ingest";
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
import { TwinSetupPanel, type TwinMaterial, type TwinSystem } from "./components/TwinSetupPanel";
import { WorkflowSelectPanel, type WorkflowId } from "./components/WorkflowSelectPanel";
import { GeometryStage, type GeneratedRole } from "./components/GeometryStage";
import { primeLayerColors } from "./lib/layer-colors";
import { exportExcel, exportDxf, downloadBlob } from "./lib/exports";
import {
  factoredPressurePsi,
  slabSelfWeightPsf,
  totalDeadPsf,
} from "./lib/load-combos";
import { estimateMoPerColumn } from "./lib/static-moment";

const DEFAULT_INPUTS: ProjectInputs = {
  fcPsi: 5000,
  hIn: 8,
  dIn: 7,
  deadPsf: 30,
  livePsf: 50,
  phi: 0.75,
  columnHeightIn: 144,
  columnFarEndFixity: "fixed",
  concreteNu: 0.2,
  meshTargetEdgeIn: 24,
  applyAciDesignAssumptions: true,
};

type SolverDiagnostics =
  | {
      mode: "fea";
      nNodes: number;
      nElements: number;
      iters: number;
      residual: number;
      equilibriumErrPct: number;
      elapsedMs: number;
      totalLoadKip: number;
      colSumKip: number;
      wallSumKip: number;
      stability: "stable" | "degraded" | "unstable";
      stabilityReasons: string[];
      unstableColumnIds: string[];
      meshTier: number;
      meshTierLabel: string;
    }
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
  const [committed, setCommitted] = useState<{ inputs: ProjectInputs } | null>(null);
  // Layer-mapping flow: we hold the uploaded DXF text + scan + editable
  // mapping between upload and Apply. `ingest` is set only after Apply.
  const [dxfText, setDxfText] = useState<string | null>(null);
  const [scan, setScan] = useState<DxfScan | null>(null);
  const [mapping, setMapping] = useState<LayerMapping | null>(null);
  // Digital Twin Builder state — precedes the upload / mapping flow.
  const [twinMaterial, setTwinMaterial] = useState<TwinMaterial | null>(null);
  const [twinSystem, setTwinSystem] = useState<TwinSystem | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowId | null>(null);
  // Roles the user has "generated" as 3D solids in the geometry stage.
  const [generatedRoles, setGeneratedRoles] = useState<Set<GeneratedRole>>(new Set());
  // Twin Setup is a floating overlay that stays open until the user closes it.
  const [twinSetupOpen, setTwinSetupOpen] = useState(true);
  // Geometry stage's upload/layer card is also a floating overlay that
  // persists until the user closes it; reopen from the Header.
  const [geometryCardOpen, setGeometryCardOpen] = useState(true);

  const handleInputsChange = (next: ProjectInputs) => {
    setInputs(next);
    setCommitted(null);
  };

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
      .map(c => ({ ...c }));
  }, [ingest, slab]);

  // Analysis is async (FEA yields to the UI for progress updates).
  const [results, setResults] = useState<ColumnResult[]>([]);
  const [solverDiag, setSolverDiag] = useState<SolverDiagnostics>(null);
  const [feaPerColumn, setFeaPerColumn] = useState<Map<string, FEAUnbalanced> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; pct: number } | null>(null);

  useEffect(() => {
    if (!committed || !slab || columns.length === 0) {
      setResults([]); setSolverDiag(null); setFeaPerColumn(null);
      setAnalyzing(false); setProgress(null);
      return;
    }
    const { inputs: cInputs } = committed;
    let cancelled = false;
    setAnalyzing(true);
    setProgress({ stage: "mesh", pct: 0 });

    (async () => {
      try {
        classifyColumns(slab, columns);
        const tribMap = tributaryAreas(slab, columns, ingest?.walls ?? [], 12);
        columns.forEach((c) => { c.tributaryArea = tribMap.get(c.id) ?? 0; });
        const wu_psi = factoredPressurePsi(cInputs);
        const moMap = estimateMoPerColumn(columns, slab, wu_psi);
        const applyAci = cInputs.applyAciDesignAssumptions ?? true;
        const colById = new Map(columns.map((c) => [c.id, c]));
        const moFloorFor = (id: string) => {
          if (!applyAci) return undefined;
          // Corner-only: interior/edge columns with a stable FEA reliably
          // capture their own Mu. Corners have the smallest tributary,
          // so pattern-loading can dwarf balanced-gravity FEA there —
          // that's where DDM's 0.3·Mo floor is load-bearing.
          const col = colById.get(id);
          if (col?.type !== "corner") return undefined;
          const m = moMap.get(id);
          if (!m) return undefined;
          // mu2 = about x-axis (bending in y) → floored by 0.3·Mo_span_y
          // mu3 = about y-axis (bending in x) → floored by 0.3·Mo_span_x
          return { mu2Floor: 0.3 * m.moSpanY, mu3Floor: 0.3 * m.moSpanX };
        };

        {
          try {
            const fea = await unbalancedMomentsFEA(
              slab, columns, ingest?.walls ?? [], wu_psi, cInputs,
              {
                onProgress: async (stage, f) => {
                  if (cancelled) return;
                  setProgress({ stage, pct: f });
                  // Yield to the browser so the progress bar actually repaints.
                  await new Promise((r) => setTimeout(r, 0));
                },
              },
            );
            if (cancelled) return;
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
              stability: d.stability,
              stabilityReasons: d.stabilityReasons,
              unstableColumnIds: d.unstableColumnIds,
              meshTier: d.meshTier,
              meshTierLabel: d.meshTierLabel,
            };
            const rs = columns.map((c) => {
              const m = fea.perColumn.get(c.id);
              return checkPunching(c, cInputs, m?.mu2, m?.mu3, slab, m?.Vu, moFloorFor(c.id));
            });
            if (cancelled) return;
            setResults(rs); setSolverDiag(diag); setFeaPerColumn(fea.perColumn);
            return;
          } catch (e) {
            if (cancelled) return;
            const msg = e instanceof Error ? e.message : String(e);
            const muMap = unbalancedMoments(slab, columns, ingest?.walls ?? [], wu_psi);
            const rs = columns.map((c) => {
              const m = muMap.get(c.id);
              return checkPunching(c, cInputs, m?.mu2, m?.mu3, slab, undefined, moFloorFor(c.id));
            });
            setResults(rs);
            setSolverDiag({ mode: "efm", reason: `FEA failed: ${msg}` });
            setFeaPerColumn(null);
            return;
          }
        }
      } finally {
        if (!cancelled) { setAnalyzing(false); setProgress(null); }
      }
    })();

    return () => { cancelled = true; };
  }, [committed, slab, columns, ingest?.walls]);

  const resultsMap = useMemo(
    () => new Map(results.map((r) => [r.columnId, r])),
    [results],
  );

  // Scan a DXF and ingest with the suggested mapping. Geometry stage
  // then renders outlines of everything; user clicks Generate per role
  // to progressively materialize 3D solids.
  const beginScan = (text: string) => {
    const s = scanDxfLayers(text);
    // Lock in layer → color assignments in sorted order so shear-wall,
    // slab, columns never collide.
    primeLayerColors(s.layers.map((L) => L.name));
    setDxfText(text);
    setScan(s);
    setMapping(s.suggestedMapping);
    try {
      const ing = ingestDxfWithMapping(text, s.suggestedMapping);
      setIngest(ing);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setCommitted(null);
    setSelected(null);
    setGeneratedRoles(new Set());
    setWorkflow(null);
  };

  // Re-ingest when the user edits the mapping in the geometry stage.
  useEffect(() => {
    if (!dxfText || !mapping) return;
    try {
      const ing = ingestDxfWithMapping(dxfText, mapping);
      setIngest(ing);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [dxfText, mapping]);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      beginScan(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadDemo = async () => {
    setError(null);
    try {
      const r = await fetch("/test-input.dxf");
      const text = await r.text();
      beginScan(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runAnalysis = () => {
    setCommitted({ inputs });
  };
  const canAnalyze = !!slab && columns.length > 0;
  const isDirty = committed === null;

  const reopenMapping = () => {
    // Go back to geometry stage so user can change layers and re-generate.
    setWorkflow(null);
    setCommitted(null);
    setSelected(null);
    setGeneratedRoles(new Set());
  };

  const handleGenerate = (role: GeneratedRole) => {
    setGeneratedRoles((prev) => {
      const next = new Set(prev);
      next.add(role);
      return next;
    });
  };

  const enterPunching = () => {
    setWorkflow("punching");
  };

  const backToWorkflowPicker = () => {
    setWorkflow(null);
    setSelected(null);
    setCommitted(null);
  };

  const restartTwin = () => {
    setTwinMaterial(null);
    setTwinSystem(null);
    setWorkflow(null);
    setIngest(null);
    setScan(null);
    setMapping(null);
    setDxfText(null);
    setCommitted(null);
    setSelected(null);
    setError(null);
  };

  // Digital Twin Builder → Punching Workflow lifecycle.
  //   twin-setup  — pick material + structural system
  //   geometry    — upload DXF, map layers, Generate slab/columns/walls, enter
  //   analyzed    — inside the punching workflow (FEA results view)
  const stage: "twin-setup" | "geometry" | "analyzed" =
    !twinMaterial || !twinSystem
      ? "twin-setup"
      : workflow
      ? "analyzed"
      : "geometry";

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
    const swPsf = slabSelfWeightPsf(inputs);
    const totalDL = totalDeadPsf(inputs);
    lines.push(`Inputs: fc=${inputs.fcPsi}  h=${inputs.hIn}  d=${inputs.dIn}  SDL=${inputs.deadPsf}  self=${swPsf.toFixed(1)}  DL_total=${totalDL.toFixed(1)}  LL=${inputs.livePsf}`);
    const wu_psi = factoredPressurePsi(inputs);
    lines.push(`wu = ${wu_psi.toFixed(3)} psi (${(wu_psi*144).toFixed(0)} psf factored, DL_total includes slab self-weight)`);
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
    <div className="h-full grid relative" style={{ gridTemplateRows: "auto 1fr" }}>
      <Header
        ingest={ingest}
        onFile={handleFile}
        onDemo={loadDemo}
        onAnalyze={runAnalysis}
        canAnalyze={canAnalyze}
        isDirty={isDirty}
        onCopyDebug={copyDebugReport}
        onExportExcel={() => {
          const degraded = solverDiag?.mode === "fea" && solverDiag.stability === "degraded";
          if (degraded && !confirm("Results are DEGRADED. Export anyway? The file will be stamped DO_NOT_SHIP.")) return;
          downloadBlob(exportExcel(results, columns, solverDiag?.mode === "fea" ? solverDiag.stability : undefined), "punching-results.xlsx");
        }}
        onExportDxf={() => {
          const degraded = solverDiag?.mode === "fea" && solverDiag.stability === "degraded";
          if (degraded && !confirm("Results are DEGRADED. Export anyway?")) return;
          downloadBlob(exportDxf(slab, columns, results), "punching-results.dxf");
        }}
        canExport={results.length > 0 && !(solverDiag?.mode === "fea" && solverDiag.stability === "unstable")}
        canReassignLayers={stage === "analyzed" && !!dxfText}
        onReassignLayers={reopenMapping}
        canBackToWorkflows={stage === "analyzed"}
        onBackToWorkflows={backToWorkflowPicker}
        canOpenTwinSetup={!twinSetupOpen}
        onOpenTwinSetup={() => setTwinSetupOpen(true)}
        canOpenGeometryCard={stage === "geometry" && !geometryCardOpen}
        onOpenGeometryCard={() => setGeometryCardOpen(true)}
        stage={stage}
      />

      {stage === "geometry" && (
        <GeometryStage
          dxfText={dxfText}
          scan={scan}
          mapping={mapping}
          ingest={ingest}
          generatedRoles={generatedRoles}
          slab={generatedRoles.has("slab") ? slab : null}
          columns={generatedRoles.has("columns") ? columns : []}
          walls={generatedRoles.has("walls") ? (ingest?.walls ?? []) : []}
          onFile={handleFile}
          onDemo={loadDemo}
          onChangeMapping={setMapping}
          onGenerate={handleGenerate}
          onEnterPunching={enterPunching}
          hSlabIn={inputs.hIn}
          wallHeightIn={inputs.columnHeightIn ?? 144}
          error={error}
          cardOpen={geometryCardOpen}
          onCloseCard={() => setGeometryCardOpen(false)}
          initialCardX={twinSetupOpen ? 40 + 620 + 16 : 40}
          initialCardY={40}
        />
      )}

      {stage === "analyzed" && (
      <div
        className="grid gap-3 p-3"
        style={{ gridTemplateColumns: "320px 1fr 380px", minHeight: 0 }}
      >
        <div className="flex flex-col gap-3 min-h-0 overflow-auto">
          <InputsPanel inputs={inputs} onChange={handleInputsChange} />
          {solverDiag && <SolverPanel diag={solverDiag} />}
          {ingest && <Diagnostics ingest={ingest} droppedPhantoms={ingest.columns.length - columns.length} keptColumns={columns.length} />}
          {error && (
            <div className="border border-accentRed text-accentRed p-2 text-[10px] font-mono">
              {error}
            </div>
          )}
        </div>

        <div className="min-h-0 relative">
          <Floor3D
            slab={slab}
            columns={columns}
            walls={ingest?.walls ?? []}
            results={resultsMap}
            hSlabIn={inputs.hIn}
            wallHeightIn={inputs.columnHeightIn}
            selectedColumn={selected}
            onSelect={setSelected}
          />
          {analyzing && <AnalyzingOverlay progress={progress} />}
        </div>

        <div className="min-h-0">
          <ResultsTable
            results={results}
            selected={selected}
            onSelect={setSelected}
            unstableColumnIds={
              solverDiag?.mode === "fea"
                ? new Set(solverDiag.unstableColumnIds)
                : undefined
            }
          />
        </div>
      </div>
      )}

      {twinSetupOpen && (
        <div className="absolute inset-0 pointer-events-none z-50" style={{ gridRow: "1 / span 2" }}>
          <div className="pointer-events-none h-full">
            <TwinSetupPanel
              material={twinMaterial}
              system={twinSystem}
              onChange={(m, s) => { setTwinMaterial(m); setTwinSystem(s); }}
              onContinue={() => {
                if (!twinMaterial) setTwinMaterial("concrete");
                if (!twinSystem) setTwinSystem("flat-plate-ordinary-walls");
              }}
              onClose={() => setTwinSetupOpen(false)}
              canClose={!!(twinMaterial && twinSystem)}
            />
          </div>
        </div>
      )}
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
  ingest, onFile, onDemo, onAnalyze, canAnalyze, isDirty,
  onCopyDebug, onExportExcel, onExportDxf, canExport,
  canReassignLayers, onReassignLayers,
  canBackToWorkflows, onBackToWorkflows,
  canOpenTwinSetup, onOpenTwinSetup,
  canOpenGeometryCard, onOpenGeometryCard,
  stage,
}: {
  ingest: IngestResult | null;
  onFile: (f: File) => void;
  onDemo: () => void;
  onAnalyze: () => void;
  canAnalyze: boolean;
  isDirty: boolean;
  onCopyDebug: () => void;
  onExportExcel: () => void;
  onExportDxf: () => void;
  canExport: boolean;
  canReassignLayers: boolean;
  onReassignLayers: () => void;
  canBackToWorkflows: boolean;
  onBackToWorkflows: () => void;
  canOpenTwinSetup: boolean;
  onOpenTwinSetup: () => void;
  canOpenGeometryCard: boolean;
  onOpenGeometryCard: () => void;
  stage: "twin-setup" | "geometry" | "analyzed";
}) {
  const showAnalysisControls = stage === "analyzed";
  const stageLabel =
    stage === "twin-setup" ? "Digital Twin · setup"
    : stage === "geometry" ? "Digital Twin · geometry"
    : "Workflow · Punching Shear";
  return (
    <header className="border-b border-ink px-3 py-2 flex items-center gap-3 text-[11px]">
      <div className="text-[9px] uppercase tracking-[0.24em] text-muted">Perfect Punching</div>
      <div className="font-semibold">{stageLabel}</div>
      <div className="flex-1" />
      {canBackToWorkflows && (
        <button
          onClick={onBackToWorkflows}
          className="border border-ink px-2 py-1 hover:bg-subtle uppercase tracking-wider text-[10px]"
          title="Back to geometry builder"
        >
          ← Geometry
        </button>
      )}
      {canOpenTwinSetup && (
        <button
          onClick={onOpenTwinSetup}
          className="border border-ink px-2 py-1 hover:bg-subtle uppercase tracking-wider text-[10px]"
          title="Reopen Digital Twin Builder"
        >
          Twin Setup
        </button>
      )}
      {canOpenGeometryCard && (
        <button
          onClick={onOpenGeometryCard}
          className="border border-ink px-2 py-1 hover:bg-subtle uppercase tracking-wider text-[10px]"
          title="Reopen geometry panel"
        >
          Geometry Panel
        </button>
      )}
      {stage === "analyzed" && (
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
      )}
      {stage === "analyzed" && (
        <button onClick={onDemo} className="border border-ink px-2 py-1 hover:bg-subtle uppercase tracking-wider text-[10px]">
          Load Demo
        </button>
      )}
      {canReassignLayers && (
        <button
          onClick={onReassignLayers}
          className="border border-ink px-2 py-1 hover:bg-subtle uppercase tracking-wider text-[10px]"
          title="Re-open layer assignment for the currently loaded DXF"
        >
          Change Layers
        </button>
      )}
      {showAnalysisControls && (
        <>
          <button
            onClick={onAnalyze}
            disabled={!canAnalyze}
            className={`border px-2 py-1 uppercase tracking-wider text-[10px] disabled:opacity-30 disabled:cursor-not-allowed ${
              canAnalyze && isDirty
                ? "border-accentRed bg-accentRed/10 text-accentRed"
                : "border-ink hover:bg-subtle"
            }`}
            title={isDirty ? "Inputs changed — click to run analysis" : "Results are up to date"}
          >
            {isDirty ? "Analyze" : "Analyzed"}
          </button>
          <button
            onClick={onCopyDebug}
            disabled={!canExport}
            className="border border-ink px-2 py-1 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-subtle uppercase tracking-wider text-[10px]"
            title="Copy per-column FEA diagnostics to clipboard"
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
        </>
      )}
      {ingest && stage === "analyzed" && (
        <span className="text-[9px] text-muted">
          {ingest.slabs.length} slab · {ingest.columns.length} cols · {ingest.walls.length} walls
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
      <StabilityBanner stability={diag.stability} reasons={diag.stabilityReasons} />
      <div className="p-3 text-[10px] font-mono space-y-1">
        <div>
          <span className="text-muted">mesh: </span>
          {diag.nNodes} nodes · {diag.nElements} elements · tier {diag.meshTier} ({diag.meshTierLabel})
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

function AnalyzingOverlay({
  progress,
}: {
  progress: { stage: string; pct: number } | null;
}) {
  const stage = progress?.stage ?? "mesh";
  const stageIndex = { mesh: 0, assemble: 1, solve: 2, recover: 3 }[stage as "mesh" | "assemble" | "solve" | "recover"] ?? 0;
  // Weight each stage so the overall bar fills smoothly across the run.
  const weights = [0.10, 0.10, 0.75, 0.05];
  const overall = weights.slice(0, stageIndex).reduce((a, b) => a + b, 0) +
    weights[stageIndex] * (progress?.pct ?? 0);
  const overallPct = Math.min(100, overall * 100);
  return (
    <div className="absolute inset-0 bg-paper/85 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
      <div className="w-[420px] border border-ink bg-paper p-4 font-mono">
        <div className="text-[9px] uppercase tracking-[0.24em] text-muted mb-2">Analyzing · Plate FEA</div>
        <div className="text-[11px] mb-3">
          <span className="text-muted">stage: </span>
          <span className="font-semibold">{stageLabel(stage)}</span>
          {progress && <span className="text-muted"> · {Math.round((progress.pct ?? 0) * 100)}%</span>}
        </div>
        <div className="h-2 w-full border border-ink">
          <div
            className="h-full bg-accentBlue transition-[width] duration-150"
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <div className="mt-2 text-[9px] text-muted tabular-nums">
          {overallPct.toFixed(0)}% overall
        </div>
        <StageTimeline current={stageIndex} />
      </div>
    </div>
  );
}

function stageLabel(s: string): string {
  switch (s) {
    case "mesh": return "meshing (poly2tri CDT)";
    case "assemble": return "assembling stiffness + loads";
    case "solve": return "CG solve";
    case "recover": return "recovering per-column forces";
    default: return s;
  }
}

function StageTimeline({ current }: { current: number }) {
  const labels = ["mesh", "assemble", "solve", "recover"];
  return (
    <div className="mt-3 flex items-center gap-1">
      {labels.map((label, i) => (
        <div
          key={label}
          className={
            "flex-1 text-center text-[8px] uppercase tracking-[0.16em] border px-1 py-0.5 " +
            (i < current ? "border-accentBlue text-accentBlue" :
             i === current ? "border-ink bg-ink text-paper" :
             "border-border text-muted")
          }
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function StabilityBanner({
  stability, reasons,
}: {
  stability: "stable" | "degraded" | "unstable";
  reasons: string[];
}) {
  if (stability === "stable") {
    return (
      <div className="border-b border-border px-3 py-1.5 text-[10px] font-mono flex items-center gap-2 text-accentGreen">
        <span className="inline-block w-2 h-2 bg-accentGreen" aria-hidden />
        <span>STABLE — per-column Mu is trusted</span>
      </div>
    );
  }
  const isUnstable = stability === "unstable";
  const bg = isUnstable ? "bg-accentRed/10" : "bg-accentAmber/10";
  const border = isUnstable ? "border-accentRed" : "border-accentAmber";
  const fg = isUnstable ? "text-accentRed" : "text-accentAmber";
  const title = isUnstable
    ? "UNSTABLE — do NOT ship these values"
    : "DEGRADED — review flagged columns before shipping";
  return (
    <div className={`border-b ${border} ${bg} px-3 py-2 text-[10px] font-mono space-y-1`}>
      <div className={`font-bold ${fg} uppercase tracking-[0.12em]`}>{title}</div>
      {reasons.length > 0 && (
        <ul className="list-disc pl-4 space-y-0.5">
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
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
