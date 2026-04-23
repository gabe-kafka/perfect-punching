import { useRef, useState } from "react";

export function UploadPanel({
  onFile,
  onDemo,
  error,
}: {
  onFile: (file: File) => void;
  onDemo: () => void;
  error?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.toLowerCase().endsWith(".dxf")) onFile(f);
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={
          "max-w-xl w-full border-2 border-dashed cursor-pointer select-none " +
          "flex flex-col items-center justify-center gap-3 py-16 px-8 " +
          (dragOver
            ? "border-accentBlue bg-accentBlue/5"
            : "border-ink hover:bg-subtle/40")
        }
      >
        <div className="text-[9px] uppercase tracking-[0.28em] text-muted">
          Perfect Punching
        </div>
        <div className="text-sm font-semibold">
          Upload arch .dxf
        </div>
        <div className="text-[11px] text-muted text-center max-w-sm">
          Drop a DXF here, or click to browse. Next step lets you assign each
          layer to <b>Slab</b>, <b>Columns</b>, or <b>Walls</b>.
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDemo();
          }}
          className="mt-3 border border-ink px-3 py-1 text-[10px] uppercase tracking-wider hover:bg-subtle"
        >
          Or load the demo DXF
        </button>
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
      {error && (
        <div className="absolute bottom-6 border border-accentRed bg-accentRed/5 text-accentRed text-[11px] font-mono px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
