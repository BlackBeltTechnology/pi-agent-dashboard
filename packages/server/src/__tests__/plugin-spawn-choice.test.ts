/**
 * Plugin spawnSession hook — `@role` + `thinkingLevel` mapping, literal
 * pass-through, pi-only rejection with `agent`.
 * test-plan: E15, E16, E17, E18, E19. See change: add-spawn-model-choice.
 * Exemplar: acp-plugin-spawn.test.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginSpawnOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnsureWorktreeResult } from "../git-worktree/ensure-worktree.js";
import type { StartWorktreeInitResult } from "../git-worktree/start-worktree-init.js";
import { createPendingAttachRegistry } from "../pending/pending-attach-registry.js";
import { createPendingInitialPromptRegistry } from "../pending/pending-initial-prompt-registry.js";
import { createPendingPluginRefRegistry } from "../pending/pending-plugin-ref-registry.js";
import { validatePluginAcpSpawn } from "../spawn-process/acp-spawn.js";
import { mapPluginSpawnOptions } from "../spawn-process/plugin-spawn-choice.js";
import { createPluginSpawnHook, type PluginSpawnHookDeps } from "../spawn-process/plugin-spawn-worktree.js";

let home: string;
let orig: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "plug-choice-"));
  orig = process.env.HOME as string;
  process.env.HOME = home;
  fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify({ acpAgents: [{ id: "qmt", name: "q", command: "q" }] }));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env.HOME = orig;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const roles = (r: Record<string, string>) => () => ({ roles: r });

describe("plugin spawn choice", () => {
  it("E15: @role + thinkingLevel → concrete model + field level", () => {
    const { options, warning } = mapPluginSpawnOptions(
      { cwd: "/p", model: "@review", thinkingLevel: "low" },
      { readRoles: roles({ review: "zai/glm-5.3" }) },
    );
    expect(options).toMatchObject({ model: "zai/glm-5.3", thinking: "low" });
    expect(warning).toBeUndefined();
  });

  it("E16: literal model passes through verbatim, no warning", () => {
    const readRoles = vi.fn(roles({}));
    const { options, warning } = mapPluginSpawnOptions({ cwd: "/p", model: "sonnet" }, { readRoles });
    expect(options.model).toBe("sonnet");
    expect(warning).toBeUndefined();
    expect(readRoles).not.toHaveBeenCalled();
  });

  it("E17: unresolvable role → no model, warning names it", () => {
    const { options, warning } = mapPluginSpawnOptions({ cwd: "/p", model: "@ghost" }, { readRoles: roles({}) });
    expect(options).not.toHaveProperty("model");
    expect(warning).toContain("ghost");
  });

  it("E18: agent + thinkingLevel rejected as pi-only", () => {
    expect(validatePluginAcpSpawn({ agent: "qmt", thinkingLevel: "low" })).toMatch(/thinkingLevel/);
  });

  it("E19: no model → no model / thinking in options", () => {
    const { options } = mapPluginSpawnOptions({ cwd: "/p" });
    expect(options).not.toHaveProperty("model");
    expect(options).not.toHaveProperty("thinking");
  });

  it("thinking-only pairs with the default model; invalid level warns", () => {
    expect(mapPluginSpawnOptions({ cwd: "/p", thinkingLevel: "high" }, { defaultModel: "a/b" }).options).toMatchObject({
      model: "a/b",
      thinking: "high",
    });
    const bad = mapPluginSpawnOptions({ cwd: "/p", thinkingLevel: "turbo" });
    expect(bad.options).not.toHaveProperty("thinking");
    expect(bad.warning).toBeTruthy();
  });
  // See change: default-model-follows-role (test-plan #E8).
  it("E8: thinking-only pairs with a RESOLVED role default, no warning", () => {
    const r = mapPluginSpawnOptions(
      { cwd: "/p", thinkingLevel: "low" },
      { defaultModel: "@planning", readRoles: roles({ planning: "anthropic/claude-sonnet-5-5:high" }) },
    );
    expect(r.options).toMatchObject({ model: "anthropic/claude-sonnet-5-5", thinking: "low" });
    expect(r.warning).toBeUndefined();
  });

  it("E8b: thinking-only with an unresolved role default → no model, no warning", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const r = mapPluginSpawnOptions({ cwd: "/p", thinkingLevel: "low" }, { defaultModel: "@validate", readRoles: roles({}) });
    expect(r.options).not.toHaveProperty("model");
    expect(r.options).toMatchObject({ thinking: "low" });
    expect(r.warning).toBeUndefined();
  });
});

// ── Plugin spawn hook with a `worktree` block (change: add-plugin-spawn-worktree) ──
describe("plugin spawn hook — worktree block", () => {
  const WT = "/repo/.worktrees/os-add-x";
  const okEnsure = (created = true): EnsureWorktreeResult => ({ ok: true, path: WT, branch: "os/add-x", created });
  const block = { branch: "os/add-x", ifExists: "reuse" as const, attachChange: "add-x" };

  function setup(over: Partial<PluginSpawnHookDeps> = {}, priority = 50) {
    const normalize = (c: string) => c;
    const regs = {
      ref: createPendingPluginRefRegistry(),
      prompt: createPendingInitialPromptRegistry({ normalize }),
      attach: createPendingAttachRegistry({ normalize }),
    };
    const calls = { order: [] as string[] };
    const ensureWorktree = vi.fn(async () => okEnsure());
    const spawnPi = vi.fn(async (_cwd: string, _opts?: Record<string, unknown>) => {
      calls.order.push("spawn");
      return { success: true, message: "ok", pid: 7, process: {}, spawnToken: "tok-1" };
    });
    const armWatchdog = vi.fn();
    const registerHeadlessPid = vi.fn();
    const startWorktreeInit = vi.fn(async (): Promise<StartWorktreeInitResult> => ({ status: "done", durationMs: 1 }));
    const deps: PluginSpawnHookDeps = {
      plugin: { id: "wf", priority },
      defaultModel: () => undefined,
      mintSpawnToken: () => "tok-1",
      validateAcp: () => null,
      pendingPluginRefRegistry: regs.ref,
      pendingInitialPromptRegistry: regs.prompt,
      pendingAttachRegistry: regs.attach,
      spawnPi,
      spawnAcp: vi.fn(),
      armWatchdog,
      registerHeadlessPid,
      ensureWorktree,
      resolveCwdPolicy: () => undefined,
      autoInitEnabled: () => true,
      startWorktreeInit,
      log: () => undefined,
      warn: () => undefined,
      ...over,
    };
    return { hook: createPluginSpawnHook(deps), regs, calls, ensureWorktree, spawnPi, armWatchdog, registerHeadlessPid, startWorktreeInit };
  }
  const spawnOpts = (over: Partial<PluginSpawnOptions> = {}): PluginSpawnOptions => ({
    cwd: "/repo",
    mode: "worktree",
    worktree: block,
    initialPrompt: "/skill:ship-it",
    pluginRef: { goalId: "g1" },
    ...over,
  });

  it("E8: an untrusted plugin is refused before anything runs", async () => {
    const t = setup({}, 500);
    const r = await t.hook(spawnOpts());
    expect(r.success).toBe(false);
    expect(t.ensureWorktree).not.toHaveBeenCalled();
    expect(t.spawnPi).not.toHaveBeenCalled();
  });

  it("E9: mode=worktree without a block keeps the local fallback", async () => {
    const t = setup();
    const r = await t.hook(spawnOpts({ worktree: undefined }));
    expect(r.success).toBe(true);
    expect(r).not.toHaveProperty("worktreePath");
    expect(t.ensureWorktree).not.toHaveBeenCalled();
    expect(t.spawnPi).toHaveBeenCalledWith("/repo", expect.anything());
  });

  it("E10: prompt, attach, spawn, watchdog and PID registry are all keyed by the worktree path", async () => {
    const t = setup();
    const r = await t.hook(spawnOpts());
    expect(r).toMatchObject({ success: true, worktreePath: WT, branch: "os/add-x", created: true });
    expect(t.regs.prompt.size(WT)).toBe(1);
    expect(t.regs.attach.size(WT)).toBe(1);
    expect(t.regs.prompt.size("/repo")).toBe(0);
    expect(t.regs.attach.size("/repo")).toBe(0);
    expect(t.spawnPi).toHaveBeenCalledWith(WT, expect.anything());
    expect(t.armWatchdog).toHaveBeenCalledWith(WT, expect.anything());
    expect(t.registerHeadlessPid).toHaveBeenCalledWith(7, WT, expect.anything(), "tok-1", expect.anything());
    expect(t.regs.attach.consume(WT)).toBe("add-x");
    expect(t.regs.prompt.consume(WT)).toBe("/skill:ship-it");
  });

  it("E11: a full attach queue still spawns, with a warning", async () => {
    const attach = { enqueue: vi.fn(() => false), withdraw: vi.fn() };
    const t = setup({ pendingAttachRegistry: attach });
    const r = await t.hook(spawnOpts());
    expect(r.success).toBe(true);
    expect(r.warning).toContain("attach queue full");
    expect(attach.withdraw).not.toHaveBeenCalled();
  });

  it("E12: no gitWorktreeBase reaches the spawn (the hook has no base-registry dependency; dialog-only per git-context)", async () => {
    const t = setup();
    await t.hook(spawnOpts());
    expect(JSON.stringify(t.spawnPi.mock.calls)).not.toContain("gitWorktreeBase");
    expect(Object.keys(t)).not.toContain("pendingWorktreeBaseRegistry");
  });

  it("X7: a malformed block fails invalid_block, spawns nothing and files nothing", async () => {
    for (const worktree of ["os/x", [], {}, { branch: "x", ifExists: "maybe" }, { branch: "x", ifExists: "reuse", attachChange: "Bad Name" }]) {
      const t = setup();
      const r = await t.hook(spawnOpts({ worktree: worktree as never }));
      expect(r, JSON.stringify(worktree)).toMatchObject({ success: false, code: "invalid_block" });
      expect(t.spawnPi).not.toHaveBeenCalled();
      expect(t.ensureWorktree).not.toHaveBeenCalled();
      expect(t.regs.ref.size()).toBe(0);
      expect(t.regs.prompt.size("/repo")).toBe(0);
    }
  });

  it("X12: an ensure failure leaves no plugin ref, prompt or attach intent and never spawns", async () => {
    const t = setup({ ensureWorktree: vi.fn(async () => ({ ok: false as const, code: "branch_invalid" as const, message: "bad" })) });
    const r = await t.hook(spawnOpts());
    expect(r).toMatchObject({ success: false, code: "branch_invalid" });
    expect(t.regs.ref.size()).toBe(0);
    expect(t.regs.prompt.size("/repo")).toBe(0);
    expect(t.regs.prompt.size(WT)).toBe(0);
    expect(t.regs.attach.size(WT)).toBe(0);
    expect(t.spawnPi).not.toHaveBeenCalled();
  });

  it("a failed spawn withdraws the prompt, attach and plugin-ref intents", async () => {
    const spawnPi = vi.fn(async () => ({ success: false, message: "boom" }));
    const t = setup({ spawnPi });
    const r = await t.hook(spawnOpts());
    expect(r.success).toBe(false);
    expect(t.regs.ref.size()).toBe(0);
    expect(t.regs.prompt.size(WT)).toBe(0);
    expect(t.regs.attach.size(WT)).toBe(0);
  });

  it("X13: a trusted init is awaited (skipIfRunning, no confirmHash) before the spawn", async () => {
    let finished = false;
    const startWorktreeInit = vi.fn(async (): Promise<StartWorktreeInitResult> => {
      await new Promise((r) => setTimeout(r, 50));
      finished = true;
      return { status: "done", durationMs: 50 };
    });
    const t = setup({ startWorktreeInit });
    t.spawnPi.mockImplementation(async () => {
      expect(finished).toBe(true);
      return { success: true, message: "ok", pid: 7, process: {}, spawnToken: "tok-1" };
    });
    const r = await t.hook(spawnOpts());
    expect(r.success).toBe(true);
    expect(startWorktreeInit).toHaveBeenCalledWith(WT, { skipIfRunning: true });
  });

  it("X14: a failed init returns init_failed, spawns nothing and files nothing", async () => {
    const startWorktreeInit = vi.fn(async (): Promise<StartWorktreeInitResult> => ({ status: "failed", code: "x", hint: "install failed", stderr: "" }));
    const t = setup({ startWorktreeInit });
    const r = await t.hook(spawnOpts());
    expect(r).toMatchObject({ success: false, code: "init_failed" });
    expect(t.spawnPi).not.toHaveBeenCalled();
    expect(t.regs.ref.size()).toBe(0);
    expect(t.regs.prompt.size(WT)).toBe(0);
    expect(t.regs.attach.size(WT)).toBe(0);
  });

  it("X15: an untrusted hook is not run and the spawn proceeds", async () => {
    const startWorktreeInit = vi.fn(async (): Promise<StartWorktreeInitResult> => ({ status: "untrusted", hook: {} as never, hash: "h" }));
    const t = setup({ startWorktreeInit });
    const r = await t.hook(spawnOpts());
    expect(r.success).toBe(true);
    expect(t.spawnPi).toHaveBeenCalled();
  });

  it("X16: with auto-init off no init is started", async () => {
    const t = setup({ autoInitEnabled: () => false });
    const r = await t.hook(spawnOpts());
    expect(r.success).toBe(true);
    expect(t.startWorktreeInit).not.toHaveBeenCalled();
  });

  it("an init another trigger started is awaited; its failure returns init_failed", async () => {
    const startWorktreeInit = vi.fn(async (): Promise<StartWorktreeInitResult> => ({ status: "already_running" }));
    const t = setup({ startWorktreeInit, awaitInitRun: async () => "failed" });
    expect(await t.hook(spawnOpts())).toMatchObject({ success: false, code: "init_failed" });
    expect(t.spawnPi).not.toHaveBeenCalled();
  });

  it("the cwd-policy check compares the target floor with the spawn cwd's floor", async () => {
    const floors: Record<string, unknown> = { "/repo": { tools: ["a", "b"] }, [WT]: { tools: ["a", "b"] } };
    let verdict: boolean | undefined;
    const ensureWorktree = vi.fn(async (o: { checkTarget?: (p: string) => boolean }) => {
      verdict = o.checkTarget?.(WT);
      return okEnsure();
    });
    void setup({ ensureWorktree, resolveCwdPolicy: (c) => floors[c] }).hook(spawnOpts());
    await vi.waitFor(() => expect(verdict).toBe(true));
    floors[WT] = { tools: ["a"] };
    verdict = undefined;
    void setup({ ensureWorktree, resolveCwdPolicy: (c) => floors[c] }).hook(spawnOpts());
    await vi.waitFor(() => expect(verdict).toBe(false));
  });
});
