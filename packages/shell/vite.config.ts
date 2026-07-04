import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";

/**
 * GitHub Pages has no server-side rewrites, so a deep hash-routed URL that is
 * hard-reloaded (or a stray non-hash path) would 404. Copy the built
 * index.html to 404.html so Pages serves the SPA shell for any unknown path;
 * the client-side hash router then takes over.
 */
function spa404Fallback(): Plugin {
  return {
    name: "spa-404-fallback",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist");
      const index = path.join(outDir, "index.html");
      if (fs.existsSync(index)) {
        fs.copyFileSync(index, path.join(outDir, "404.html"));
      }
    },
  };
}

export default defineConfig({
  // Relative base so the static bundle works from any GitHub Pages subpath.
  base: "./",
  plugins: [react(), tailwindcss(), spa404Fallback()],
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 3100,
  },
});
