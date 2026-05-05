/**
 * Route tests for `GET /api/doctor`.
 *
 * Asserts:
 *   - JSON shape contract (every check has `section`; non-ok has message+detail+suggestion)
 *   - summary counts match
 *   - fault-tolerance arm: a deps function that throws → 200 with fallback row
 *   - no Electron-only rows (4.5)
 *
 * See change: doctor-rich-output (tasks 4.4–4.5).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDoctorRoutes } from "../routes/doctor-routes.js";
import type {
  DoctorReport,
  SharedChecksDeps,
} from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";

const ELECTRON_ONLY_NAMES = new Set([
  "Electron",
  "Bundled Node.js",
  "Bundled npm",
  "Offline packages bundle",
  "Dashboard server code",
  "Server launch test",
]);

async function makeApp(buildDeps?: () => SharedChecksDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerDoctorRoutes(app, buildDeps ? { buildDeps } : {});
  await app.ready();
  return app;
}

function fakeDeps(overrides: Partial<SharedChecksDeps> = {}): SharedChecksDeps {
  return {
    managedDir: "/tmp/doctor-route-test-managed",
    detectSystemNode: () => ({ found: true, path: "/usr/bin/node" }),
    detectPi: () => ({ found: true, path: "/usr/local/bin/pi", source: "system" }),
    detectOpenSpec: () => ({ found: false }),
    isApiKeyConfigured: () => true,
    probeServer: async () => ({ running: true, version: "0.4.6", mode: "production" }),
    ...overrides,
  };
}

describe("/api/doctor", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with a DoctorReport envelope", async () => {
    app = await makeApp(() => fakeDeps());
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as DoctorReport;
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.generatedAt).toBe("number");
  });

  it("every check has a section", async () => {
    app = await makeApp(() => fakeDeps());
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    const body = res.json() as DoctorReport;
    for (const c of body.checks) {
      expect(c.section).toBeDefined();
      expect(["runtime", "pi-tooling", "server", "setup", "diagnostics"]).toContain(c.section);
    }
  });

  it("every non-ok row carries non-empty message + detail + suggestion (Decision 8 lint)", async () => {
    app = await makeApp(() =>
      fakeDeps({
        detectPi: () => ({ found: false }),
        detectOpenSpec: () => ({ found: false }),
        probeServer: async () => ({ running: false }),
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    const body = res.json() as DoctorReport;
    const nonOk = body.checks.filter((c) => c.status !== "ok");
    expect(nonOk.length).toBeGreaterThan(0);
    for (const c of nonOk) {
      expect(c.message.length).toBeGreaterThan(0);
      expect((c.detail ?? "").length).toBeGreaterThan(0);
      expect((c.suggestion ?? "").length).toBeGreaterThan(0);
    }
  });

  it("summary counts match the rows", async () => {
    app = await makeApp(() =>
      fakeDeps({
        detectPi: () => ({ found: false }),
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    const body = res.json() as DoctorReport;
    const ok = body.checks.filter((c) => c.status === "ok").length;
    const warn = body.checks.filter((c) => c.status === "warning").length;
    const err = body.checks.filter((c) => c.status === "error").length;
    expect(body.summary.ok).toBe(ok);
    expect(body.summary.warnings).toBe(warn);
    expect(body.summary.errors).toBe(err);
  });

  it("never returns Electron-only rows (4.5)", async () => {
    app = await makeApp(() => fakeDeps());
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    const body = res.json() as DoctorReport;
    for (const c of body.checks) {
      expect(ELECTRON_ONLY_NAMES.has(c.name)).toBe(false);
    }
  });

  it("returns 200 with a single fallback row when buildDeps throws", async () => {
    app = await makeApp(() => {
      throw new Error("boom — deps unavailable");
    });
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    // Per task 4.3, the route returns 200 even on internal failure so the
    // client always has something to render.
    expect(res.statusCode).toBe(200);
    const body = res.json() as DoctorReport;
    expect(body.checks.length).toBe(1);
    expect(body.checks[0].status).toBe("error");
    expect(body.checks[0].name).toMatch(/Doctor failed/i);
    expect(body.summary.errors).toBe(1);
  });
});
