/**
 * GET /api/doctor — server-side diagnostic endpoint.
 *
 * Calls `runSharedChecks(...)` with server-appropriate `deps`, post-stamps
 * `section` + `suggestion`, returns `{ checks, summary, generatedAt }`.
 *
 * Auth-gated identically to `/api/config`; unauthenticated requests yield
 * the same status code as `/api/config` (the auth plugin's onRequest hook
 * intercepts before this handler runs).
 *
 * On a thrown error from `runSharedChecks`, returns a 200 with a single
 * fallback `error` row rather than a 500 — the web client always has
 * something to render. See change: doctor-rich-output (tasks 4.1–4.5).
 */
import type { FastifyInstance } from "fastify";
import path from "node:path";
import os from "node:os";
import {
  runSharedChecks,
  stampSectionsAndSuggestions,
  safeExec,
  type DoctorCheck,
  type DoctorReport,
  type SharedChecksDeps,
} from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import {
  hasAnyProviderCredential,
  inspectedCredentialFiles,
} from "@blackbelt-technology/pi-dashboard-shared/credential-detect.js";
import { getTunnelWatchdogStatus } from "../tunnel/tunnel-watchdog.js";

function getManagedDir(): string {
  return process.env.MANAGED_DIR || path.join(os.homedir(), ".pi-dashboard");
}

function detectSystemNode(): { found: boolean; path?: string } {
  const cmd = process.platform === "win32" ? "where node" : "which node"; // platform-branch-ok: localised PATH-lookup primitive
  const r = safeExec(cmd, { timeoutMs: 3000 });
  if (!r.ok) return { found: false };
  const first = r.stdout.trim().split("\n")[0];
  return first ? { found: true, path: first } : { found: false };
}

function detectOnPath(name: string): { found: boolean; path?: string; source?: string } {
  const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`; // platform-branch-ok: localised PATH-lookup primitive
  const r = safeExec(cmd, { timeoutMs: 3000 });
  if (!r.ok) return { found: false };
  const first = r.stdout.trim().split("\n")[0];
  return first ? { found: true, path: first, source: "system" } : { found: false };
}

/**
 * Tool detection that mirrors the ToolRegistry resolution chain used
 * by the rest of the server (override → bundled/bare-import → managed →
 * PATH). Without this, the doctor falsely reported pi/openspec as
 * "Not found" when the Electron app shipped them inside
 * `Resources/server/node_modules/` — bypassing the registry that
 * `/api/tools` already consults. See change: fix-doctor-bundled-tool-detection.
 */
function detectViaRegistry(name: "pi" | "openspec"): { found: boolean; path?: string; source?: string } {
  try {
    const reg = getDefaultRegistry();
    if (reg.has(name)) {
      const r = reg.resolve(name);
      if (r.ok && r.path) {
        return { found: true, path: r.path, source: r.source ?? "system" };
      }
    }
  } catch {
    // Registry not initialised or threw — fall through to PATH.
  }
  return detectOnPath(name);
}

// Doctor's "API key" check delegates to the shared detector, which
// inspects BOTH ~/.pi/agent/settings.json (legacy API-key fields) AND
// ~/.pi/agent/auth.json (OAuth + provider-stored API keys written by
// Settings → Providers). See change: fix-doctor-oauth-credential-detection.
function isApiKeyConfigured(): boolean {
  return hasAnyProviderCredential();
}

function buildDefaultDeps(): SharedChecksDeps {
  return {
    managedDir: getManagedDir(),
    detectSystemNode,
    detectPi: () => detectViaRegistry("pi"),
    detectOpenSpec: () => detectViaRegistry("openspec"),
    // CLI-on-PATH checks: deliberately use PATH-only lookup so the
    // result reflects what a human's shell sees, NOT what the dashboard
    // can resolve via its bundled node_modules. See change:
    // fix-doctor-bundled-tool-detection.
    detectPiOnPath: () => detectOnPath("pi"),
    detectOpenSpecOnPath: () => detectOnPath("openspec"),
    isApiKeyConfigured,
    inspectedCredentialFiles: () => inspectedCredentialFiles(),
    resolveZrokBinary: () => {
      // Use the same ToolRegistry that backs Settings ▸ Tools. Its
      // `whereStrategy` is login-shell-aware, so the diagnostic and the
      // Tools card never disagree about whether zrok is reachable.
      try {
        const reg = getDefaultRegistry();
        if (reg.has("zrok")) {
          const r = reg.resolve("zrok");
          if (r.ok && r.path) return { found: true, path: r.path };
        }
      } catch {
        /* registry not initialised — fall through */
      }
      return { found: false };
    },
    getTunnelWatchdogStatus: () => getTunnelWatchdogStatus(),
    probeServer: async () => {
      // CRITICAL: do NOT shell out to `curl http://localhost:8000/api/health`
      // here. `safeExec` uses synchronous `execSync`, which blocks the Node
      // event loop until the child exits. The child is curl, talking back
      // to *this same Node process* — a self-deadlock. curl waits for the
      // server to respond, server is blocked in execSync, after 3 s the
      // timeout kills curl and the probe falsely reports "Not running".
      //
      // Since we are currently handling an HTTP request, by definition the
      // server IS running. Read process-resident health data directly
      // instead of round-tripping through HTTP.
      //
      // See change: harvest-bootstrap-survivor-fixes (cherry-pick 5).
      const installable =
        process.env.DASHBOARD_INSTALLABLE_TOTAL !== undefined
          ? {
              total: Number(process.env.DASHBOARD_INSTALLABLE_TOTAL ?? 0),
              installed: Number(process.env.DASHBOARD_INSTALLABLE_INSTALLED ?? 0),
              failed: [] as string[],
            }
          : null;
      return {
        running: true,
        starter: process.env.DASHBOARD_STARTER ?? null,
        mode: process.env.NODE_ENV === "development" ? "dev" : "production",
        installable,
      };
    },
  };
}

function summarize(checks: DoctorCheck[]): DoctorReport["summary"] {
  return {
    ok: checks.filter((c) => c.status === "ok").length,
    warnings: checks.filter((c) => c.status === "warning").length,
    errors: checks.filter((c) => c.status === "error").length,
  };
}

export interface DoctorRouteDeps {
  /** Override for tests — substitutes a different `runSharedChecks` deps shape (or throws to exercise fault tolerance). */
  buildDeps?: () => SharedChecksDeps;
}

export function registerDoctorRoutes(fastify: FastifyInstance, deps: DoctorRouteDeps = {}): void {
  fastify.get("/api/doctor", async (_request, _reply): Promise<DoctorReport> => {
    try {
      const sharedDeps = deps.buildDeps ? deps.buildDeps() : buildDefaultDeps();
      const checks = await runSharedChecks(sharedDeps);
      stampSectionsAndSuggestions(checks);
      return {
        checks,
        summary: summarize(checks),
        generatedAt: Date.now(),
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const fallback: DoctorCheck = {
        name: "Doctor failed to produce a report",
        section: "diagnostics",
        status: "error",
        message: "Unexpected internal failure",
        code: "doctor.unexpected_internal_failure", // See change: make-all-ui-text-i18n
        detail: `${e.message}\n${(e.stack || "").split("\n").slice(0, 4).join("\n")}`,
        suggestion:
          "Check `~/.pi-dashboard/doctor.log` on the server, then file an issue with the captured error.",
      };
      return {
        checks: [fallback],
        summary: { ok: 0, warnings: 0, errors: 1 },
        generatedAt: Date.now(),
      };
    }
  });
}
