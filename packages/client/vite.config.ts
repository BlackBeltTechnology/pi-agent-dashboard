import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
// Import via a relative workspace path so vite's esbuild config-loader bundles
// the plugin (and its transitive .ts deps) into the temp config bundle. Using
// the package specifier "@blackbelt-technology/dashboard-plugin-runtime"
// instead would externalize the module and hit ERR_MODULE_NOT_FOUND because
// the runtime ships raw .ts (no compiled dist) and Node can't resolve
// `.js`-extensioned internal imports back to `.ts` at runtime.
import { viteDashboardPluginsPlugin } from "../dashboard-plugin-runtime/src/vite-plugin/index.js";

/**
 * Resolve the dashboard HTTP port for Vite proxy targets.
 *
 * Resolution order:
 *   1. PI_DASHBOARD_PORT env var (if set and parseable as 1–65535)
 *   2. /tmp/dash-dev-port marker file (dash-dev.sh writes this)
 *   3. port field from ~/.pi/dashboard/config.json
 *   4. Fallback: 8000
 *
 * Errors (missing config, bad JSON, invalid env) are silently swallowed;
 * the dev server starts with the fallback port.
 */
function resolveDashboardPort(): number {
  // 1. Env var
  const envPort = process.env.PI_DASHBOARD_PORT;
  if (envPort !== undefined) {
    const parsed = parseInt(envPort, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed;
    }
  }
  // 2. dash-dev.sh marker file
  try {
    const raw = fs.readFileSync("/tmp/dash-dev-port", "utf-8").trim();
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed;
    }
  } catch {
    // File missing or unreadable — fall through
  }
  // 3. Config file
  try {
    const configPath = path.join(os.homedir(), ".pi", "dashboard", "config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw);
    if (typeof cfg.port === "number" && Number.isFinite(cfg.port) && cfg.port >= 1 && cfg.port <= 65535) {
      return cfg.port;
    }
  } catch {
    // Missing file, bad JSON, wrong shape — fall through
  }
  // 4. Fallback
  return 8000;
}

const DASHBOARD_PORT = resolveDashboardPort();

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteDashboardPluginsPlugin(path.resolve(__dirname, "../..")),
  ],
  root: "src",
  // publicDir is resolved relative to `root` (= packages/client/src/), so three
  // `../` hops are needed to reach the project-root public/ directory which
  // holds icon-192.png, manifest.json, sw.js, etc.
  publicDir: "../../../public",
  resolve: {
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
      "@blackbelt-technology/pi-dashboard-client-utils": path.resolve(__dirname, "../client-utils/src"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Split the main bundle so no single chunk exceeds ~500 KB. This avoids
    // zrok / free-tunnel aborts on large static assets and improves caching
    // (only changed chunks invalidate).
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const chunks: Record<string, string[]> = {
            "react-vendor": ["react", "react-dom"],
            "markdown": ["react-markdown", "remark-gfm", "rehype-raw", "dompurify"],
            "syntax": ["react-syntax-highlighter"],
            "diff": [
              "@git-diff-view/core",
              "@git-diff-view/file",
              "@git-diff-view/lowlight",
              "@git-diff-view/react",
              "diff",
            ],
            "xterm": [
              "@xterm/xterm",
              "@xterm/addon-attach",
              "@xterm/addon-fit",
            ],
            "dnd": [
              "@dnd-kit/core",
              "@dnd-kit/sortable",
              "@dnd-kit/utilities",
            ],
            "util": ["fuse.js", "qrcode", "wouter", "ansi-to-react"],
            // Monaco is heavy + only referenced by the lazily-imported
            // MonacoBuffer, so this chunk is fetched on first text-file open.
            // See change: add-internal-monaco-editor-pane.
            "monaco": ["monaco-editor", "@monaco-editor/react"],
          };
          for (const [chunk, deps] of Object.entries(chunks)) {
            if (deps.some((dep) => id.includes(`/node_modules/${dep}/`))) {
              return chunk;
            }
          }
        },
      },
    },
    // Raise the warning limit — mermaid and cytoscape chunks are already
    // code-split by vite's dynamic-import detection and don't need further
    // splitting.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 3000,
    hmr: {
      // HMR WebSocket must connect directly to Vite's port, not the dashboard's.
      clientPort: 3000,
    },
    proxy: {
      "/api": `http://localhost:${DASHBOARD_PORT}`,
      "/ws": {
        target: `ws://localhost:${DASHBOARD_PORT}`,
        ws: true,
      },
    },
  },
});
