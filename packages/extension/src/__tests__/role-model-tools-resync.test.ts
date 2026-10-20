/**
 * `list_models` resyncs the in-process registry from global config before it
 * reads, degrades on failure/abort/timeout, and surfaces `refreshErrors`.
 * See change: list-models-auto-resync (test-plan #E1–#E4, #E6–#E10, #X1–#X6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandHandler } from "../command-handler.js";
import { getCustomProviderNames } from "../provider-register.js";
import { registerRoleModelTools, type RoleModelToolsDeps } from "../role-model-tools.js";

vi.mock("../provider-register.js", async (orig) => ({
  ...(await orig<typeof import("../provider-register.js")>()),
  getCustomProviderNames: vi.fn(() => new Set<string>()),
}));

function mkPi() {
  const tools = new Map<string, any>();
  const pi: any = {
    registerTool: (t: any) => tools.set(t.name, t),
    events: { on: () => {}, emit: async () => {} },
  };
  return { pi, tools };
}

type Result = { aborted: boolean; errors: Map<string, Error> };
const OK: Result = { aborted: false, errors: new Map() };

/** Fake registry whose catalogue switches to `after` once `refresh` ran. */
function mkRegistry(opts: {
  before?: any[];
  after?: any[];
  allAfter?: any[];
  refresh?: (o: any) => Promise<Result | undefined>;
  order?: string[];
}) {
  let refreshed = false;
  const order = opts.order ?? [];
  const registry = {
    refresh: vi.fn(async (o: any) => {
      order.push("refresh");
      const r = opts.refresh ? await opts.refresh(o) : OK;
      refreshed = true;
      return r;
    }),
    getAvailable: vi.fn(() => {
      order.push("getAvailable");
      return refreshed ? (opts.after ?? []) : (opts.before ?? []);
    }),
    getAll: vi.fn(() => (refreshed ? (opts.allAfter ?? opts.after ?? []) : (opts.before ?? []))),
  };
  return { registry, order };
}

async function run(deps: RoleModelToolsDeps, params: any = {}, signal?: AbortSignal) {
  const { pi, tools } = mkPi();
  registerRoleModelTools(pi, deps);
  const res = await tools.get("list_models").execute("id", params, signal, null, {});
  return res.details;
}

describe("list_models resync-before-read", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("E1: re-applies providers, refreshes, then reads — a newly registered provider is listed", async () => {
    const order: string[] = [];
    const { registry } = mkRegistry({ after: [{ provider: "newprov", id: "m1" }], order });
    // `custom` comes from provider-register's lastRegistered; simulated via the module mock.
    vi.mocked(getCustomProviderNames).mockReturnValue(new Set(["newprov"]));
    const details = await run({
      getRegistry: () => registry,
      reloadProviders: async () => { order.push("reloadProviders"); },
    });
    expect(details.models).toEqual([expect.objectContaining({ ref: "newprov/m1", custom: true })]);
    expect(order).toEqual(["reloadProviders", "refresh", "getAvailable"]);
  });

  it("E2: a provider dropped by the refresh is not listed", async () => {
    const { registry } = mkRegistry({
      before: [{ provider: "oldprov", id: "x" }, { provider: "a", id: "1" }],
      after: [{ provider: "a", id: "1" }],
    });
    const details = await run({ getRegistry: () => registry, reloadProviders: async () => {} });
    expect(details.models.some((m: any) => m.provider === "oldprov")).toBe(false);
  });

  it("E3: a credential added out-of-band is picked up with no reloadProviders dep", async () => {
    const { registry } = mkRegistry({ after: [{ provider: "anthropic", id: "x" }] });
    const details = await run({ getRegistry: () => registry });
    expect(details.models.map((m: any) => m.ref)).toEqual(["anthropic/x"]);
    expect(registry.refresh).toHaveBeenCalledOnce();
  });

  it("E4: refresh is local-only and never carries the agent signal", async () => {
    const { registry } = mkRegistry({});
    await run({ getRegistry: () => registry }, {}, new AbortController().signal);
    const arg = registry.refresh.mock.calls[0][0];
    expect(arg.allowNetwork).toBe(false);
    expect("signal" in arg).toBe(false);
  });

  it("E6: absent registry returns registryReady:false immediately, no re-apply", async () => {
    const reloadProviders = vi.fn(async () => {});
    const details = await run({ getRegistry: () => undefined, reloadProviders });
    expect(details).toEqual({ models: [], registryReady: false, reason: expect.any(String) });
    expect(details.reason.length).toBeGreaterThan(0);
    expect(reloadProviders).not.toHaveBeenCalled();
  });

  it("E7: a registry cleared during the resync still reads the start-of-call instance", async () => {
    const { registry } = mkRegistry({ after: [{ provider: "a", id: "1" }] });
    let calls = 0;
    const details = await run({ getRegistry: () => (calls++ === 0 ? registry : undefined) });
    expect(details.registryReady).toBe(true);
    expect(details.models).toHaveLength(1);
  });

  it("E8: a clean refresh omits refreshErrors", async () => {
    const { registry } = mkRegistry({ after: [{ provider: "a", id: "1" }] });
    const details = await run({ getRegistry: () => registry });
    expect("refreshErrors" in details).toBe(false);
  });

  it("E9: annotated mode reads the refreshed getAll() with excludedReason", async () => {
    const { registry } = mkRegistry({ after: [], allAfter: [{ provider: "c", id: "m" }] });
    const details = await run({ getRegistry: () => registry }, { annotated: true });
    expect(details.models).toEqual([expect.objectContaining({ ref: "c/m", excludedReason: "no-credential" })]);
    expect(registry.refresh).toHaveBeenCalledOnce();
  });

  it("E10: the session scope still filters the refreshed catalogue", async () => {
    const { registry } = mkRegistry({ after: [{ provider: "a", id: "1" }, { provider: "b", id: "2" }] });
    const details = await run({
      getRegistry: () => registry,
      getScopedModels: () => [{ model: { provider: "a", id: "1" } }],
    });
    expect(details.models.map((m: any) => m.ref)).toEqual(["a/1"]);
  });
});

describe("list_models resync degradation", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("X1: a throwing re-apply still refreshes and answers", async () => {
    const { registry } = mkRegistry({ after: [{ provider: "a", id: "1" }] });
    const warn = vi.mocked(console.warn);
    const details = await run({
      getRegistry: () => registry,
      reloadProviders: async () => { throw new Error("boom"); },
    });
    expect(registry.refresh).toHaveBeenCalledOnce();
    expect(details.registryReady).toBe(true);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/boom/);
  });

  it("X2: a rejecting refresh yields the last-known catalogue, no refreshErrors", async () => {
    const last = [{ provider: "a", id: "1" }];
    const registry = {
      refresh: vi.fn(async () => { throw new Error("nope"); }),
      getAvailable: () => last,
      getAll: () => last,
    };
    const details = await run({ getRegistry: () => registry });
    expect(details.models.map((m: any) => m.ref)).toEqual(["a/1"]);
    expect("refreshErrors" in details).toBe(false);
  });

  it("X3: per-provider refresh errors surface as refreshErrors", async () => {
    const { registry } = mkRegistry({
      after: [{ provider: "a", id: "1" }],
      refresh: async () => ({ aborted: false, errors: new Map([["flaky", new Error("down")]]) }),
    });
    const details = await run({ getRegistry: () => registry });
    expect(details.refreshErrors).toEqual([{ provider: "flaky", message: "down" }]);
    expect(details.models).toHaveLength(1);
  });

  it("X4: an aborted refresh omits refreshErrors", async () => {
    const { registry } = mkRegistry({
      refresh: async () => ({ aborted: true, errors: new Map([["x", new Error("e")]]) }),
    });
    const details = await run({ getRegistry: () => registry });
    expect("refreshErrors" in details).toBe(false);
  });

  it("X5: an agent abort during the re-apply resolves without refreshing", async () => {
    const { registry } = mkRegistry({});
    const ac = new AbortController();
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => registry, reloadProviders: () => new Promise(() => {}) });
    const call = tools.get("list_models").execute("id", {}, ac.signal, null, {});
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    await expect(call).resolves.toBeDefined();
    expect(registry.refresh).not.toHaveBeenCalled();
  });

  it("X6: an agent abort during a pending refresh resolves first, never aborting the refresh", async () => {
    let release!: (r: Result) => void;
    const { registry } = mkRegistry({ refresh: () => new Promise<Result>((res) => { release = res; }) });
    const ac = new AbortController();
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => registry });
    const call = tools.get("list_models").execute("id", {}, ac.signal, null, {});
    await new Promise((r) => setTimeout(r, 5));
    expect(registry.refresh).toHaveBeenCalledOnce();
    ac.abort();
    await expect(call).resolves.toBeDefined();
    expect("signal" in registry.refresh.mock.calls[0][0]).toBe(false);
    release(OK);
    await new Promise((r) => setTimeout(r, 5));
  });
});

describe("list_models ↔ Model Selector parity", () => {
  let home: string;
  const originalHome = process.env.HOME;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lm-parity-"));
    process.env.HOME = home;
    // settings.json without enabledModels → the Selector applies no filter.
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "settings.json"), "{}", "utf-8");
  });
  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("E5: request_models and list_models return the same refs for the same registry", async () => {
    const models = [
      { provider: "anthropic", id: "x", name: "x" },
      { provider: "openai", id: "y", name: "y" },
    ];
    const mk = () => mkRegistry({ before: models, after: models }).registry;
    const pi: any = { setSessionName: vi.fn(), getSessionName: () => "s" };
    const selectorReg = mk();
    const handler = createCommandHandler(pi, "s1", { getModelRegistry: () => selectorReg });
    const selector: any = await handler.handle({ type: "request_models", sessionId: "s1" } as any);
    const details = await run({ getRegistry: () => mk() });

    const selectorRefs = new Set(selector.models.map((m: any) => `${m.provider}/${m.id}`));
    const toolRefs = new Set(details.models.map((m: any) => m.ref));
    expect(selectorRefs.size).toBe(2);
    expect(toolRefs).toEqual(selectorRefs);
  });
});
