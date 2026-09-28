/**
 * `registry-singleton` × compatibility seam wiring.
 *
 * Covers task 2.1 (the ADAPTED surface is what gets cached, so
 * `getStreamSimpleFn()` is defined on a factory runtime), test-plan #X1
 * (unrecognized module → degraded WITH a reason, which is what makes
 * `/api/models` answer 503 `MODEL_PROXY_RUNTIME_MISSING`), #X4 (per-provider
 * `proxy.oauthProviders`, with `proxy.status` staying `ready`) and #E10
 * (catalogue composition is not perturbed by the adapted surface).
 *
 * The pi-ai module is stubbed at the tool-registry boundary, so these run on
 * either pin.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveModule = vi.fn();
/** Filesystem seam the fixture injects; production passes none. */
let seamDeps: { importPath: (p: string) => Promise<any>; exists: (p: string) => boolean } | undefined;

vi.mock("@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getDefaultRegistry: () => ({ resolveModule }) };
});
// The singleton calls `adaptPiAi` with the REAL fs/import deps. Redirect only
// those at the in-memory fixture — the seam's own logic still runs verbatim.
vi.mock("@blackbelt-technology/pi-dashboard-shared/piai-compat/index.js", async (orig) => {
  const actual = (await orig()) as Record<string, any>;
  return {
    ...actual,
    adaptPiAi: (mod: unknown, path?: string, deps?: unknown) =>
      actual.adaptPiAi(mod, path, deps ?? seamDeps ?? {}),
  };
});
vi.mock("../../auth/provider-auth-storage.js", () => ({
  readAuthJson: () => ({}),
  writeCredential: async () => {},
}));
vi.mock("../custom-provider-discovery.js", () => ({ discoverAllCustomProviders: async () => [] }));

import { adaptPiAi } from "@blackbelt-technology/pi-dashboard-shared/piai-compat/index.js";
import { InternalRegistry } from "../internal-registry.js";
import {
  disposeModelRegistry,
  getModelProxyStatus,
  getModelRegistry,
  getStreamSimpleFn,
} from "../registry-singleton.js";
import { FIXTURE_PATH, makeFactoryFixture } from "@blackbelt-technology/pi-dashboard-shared/test-support/piai-factory-fixture.js";

/** Route the seam's filesystem access at the in-memory fixture. */
function stubResolution(fixture: ReturnType<typeof makeFactoryFixture> | null, module?: unknown) {
  seamDeps = fixture?.deps;
  resolveModule.mockResolvedValue({
    resolution: { path: FIXTURE_PATH },
    module: fixture ? fixture.module : module,
  });
}

describe("registry-singleton — seam wiring", () => {
  beforeEach(() => {
    disposeModelRegistry();
    seamDeps = undefined;
    vi.clearAllMocks();
  });
  afterEach(() => {
    disposeModelRegistry();
    seamDeps = undefined;
  });

  // Task 2.1 — caching the RAW module would leave this undefined on a factory
  // runtime, and the proxy would 503 with a perfectly healthy registry.
  it("caches the ADAPTED surface, so getStreamSimpleFn() is defined", async () => {
    const fx = makeFactoryFixture();
    // The raw factory module has no `streamSimple` at all.
    expect((fx.module as Record<string, unknown>).streamSimple).toBeUndefined();

    stubResolution(fx);
    await getModelRegistry();

    expect(typeof getStreamSimpleFn()).toBe("function");
  });

  it("reports the adapted generation once initialized", async () => {
    stubResolution(makeFactoryFixture());
    await getModelRegistry();
    expect(getModelProxyStatus()).toMatchObject({ status: "ready", piAiGeneration: "factory" });
  });

  // test-plan #X1 — an unrecognized module must be a DIAGNOSABLE failure, not
  // a silently empty catalogue. The rejection is what makes `/api/models`
  // answer 503 MODEL_PROXY_RUNTIME_MISSING, and the reason is what makes
  // /api/health actionable.
  it("X1: an unrecognized module rejects and degrades WITH a reason", async () => {
    stubResolution(null, { somethingElse: () => {} });

    await expect(getModelRegistry()).rejects.toThrow(/compatibility seam/);

    const status = getModelProxyStatus();
    expect(status.status).toBe("degraded");
    expect(status.reason).toMatch(/neither the legacy global API|factory API/);
  });

  // test-plan #X4 — OAuth unavailability is reported PER PROVIDER and does
  // NOT flip `proxy.status`, which stays reserved for a dead registry
  // (clarification C2). api-key models keep routing.
  it("X4: surfaces per-provider oauthProviders while status stays ready", async () => {
    const fx = makeFactoryFixture({
      oauthLoaders: {
        loadAnthropicOAuth: async () => ({ refresh: async () => ({ access: "a" }) }),
      },
    });
    stubResolution(fx);
    await getModelRegistry();

    const status = getModelProxyStatus();
    expect(status.status).toBe("ready");
    expect(status.oauthProviders).toBeTruthy();
    expect(status.oauthProviders!.anthropic).toBe(true);
    expect(status.oauthProviders!["openai-codex"]).toBe(false);
    expect(status.oauthProviders!["github-copilot"]).toBe(false);
    // Every value is a boolean — never undefined, never a string.
    for (const v of Object.values(status.oauthProviders!)) expect(typeof v).toBe("boolean");
  });

  it("clears the cached generation and capability map on dispose", async () => {
    stubResolution(makeFactoryFixture());
    await getModelRegistry();
    disposeModelRegistry();

    const status = getModelProxyStatus();
    expect(status.status).toBe("degraded");
    expect(status.oauthProviders).toBeUndefined();
    expect(status.piAiGeneration).toBeUndefined();
  });
});

// ── test-plan #E10 — composition is not perturbed by the adapted surface ────

describe("InternalRegistry over the adapted factory surface", () => {
  it("E10: a custom entry under a built-in provider/id does not override the built-in", async () => {
    const fx = makeFactoryFixture({
      providers: ["anthropic"],
      models: [
        {
          provider: "anthropic",
          id: "claude-opus-5",
          api: "anthropic-messages",
          contextWindow: 200_000,
          maxTokens: 64_000,
        },
      ],
    });
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    const registry = new InternalRegistry(module, {} as never, {
      readProviders: () => ({}),
      // Same provider/id as the built-in, with DIFFERENT capabilities.
      readModels: () => [
        { provider: "anthropic", id: "claude-opus-5", contextWindow: 1, maxTokens: 1 } as never,
      ],
      readAuth: () => ({ anthropic: { type: "api_key", key: "sk" } }),
    });

    const all = registry.getAll();
    const hits = all.filter((m: any) => m.provider === "anthropic" && m.id === "claude-opus-5");
    expect(hits).toHaveLength(1);
    // The built-in survived: the custom entry's capability floors did not win.
    expect(hits[0].contextWindow).toBe(200_000);
  });

  it("sources a non-empty catalogue through the projected provider ids", async () => {
    const fx = makeFactoryFixture({ providers: ["anthropic", "openai-codex"] });
    const { module } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    // The regression guard: unprojected `Provider` OBJECTS make getModels()
    // return zero with no error — a 200 with an empty catalogue.
    expect(module.getProviders().every((p) => typeof p === "string")).toBe(true);

    const registry = new InternalRegistry(module, {} as never, {
      readProviders: () => ({}),
      readModels: () => [],
      readAuth: () => ({ anthropic: { type: "api_key", key: "sk" } }),
    });
    expect(registry.getAll().length).toBeGreaterThan(0);
  });
});

describe("fixture sanity", () => {
  it("uses a native-separator path", () => {
    expect(FIXTURE_PATH.endsWith(["dist", "index.js"].join(sep))).toBe(true);
  });
});
