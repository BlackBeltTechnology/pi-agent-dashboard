/**
 * HTTP-level tests for POST /api/openspec/init (add-openspec-init-affordances).
 *
 * Covers:
 *   - validation set: un-filtered union(session cwds, pinned dirs) (E20, E21)
 *   - exact argv construction (E22 — through OPENSPEC_INIT recipe + route)
 *   - overwrite confirmation on existing <cwd>/openspec/ (F17 server half)
 *   - per-cwd serialization: 409 + single spawn (X4), lock release after
 *     timeout (X3), hung-spawn bounded failure with partial stderr (X2)
 *   - CLI failure reports stderr, records no signature (X1, E28)
 *   - support probe: unsupported CLI refused naming the binary (X5),
 *     probe cached across requests (X6)
 *   - expanded profile healed before spawn, no --profile in argv (X7)
 *   - signature recorded on success (E27)
 *
 * See change: add-openspec-init-affordances.
 */

import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { OPENSPEC_INIT } from "@blackbelt-technology/pi-dashboard-shared/platform/openspec.js";
import { ROUTE_TIERS } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import type { Semaphore } from "@blackbelt-technology/pi-dashboard-shared/semaphore.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_PATCH, type WorkflowSchemaAction } from "../openspec/workflow-schema.js";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";
import {
  makeFakeCli,
  mkRepo,
  mkTmp,
  snapshotTree,
  stubDeps,
  write,
  writeSchemaDir,
} from "./helpers/workflow-schema-fixtures.js";

// Hoisted mock fns — the route module imports these from the platform module.
const initAsyncMock = vi.hoisted(() => vi.fn());
const initHelpMock = vi.hoisted(() => vi.fn());
const configListOrAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/openspec.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@blackbelt-technology/pi-dashboard-shared/platform/openspec.js")
  >();
  return {
    ...actual,
    initAsync: initAsyncMock,
    initHelpAsync: initHelpMock,
    configListOrAsync: configListOrAsyncMock,
  };
});

const PASSTHRU_GUARD = async () => {};

function makeDeps(opts: {
  sessionCwds?: string[];
  pinnedDirs?: string[];
  recorded?: string;
} = {}) {
  const setOpenSpecUpdateSignature = vi.fn();
  return {
    sessionManager: {
      listAll: () => (opts.sessionCwds ?? []).map((cwd) => ({ id: "s1", cwd })),
    } as any,
    preferencesStore: {
      getPinnedDirectories: () => opts.pinnedDirs ?? [],
      getOpenSpecUpdateSignature: () => opts.recorded,
      setOpenSpecUpdateSignature,
    } as any,
    directoryService: {
      refreshOpenSpec: vi.fn(async () => ({
        initialized: true,
        changes: [],
        hasOpenSpecSkills: true,
        readiness: { state: "READY" as const },
      })),
      invalidateOpenSpecSignatureCache: vi.fn(),
    } as any,
    networkGuard: PASSTHRU_GUARD,
    onOpenSpecChanged: vi.fn(),
    setOpenSpecUpdateSignature,
  };
}

describe("POST /api/openspec/init (add-openspec-init-affordances)", () => {
  let tmpDir: string;
  let fastify: FastifyInstance;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "osx-init-"));
    configListOrAsyncMock.mockResolvedValue({ profile: "custom", workflows: ["w1", "w2"] });
    initHelpMock.mockResolvedValue({
      ok: true,
      value: "Usage: openspec init [options] [path]\n  --tools <tools>  Configure AI tools\n  --force          Auto-cleanup\n  --profile <profile>",
    });
    initAsyncMock.mockResolvedValue({ ok: true, value: "initialized stdout" });
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function setup(depsOpts?: Parameters<typeof makeDeps>[0]) {
    deps = makeDeps(depsOpts ?? { sessionCwds: [tmpDir] });
    fastify = Fastify();
    registerOpenSpecRoutes(fastify, deps);
    await fastify.ready();
  }

  const post = (body: Record<string, unknown>) =>
    fastify.inject({ method: "POST", url: "/api/openspec/init", payload: body });

  it("E20: pinned directory with no openspec/ is a valid target (accepted, spawn happens)", async () => {
    await setup({ sessionCwds: [], pinnedDirs: [tmpDir] });
    const res = await post({ cwd: tmpDir });
    expect(res.statusCode).toBe(200);
    expect(initAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("E21: unknown directory is rejected, no spawn", async () => {
    await setup({ sessionCwds: [], pinnedDirs: [] });
    const res = await post({ cwd: tmpDir });
    expect(res.statusCode).toBe(400);
    expect(initAsyncMock).not.toHaveBeenCalled();
  });

  it("E22: argv is exactly [init, <cwd>, --tools, pi, --force] — recipe level", () => {
    expect(OPENSPEC_INIT.argv({ cwd: "/some/dir" })).toEqual([
      "openspec",
      "init",
      "/some/dir",
      "--tools",
      "pi",
      "--force",
    ]);
  });

  it("E22/X7: route spawns via initAsync with the target cwd; healed profile, no --profile in argv", async () => {
    // X7: global profile is the expanded alias → healed to custom before spawn.
    configListOrAsyncMock.mockResolvedValue({ profile: "expanded", workflows: ["w1"] });
    await setup({ sessionCwds: [tmpDir] });
    const res = await post({ cwd: tmpDir });
    expect(res.statusCode).toBe(200);
    expect(initAsyncMock).toHaveBeenCalledWith({ cwd: tmpDir });
    // The recipe's argv carries no --profile and no nonexistent flags.
    expect(OPENSPEC_INIT.argv({ cwd: tmpDir })).not.toContain("--profile");
    expect(OPENSPEC_INIT.argv({ cwd: tmpDir })).not.toContain("--no-animation");
    expect(OPENSPEC_INIT.argv({ cwd: tmpDir })).not.toContain("--no-copilot-cloud");
  });

  it("F17 server half: existing openspec/ refused without confirm; with confirm, spawn proceeds", async () => {
    await fs.mkdir(path.join(tmpDir, "openspec"), { recursive: true });
    await setup({ sessionCwds: [tmpDir] });

    const refused = await post({ cwd: tmpDir });
    expect(refused.statusCode).toBe(400);
    expect(JSON.parse(refused.payload).error).toContain(tmpDir);
    expect(initAsyncMock).not.toHaveBeenCalled();

    const confirmed = await post({ cwd: tmpDir, confirm: true });
    expect(confirmed.statusCode).toBe(200);
    expect(initAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("X1/E28: CLI exits non-zero → failure reports stderr, no signature recorded", async () => {
    initAsyncMock.mockResolvedValue({
      ok: false,
      error: { kind: "exit", code: 1, signal: null, stdout: "partial out", stderr: "fatal boom" },
    });
    await setup({ sessionCwds: [tmpDir] });
    const res = await post({ cwd: tmpDir });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.stderr).toContain("fatal boom");
    expect(deps.setOpenSpecUpdateSignature).not.toHaveBeenCalled();
  });

  it("X2: hung CLI (timeout) → killed, request fails with partial stderr", async () => {
    initAsyncMock.mockResolvedValue({
      ok: false,
      error: { kind: "timeout", timeoutMs: 60000, binary: "openspec", stdout: "partial-out", stderr: "partial-err" },
    });
    await setup({ sessionCwds: [tmpDir] });
    const res = await post({ cwd: tmpDir });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body.error).toMatch(/timed out/i);
    expect(body.stderr).toContain("partial-err");
  });

  it("X3: lock is released after a timeout — a subsequent request is accepted, not 409", async () => {
    initAsyncMock.mockResolvedValueOnce({
      ok: false,
      error: { kind: "timeout", timeoutMs: 60000, binary: "openspec", stdout: "", stderr: "" },
    });
    await setup({ sessionCwds: [tmpDir] });
    await post({ cwd: tmpDir });
    const second = await post({ cwd: tmpDir });
    expect(second.statusCode).toBe(200);
    expect(initAsyncMock).toHaveBeenCalledTimes(2);
  });

  it("X4: concurrent init for the same cwd → 409 Conflict, exactly one spawn", async () => {
    let release!: (v: unknown) => void;
    initAsyncMock.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );
    await setup({ sessionCwds: [tmpDir] });
    const first = post({ cwd: tmpDir });
    // Wait for the first request to take the lock (observable: it reached the
    // mocked init, which is called after the lock is taken). A fixed 10 ms
    // sleep raced it under contention and left `release` unassigned, hanging
    // the test until its timeout. See change: contention-harden-real-process-tests.
    for (let i = 0; i < 2000 && initAsyncMock.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const second = await post({ cwd: tmpDir });
    expect(second.statusCode).toBe(409);
    expect(initAsyncMock).toHaveBeenCalledTimes(1);
    release({ ok: true, value: "" });
    expect((await first).statusCode).toBe(200);
  });

  it("X5: unsupported CLI (init --help lacks --tools) refused naming the binary, no spawn", async () => {
    initHelpMock.mockResolvedValue({
      ok: true,
      value: "Usage: openspec init [options] [path]\n  --force  Auto-cleanup legacy files",
    });
    await setup({ sessionCwds: [tmpDir] });
    const res = await post({ cwd: tmpDir });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toMatch(/--tools/);
    expect(initAsyncMock).not.toHaveBeenCalled();
  });

  it("X6: support probe runs once across two init requests", async () => {
    await setup({ sessionCwds: [tmpDir] });
    await post({ cwd: tmpDir });
    await post({ cwd: tmpDir });
    expect(initHelpMock).toHaveBeenCalledTimes(1);
    expect(initAsyncMock).toHaveBeenCalledTimes(2);
  });

  it("review round 1: legacy artifacts (marker-bearing AGENTS.md, no openspec/) refuse without confirm", async () => {
    await fs.writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "intro\n<!-- OPENSPEC:START -->\nold instructions\n<!-- OPENSPEC:END -->\n",
    );
    await setup({ sessionCwds: [tmpDir] });
    const refused = await post({ cwd: tmpDir });
    expect(refused.statusCode).toBe(400);
    expect(JSON.parse(refused.payload).code).toBe("confirm_required");
    expect(initAsyncMock).not.toHaveBeenCalled();

    const confirmed = await post({ cwd: tmpDir, confirm: true });
    expect(confirmed.statusCode).toBe(200);
    expect(initAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("review round 1: legacy command dir (.claude/commands/openspec) refuses without confirm", async () => {
    await fs.mkdir(path.join(tmpDir, ".claude", "commands", "openspec"), { recursive: true });
    await setup({ sessionCwds: [tmpDir] });
    const refused = await post({ cwd: tmpDir });
    expect(refused.statusCode).toBe(400);
    expect(initAsyncMock).not.toHaveBeenCalled();
  });

  it("review round 2: opencode/junie legacy command files refuse without confirm", async () => {
    await fs.mkdir(path.join(tmpDir, ".opencode", "command"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".opencode", "command", "opsx-apply.md"), "x");
    await setup({ sessionCwds: [tmpDir] });
    const refused = await post({ cwd: tmpDir });
    expect(refused.statusCode).toBe(400);
    expect(JSON.parse(refused.payload).code).toBe("confirm_required");
    expect(initAsyncMock).not.toHaveBeenCalled();
  });

  it("refresh-electron-bundled-components: a CURRENT CoStrict opsx- command is not legacy, an openspec- file is", async () => {
    // 1.14.3 scopes CoStrict cleanup to `.cospec/openspec/commands/openspec-*.md`; the
    // adapter writes live `opsx-*.md` into the same folder, so it must not force a confirm.
    await fs.mkdir(path.join(tmpDir, ".cospec", "openspec", "commands"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".cospec", "openspec", "commands", "opsx-propose.md"), "x");
    await setup({ sessionCwds: [tmpDir] });
    const current = await post({ cwd: tmpDir });
    expect(current.statusCode).toBe(200);
    expect(initAsyncMock).toHaveBeenCalledTimes(1);

    await fs.writeFile(path.join(tmpDir, ".cospec", "openspec", "commands", "openspec-proposal.md"), "x");
    initAsyncMock.mockClear();
    const legacy = await post({ cwd: tmpDir });
    expect(legacy.statusCode).toBe(400);
    expect(JSON.parse(legacy.payload).code).toBe("confirm_required");
    expect(initAsyncMock).not.toHaveBeenCalled();
  });

  it("review round 1: CLI-read failure at init time records NO fabricated signature", async () => {
    // currentGlobalWorkflowSignature resolves undefined when the CLI read
    // fails — the route must skip recording instead of fabricating the
    // empty-set signature (which would present the fresh project as
    // STALE · profile-stale on the next healthy tick).
    configListOrAsyncMock.mockResolvedValue(null);
    await setup({ sessionCwds: [tmpDir] });
    const res = await post({ cwd: tmpDir });
    expect(res.statusCode).toBe(200);
    expect(deps.setOpenSpecUpdateSignature).not.toHaveBeenCalled();
  });

  it("review round 1: probe failure is NOT memoized — a later request re-probes", async () => {
    initHelpMock.mockRejectedValueOnce(new Error("transient"));
    await setup({ sessionCwds: [tmpDir] });
    const first = await post({ cwd: tmpDir });
    expect(first.statusCode).toBe(400); // refused this time
    const second = await post({ cwd: tmpDir });
    expect(second.statusCode).toBe(200); // re-probed, supported → proceeds
    expect(initHelpMock).toHaveBeenCalledTimes(2);
  });

  it("E27: successful init records the current signature and refreshes the poll", async () => {
    await setup({ sessionCwds: [tmpDir], recorded: undefined });
    const res = await post({ cwd: tmpDir });
    expect(res.statusCode).toBe(200);
    // currentGlobalSignature derives from the mocked config list {workflows:[w1,w2]}.
    expect(deps.setOpenSpecUpdateSignature).toHaveBeenCalledWith(
      tmpDir,
      expect.any(String),
    );
    expect(deps.directoryService.refreshOpenSpec).toHaveBeenCalledWith(tmpDir);
    expect(deps.directoryService.invalidateOpenSpecSignatureCache).toHaveBeenCalled();
    const body = JSON.parse(res.payload);
    expect(body.data.readiness).toEqual({ state: "READY" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/openspec/workflow-schema + init chaining
// See change: add-pi-spec-driven-schema (tasks 3.1–3.9).
// ─────────────────────────────────────────────────────────────────────────────

type Generated = "none" | "current" | "outdated" | "newer" | "incompatible" | "conflict" | "unmanaged";

/** Writes the on-disk schema state for a `generated` value (CLI version 1.11.0, CURRENT_PATCH). */
function arrangeGenerated(root: string, generated: Generated): { localValidateFails: boolean } {
  switch (generated) {
    case "none":
      break;
    case "current":
      writeSchemaDir(root, { base: "1.11.0", patch: CURRENT_PATCH });
      break;
    case "outdated":
      writeSchemaDir(root, { base: "1.10.0", patch: CURRENT_PATCH });
      break;
    case "newer":
    case "incompatible":
      writeSchemaDir(root, { base: "1.12.0", patch: CURRENT_PATCH });
      break;
    case "conflict":
      writeSchemaDir(root, { base: "1.12.0", patch: CURRENT_PATCH - 1 });
      break;
    case "unmanaged":
      writeSchemaDir(root, null);
      break;
  }
  return { localValidateFails: generated === "incompatible" };
}

/** The "Actions are allowed only in defined states" table, restated independently of the module. */
function allowedByTable(action: WorkflowSchemaAction, configured: string, generated: Generated): boolean {
  const enabled = configured === "pi-spec-driven";
  switch (action) {
    case "enable":
      return !enabled && ["none", "current", "outdated", "newer", "conflict"].includes(generated);
    case "disable":
      return enabled;
    case "update":
      return generated === "outdated" || generated === "current" || (generated === "none" && enabled);
    case "adopt":
      return generated === "unmanaged";
    case "pin":
      return enabled;
    case "remove":
      return ["current", "outdated", "newer", "conflict", "incompatible"].includes(generated);
  }
}

describe("POST /api/openspec/workflow-schema (add-pi-spec-driven-schema)", () => {
  let fastify: FastifyInstance;
  let roots: string[];
  let logLines: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    roots = [];
    logLines = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (fastify) await fastify.close();
    for (const r of roots) nodeFs.rmSync(r, { recursive: true, force: true });
  });

  const repo = (...a: Parameters<typeof mkRepo>): string => {
    const r = mkRepo(...a);
    roots.push(r);
    return r;
  };

  async function boot(opts: {
    sessionCwds?: string[];
    pinnedDirs?: string[];
    enabled?: boolean;
    optOut?: string[];
    defaultForNewProjects?: boolean;
    fake?: ReturnType<typeof makeFakeCli>;
    networkGuard?: (req: any, reply: any) => Promise<void>;
  }) {
    const base = makeDeps({ sessionCwds: opts.sessionCwds, pinnedDirs: opts.pinnedDirs });
    const fake = opts.fake ?? makeFakeCli();
    const spawnSemaphore = { run: vi.fn((fn: () => Promise<unknown>) => fn()), setMax: vi.fn(), size: () => 0 };
    fastify = Fastify({
      logger: {
        level: "info",
        stream: new Writable({
          write(chunk, _enc, cb) {
            logLines.push(String(chunk));
            cb();
          },
        }),
      },
    });
    registerOpenSpecRoutes(fastify, {
      ...base,
      ...(opts.networkGuard ? { networkGuard: opts.networkGuard } : {}),
      getOpenSpecConfig: () => ({
        enabled: opts.enabled ?? true,
        optOutDirectories: opts.optOut ?? [],
        workflowSchema: { defaultForNewProjects: opts.defaultForNewProjects ?? false },
      }),
      spawnSemaphore: spawnSemaphore as unknown as Semaphore,
      workflowSchemaDeps: stubDeps(fake),
    });
    await fastify.ready();
    return { base, fake, spawnSemaphore };
  }

  const postWfs = (body: Record<string, unknown>) =>
    fastify.inject({ method: "POST", url: "/api/openspec/workflow-schema", payload: body });

  it("#E20 every action × generated × configured: allowed exactly per the table, else refused with the current status", async () => {
    const generatedStates: Generated[] = ["none", "current", "outdated", "newer", "incompatible", "conflict", "unmanaged"];
    const actions: WorkflowSchemaAction[] = ["enable", "disable", "update", "adopt", "pin", "remove"];
    const cwds: string[] = [];
    const { fake } = await boot({ sessionCwds: cwds });

    for (const configured of ["spec-driven", "pi-spec-driven"]) {
      for (const generated of generatedStates) {
        for (const action of actions) {
          const root = repo({ config: `schema: ${configured}\n` });
          cwds.push(root);
          const { localValidateFails } = arrangeGenerated(root, generated);
          fake.options.localValidateFails = localValidateFails;
          const before = snapshotTree(root);
          const label = `${action} | generated=${generated} | configured=${configured}`;

          const res = await postWfs({
            cwd: root,
            action,
            confirm: true,
            previousDefault: "spec-driven",
            pinTo: "pi-spec-driven",
          });
          const body = JSON.parse(res.payload);

          if (allowedByTable(action, configured, generated)) {
            // Past the state table: never refused for a state reason.
            expect(body.error ?? "", label).not.toMatch(/^cannot |^adopt needs an unmanaged|^pin is only allowed/);
          } else if ((action === "enable" && configured === "pi-spec-driven") || (action === "disable" && configured !== "pi-spec-driven")) {
            // Decision: "nothing to do" verdicts (already enabled / not the current default) are a 200 no-op, not a refusal.
            expect(res.statusCode, label).toBe(200);
            expect(body.data, label).toMatchObject({ ok: true, written: [], status: generated, configured });
            expect(snapshotTree(root), label).toEqual(before);
          } else {
            expect(res.statusCode, label).toBe(422);
            expect(body.success, label).toBe(false);
            expect(body.data.ok, label).toBe(false);
            expect(body.data.status, label).toBe(generated);
            expect(body.data.configured, label).toBe(configured);
            expect(body.data.written, label).toEqual([]);
            expect(snapshotTree(root), label).toEqual(before);
          }
        }
      }
    }
  }, 120_000);

  it("#E20 a no-op verdict (enable when already enabled) is a 200 ok with nothing written", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    writeSchemaDir(root, { base: "1.11.0", patch: CURRENT_PATCH });
    await boot({ sessionCwds: [root] });
    const before = snapshotTree(root);
    const res = await postWfs({ cwd: root, action: "enable" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toMatchObject({ success: true, data: { ok: true, written: [], configured: "pi-spec-driven", status: "current" } });
    expect(snapshotTree(root)).toEqual(before);
  });

  it("#E20 request shape: bad action / missing cwd / mistyped fields → 400 before any work", async () => {
    const root = repo();
    const { fake } = await boot({ sessionCwds: [root] });
    for (const body of [
      { cwd: root, action: "nuke" },
      { action: "enable" },
      { cwd: root },
      { cwd: root, action: "pin", pinTo: 5 },
      { cwd: root, action: "pin", changes: "a" },
      { cwd: root, action: "pin", changes: [1] },
      { cwd: root, action: "enable", confirm: "yes" },
      { cwd: root, action: "update", previousDefault: {} },
    ]) {
      const res = await postWfs(body as Record<string, unknown>);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("#E20 an injected pinTo reaches the module's validation and writes nothing", async () => {
    const root = repo({ config: "schema: pi-spec-driven\n" });
    writeSchemaDir(root, { base: "1.11.0", patch: CURRENT_PATCH });
    await boot({ sessionCwds: [root] });
    const before = snapshotTree(root);
    const res = await postWfs({ cwd: root, action: "pin", pinTo: "spec-driven\nretire_capabilities: true" });
    expect(res.statusCode).toBe(422);
    expect(snapshotTree(root)).toEqual(before);
  });

  describe("#X1 gate order", () => {
    const fsSpies = () => [
      vi.spyOn(fs, "stat"),
      vi.spyOn(fs, "lstat"),
      vi.spyOn(fs, "access"),
      vi.spyOn(fs, "readdir"),
      vi.spyOn(fs, "realpath"),
      vi.spyOn(nodeFs, "statSync"),
      vi.spyOn(nodeFs, "existsSync"),
      vi.spyOn(nodeFs.realpathSync, "native"),
    ];

    it("untracked cwd → 400, zero filesystem calls, zero CLI calls", async () => {
      const root = repo();
      const { fake } = await boot({ sessionCwds: [], pinnedDirs: [] });
      const spies = fsSpies();
      const res = await postWfs({ cwd: root, action: "enable" });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe("untracked");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(fake.calls).toHaveLength(0);
    });

    it("OpenSpec disabled → 400 openspec_disabled, no filesystem access", async () => {
      const root = repo();
      const { fake } = await boot({ sessionCwds: [root], enabled: false });
      const spies = fsSpies();
      const res = await postWfs({ cwd: root, action: "enable" });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe("openspec_disabled");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(fake.calls).toHaveLength(0);
    });

    it("opted-out cwd → 400 opted_out, no filesystem access", async () => {
      const root = repo();
      const { fake } = await boot({ sessionCwds: [root], optOut: [root] });
      const spies = fsSpies();
      const res = await postWfs({ cwd: root, action: "enable" });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe("opted_out");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(fake.calls).toHaveLength(0);
    });

    it("tracked cwd without openspec/ → 400 no_openspec, no CLI call", async () => {
      const root = mkTmp("wfs-bare");
      roots.push(root);
      const { fake } = await boot({ sessionCwds: [root] });
      const res = await postWfs({ cwd: root, action: "enable" });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe("no_openspec");
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe("#X2 per-cwd lock", () => {
    it("two concurrent enables → one 200 + one 409; a symlinked spelling is also 409; lock is released afterwards", async () => {
      const root = repo();
      const link = `${root}-link`;
      nodeFs.symlinkSync(root, link);
      roots.push(link);

      // Hold the first call inside the CLI so the second arrives while it is in flight.
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const fake = makeFakeCli();
      const inner = fake.cli;
      let entered = false;
      fake.cli = async (call, ctx) => {
        entered = true;
        if (call.op === "statusAll") await gate;
        return inner(call, ctx);
      };
      await boot({ sessionCwds: [root, link], fake });

      const first = postWfs({ cwd: root, action: "enable" });
      for (let i = 0; i < 2000 && !entered; i++) await new Promise((r) => setTimeout(r, 5));
      expect(entered).toBe(true);

      const second = await postWfs({ cwd: root, action: "enable" });
      const viaSymlink = await postWfs({ cwd: link, action: "enable" });
      expect(second.statusCode).toBe(409);
      expect(viaSymlink.statusCode).toBe(409);

      release();
      expect((await first).statusCode).toBe(200);
      // Lock released: a later call is admitted (enabled already → no-op 200).
      expect((await postWfs({ cwd: root, action: "enable" })).statusCode).toBe(200);
    });

    it("an in-flight REST init blocks the endpoint for the same cwd (shared lock)", async () => {
      const root = repo();
      initHelpMock.mockResolvedValue({ ok: true, value: "--tools" });
      let release!: (v: unknown) => void;
      initAsyncMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
      await boot({ sessionCwds: [root] });
      const init = fastify.inject({ method: "POST", url: "/api/openspec/init", payload: { cwd: root, confirm: true } });
      for (let i = 0; i < 2000 && initAsyncMock.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
      const res = await postWfs({ cwd: root, action: "enable" });
      expect(res.statusCode).toBe(409);
      release({ ok: true, value: "" });
      await init;
    });
  });

  it("#X3 control-tier row, networkGuard on the route, manifest entry", async () => {
    expect(ROUTE_TIERS).toContainEqual({ method: "POST", path: "/api/openspec/workflow-schema", tier: "control" });

    const guard = vi.fn(async (_req: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) => {
      reply.code(403).send({ success: false, error: "denied" });
    });
    const root = repo();
    const { fake } = await boot({ sessionCwds: [root], networkGuard: guard as never });
    const res = await postWfs({ cwd: root, action: "enable" });
    expect(guard).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(403);
    expect(fake.calls).toHaveLength(0);

    /** @structural-pin MCP manifest coverage: the route row must exist in the static tools.manifest.ts table (#X3) */
    const manifest = nodeFs.readFileSync(
      path.resolve(__dirname, "../../../mcp-server-plugin/src/server/tools.manifest.ts"),
      "utf8",
    );
    expect(manifest).toContain('path: "/api/openspec/workflow-schema"');
  });

  it("#X7 a successful update logs cwd, action, written paths, stamp before and after; refresh + semaphore are wired", async () => {
    const root = repo();
    writeSchemaDir(root, { base: "1.10.0", patch: CURRENT_PATCH });
    const { base, spawnSemaphore } = await boot({ sessionCwds: [root] });
    const res = await postWfs({ cwd: root, action: "update", previousDefault: "spec-driven" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toMatchObject({ ok: true, status: "current" });
    expect(body.data.written).toEqual(["openspec/schemas/pi-spec-driven"]);

    const entries = logLines.map((l) => JSON.parse(l)).filter((e) => e.event === "openspec.workflow-schema");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      cwd: root,
      action: "update",
      ok: true,
      written: ["openspec/schemas/pi-spec-driven"],
      stampBefore: { base: "1.10.0", patch: CURRENT_PATCH },
      stampAfter: { base: "1.11.0", patch: CURRENT_PATCH },
    });
    // forced refresh went through the directory service for the tracked spelling
    expect(base.directoryService.refreshOpenSpec).toHaveBeenCalledWith(root);
    // the real spawn semaphore is injected (the stubbed `newer` validate is not reached here, so only wiring is asserted via a newer case below)
    expect(spawnSemaphore.run).toBeDefined();
  });

  it("the injected spawn semaphore wraps the local validate for a newer stamp", async () => {
    const root = repo();
    writeSchemaDir(root, { base: "1.12.0", patch: CURRENT_PATCH });
    const { spawnSemaphore } = await boot({ sessionCwds: [root] });
    const res = await postWfs({ cwd: root, action: "remove", confirm: true });
    expect(res.statusCode).toBe(200);
    expect(spawnSemaphore.run).toHaveBeenCalled();
  });

  describe("#X4 init chaining (default for new projects)", () => {
    const scaffoldOnInit = (root: string) =>
      initAsyncMock.mockImplementation(async () => {
        write(root, "openspec/config.yaml", "schema: spec-driven\n");
        nodeFs.mkdirSync(path.join(root, "openspec", "changes"), { recursive: true });
        return { ok: true, value: "initialized" };
      });
    const configOf = (root: string) => nodeFs.readFileSync(path.join(root, "openspec", "config.yaml"), "utf8");
    const initPost = (body: Record<string, unknown>) =>
      fastify.inject({ method: "POST", url: "/api/openspec/init", payload: body });

    it("default on + dir without openspec/ → enabled inside init's lock (no 409), reported in the init response", async () => {
      const root = mkTmp("wfs-new");
      roots.push(root);
      scaffoldOnInit(root);
      const { base } = await boot({ sessionCwds: [root], defaultForNewProjects: true });
      const res = await initPost({ cwd: root });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.workflowSchemaError).toBeUndefined();
      expect(body.data.workflowSchema).toMatchObject({ ok: true, configured: "pi-spec-driven", status: "current" });
      expect(configOf(root)).toContain("pi-spec-driven");
      // init's own refresh runs once, after enable (enable does not double-refresh)
      expect(base.directoryService.refreshOpenSpec).toHaveBeenCalledTimes(1);
    });

    it("default on + existing openspec/ (confirmed re-init) → not enabled", async () => {
      const root = repo({ config: "schema: spec-driven\n" });
      initAsyncMock.mockResolvedValue({ ok: true, value: "x" });
      const { fake } = await boot({ sessionCwds: [root], defaultForNewProjects: true });
      const res = await initPost({ cwd: root, confirm: true });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.workflowSchema).toBeUndefined();
      expect(body.data.workflowSchemaError).toBeUndefined();
      expect(configOf(root)).toContain("spec-driven");
      expect(configOf(root)).not.toContain("pi-spec-driven");
      expect(fake.calls).toHaveLength(0);
    });

    it("default on + enable fails → init still succeeds and reports workflowSchemaError", async () => {
      const root = mkTmp("wfs-fail");
      roots.push(root);
      scaffoldOnInit(root);
      await boot({ sessionCwds: [root], defaultForNewProjects: true, fake: makeFakeCli({ statusRoot: null }) });
      const res = await initPost({ cwd: root });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.workflowSchema).toBeUndefined();
      expect(typeof body.data.workflowSchemaError).toBe("string");
      expect(body.data.workflowSchemaError).toMatch(/root/);
      expect(configOf(root)).not.toContain("pi-spec-driven");
    });

    it("default off → not enabled", async () => {
      const root = mkTmp("wfs-off");
      roots.push(root);
      scaffoldOnInit(root);
      const { fake } = await boot({ sessionCwds: [root], defaultForNewProjects: false });
      const res = await initPost({ cwd: root });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.workflowSchema).toBeUndefined();
      expect(body.data.workflowSchemaError).toBeUndefined();
      expect(fake.calls).toHaveLength(0);
    });
  });
});
