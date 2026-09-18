/**
 * `/api/health.clientBuild` — served-artifact coherence states and diagnostics.
 *
 * Folds test-plan scenarios E12 (four states), E13 (additive-only health),
 * E14 (declared fixture policy honoured), X1/X2 (diagnostic leaks no path),
 * X6 (dev-mode scoping) and P1 (snapshot-cheap).
 *
 * See change: add-served-build-coherence-and-hash-parity (design D3/D4).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILD_DECLARATION_SCHEMA_VERSION,
  type BuildDeclaration,
  writeBuildDeclaration,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  clientBuildDiagnostic,
  readClientBuildSnapshot,
  runtimePluginRegistryHash,
} from "../lib/client-dist.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

const dirs: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A served-client fixture directory; `declaration: null` leaves it undescribed. */
function makeBuild(declaration: BuildDeclaration | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "health-cb-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html>", "utf-8");
  if (declaration) writeBuildDeclaration(dir, declaration);
  return dir;
}

function declaration(overrides: Partial<BuildDeclaration> = {}): BuildDeclaration {
  return {
    schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION,
    pluginRegistryHash: runtimePluginRegistryHash(true),
    fixturePolicy: "excluded",
    ...overrides,
  };
}

async function makeApp(opts: { clientDir: string | null; dev?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  apps.push(app);
  registerSystemRoutes(app, {
    sessionManager: { listActive: () => [], listAll: () => [] },
    preferencesStore: { flush: () => {} },
    metaPersistence: { flushAll: () => {} },
    config: { port: 8000, piPort: 9999, dev: opts.dev ?? false },
    networkGuard: async () => {},
    version: "test",
    clientDir: opts.clientDir,
  } as never);
  await app.ready();
  return app;
}

async function getHealth(app: FastifyInstance): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body) as Record<string, unknown>;
}

/** Median of a duration sample — robust to GC outliers under parallel load. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

describe("GET /api/health.clientBuild (E12–E14, E13)", () => {
  it("E12 matched — declaration hash equals the production runtime hash", async () => {
    const app = await makeApp({ clientDir: makeBuild(declaration()) });
    const body = await getHealth(app);
    expect(body.clientBuild).toEqual({
      pluginRegistryHash: runtimePluginRegistryHash(true),
      status: "matched",
    });
  });

  it("E12 mismatched — declaration hash differs from the runtime hash", async () => {
    const served = declaration({ pluginRegistryHash: "0".repeat(64) });
    const app = await makeApp({ clientDir: makeBuild(served) });
    const body = await getHealth(app);
    expect(body.clientBuild).toEqual({
      pluginRegistryHash: "0".repeat(64),
      status: "mismatched",
    });
  });

  it("E12 metadata-missing — a served directory with no declaration", async () => {
    const app = await makeApp({ clientDir: makeBuild(null) });
    const body = await getHealth(app);
    expect(body.clientBuild).toEqual({ pluginRegistryHash: null, status: "metadata-missing" });
  });

  it("E12 not-served — no resolvable static client directory", async () => {
    const app = await makeApp({ clientDir: null });
    const body = await getHealth(app);
    expect(body.clientBuild).toEqual({ pluginRegistryHash: null, status: "not-served" });
  });

  it("E13 is additive-only: bundleHash stays hex and the key set is unchanged", async () => {
    const servedKeys = Object.keys(
      await getHealth(await makeApp({ clientDir: makeBuild(declaration()) })),
    ).sort();
    const apiOnlyKeys = Object.keys(await getHealth(await makeApp({ clientDir: null }))).sort();

    // Adding a served artifact introduces no key and removes none.
    expect(servedKeys).toEqual(apiOnlyKeys);
    expect(servedKeys).toContain("clientBuild");

    const body = await getHealth(await makeApp({ clientDir: makeBuild(declaration()) }));
    expect(typeof body.bundleHash).toBe("string");
    expect(body.bundleHash as string).toMatch(/^[0-9a-f]{64}$/);
    // A sample of pre-existing keys keep their type.
    expect(typeof body.ok).toBe("boolean");
    expect(typeof body.pid).toBe("number");
    expect(typeof body.mode).toBe("string");
    expect(typeof body.startedAt).toBe("string");
    expect(Array.isArray(body.plugins)).toBe(true);
  });

  it("E14 honours the artifact's declared fixture policy, not the server's mode", async () => {
    // Dev-mode server (config.dev true) + artifact declaring `excluded`:
    // the comparison must use the production selection, so `demo-plugin` being
    // discoverable does not fabricate a mismatch.
    const excludedArtifact = makeBuild(declaration({ fixturePolicy: "excluded" }));
    const devServer = await makeApp({ clientDir: excludedArtifact, dev: true });
    expect((await getHealth(devServer)).clientBuild).toMatchObject({ status: "matched" });

    // And the mirror: a production server compared against an artifact that
    // declares `included` uses the dev selection.
    const includedArtifact = makeBuild({
      schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION,
      pluginRegistryHash: runtimePluginRegistryHash(false),
      fixturePolicy: "included",
    });
    const prodServer = await makeApp({ clientDir: includedArtifact, dev: false });
    expect((await getHealth(prodServer)).clientBuild).toMatchObject({ status: "matched" });
  });
});

describe("clientBuild snapshot semantics and diagnostics (X1, X2, X6, P1)", () => {
  it("P1 is a startup snapshot — a later disk change does not alter health", async () => {
    const dir = makeBuild(declaration({ pluginRegistryHash: "0".repeat(64) }));
    const app = await makeApp({ clientDir: dir });
    expect((await getHealth(app)).clientBuild).toMatchObject({ status: "mismatched" });

    // Rewrite the declaration to the matching hash — the running server must
    // keep reporting the startup snapshot (no per-request filesystem read).
    writeBuildDeclaration(dir, declaration());
    expect((await getHealth(app)).clientBuild).toMatchObject({ status: "mismatched" });
  });

  it("X6 dev mode describes the production fallback directory, well-formed", async () => {
    const dir = makeBuild(declaration());
    const app = await makeApp({ clientDir: dir, dev: true });
    const body = await getHealth(app);
    expect(body.clientBuild).toMatchObject({ status: "matched" });
    expect(body.mode).toBe("dev");
  });

  it("X1 an unreadable declaration reports metadata-missing with a path-free diagnostic", () => {
    const dir = makeBuild(null);
    // A directory in the declaration's place is unreadable as a file.
    fs.mkdirSync(path.join(dir, "pi-dashboard-build.json"), { recursive: true });

    const snapshot = readClientBuildSnapshot(dir, () => runtimePluginRegistryHash(true));
    expect(snapshot).toEqual({ pluginRegistryHash: null, status: "metadata-missing" });

    const line = clientBuildDiagnostic(snapshot);
    expect(line).toContain("metadata-missing");
    expect(line).not.toMatch(/[/\\]/);
  });

  it("X2 a mismatched declaration reports a path-free diagnostic", () => {
    const snapshot = readClientBuildSnapshot(makeBuild(declaration({ pluginRegistryHash: "1".repeat(64) })), () =>
      runtimePluginRegistryHash(true),
    );
    expect(snapshot.status).toBe("mismatched");
    const line = clientBuildDiagnostic(snapshot);
    expect(line).toContain("mismatched");
    expect(line).not.toMatch(/[/\\]/);
  });

  it("P1 200 health reads re-read no declaration and add no measurable cost", async () => {
    const withClient = await makeApp({ clientDir: makeBuild(declaration()) });
    const withoutClient = await makeApp({ clientDir: null });

    // Per-request durations, plus a hard check that the declaration is never
    // re-read: the snapshot is taken at registration, so 200 requests must do
    // ZERO declaration I/O. This is the deterministic half — the timing half
    // uses a median, because a mean is dominated by GC outliers when the full
    // 20k-test suite runs in parallel on a loaded host.
    async function measure(
      app: FastifyInstance,
      n: number,
    ): Promise<{ medianMs: number; declarationReads: number }> {
      await getHealth(app); // warm the lazy 30s caches so the comparison isolates clientBuild
      const durations: number[] = [];
      const spy = vi.spyOn(fs, "readFileSync");
      try {
        for (let i = 0; i < n; i += 1) {
          const start = performance.now();
          const res = await app.inject({ method: "GET", url: "/api/health" });
          durations.push(performance.now() - start);
          if (res.statusCode !== 200) throw new Error(`health ${res.statusCode}`);
        }
        const declarationReads = spy.mock.calls.filter(([target]) =>
          String(target).includes("pi-dashboard-build.json"),
        ).length;
        return { medianMs: median(durations), declarationReads };
      } finally {
        spy.mockRestore();
      }
    }

    const withClientRun = await measure(withClient, 200);
    const withoutClientRun = await measure(withoutClient, 200);

    expect(withClientRun.declarationReads).toBe(0);
    expect(withoutClientRun.declarationReads).toBe(0);
    expect(withClientRun.medianMs - withoutClientRun.medianMs).toBeLessThan(1);
  });
});
