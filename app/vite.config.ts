import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5179, host: "127.0.0.1", strictPort: false },
  // poly2tri is UMD/CJS and references `global` at module load; browsers
  // don't define it.  index.html ships a tiny polyfill before modules load.
});
