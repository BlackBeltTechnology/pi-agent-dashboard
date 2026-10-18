/**
 * Worker probe + build requests for the `status --all` path.
 *
 * #X6: a worker that crashes during the build request must still yield the
 * in-process result, equal to the healthy result for the same inputs.
 * Also covers the probe's enumeration/tracked-set contract.
 * See change: use-openspec-status-all.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeTrackedPaths } from "../openspec/openspec-poll-fs-helpers.js";
import { buildFromStatusAll, type StatusAllBuildRequest } from "../openspec/openspec-poll-worker.js";
import { createOpenSpecPollWorkerPool } from "../openspec/openspec-poll-worker-pool.js";
import { backdate, mkTmpCwd, renderStatusAll, seedChanges, touchFuture, writeFile } from "./helpers/status-all-fixture.js";

let cwd: string;
let openspecDir: string;
const tmpFiles: string[] = [];

beforeEach(() => {
  cwd = mkTmpCwd("poll-worker-all");
  openspecDir = path.join(cwd, "openspec");
  seedChanges(cwd, 3);
  backdate(openspecDir);
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

async function buildRequest(): Promise<StatusAllBuildRequest> {
  const probeReq = { openspecDir, extras: null };
  const pre = await probeTrackedPaths(probeReq);
  return {
    cwd,
    openspecDir,
    hasOpenspecDir: true,
    raw: renderStatusAll(cwd),
    probeReq,
    pre,
    cachedChanges: {},
    groupAssignments: {},
  };
}

describe("probeTrackedPaths", () => {
  it("enumerates change dirs (no archive, no dot-dirs) and stats the tracked set", async () => {
    fs.mkdirSync(path.join(openspecDir, "changes", "archive", "2026-old"), { recursive: true });
    fs.mkdirSync(path.join(openspecDir, "changes", ".hidden"), { recursive: true });
    const probe = await probeTrackedPaths({ openspecDir, extras: null });
    expect(probe.names).toEqual(["c000", "c001", "c002"]);
    expect(Object.keys(probe.changes).sort()).toEqual(probe.names);
    for (const n of probe.names) expect(probe.changes[n]).toBeTypeOf("number");
    expect(probe.cwdMtime).toBeTypeOf("number");
  });

  it("missing paths are skipped, not treated as zero; no throw on ENOENT", async () => {
    const probe = await probeTrackedPaths({ openspecDir: path.join(cwd, "nope", "openspec"), extras: null });
    expect(probe).toEqual({ cwdMtime: undefined, names: [], changes: {} });
  });

  it("an in-place edit only a schema-declared output can see moves that change's mtime", async () => {
    writeFile(cwd, "openspec/changes/c001/dependencies.yaml", "deps: []\n");
    backdate(openspecDir);
    const extras = {
      c001: { files: [path.join(openspecDir, "changes/c001/dependencies.yaml")], globPrefixes: [], outputs: ["dependencies.yaml"] },
    };
    const before = await probeTrackedPaths({ openspecDir, extras });
    const legacyBefore = await probeTrackedPaths({ openspecDir, extras: null });
    touchFuture(path.join(openspecDir, "changes/c001/dependencies.yaml"));
    const after = await probeTrackedPaths({ openspecDir, extras });
    const legacyAfter = await probeTrackedPaths({ openspecDir, extras: null });
    expect(after.changes.c001).toBeGreaterThan(before.changes.c001!);
    expect(legacyAfter.changes.c001).toBe(legacyBefore.changes.c001); // legacy set is blind to it
    expect(after.changes.c000).toBe(before.changes.c000);
  });

  it("walks every directory beneath a glob prefix", async () => {
    fs.mkdirSync(path.join(openspecDir, "changes/c000/specs/deep/er"), { recursive: true });
    backdate(openspecDir);
    const extras = { c000: { files: [], globPrefixes: [path.join(openspecDir, "changes/c000/specs")], outputs: ["specs/**/*.md"] } };
    const before = await probeTrackedPaths({ openspecDir, extras });
    writeFile(cwd, "openspec/changes/c000/specs/deep/er/spec.md", "x\n");
    const after = await probeTrackedPaths({ openspecDir, extras });
    expect(after.changes.c000).toBeGreaterThan(before.changes.c000!);
  });
});

describe("buildFromStatusAll", () => {
  it("classification results pass through: unsupported / failed", async () => {
    const base = await buildRequest();
    expect(
      await buildFromStatusAll({ ...base, raw: { stdout: "", stderr: "error: unknown option '--all'", exitCode: 1 } }),
    ).toMatchObject({ kind: "unsupported" });
    expect(await buildFromStatusAll({ ...base, raw: { stdout: "Error: boom", stderr: "", exitCode: 1 } })).toMatchObject({
      kind: "failed",
    });
  });

  it("stamps every unchanged change with its pre-call mtime and serializes once", async () => {
    const out = await buildFromStatusAll(await buildRequest());
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.racyNames).toEqual([]);
    expect(out.serialized).toBe(JSON.stringify(out.data));
    expect(out.data.changes).toHaveLength(3);
    for (const c of out.data.changes) expect(out.stampMtimes[c.name]).toBeTypeOf("number");
    expect(out.cwdStamp).toBeTypeOf("number");
  });

  it("joins groupAssignments", async () => {
    const out = await buildFromStatusAll({ ...(await buildRequest()), groupAssignments: { c001: "g1" } });
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.data.changes.find((c) => c.name === "c001")?.groupId).toBe("g1");
    expect(out.data.changes.find((c) => c.name === "c000")?.groupId).toBeNull();
  });
});

describe("#X6 worker crash during the build request", () => {
  it("falls back in-process with data equal to the healthy result", async () => {
    const req = await buildRequest();
    const healthy = createOpenSpecPollWorkerPool({ useWorker: false });
    const expected = await healthy.build(req);
    await healthy.dispose();

    // A worker entry that throws on load: the pool sees an `error` event while
    // the build request is in flight and settles it in-process.
    const crashEntry = path.join(os.tmpdir(), `crash-worker-${process.pid}-${Date.now()}.mjs`);
    fs.writeFileSync(crashEntry, 'throw new Error("boom: worker crashed on load");\n');
    tmpFiles.push(crashEntry);
    const crashing = createOpenSpecPollWorkerPool({ useWorker: true, size: 1, workerUrlOverride: pathToFileURL(crashEntry).href });
    try {
      const got = await crashing.build(req);
      expect(got).toEqual(expected);
      // The pool stays usable afterwards (probe also settles via fallback).
      const probe = await crashing.probe(req.probeReq);
      expect(probe.names).toEqual(["c000", "c001", "c002"]);
    } finally {
      await crashing.dispose();
    }
  });
});
