import * as XLSX from "xlsx";
import Drawing from "dxf-writer";
import type { Column, ColumnResult, Polygon } from "./types";

export function exportExcel(results: ColumnResult[], columns: Column[]): Blob {
  const colById = new Map(columns.map((c) => [c.id, c]));
  const rows = results.map((r) => {
    const c = colById.get(r.columnId);
    return {
      Column: r.columnId,
      X_in: c?.position[0]?.toFixed(2) ?? "",
      Y_in: c?.position[1]?.toFixed(2) ?? "",
      Type: r.type,
      "P_u (kip)": (r.vu / 1000).toFixed(2),
      "M_u (kip-ft)": (r.mu / 12000).toFixed(2),
      "Tributary (ft^2)": (r.tributaryAreaIn2 / 144).toFixed(1),
      "b_0 (in)": r.b0.toFixed(1),
      "J_c (in^4)": r.jc.toExponential(2),
      "v_u,max (psi)": r.vuMaxPsi.toFixed(1),
      "phi*v_c (psi)": r.phiVcPsi.toFixed(1),
      DCR: r.dcr.toFixed(3),
      Pass: r.dcr <= 1 ? "OK" : "FAIL",
    };
  });

  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "PUNCHING");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function exportDxf(
  slab: Polygon | null,
  columns: Column[],
  results: ColumnResult[],
): Blob {
  const d = new Drawing();
  d.setUnits("Inches");

  d.addLayer("SLAB", Drawing.ACI.WHITE, "CONTINUOUS");
  d.addLayer("COLUMN-REAL", Drawing.ACI.WHITE, "CONTINUOUS");
  d.addLayer("COLUMN-LABEL", Drawing.ACI.WHITE, "CONTINUOUS");
  d.addLayer("PUNCHING-OK", Drawing.ACI.GREEN, "CONTINUOUS");
  d.addLayer("PUNCHING-FAIL", Drawing.ACI.RED, "CONTINUOUS");
  d.addLayer("PUNCHING-RESULT", Drawing.ACI.WHITE, "CONTINUOUS");

  if (slab) {
    d.setActiveLayer("SLAB");
    const r = slab.outer;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      d.drawLine(a[0], a[1], b[0], b[1]);
    }
  }

  const byId = new Map(columns.map((c) => [c.id, c]));
  for (const res of results) {
    const c = byId.get(res.columnId);
    if (!c) continue;
    const x = c.position[0];
    const y = c.position[1];

    const pass = res.dcr <= 1;
    d.setActiveLayer(pass ? "PUNCHING-OK" : "PUNCHING-FAIL");

    // Column footprint
    const hx = c.c1 / 2;
    const hy = c.c2 / 2;
    d.drawLine(x - hx, y - hy, x + hx, y - hy);
    d.drawLine(x + hx, y - hy, x + hx, y + hy);
    d.drawLine(x + hx, y + hy, x - hx, y + hy);
    d.drawLine(x - hx, y + hy, x - hx, y - hy);

    d.setActiveLayer("PUNCHING-RESULT");
    const lines = [
      `${res.columnId} (${res.type})`,
      `Pu=${(res.vu / 1000).toFixed(1)}k  Mu=${(res.mu / 12000).toFixed(1)}k-ft`,
      `DCR=${res.dcr.toFixed(2)}  ${pass ? "OK" : "FAIL"}`,
    ];
    const h = 6; // text height (in)
    lines.forEach((line, i) => {
      d.drawText(x + hx + 6, y - i * (h * 1.4), h, 0, line);
    });
  }

  return new Blob([d.toDxfString()], { type: "application/dxf" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
