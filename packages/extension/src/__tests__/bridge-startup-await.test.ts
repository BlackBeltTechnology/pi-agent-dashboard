/**
 * Bridge default export awaits startup provider registration as its LAST step
 * (test-plan E11, X2). The synchronous body is unchanged: callers that do not
 * await still see every registration immediately; pi awaits the returned
 * promise, which never rejects (a rejecting factory makes pi discard its
 * queued registrations).
 *
 * See change: register-custom-provider-models-at-activation (design D1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRIDGE_KEY = "__pi_dashboard_bridge__";
const g = process as unknown as Record<string, unknown>;

function recordingPi(throwFor?: string) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const pi = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === "events") return { on: vi.fn(), emit: vi.fn() };
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        const cfg = args[1] as { models?: unknown[] } | undefined;
        if (prop === "registerProvider" && args[0] === throwFor && Array.isArray(cfg?.models)) {
          throw new Error(`boom ${throwFor}`);
        }
      };
    },
  });
  return { pi, calls };
}

describe("bridge default export awaits startup provider models", () => {
  let prevEnv: string | undefined;
  let tmpHome: string;
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    prevEnv = process.env.PI_DASHBOARD_BRIDGE;
    process.env.PI_DASHBOARD_BRIDGE = "on";
    tmpHome = mkdtempSync(join(tmpdir(), "bridge-startup-"));
    process.env.HOME = tmpHome;
    // Background discovery never answers: only cached registrations are visible.
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as any;
    vi.resetModules();
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.PI_DASHBOARD_BRIDGE;
    else process.env.PI_DASHBOARD_BRIDGE = prevEnv;
    delete g[BRIDGE_KEY];
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  async function writeProvidersAndCache(names: string[]) {
    const providers: Record<string, unknown> = {};
    const { recordProviderModelCache } = await import("../provider-model-cache.js");
    for (const n of names) {
      const entry = { baseUrl: `http://${n}/v1`, apiKey: "k", api: "openai-completions" };
      providers[n] = entry;
      recordProviderModelCache(n, entry, [{ id: `${n}-m`, advertised: {} }]);
    }
    mkdirSync(join(tmpHome, ".pi", "agent"), { recursive: true });
    writeFileSync(join(tmpHome, ".pi", "agent", "providers.json"), JSON.stringify({ providers }));
  }

  it("E11: synchronous registrations are present without awaiting; the return value is a Promise", async () => {
    await writeProvidersAndCache(["proxy"]);
    const owner = recordingPi();
    const sub = recordingPi();
    g[BRIDGE_KEY] = { generation: 1, pi: owner.pi }; // initBridge re-entry guard → early return
    const { default: bridge } = await import("../bridge.js");

    const ret = bridge(sub.pi as never);
    // Without awaiting: provider auth + cached models + role handlers already registered.
    const reg = sub.calls.filter((c) => c.method === "registerProvider" && c.args[0] === "proxy");
    expect(reg.some((c) => (c.args[1] as any).models === undefined)).toBe(true);
    expect(reg.some((c) => Array.isArray((c.args[1] as any).models))).toBe(true);
    expect(ret).toBeInstanceOf(Promise);
    await expect(ret).resolves.toBeUndefined();
    // The re-entry guard is untouched.
    expect((g[BRIDGE_KEY] as { generation: number }).generation).toBe(1);
  });

  it("X2: a throwing cached registration cannot reject the factory; other providers stay registered", async () => {
    await writeProvidersAndCache(["bad", "good"]);
    const owner = recordingPi();
    const sub = recordingPi("bad");
    g[BRIDGE_KEY] = { generation: 1, pi: owner.pi };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: bridge } = await import("../bridge.js");

    await expect(bridge(sub.pi as never)).resolves.toBeUndefined();
    const good = sub.calls.filter(
      (c) => c.method === "registerProvider" && c.args[0] === "good" && Array.isArray((c.args[1] as any).models),
    );
    expect(good.map((c) => (c.args[1] as any).models.map((m: any) => m.id))).toEqual([["good-m"]]);
    err.mockRestore();
  });
});
