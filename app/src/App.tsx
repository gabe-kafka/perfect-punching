import { useMemo, useState } from "react";
import { ingestDxf, type IngestResult } from "./lib/dxf-ingest";
import { largest } from "./lib/geom";
import { tributaryAreas } from "./lib/voronoi";
import { classifyColumns } from "./lib/classify";
import { checkPunching } from "./lib/punching";
import { unbalancedMoments } from "./lib/efm";
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
};

export default function App() {
  const [inputs, setInputs] = useState<ProjectInputs>(DEFAULT_INPUTS);
  const [ingest, setIngest] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const slab = useMemo(() => {
    if (!ingest) return null;
    return largest(ingest.slabs.map((s) => s.polygon));
  }, [ingest]);

  // Apply default column sizes to ingested columns
  const columns = useMemo(() => {
    if (!ingest) return [];
    return ingest.columns.map((c) => ({
      ...c,
      c1: c.c1 || inputs.defaultC1,
      c2: c.c2 || inputs.defaultC2,
    }));
  }, [ingest, inputs.defaultC1, inputs.defaultC2]);

  const results: ColumnResult[] = useMemo(() => {
    if (!slab || columns.length === 0) return [];
    classifyColumns(slab, columns);
    const tribMap = tributaryAreas(slab, columns, ingest?.walls ?? [], 12);
    columns.forEach((c) => {
      c.tributaryArea = tribMap.get(c.id) ?? 0;
    });
    const wu_psi = (1.2 * inputs.deadPsf + 1.6 * inputs.livePsf) / 144;
    const muMap = unbalancedMoments(slab, columns, ingest?.walls ?? [], wu_psi);
    return columns.map((c) => {
      const m = muMap.get(c.id);
      return checkPunching(c, inputs, m?.mu2, m?.mu3);
    });
  }, [slab, columns, inputs]);

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

  return (
    <div className="h-full grid" style={{ gridTemplateRows: "auto 1fr" }}>
      <Header
        ingest={ingest}
        onFile={handleFile}
        onDemo={loadDemo}
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
          {ingest && <Diagnostics ingest={ingest} />}
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

function Header({
  ingest, onFile, onDemo, onExportExcel, onExportDxf, canExport,
}: {
  ingest: IngestResult | null;
  onFile: (f: File) => void;
  onDemo: () => void;
  onExportExcel: () => void;
  onExportDxf: () => void;
  canExport: boolean;
}) {
  return (
    <header className="border-b border-ink px-3 py-2 flex items-center gap-3 text-[11px]">
      <div className="text-[9px] uppercase tracking-[0.24em] text-muted">Perfect Punching</div>
      <div className="font-semibold">DXF · Punching Shear · Per-Column DCR</div>
      <div className="flex-1" />
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
          {ingest.slabs.length} slab · {ingest.columns.length} cols · {ingest.walls.length} walls
        </span>
      )}
    </header>
  );
}

function Diagnostics({ ingest }: { ingest: IngestResult }) {
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
