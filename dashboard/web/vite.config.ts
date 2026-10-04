import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync } from "node:fs";

/** MapLibre 6 runs a module worker that imports a shared chunk next to it;
 *  serve both from /maplibre/ so they work in dev and in production builds. */
function maplibreWorker() {
  const copy = () => {
    const from = fileURLToPath(new URL("../node_modules/maplibre-gl/dist/", import.meta.url));
    const to = fileURLToPath(new URL("./public/maplibre/", import.meta.url));
    mkdirSync(to, { recursive: true });
    for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(from + f, to + f);
  };
  return { name: "maplibre-worker", config: () => { copy(); return {}; } };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), maplibreWorker()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@digilite/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
