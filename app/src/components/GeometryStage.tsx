/**
 * Digital Twin Builder — stage 2 (geometry).
 *
 * Full-bleed 3D canvas with a floating card overlaid.  The card starts
 * as a tiny upload prompt; once a DXF is loaded, it expands into the
 * layer list with smart-selected roles and per-role "Generate" buttons.
 * Clicking each Generate materializes the slab / columns / walls as
 * extrusions dropping DOWN from the DXF outline plane.
 */
import { useEffect, useRef, useState } from "react";
import { Floor3D } from "../scenes/Floor3D";
import type { Column, ColumnResult, Polygon, Slab, Wall } from "../lib/types";
import { layerColor } from "../lib/layer-colors";
import {
  ALL_ROLES,
  type DxfScan,
  type IngestResult,
  type LayerMapping,
  type LayerRole,
} from "../lib/dxf-ingest";

const ROLE_LABEL: Record<LayerRole, string> = {
  slab: "Slab",
  columns: "Columns",
  walls: "Walls",
  "column-labels": "Labels",
  ignore: "Ignore",
};

export type GeneratedRole = Extract<LayerRole, "slab" | "columns" | "walls">;

export function GeometryStage({
  dxfText, scan, mapping, ingest,
  generatedRoles,
  slab, columns, walls,
  onFile, onDemo,
  onChangeMapping,
  onGenerate,
  onEnterPunching,
  hSlabIn, wallHeightIn,
  error,
  cardOpen, onCloseCard,
  initialCardX = 680, initialCardY = 40,
}: {
  dxfText: string | null;
  scan: DxfScan | null;
  mapping: LayerMapping | null;
  ingest: IngestResult | null;
  generatedRoles: Set<GeneratedRole>;
  slab: Polygon | null;
  columns: Column[];
  walls: Wall[];
  onFile: (f: File) => void;
  onDemo: () => void;
  onChangeMapping: (next: LayerMapping) => void;
  onGenerate: (role: GeneratedRole) => void;
  onEnterPunching: () => void;
  hSlabIn: number;
  wallHeightIn: number;
  error?: string | null;
  cardOpen: boolean;
  onCloseCard: () => void;
  initialCardX?: number;
  initialCardY?: number;
}) {
  const ready = dxfText && scan && mapping && ingest;
  const canEnter = generatedRoles.has("slab") && generatedRoles.has("columns");

  const outlineSlab: Slab | null = ingest && ingest.slabs.length > 0
    ? ingest.slabs.reduce((a, b) => {
        const aa = Math.abs(ringArea(a.polygon.outer));
        const bb = Math.abs(ringArea(b.polygon.outer));
        return aa > bb ? a : b;
      })
    : null;
  const outlineColumns = ingest?.columns ?? [];
  const outlineWalls = ingest?.walls ?? [];

  return (
    <div className="relative h-full w-full">
      {/* 3D canvas fills the stage */}
      <Floor3D
        slab={slab}
        columns={columns}
        walls={walls}
        results={new Map<string, ColumnResult>()}
        hSlabIn={hSlabIn}
        wallHeightIn={wallHeightIn}
        selectedColumn={null}
        onSelect={() => {}}
        outlineSlab={outlineSlab}
        outlineColumns={outlineColumns}
        outlineWalls={outlineWalls}
      />

      {cardOpen && (
        <FloatingCard
          title={ready ? "UPLOAD + LAYER MAP" : "UPLOAD DXF"}
          width={ready ? 540 : 360}
          initialX={initialCardX}
          initialY={initialCardY}
          onClose={onCloseCard}
        >
          {!ready && <UploadCard onFile={onFile} onDemo={onDemo} />}
          {ready && scan && mapping && (
            <LayersCard
              scan={scan}
              mapping={mapping}
              generatedRoles={generatedRoles}
              onChangeMapping={onChangeMapping}
              onGenerate={onGenerate}
              onEnterPunching={onEnterPunching}
              canEnter={!!canEnter}
            />
          )}
        </FloatingCard>
      )}

      {error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 border border-accentRed bg-paper text-accentRed text-[11px] font-mono px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

function FloatingCard({
  title, hint, width, initialX, initialY, onClose, children,
}: {
  title: string;
  hint?: string;
  width: number;
  initialX: number;
  initialY: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  // Reposition whenever the parent hands us a new initial position
  // (e.g., when the card is reopened).
  useEffect(() => {
    setPos({ x: initialX, y: initialY });
  }, [initialX, initialY]);

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
  return (
    <div
      className="absolute border border-ink bg-paper shadow-2xl"
      style={{ left: pos.x, top: pos.y, width }}
    >
      <header
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        className="cursor-move bg-ink text-paper px-3 py-1.5 flex items-center gap-2 select-none"
      >
        <span className="text-[11px] font-semibold tracking-wider">{title}</span>
        <span className="flex-1" />
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center text-[13px] leading-none hover:bg-paper/20"
          aria-label="Close panel"
        >
          ×
        </button>
      </header>
      {children}
    </div>
  );
}

function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

// ---- Upload card (small floating box pre-upload) ----

function UploadCard({
  onFile, onDemo,
}: {
  onFile: (f: File) => void;
  onDemo: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.toLowerCase().endsWith(".dxf")) onFile(f);
  };
  return (
    <div className="p-4">
      <div className="text-[9px] uppercase tracking-[0.24em] text-muted mb-1">
        Step 2 of 3 · Geometry
      </div>
      <div className="text-[13px] font-semibold mb-3">Upload the floor-plan DXF</div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={
          "border-2 border-dashed cursor-pointer px-4 py-6 text-center select-none " +
          (dragOver ? "border-accentBlue bg-accentBlue/5" : "border-ink hover:bg-subtle/40")
        }
      >
        <div className="text-[11px]">Drop .dxf or click to browse</div>
        <input
          ref={inputRef}
          type="file"
          accept=".dxf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.currentTarget.value = "";
          }}
        />
      </div>
      <div className="mt-2 flex items-center text-[10px]">
        <button
          type="button"
          onClick={onDemo}
          className="border border-ink px-2 py-1 uppercase tracking-wider hover:bg-subtle"
        >
          Load demo
        </button>
      </div>
    </div>
  );
}

// ---- Layers card (expanded floating box after upload) ----

function LayersCard({
  scan, mapping,
  generatedRoles,
  onChangeMapping,
  onGenerate,
  onEnterPunching,
  canEnter,
}: {
  scan: DxfScan;
  mapping: LayerMapping;
  generatedRoles: Set<GeneratedRole>;
  onChangeMapping: (next: LayerMapping) => void;
  onGenerate: (role: GeneratedRole) => void;
  onEnterPunching: () => void;
  canEnter: boolean;
}) {
  const setRole = (layer: string, role: LayerRole) =>
    onChangeMapping({ ...mapping, [layer]: role });
  const roleHasAnyLayer = (r: GeneratedRole) =>
    scan.layers.some((L) => (mapping[L.name] ?? "ignore") === r);

  return (
    <div>
      <div className="border-b border-ink px-4 py-2 flex items-center gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-[0.24em] text-muted">
            Step 2 of 3 · Geometry
          </div>
          <div className="text-[12px] font-semibold">Assign layers + generate</div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          disabled={!canEnter}
          onClick={onEnterPunching}
          className={
            "border px-3 py-1.5 text-[10px] uppercase tracking-wider " +
            (canEnter
              ? "border-accentBlue bg-accentBlue text-paper hover:opacity-90"
              : "border-border text-muted cursor-not-allowed")
          }
          title={canEnter ? "Enter Punching Analysis" : "Generate slab + columns first"}
        >
          Enter Punching Analysis →
        </button>
      </div>

      <div className="max-h-[260px] overflow-auto px-2 py-1">
        <table className="w-full text-[10px] font-mono">
          <thead className="text-[8px] uppercase tracking-wider text-muted">
            <tr>
              <th className="text-left px-2 py-1">Layer</th>
              <th className="text-left px-2 py-1">Entities</th>
              <th className="text-left px-2 py-1">Role</th>
            </tr>
          </thead>
          <tbody>
            {scan.layers.map((L) => {
              const current = mapping[L.name] ?? "ignore";
              const color = layerColor(L.name);
              return (
                <tr key={L.name} className="border-t border-border/40">
                  <td className="px-2 py-1 align-top">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 shrink-0"
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                      <span style={{ color }}>{L.name || "(no layer)"}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1 align-top text-muted">
                    {Object.entries(L.entityCounts)
                      .map(([t, n]) => `${t}×${n}`)
                      .join("  ") || "—"}
                  </td>
                  <td className="px-2 py-1 align-top">
                    <select
                      value={current}
                      onChange={(e) => setRole(L.name, e.target.value as LayerRole)}
                      className="border border-ink px-1.5 py-0.5 text-[10px] bg-paper"
                    >
                      {ALL_ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-ink px-3 py-2 flex items-center gap-2">
        {(["slab", "columns", "walls"] as GeneratedRole[]).map((r) => {
          const generated = generatedRoles.has(r);
          const hasLayer = roleHasAnyLayer(r);
          return (
            <button
              key={r}
              type="button"
              disabled={!hasLayer || generated}
              onClick={() => onGenerate(r)}
              className={
                "border px-2 py-1 text-[10px] uppercase tracking-wider " +
                (generated
                  ? "border-accentGreen bg-accentGreen/10 text-accentGreen cursor-default"
                  : !hasLayer
                  ? "border-border text-muted cursor-not-allowed"
                  : "border-ink hover:bg-subtle")
              }
            >
              {generated ? `✓ ${ROLE_LABEL[r]}` : `Generate ${ROLE_LABEL[r]}`}
            </button>
          );
        })}
        <div className="flex-1" />
        <span className="text-[9px] text-muted">extrudes down from DXF plane</span>
      </div>
    </div>
  );
}
