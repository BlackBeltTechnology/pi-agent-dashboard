/**
 * Plugin-spawn-scope env projection: `scope.extensionConfig[name][key]` →
 * namespaced env `PI_EXT_<NAME>_<KEY>` on the headless mechanism, driven
 * through the real `pluginSpawnToSessionOptions` mapper into `buildSpawnEnv`.
 *
 * Covers E9 (config → env), E10 (name/key normalization), E11 (absent ⇒ env
 * untouched), X3 (NUL-bearing value dropped). The mapper sanitizes NUL values
 * before they reach `buildSpawnEnv`, so the full mapper→env path is exercised
 * here rather than `buildSpawnEnv` in isolation.
 *
 * A separate source-order lint (X5) asserts the hook maps BEFORE it enqueues
 * an `automationRun` stamp — a mapper failure must not strand a stale stamp
 * keyed by `cwd`.
 *
 * See change: add-plugin-spawn-scope.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginSpawnToSessionOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type DashboardServer } from "../server.js";
import { installFakePlugin, pluginCtx } from "./helpers/plugin-host-harness.js";
import { buildSpawnEnv } from "../spawn-process/process-manager.js";

// ── Host-hook scenarios (relocate-goal-product-to-plugin, D1-#1/#3) ────────
// The spawnSession hook body lives inside createServer, so these scenarios
// boot the REAL server with FAKE plugins (installed via the per-file HOME's
// installed-plugins dir, see helpers/plugin-host-harness.ts) and drive
// ctx.spawnSession / ctx.mintSpawnToken directly. spawnPiSession and the two
// pending registries are mocked/captured at their modules so the test can
// observe the host's internal state.
const h = vi.hoisted(() => ({
  spawnPiSessionMock: vi.fn(),
  pluginRefRegistry: { current: null as import("../pending/pending-plugin-ref-registry.js").PendingPluginRefRegistry | null },
  initialPromptRegistry: { current: null as import("../pending/pending-initial-prompt-registry.js").PendingInitialPromptRegistry | null },
}));

vi.mock("../spawn-process/process-manager.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../spawn-process/process-manager.js")>();
  return { ...mod, spawnPiSession: h.spawnPiSessionMock };
});
vi.mock("../pending/pending-plugin-ref-registry.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../pending/pending-plugin-ref-registry.js")>();
  return {
    ...mod,
    createPendingPluginRefRegistry: (...args: Parameters<typeof mod.createPendingPluginRefRegistry>) => {
      const inst = mod.createPendingPluginRefRegistry(...args);
      h.pluginRefRegistry.current = inst;
      return inst;
    },
  };
});
vi.mock("../pending/pending-initial-prompt-registry.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../pending/pending-initial-prompt-registry.js")>();
  return {
    ...mod,
    createPendingInitialPromptRegistry: (...args: Parameters<typeof mod.createPendingInitialPromptRegistry>) => {
      const inst = mod.createPendingInitialPromptRegistry(...args);
      h.initialPromptRegistry.current = inst;
      return inst;
    },
  };
});

const TRUSTED_ID = "fake-trusted-spawner";
const UNTRUSTED_ID = "fake-untrusted-spawner";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Keys this capability introduces on top of the base env. */
function piExtKeys(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((k) => k.startsWith("PI_EXT_"));
}

/** Base env with zero PI_EXT_* so additions are attributable to the mapper. */
function cleanBaseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of piExtKeys(env)) delete env[k];
  return env;
}

describe("plugin-spawn-scope env projection", () => {
  it("E9: extensionConfig → PI_EXT_<NAME>_<KEY>; no argv element derived", () => {
    const mapped = pluginSpawnToSessionOptions({ cwd: "/w", scope: { extensionConfig: { myext: { token: "abc" } } } });
    const env = buildSpawnEnv(cleanBaseEnv(), { extensionConfig: mapped.extensionConfig });
    expect(env.PI_EXT_MYEXT_TOKEN).toBe("abc");
  });

  it("E10: name/key are uppercased with non-[A-Z0-9_] → _", () => {
    const mapped = pluginSpawnToSessionOptions({ cwd: "/w", scope: { extensionConfig: { "my-ext": { "api.key": "v" } } } });
    const env = buildSpawnEnv(cleanBaseEnv(), { extensionConfig: mapped.extensionConfig });
    expect(env.PI_EXT_MY_EXT_API_KEY).toBe("v");
  });

  it("E11: extensionConfig absent ⇒ env carries no PI_EXT_* from this capability", () => {
    const mapped = pluginSpawnToSessionOptions({ cwd: "/w", model: "m" });
    const env = buildSpawnEnv(cleanBaseEnv(), { extensionConfig: mapped.extensionConfig });
    expect(piExtKeys(env)).toEqual([]);
  });

  it("X3: a NUL-bearing config value is dropped; siblings survive; no crash", () => {
    const opts = {
      cwd: "/w",
      scope: { extensionConfig: { myext: { token: "a\u0000b", ok: "v" } } },
    } as unknown as Parameters<typeof pluginSpawnToSessionOptions>[0];
    const mapped = pluginSpawnToSessionOptions(opts);
    const env = buildSpawnEnv(cleanBaseEnv(), { extensionConfig: mapped.extensionConfig });
    expect(env.PI_EXT_MYEXT_OK).toBe("v");
    expect(env.PI_EXT_MYEXT_TOKEN).toBeUndefined();
  });

  it("E15: array value round-trips losslessly via JSON; sibling scalar stays verbatim", () => {
    const allowedRoots = ["/a", "/b,c", " /d "];
    const mapped = pluginSpawnToSessionOptions({
      cwd: "/w",
      scope: { extensionConfig: { guard: { allowedRoots, token: "abc" } } },
    });
    const env = buildSpawnEnv(cleanBaseEnv(), { extensionConfig: mapped.extensionConfig });
    // Array key: JSON-encoded, parses back deep-equal to the original.
    expect(JSON.parse(env.PI_EXT_GUARD_ALLOWED_ROOTS as string)).toEqual(allowedRoots);
    // Sibling scalar key: still projected verbatim (no JSON quoting).
    expect(env.PI_EXT_GUARD_TOKEN).toBe("abc");
  });
});

describe("pluginSpawnToSessionOptions resume mapping (D1-#2)", () => {
  it("E4: resume maps to session-level sessionFile + mode continue; isolation mode untouched", () => {
    const mapped = pluginSpawnToSessionOptions({
      cwd: "/w",
      resume: { sessionFile: "/tmp/s.jsonl" },
      mode: "worktree",
    });
    expect(mapped.sessionFile).toBe("/tmp/s.jsonl");
    expect(mapped.mode).toBe("continue");
    // The run-isolation `mode` is a PluginSpawnOptions field consumed by the
    // host hook, never mapped onto the spawn argv — the two `mode`s live on
    // different types and only meet in the mapper, which touches only the
    // session-level one.
    expect((mapped as Record<string, unknown>).worktree).toBeUndefined();
  });

  it("E5: resume with empty / non-string sessionFile is sanitized away, no throw", () => {
    for (const bad of ["", 42]) {
      const mapped = pluginSpawnToSessionOptions({
        cwd: "/w",
        resume: { sessionFile: bad as unknown as string },
      });
      expect(mapped.sessionFile).toBeUndefined();
      expect(mapped.mode).toBeUndefined();
    }
    // Malformed resume container treated as absent (total mapper).
    const mapped = pluginSpawnToSessionOptions({
      cwd: "/w",
      resume: 42 as unknown as { sessionFile: string },
    });
    expect(mapped.sessionFile).toBeUndefined();
    expect(mapped.mode).toBeUndefined();
  });

  it("E5: absent resume ⇒ no sessionFile / mode keys at all", () => {
    const mapped = pluginSpawnToSessionOptions({ cwd: "/w" });
    expect("sessionFile" in mapped).toBe(false);
    expect("mode" in mapped).toBe(false);
  });
});

describe("plugin spawnSession host hook (relocate-goal-product-to-plugin)", () => {
  let server: DashboardServer;
  let cwd: string;

  beforeAll(() => {
    installFakePlugin({ id: TRUSTED_ID, priority: 100 });
    installFakePlugin({ id: UNTRUSTED_ID, priority: 1000 });
  });

  beforeEach(async () => {
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    cwd = "/tmp/fake-goal-cwd";
    h.spawnPiSessionMock.mockReset();
    h.spawnPiSessionMock.mockImplementation(async (_cwd, opts) => ({
      success: true,
      spawnToken: opts.spawnToken,
    }));
  });

  afterEach(async () => {
    await server.stop();
  });

  it("E1: trusted caller-supplied spawnToken is used verbatim and filed before the spawn await", async () => {
    const token = "11111111-1111-4111-8111-111111111111";
    let ownerAtSpawn: string | undefined;
    let hasAtSpawn = false;
    h.spawnPiSessionMock.mockImplementation(async (_cwd, opts) => {
      // Runs BEFORE the hook's await resolves: the ref must already be filed.
      hasAtSpawn = h.pluginRefRegistry.current!.has(token);
      ownerAtSpawn = h.pluginRefRegistry.current!.resolve(token)?.ownerId ?? undefined;
      return { success: true, spawnToken: opts.spawnToken };
    });
    const result = await pluginCtx(TRUSTED_ID).spawnSession({
      cwd,
      spawnToken: token,
      pluginRef: { goalId: "g1" },
    });
    expect(h.spawnPiSessionMock).toHaveBeenCalledTimes(1);
    expect(h.spawnPiSessionMock.mock.calls[0]![1].spawnToken).toBe(token);
    expect(hasAtSpawn).toBe(true);
    expect(ownerAtSpawn).toBe(TRUSTED_ID);
    expect(result.success).toBe(true);
    expect(result.spawnToken).toBe(token);
  });

  it("E2: a duplicate caller token is rejected; the prior owner's entry is untouched", async () => {
    const registry = h.pluginRefRegistry.current!;
    expect(registry.file("tok-A", { automationRun: { id: "r1" } }, "automation")).toBe(true);
    const result = await pluginCtx(TRUSTED_ID).spawnSession({ cwd, spawnToken: "tok-A" });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already pending/);
    expect(h.spawnPiSessionMock).not.toHaveBeenCalled();
    expect(registry.resolve("tok-A")?.ownerId).toBe("automation");
  });

  it("E3: trust gate × token decision table", async () => {
    const registry = h.pluginRefRegistry.current!;
    // Untrusted × supplied → rejected, registry never filed.
    const untrusted = pluginCtx(UNTRUSTED_ID);
    const sizeBefore = registry.size();
    const r1 = await untrusted.spawnSession({ cwd, spawnToken: "tok-U" });
    expect(r1.success).toBe(false);
    expect(registry.has("tok-U")).toBe(false);
    expect(registry.size()).toBe(sizeBefore);
    // Untrusted × absent → rejected, registry never filed.
    const r2 = await untrusted.spawnSession({ cwd });
    expect(r2.success).toBe(false);
    expect(registry.size()).toBe(sizeBefore);
    // Trusted × absent → fresh minted UUID v4 (not undefined).
    const r3 = await pluginCtx(TRUSTED_ID).spawnSession({ cwd });
    expect(r3.success).toBe(true);
    expect(r3.spawnToken).toMatch(UUID_V4);
    // Trusted × supplied → covered by E1.
  });

  it("E15: mintSpawnToken returns distinct UUID v4 values (trusted)", () => {
    const ctx = pluginCtx(TRUSTED_ID);
    const a = ctx.mintSpawnToken();
    const b = ctx.mintSpawnToken();
    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it("E6: initialPrompt is enqueued before the spawn and still queued after success", async () => {
    const registry = h.initialPromptRegistry.current!;
    const enqueueSpy = vi.spyOn(registry, "enqueue");
    const result = await pluginCtx(TRUSTED_ID).spawnSession({ cwd, initialPrompt: "/goal reprime" });
    expect(result.success).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledWith(cwd, "/goal reprime");
    // Order: enqueue BEFORE spawnPiSession.
    expect(enqueueSpy.mock.invocationCallOrder[0]).toBeLessThan(
      h.spawnPiSessionMock.mock.invocationCallOrder[0]!,
    );
    // Consumed only by register — the queue still holds the prompt.
    expect(registry.size(cwd)).toBe(1);
  });

  it("E7: a full per-cwd queue does not block the spawn (enqueue returns false, cap preserved)", async () => {
    const registry = h.initialPromptRegistry.current!;
    for (let i = 0; i < 8; i++) registry.enqueue(cwd, `p${i}`);
    const enqueueSpy = vi.spyOn(registry, "enqueue");
    const result = await pluginCtx(TRUSTED_ID).spawnSession({ cwd, initialPrompt: "p8" });
    expect(result.success).toBe(true);
    expect(enqueueSpy).toHaveReturnedWith(false);
    expect(registry.size(cwd)).toBe(8);
  });

  it("X1: failed spawn removes the ref and consumes the queued prompt", async () => {
    h.spawnPiSessionMock.mockResolvedValue({ success: false, message: "spawn failed" });
    const registry = h.pluginRefRegistry.current!;
    const prompts = h.initialPromptRegistry.current!;
    const consumeSpy = vi.spyOn(prompts, "consume");
    const result = await pluginCtx(TRUSTED_ID).spawnSession({
      cwd,
      spawnToken: "tok-A",
      initialPrompt: "/goal reprime",
    });
    expect(result.success).toBe(false);
    expect(registry.has("tok-A")).toBe(false);
    expect(consumeSpy).toHaveBeenCalledWith(cwd);
    expect(prompts.size(cwd)).toBe(0);
  });

  it("X2: a throwing spawn removes the ref, consumes the prompt, resolves { success:false }", async () => {
    h.spawnPiSessionMock.mockRejectedValue(new Error("boom"));
    const registry = h.pluginRefRegistry.current!;
    const prompts = h.initialPromptRegistry.current!;
    const consumeSpy = vi.spyOn(prompts, "consume");
    const result = await pluginCtx(TRUSTED_ID).spawnSession({ cwd, initialPrompt: "/goal reprime" });
    expect(result.success).toBe(false);
    expect(result.message).toBe("boom");
    expect(consumeSpy).toHaveBeenCalledWith(cwd);
    expect(prompts.size(cwd)).toBe(0);
    // No fresh token was filed (the minted one was rolled back).
    expect(registry.size()).toBe(0);
  });
});

describe("plugin-spawn-scope hook ordering (X5)", () => {
  it("maps options BEFORE filing the pluginRef against the spawn token", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const source = fs.readFileSync(path.resolve(__dirname, "..", "server.ts"), "utf8");
    const mapIdx = source.indexOf("pluginSpawnToSessionOptions(opts)");
    const fileIdx = source.indexOf("pendingPluginRefRegistry.file(\n                  spawnToken");
    expect(mapIdx, "pluginSpawnToSessionOptions(opts) call must be present").toBeGreaterThan(-1);
    expect(fileIdx, "pendingPluginRefRegistry.file(spawnToken, ...) must be present").toBeGreaterThan(-1);
    expect(
      mapIdx,
      "the total mapper must run BEFORE the ref is filed so a sanitized/rejected input cannot strand a stale token-keyed ref (design D7, now token-keyed per detach-automation-goal-from-core)",
    ).toBeLessThan(fileIdx);
  });
});
