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
import { existsSync, readFileSync } from "node:fs";
import {
  runSharedChecks,
  stampSectionsAndSuggestions,
  safeExec,
  type DoctorCheck,
  type DoctorReport,
  type SharedChecksDeps,
} from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";

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

function isApiKeyConfigured(): boolean {
  try {
    const settings = path.join(os.homedir(), ".pi", "agent", "settings.json");
    if (!existsSync(settings)) return false;
    const data = JSON.parse(readFileSync(settings, "utf-8"));
    if (data?.anthropicApiKey || data?.openaiApiKey || data?.apiKey) return true;
    if (data?.providers && typeof data.providers === "object") {
      for (const v of Object.values(data.providers as Record<string, unknown>)) {
        if (v && typeof v === "object" && "apiKey" in (v as object)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function buildDefaultDeps(): SharedChecksDeps {
  return {
    managedDir: getManagedDir(),
    detectSystemNode,
    detectPi: () => detectOnPath("pi"),
    detectOpenSpec: () => detectOnPath("openspec"),
    isApiKeyConfigured,
    probeServer: async () => {
      const r = safeExec("curl -sf http://localhost:8000/api/health", { timeoutMs: 3000 });
      if (!r.ok || !r.stdout.trim()) return { running: false };
      try {
        const h = JSON.parse(r.stdout);
        return {
          running: true,
          version: typeof h.version === "string" ? h.version : undefined,
          mode: typeof h.mode === "string" ? h.mode : undefined,
          starter: typeof h.starter === "string" ? h.starter : null,
          installable:
            h.installable && typeof h.installable === "object"
              ? {
                  total: h.installable.total ?? 0,
                  installed: h.installable.installed ?? 0,
                  failed: Array.isArray(h.installable.failed) ? h.installable.failed : [],
                }
              : null,
        };
      } catch {
        return { running: true };
      }
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
