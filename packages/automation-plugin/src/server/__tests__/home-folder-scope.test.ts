/**
 * The global home dir must never also be a folder scope (double-arm).
 * See change: fix-home-folder-scope-double-arm.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPlugin } from "../index.js";

const YAML = `on: { kind: schedule, cron: "* * * * *" }
action: { kind: prompt, prompt: ./prompt.md }
model: "@fast"
`;

let H: string;
let realHome: string | undefined;

function writeAuto(base: string, name: string) {
  const d = path.join(base, ".pi", "automation", name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "automation.yaml"), YAML);
  fs.writeFileSync(path.join(d, "prompt.md"), "hi");
}

beforeEach(() => {
  realHome = process.env.HOME;
  H = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "home-scope-")));
  process.env.HOME = H;
  writeAuto(H, "nightly");
});

afterEach(() => {
  vi.useRealTimers();
  process.env.HOME = realHome;
  fs.rmSync(H, { recursive: true, force: true });
});

async function boot(opts: {
  cfg?: Record<string, unknown>;
  sessions: () => Array<{ cwd: string }>;
}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-19T08:59:30Z"));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let usage: () => Array<{ label: string; ref: string }> = () => [];
  const registerUsage = vi.fn((_o: string, fn: typeof usage) => {
    usage = fn;
    return () => {};
  });
  const onEvent = vi.fn();
  const spawnSession = vi.fn(async () => ({ ok: true, sessionId: "s1" }));
  const ctx = {
    logger,
    provide: vi.fn(),
    consume: vi.fn((key: string) => (key === "roles.bindings" ? { registerUsage } : undefined)),
    consumeAll: vi.fn(() => []),
    getPluginConfig: vi.fn(() => opts.cfg ?? {}),
    sessionManager: { listAll: () => opts.sessions(), getSession: () => undefined },
    fastify: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), addHook: vi.fn(() => { throw new Error("already listening"); }) },
    spawnSession,
    abortSpawnedRun: vi.fn(),
    emitEventToSession: vi.fn(),
    sendToSession: vi.fn(),
    onEvent,
    onSessionEnded: vi.fn(),
    onShutdown: vi.fn(),
    registerBrowserHandler: vi.fn(),
  } as unknown as Parameters<typeof registerPlugin>[0];
  await registerPlugin(ctx);
  await vi.advanceTimersByTimeAsync(1500);
  const armLog = () =>
    logger.info.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("armed "));
  await vi.waitFor(() => expect(armLog().length).toBeGreaterThan(0), { timeout: 5000 });
  return { logger, usage: () => usage(), armLog, spawnSession, onEvent };
}

const ARM1 = "armed 1 automation(s) across 1 scope(s)";

describe("home dir is never also a folder scope", () => {
  it("E1 session in $HOME does not double-arm", async () => {
    const t = await boot({ sessions: () => [{ cwd: H }] });
    expect(t.armLog().at(-1)).toContain(ARM1);
    expect(t.usage().map((u) => u.label)).toEqual(["global:nightly"]);
  });

  it("E2 one occurrence starts exactly one run", async () => {
    const t = await boot({ sessions: () => [{ cwd: H }] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.spawnSession).toHaveBeenCalledTimes(1);
  });

  it("E3 trailing-slash spelling is recognized", async () => {
    const t = await boot({ sessions: () => [{ cwd: `${H}/` }] });
    expect(t.armLog().at(-1)).toContain(ARM1);
    expect(t.usage().map((u) => u.label)).toEqual(["global:nightly"]);
  });

  it("E4 a global run's own session does not create a folder scope", async () => {
    let live: Array<{ cwd: string }> = [];
    const t = await boot({ sessions: () => live });
    t.spawnSession.mockImplementation(async () => {
      live = [{ cwd: H }];
      return { ok: true, sessionId: "s1" };
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.spawnSession).toHaveBeenCalledTimes(1);
    const handler = t.onEvent.mock.calls[0]?.[0] as ((...a: unknown[]) => void) | undefined;
    handler?.("s1", { type: "message_end" });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(t.armLog().at(-1)).toContain(ARM1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.spawnSession).toHaveBeenCalledTimes(2);
  });

  it("E5 home session still arms as folder when global scanning is off", async () => {
    const t = await boot({ cfg: { scanGlobalScope: false }, sessions: () => [{ cwd: H }] });
    expect(t.armLog().at(-1)).toContain(ARM1);
    expect(t.usage().map((u) => u.label)).toEqual(["folder:nightly"]);
  });

  it("E6 subdirectory of $HOME is unaffected", async () => {
    writeAuto(path.join(H, "proj"), "build");
    const t = await boot({ sessions: () => [{ cwd: path.join(H, "proj") }] });
    expect(t.armLog().at(-1)).toContain("armed 2 automation(s) across 2 scope(s)");
    expect(t.usage().map((u) => u.label).sort()).toEqual(["folder:build", "global:nightly"]);
  });
});
