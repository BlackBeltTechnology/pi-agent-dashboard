import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Plugin } from "vite";
// Relative (not the package specifier) so vite's esbuild config-loader bundles it, like the plugin-runtime import in vite.config.ts.
import { resolveTrustedTypesMode } from "../shared/src/trusted-types-mode.js";

/** Read the raw `security.trustedTypes` from `~/.pi/dashboard/config.json` (missing / bad JSON → undefined). */
function readStoredTrustedTypes(): unknown {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pi", "dashboard", "config.json"), "utf-8"));
    return cfg?.security?.trustedTypes;
  } catch {
    return undefined;
  }
}

/**
 * Dev-server half of the Trusted Types mode (change: harden-client-sinks D6,
 * enforce-trusted-types-default D3). In dev the dashboard proxies `index.html` from Vite
 * unmodified, so this injects the same `<meta name="pi-trusted-types">` the server adds in
 * production, resolved by the SAME shared resolver (env `PI_DASHBOARD_TRUSTED_TYPES`, then
 * config `security.trustedTypes`, then the default), and exposes the workspace root the
 * `pi-worker-url` policy accepts under `/@fs/` (empty in builds).
 */
export function trustedTypesDevPlugin(
  workspaceRoot: string,
  inputs: { env?: Record<string, string | undefined>; /** Raw stored `security.trustedTypes`. */ readConfig?: () => unknown } = {},
): Plugin {
  const env = inputs.env ?? process.env;
  const config = inputs.readConfig ? inputs.readConfig() : readStoredTrustedTypes();
  const { mode, warnings } = resolveTrustedTypesMode({
    env: env.PI_DASHBOARD_TRUSTED_TYPES,
    config,
    cspMode: env.PI_DASHBOARD_CSP === "off" ? "off" : "report",
  });
  for (const w of warnings) console.warn(`[trusted-types] ${w.message}`);
  return {
    name: "pi-trusted-types-dev",
    config: (_cfg, viteEnv) => ({
      define: { __PI_DEV_FS_ROOT__: JSON.stringify(viteEnv.command === "serve" ? workspaceRoot : "") },
    }),
    transformIndexHtml: {
      order: "pre",
      handler: (html, ctx) =>
        ctx.server ? html.replace(/<head\b[^>]*>/i, (m) => `${m}\n    <meta name="pi-trusted-types" content="${mode}">`) : html,
    },
  };
}
