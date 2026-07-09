import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Worktree client source. The node_modules symlink for pi-dashboard-web points
// at the MAIN repo checkout (which lacks this worktree's `exports` map and new
// files), so alias the subpath straight at the worktree barrel source. Vite
// follows the barrel's relative imports through the rest of the 107-file
// subtree — all under packages/, so @vitejs/plugin-react transforms the raw
// .tsx (it only skips node_modules).
const clientSrc = path.resolve(__dirname, "../../packages/client/src");
const DASHBOARD = process.env.DASHBOARD_URL ?? "http://localhost:8000";

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    // Single React copy — the embed contract requires it (hooks break across a
    // dual-copy boundary). Dedupe to the hoisted root node_modules.
    dedupe: ["react", "react-dom"],
    alias: {
      "@blackbelt-technology/pi-dashboard-web/chat-embed": path.join(
        clientSrc,
        "chat-embed/index.ts",
      ),
    },
  },
  server: {
    port: 5199,
    // Bind all interfaces (IPv4 + IPv6). Vite's default binds IPv6 loopback
    // only ([::1]), so an IPv4 127.0.0.1:5199 client gets ECONNREFUSED.
    host: true,
    strictPort: true,
    // Same-origin to the browser; forward /ws + /api + /auth to the running
    // dashboard so no CORS config is needed (server's corsAllowedOrigins=[]).
    proxy: {
      "/ws": { target: DASHBOARD, ws: true, changeOrigin: true },
      "/api": { target: DASHBOARD, changeOrigin: true },
      "/auth": { target: DASHBOARD, changeOrigin: true },
    },
  },
});
