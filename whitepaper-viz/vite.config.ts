import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5178, host: "127.0.0.1", strictPort: false },
  // opencascade.js ships its own WASM + emscripten runtime; don't prebundle it.
  optimizeDeps: { exclude: ["opencascade.js"] },
  // Vite treats .wasm imports as URL assets by default; nothing else needed.
  assetsInclude: ["**/*.wasm"],
  build: {
    // emscripten module is huge — raise warning threshold instead of spam.
    chunkSizeWarningLimit: 80_000,
  },
});
