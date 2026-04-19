import type { ColumnResult } from "../lib/types";

export function ResultsTable({
  results, selected, onSelect,
}: {
  results: ColumnResult[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="border border-ink">
      <div className="border-b border-border px-3 py-2 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.18em] text-muted">
          Results · {results.length} columns
        </span>
        <span className="text-[9px] uppercase tracking-[0.18em] text-muted">
          {results.filter((r) => r.dcr > 1).length} fail
        </span>
      </div>
      <div className="overflow-auto max-h-[420px]">
        <table className="w-full text-[10px] font-mono leading-tight">
          <thead className="sticky top-0 bg-paper border-b border-border">
            <tr className="text-[8px] uppercase tracking-wider text-muted">
              <Th>id</Th>
              <Th>type</Th>
              <Th right>P_u (k)</Th>
              <Th right>M_u (k-ft)</Th>
              <Th right>b_0 (in)</Th>
              <Th right>v_u (psi)</Th>
              <Th right>φv_c (psi)</Th>
              <Th right>DCR</Th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.columnId}
                onClick={() => onSelect(r.columnId === selected ? null : r.columnId)}
                className={
                  "cursor-pointer border-b border-border/40 " +
                  (r.columnId === selected ? "bg-subtle" : "hover:bg-subtle/40")
                }
              >
                <Td>{r.columnId}</Td>
                <Td>{r.type}</Td>
                <Td right>{(r.vu / 1000).toFixed(1)}</Td>
                <Td right>{(r.mu / 12000).toFixed(1)}</Td>
                <Td right>{r.b0.toFixed(0)}</Td>
                <Td right>{r.vuMaxPsi.toFixed(0)}</Td>
                <Td right>{r.phiVcPsi.toFixed(0)}</Td>
                <Td right>
                  <span
                    className={
                      r.dcr > 1
                        ? "text-accentRed font-bold"
                        : r.dcr > 0.85
                        ? "text-accentAmber"
                        : "text-accentGreen"
                    }
                  >
                    {r.dcr.toFixed(2)}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={"px-2 py-1 " + (right ? "text-right" : "text-left")}>{children}</th>
  );
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td className={"px-2 py-1 " + (right ? "text-right tabular-nums" : "text-left")}>{children}</td>
  );
}
