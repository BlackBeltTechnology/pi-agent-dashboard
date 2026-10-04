import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Copy the built index.html to 404.html in the shell's dist.
 *
 * On the deployed site this copy is NOT what answers an unknown path: GitHub
 * Pages serves the repository-root 404 page (`site/404.html`) for any
 * unmatched path, including paths under the shell's `/app/` subpath. The
 * copied `dist/404.html` is reached only if the shell is ever deployed at a
 * Pages root. Inert in practice: the shell uses hash routing, so deep links
 * never reach the server as paths. See change: fix-ci-pipeline-followups.
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
