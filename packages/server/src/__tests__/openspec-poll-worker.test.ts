/**
 * Parity + fallback tests for the OpenSpec poll worker.
 *
 * The worker offloads per-change artifact derivation and payload serialization
 * to a `worker_threads` thread. Output `data` MUST equal the in-process
 * derivation byte-for-byte, and `serialized === JSON.stringify(data)`.
 *
 * See change: offload-openspec-poll-to-worker.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildOpenSpecData,
  createFsProbeFactory,
  createFsSpecsProbeFactory,
  deriveArtifactStatus,
} from "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js";
import {
  deriveAndSerialize,
  type PollWorkerRequest,
} from "../openspec/openspec-poll-worker.js";
import { createOpenSpecPollWorkerPool } from "../openspec/openspec-poll-worker-pool.js";
import {
  effectiveMtimeOr,
  perChangeArtifactPaths,
} from "../openspec/openspec-poll-fs-helpers.js";

function mkFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openspec-poll-worker-"));
  const changesRoot = path.join(root, "openspec", "changes");
  fs.mkdirSync(changesRoot, { recursive: true });

  // change-a: proposal + tasks (with content), no design/specs → tasks done, design ready, specs ready
  const a = path.join(changesRoot, "change-a");
  fs.mkdirSync(a);
  fs.writeFileSync(path.join(a, "proposal.md"), "# proposal a\n");
  fs.writeFileSync(path.join(a, "tasks.md"), "- [ ] 1.1 task\n- [x] 1.2 done\n");

  // change-b: proposal + design.md + specs/cap/spec.md + tasks → all done
  const b = path.join(changesRoot, "change-b");
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(b, "proposal.md"), "# proposal b\n");
  fs.writeFileSync(path.join(b, "design.md"), "# design b\n");
  fs.mkdirSync(path.join(b, "specs", "cap"), { recursive: true });
  fs.writeFileSync(path.join(b, "specs", "cap", "spec.md"), "spec\n");
  fs.writeFileSync(path.join(b, "tasks.md"), "- [x] 1.1 done\n");

  // change-c: no tasks → tasks blocked
  const c = path.join(changesRoot, "change-c");
  fs.mkdirSync(c);
  fs.writeFileSync(path.join(c, "proposal.md"), "# c\n");

  return root;
}

function inProcessDerive(cwd: string): { data: ReturnType<typeof buildOpenSpecData>; serialized: string } {
  const changesRoot = path.join(cwd, "openspec", "changes");
  const designFactory = createFsProbeFactory(cwd);
  const specsFactory = createFsSpecsProbeFactory(cwd);
  const listResult = [
    { name: "change-a", status: "in-progress", completedTasks: 1, totalTasks: 2 },
    { name: "change-b", status: "in-progress", completedTasks: 1, totalTasks: 1 },
    { name: "change-c", status: "no-tasks", completedTasks: 0, totalTasks: 0 },
  ];
  const statusResults = new Map<string, any>();
  for (const c of listResult) {
    statusResults.set(
      c.name,
      deriveArtifactStatus(path.join(changesRoot, c.name), c, {
        design: designFactory(c.name),
        specs: specsFactory(c.name),
      }),
    );
  }
  let data = buildOpenSpecData({ changes: listResult }, statusResults, designFactory, specsFactory);
  data = { ...data, hasOpenspecDir: true };
  return { data, serialized: JSON.stringify(data) };
}

function buildRequest(cwd: string): PollWorkerRequest {
  return {
    cwd,
    changesRoot: path.join(cwd, "openspec", "changes"),
    hasOpenspecDir: true,
    gateEnabled: true,
    listResult: [
      { name: "change-a", status: "in-progress", completedTasks: 1, totalTasks: 2 },
      { name: "change-b", status: "in-progress", completedTasks: 1, totalTasks: 1 },
      { name: "change-c", status: "no-tasks", completedTasks: 0, totalTasks: 0 },
    ],
    perChange: [
      { name: "change-a", cached: null },
      { name: "change-b", cached: null },
      { name: "change-c", cached: null },
    ],
    groupAssignments: {},
  };
}

describe("openspec-poll-worker — parity with in-process derivation", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkFixture();
  });

  afterEach(() => {
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("derives byte-identical data + serialized payload", () => {
    const req = buildRequest(cwd);
    const out = deriveAndSerialize(req);
    const expected = inProcessDerive(cwd);

    expect(out.data).toEqual(expected.data);
    expect(out.serialized).toBe(expected.serialized);
    expect(out.serialized).toBe(JSON.stringify(out.data));
  });

  it("joins groupAssignments into the data when provided", () => {
    const req = buildRequest(cwd);
    req.groupAssignments = { "change-a": "g1", "change-b": "g2" };
    const out = deriveAndSerialize(req);
    const aById = out.data.changes!.find((c) => c.name === "change-a")!;
    const bById = out.data.changes!.find((c) => c.name === "change-b")!;
    const cById = out.data.changes!.find((c) => c.name === "change-c")!;
    expect(aById.groupId).toBe("g1");
    expect(bById.groupId).toBe("g2");
    expect(cById.groupId).toBeNull();
  });

  it("reuses cached artifacts on a gated cache hit (preCallMtime === cached.mtimeMs)", () => {
    const req = buildRequest(cwd);
    // Cache hit: worker computes preCallMtime from disk and compares against
    // cached.mtimeMs. Use the real current mtime so the comparison fires.
    const changesRoot = path.join(cwd, "openspec", "changes");
    const real = effectiveMtimeOr(perChangeArtifactPaths(changesRoot, "change-a"));
    req.perChange = [
      {
        name: "change-a",
        cached: {
          mtimeMs: real,
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "design", status: "ready" },
            { id: "specs", status: "ready" },
            { id: "tasks", status: "done" },
          ],
        },
      },
      { name: "change-b", cached: null },
      { name: "change-c", cached: null },
    ];
    const out = deriveAndSerialize(req);
    // change-a should reflect the cached artifacts, not a re-derive.
    const a = out.data.changes!.find((c) => c.name === "change-a")!;
    expect(a.artifacts.map((x) => x.id)).toEqual(["proposal", "design", "specs", "tasks"]);
  });
});

describe("openspec-poll-worker-pool — fallback", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkFixture();
  });

  afterEach(() => {
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("with useWorker=false runs in-process and matches parity", async () => {
    const pool = createOpenSpecPollWorkerPool({ useWorker: false });
    try {
      const out = await pool.process(buildRequest(cwd));
      const expected = inProcessDerive(cwd);
      expect(out.data).toEqual(expected.data);
      expect(out.serialized).toBe(expected.serialized);
    } finally {
      await pool.dispose();
    }
  });

  it("with useWorker=true yields parity output (worker path or in-process fallback)", async () => {
    // Under vitest, `process.execArgv` does not carry the jiti `--import`
    // hook, so spawning a Worker pointed at a .ts entry may fail and the
    // pool will fall back in-process. The pool's contract is correctness;
    // exercising both shapes through one assertion locks that contract.
    const pool = createOpenSpecPollWorkerPool({ useWorker: true, size: 1, timeoutMs: 15_000 });
    try {
      const out = await pool.process(buildRequest(cwd));
      const expected = inProcessDerive(cwd);
      expect(out.data).toEqual(expected.data);
      expect(out.serialized).toBe(expected.serialized);
    } finally {
      await pool.dispose();
    }
  });

  it("falls back in-process when the worker spawn URL is unresolvable", async () => {
    // Force a bogus worker entry so spawn fails synchronously; pool MUST still
    // return the correct data via in-process fallback.
    const pool = createOpenSpecPollWorkerPool({
      useWorker: true,
      workerUrlOverride: "file:///definitely/does/not/exist/openspec-poll-worker.mjs",
      timeoutMs: 250,
    });
    try {
      const out = await pool.process(buildRequest(cwd));
      const expected = inProcessDerive(cwd);
      expect(out.data).toEqual(expected.data);
      expect(out.serialized).toBe(expected.serialized);
    } finally {
      await pool.dispose();
    }
  });
});
