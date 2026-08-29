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

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OPENSPEC_INIT } from "@blackbelt-technology/pi-dashboard-shared/platform/openspec.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";

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

  const post = (body: unknown) =>
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
    // Give the first request time to take the lock.
    await new Promise((r) => setTimeout(r, 10));
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
