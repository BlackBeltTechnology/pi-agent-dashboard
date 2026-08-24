import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Static build with RELATIVE base so the bundle works under the dashboard
// live-server proxy subpath (/live/<id>/) inside a sandboxed iframe.
export default defineConfig({
  base: "./",
  root: resolve(import.meta.dirname, "preview"),
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom", "@mui/material", "@emotion/react", "@emotion/styled"],
  },
  build: {
    outDir: resolve(import.meta.dirname, "canvas-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "preview/canvas-index.html"),
    },
  },
});
