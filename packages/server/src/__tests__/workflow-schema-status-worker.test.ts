/**
 * Worker-safe workflow-schema status + the `schemaStatus` poll-worker request:
 * #P4 stamp-first lean fingerprint, #P5 bounded reads, #P15 import closure,
 * #P7 writing actions keep the full fingerprint, #P17 exhaustive dispatch,
 * plus the pool's worker-failure fallback.
 *
 * @structural-pin import-graph guard (#P15): the worker-safe module must not pull the CLI recipes, semaphore or poller into the worker; a static scan of import specifiers is the contract
 *
 * See change: move-workflow-schema-status-to-poll-worker.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeSchemaStatusFor,
  handlePollWorkerMessage,
  type SchemaStatusRequest,
} from "../openspec/openspec-poll-worker.js";
import { createOpenSpecPollWorkerPool, runAsyncInProcess } from "../openspec/openspec-poll-worker-pool.js";
import { runWorkflowSchemaAction } from "../openspec/workflow-schema.js";
import { computeSchemaStatus } from "../openspec/workflow-schema-status.js";
import { makeFakeCli, mkRepo, stubDeps, write, writeSchemaDir } from "./helpers/workflow-schema-fixtures.js";

const roots: string[] = [];
const repo = (...a: Parameters<typeof mkRepo>): string => {
  const r = mkRepo(...a);
  roots.push(r);
  return r;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const NO_USER = "/nonexistent-user-schemas";

describe("#P4 stamp-first status with a lean fingerprint", () => {
  type Row = [label: string, setup: (root: string) => void, generated: string, fpCalls: number, validate: boolean, rejectFp?: boolean];
  const rows: Row[] = [
    ["stamp current", (r) => void writeSchemaDir(r, { base: "1.11.0", patch: 1 }), "current", 0, false],
    ["stamp outdated", (r) => void writeSchemaDir(r, { base: "1.10.0", patch: 1 }), "outdated", 0, false],
    ["no stamp in an existing dir", (r) => void writeSchemaDir(r, null), "unmanaged", 0, false],
    ["no dir", () => undefined, "none", 0, false],
    ["stamp newer", (r) => void writeSchemaDir(r, { base: "1.12.0", patch: 1 }), "newer", 1, true],
    ["stamp conflict", (r) => void writeSchemaDir(r, { base: "1.12.0", patch: 0 }), "conflict", 1, true],
    ["current + rejecting fingerprint", (r) => void writeSchemaDir(r, { base: "1.11.0", patch: 1 }), "current", 0, false, true],
    ["newer + rejecting fingerprint", (r) => void writeSchemaDir(r, { base: "1.12.0", patch: 1 }), "unmanaged", 1, false, true],
  ];
  it.each(rows)("%s", async (_label, setup, generated, fpCalls, validate, rejectFp) => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    setup(root);
    let calls = 0;
    const fingerprintFn = async (): Promise<string | null> => {
      calls++;
      if (rejectFp) throw new Error("fingerprint boom");
      return "fp-1";
    };
    const res = await computeSchemaStatus(root, {
      localVersion: "1.11.0",
      packageSchemasDir: "/pkg",
      userSchemasDirPath: NO_USER,
      fingerprint: "when-needed",
      fingerprintFn,
    });
    expect(res.status.generated).toBe(generated);
    expect(calls).toBe(fpCalls);
    expect("validateFingerprint" in res).toBe(validate);
    if (validate) expect(res.validateFingerprint).toBe("fp-1");
  });
});

describe("#P5 bounded `.openspec.yaml` reads", () => {
  it("104 changes (33 file-less): peak in-flight reads <= 16, result equals the unbounded one", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    const expectedUnpinned: string[] = [];
    const expectedAffected: string[] = [];
    for (let i = 0; i < 104; i++) {
      const name = `c${String(i).padStart(3, "0")}`;
      fs.mkdirSync(path.join(root, "openspec", "changes", name), { recursive: true });
      if (i % 3 === 0 && expectedUnpinned.length < 33) {
        expectedUnpinned.push(name);
        expectedAffected.push(name);
      } else if (i % 2 === 0) {
        write(root, `openspec/changes/${name}/.openspec.yaml`, "schema: pi-spec-driven\n");
        expectedAffected.push(name);
      } else {
        write(root, `openspec/changes/${name}/.openspec.yaml`, "schema: spec-driven\n");
      }
    }
    expect(expectedUnpinned).toHaveLength(33);
    const real = fsp.readFile.bind(fsp);
    let inFlight = 0;
    let peak = 0;
    vi.spyOn(fsp, "readFile").mockImplementation((async (p: unknown, ...rest: unknown[]) => {
      if (!String(p).endsWith(".openspec.yaml")) return (real as (...a: unknown[]) => unknown)(p, ...rest);
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 2));
        return await (real as (...a: unknown[]) => unknown)(p, ...rest);
      } finally {
        inFlight--;
      }
    }) as never);
    const { status } = await computeSchemaStatus(root, {
      localVersion: "1.11.0",
      packageSchemasDir: "/pkg",
      userSchemasDirPath: NO_USER,
    });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(16);
    expect(status.unpinnedChanges).toEqual(expectedUnpinned);
    expect(status.affectedChanges).toEqual(expectedAffected);
  });
});

describe("#P15 worker-safe import closure", () => {
  const serverSrc = path.resolve(__dirname, "..");
  const sharedSrc = path.resolve(__dirname, "../../../shared/src");
  const FORBIDDEN = [/platform\/openspec\.ts$/, /platform\/runner\.ts$/, /semaphore\.ts$/, /openspec-poller\.ts$/, /workflow-schema\.ts$/];

  /** Runtime import specifiers of a source file (`import type` / `export type` are erased). */
  function specifiers(file: string): string[] {
    const src = fs.readFileSync(file, "utf8");
    const out: string[] = [];
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/g)) out.push(m[1]!);
    for (const m of src.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) out.push(m[1]!);
    return out;
  }
  function resolve(from: string, spec: string): string | null {
    if (spec.startsWith(".")) return path.resolve(path.dirname(from), spec.replace(/\.js$/, ".ts"));
    const m = /^@blackbelt-technology\/pi-dashboard-shared\/(.+)\.js$/.exec(spec);
    return m ? path.join(sharedSrc, `${m[1]}.ts`) : null;
  }
  const direct = (file: string): string[] => specifiers(file).map((s) => resolve(file, s)).filter((p): p is string => p !== null);
  function closure(entry: string): Set<string> {
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length > 0) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      stack.push(...direct(f));
    }
    seen.delete(entry);
    return seen;
  }

  it("workflow-schema-status.ts closure holds no CLI recipe, semaphore, poller or workflow-schema.ts", () => {
    const all = [...closure(path.join(serverSrc, "openspec/workflow-schema-status.ts"))];
    expect(all.some((p) => p.endsWith("shared/src/openspec-status-all.ts"))).toBe(true); // the resolver follows shared imports
    for (const re of FORBIDDEN) expect(all.filter((p) => re.test(p))).toEqual([]);
  });

  it("the worker adds no platform/openspec, platform/runner or semaphore edge (openspec-poller is grandfathered)", () => {
    const edges = direct(path.join(serverSrc, "openspec/openspec-poll-worker.ts"));
    for (const re of [/platform\/openspec\.ts$/, /platform\/runner\.ts$/, /semaphore\.ts$/]) {
      expect(edges.filter((p) => re.test(p))).toEqual([]);
    }
    expect(edges.some((p) => p.endsWith("workflow-schema-status.ts"))).toBe(true);
  });
});

describe("#P7 writing actions keep the full fingerprint", () => {
  it("update on a current schema re-stamps previousDefault with no fingerprint-mismatch refusal", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    writeSchemaDir(root, { base: "1.11.0", patch: 1, previousDefault: "spec-driven" });
    const res = await runWorkflowSchemaAction(
      { cwd: root, action: "update", previousDefault: "team-flow" },
      stubDeps(makeFakeCli()),
    );
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
    expect(fs.readFileSync(path.join(root, "openspec/schemas/pi-spec-driven/schema.yaml"), "utf8")).toMatch(/previousDefault: team-flow/);
  });
});

describe("#P17 exhaustive request dispatch", () => {
  const fixture = (): SchemaStatusRequest => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    writeSchemaDir(root, { base: "1.12.0", patch: 1 });
    return { cwd: root, localVersion: "1.11.0", packageSchemasDir: "/pkg", userSchemasDir: NO_USER };
  };
  const shape = (r: unknown): unknown => {
    const o = r as { status: { generated: string }; validateFingerprint?: string };
    return { generated: o.status.generated, hasFp: typeof o.validateFingerprint === "string" };
  };

  it("schemaStatus returns { status, validateFingerprint? } at the worker handler, runAsyncInProcess and a disposed pool", async () => {
    const req = fixture();
    const expected = { generated: "newer", hasFp: true };
    expect(shape(await handlePollWorkerMessage("schemaStatus", req))).toEqual(expected);
    expect(shape(await runAsyncInProcess("schemaStatus", req))).toEqual(expected);
    const pool = createOpenSpecPollWorkerPool({ useWorker: false });
    await pool.dispose();
    expect(shape(await pool.schemaStatus(req))).toEqual(expected);
    expect(shape(await computeSchemaStatusFor(req))).toEqual(expected);
  });

  it("`process()` on a disposed pool keeps its never-rejects contract (a throwing derive yields empty data)", async () => {
    const pool = createOpenSpecPollWorkerPool({ useWorker: false });
    await pool.dispose();
    const out = await pool.process({ cwd: "/x", hasOpenspecDir: true } as never); // malformed request: derive throws
    expect(out.data).toMatchObject({ initialized: false, changes: [], hasOpenspecDir: true });
  });

  it("an unknown kind rejects at the worker handler and runAsyncInProcess (the disposed pool shares the latter)", async () => {
    await expect(handlePollWorkerMessage("bogus" as never, {})).rejects.toThrow(/unknown poll worker request kind/);
    await expect(runAsyncInProcess("bogus" as never, {} as never)).rejects.toThrow(/unknown poll worker request kind/);
  });
});

describe("pool `schemaStatus` fallbacks", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const f of tmp.splice(0)) fs.rmSync(f, { force: true });
  });

  it("a worker-side error falls back in-process; the injected schemaStatusImpl is the in-process body", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    const req: SchemaStatusRequest = { cwd: root, localVersion: "1.11.0", packageSchemasDir: "/pkg", userSchemasDir: NO_USER };
    const fixtureUrl = pathToFileURL(path.resolve(__dirname, "fixtures/reject-schema-status-worker.mjs")).href;
    const real = createOpenSpecPollWorkerPool({ useWorker: true, size: 1, workerUrlOverride: fixtureUrl });
    const stub = vi.fn(async (r: SchemaStatusRequest) => ({ status: { ...(await computeSchemaStatusFor(r)).status, configured: "stubbed" } }));
    const stubbed = createOpenSpecPollWorkerPool({ useWorker: true, size: 1, workerUrlOverride: fixtureUrl, schemaStatusImpl: stub });
    try {
      expect((await real.schemaStatus(req)).status.configured).toBe("pi-spec-driven");
      expect((await stubbed.schemaStatus(req)).status.configured).toBe("stubbed");
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      await real.dispose();
      await stubbed.dispose();
    }
  });
});
