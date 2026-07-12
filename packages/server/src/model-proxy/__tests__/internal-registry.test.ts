/**
 * Tests for InternalRegistry credential-kind-aware filtering.
 *
 * Uses a fake PiAiModule + injected deps — no real pi-ai.
 *
 * See change: filter-oauth-incompatible-models, tasks 4.1 / 4.2.
 */
import { describe, expect, it } from "vitest";
import {
  type CustomModelEntry,
  InternalRegistry,
  type InternalRegistryDeps,
  type PiAiModule,
} from "../internal-registry.js";
import { OAUTH_INCOMPATIBLE } from "../oauth-compat.js";

// ── Fakes ────────────────────────────────────────────────────────────────

function makePiAi(builtins: Record<string, any[]>): PiAiModule {
  return {
    registerBuiltInApiProviders: () => {},
    getProviders: () => Object.keys(builtins),
    getModels: (provider: string) => builtins[provider] ?? [],
    getModel: () => null,
    registerApiProvider: () => {},
    unregisterApiProviders: () => {},
    streamSimple: async function* () {},
  } as unknown as PiAiModule;
}

function makeRegistry(opts: {
  builtins?: Record<string, any[]>;
  auth?: Record<string, any>;
  customModels?: CustomModelEntry[];
}): InternalRegistry {
  const piAi = makePiAi(opts.builtins ?? {});
  const deps: InternalRegistryDeps = {
    readProviders: () => ({}),
    readModels: () => opts.customModels ?? [],
    readAuth: () => opts.auth ?? {},
  };
  return new InternalRegistry(piAi, {} as any, deps);
}

const OAUTH = { type: "oauth", access: "tok" };
const API_KEY = { type: "api_key", key: "sk-test" };

const anthropicBuiltins = [
  { id: "claude-3-5-haiku-20241022", provider: "anthropic" }, // legacy → OAuth-incompatible
  { id: "claude-haiku-4-5", provider: "anthropic" }, // current allowlist
];

function ids(models: any[]): string[] {
  return models.map((m) => m.id).sort();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("InternalRegistry.getAvailable — credential-kind filtering", () => {
  it("OAuth-only credential excludes legacy snapshot, keeps current model", async () => {
    const reg = makeRegistry({ builtins: { anthropic: anthropicBuiltins }, auth: { anthropic: OAUTH } });
    const available = await reg.getAvailable();
    expect(ids(available)).toEqual(["claude-haiku-4-5"]);
    expect(await reg.find("anthropic", "claude-3-5-haiku-20241022")).toBeNull();
    expect(await reg.find("anthropic", "claude-haiku-4-5")).not.toBeNull();
  });

  it("api_key credential routes every model of its provider", async () => {
    const reg = makeRegistry({ builtins: { anthropic: anthropicBuiltins }, auth: { anthropic: API_KEY } });
    const available = await reg.getAvailable();
    expect(ids(available)).toEqual(["claude-3-5-haiku-20241022", "claude-haiku-4-5"]);
  });

  it("no credential excludes the provider entirely", async () => {
    const reg = makeRegistry({ builtins: { openai: [{ id: "gpt-4o", provider: "openai" }] }, auth: {} });
    expect(await reg.getAvailable()).toHaveLength(0);
  });

  it("honors custom model oauthCompatible:false under OAuth", async () => {
    const reg = makeRegistry({
      builtins: {},
      auth: { acme: OAUTH },
      customModels: [
        { id: "acme-oauth-ok", provider: "acme" },
        { id: "acme-oauth-no", provider: "acme", oauthCompatible: false },
      ],
    });
    expect(ids(await reg.getAvailable())).toEqual(["acme-oauth-ok"]);
  });
});

describe("InternalRegistry — deterministic source precedence (dedup by fqid)", () => {
  it("collision between built-in and models.json → one entry, built-in wins", async () => {
    // Both sources produce fqid `openai/gpt-4o`; built-in carries a marker.
    const reg = makeRegistry({
      builtins: { openai: [{ id: "gpt-4o", provider: "openai", __src: "builtin" }] },
      auth: { openai: API_KEY },
      customModels: [{ id: "gpt-4o", provider: "openai" }],
    });
    const all = reg.getAll().filter((m) => m.provider === "openai" && m.id === "gpt-4o");
    expect(all).toHaveLength(1);
    expect(all[0].__src).toBe("builtin");

    const available = (await reg.getAvailable()).filter(
      (m) => m.provider === "openai" && m.id === "gpt-4o",
    );
    expect(available).toHaveLength(1);
    expect(await reg.find("openai", "gpt-4o")).toMatchObject({ __src: "builtin" });
  });
});

describe("InternalRegistry.firstAvailable", () => {
  it("walks the ordered list, returns the first entry present in getAvailable()", async () => {
    const reg = makeRegistry({
      builtins: {
        anthropic: [{ id: "claude-haiku-4-5", provider: "anthropic" }],
        openai: [{ id: "gpt-4o", provider: "openai" }],
      },
      // anthropic has NO credential → unavailable; openai available.
      auth: { openai: API_KEY },
    });
    const pick = await reg.firstAvailable(["anthropic/claude-haiku-4-5", "openai/gpt-4o"]);
    expect(pick).toMatchObject({ provider: "openai", id: "gpt-4o" });
  });

  it("returns null for empty list or when no entry is available", async () => {
    const reg = makeRegistry({
      builtins: { openai: [{ id: "gpt-4o", provider: "openai" }] },
      auth: { openai: API_KEY },
    });
    expect(await reg.firstAvailable([])).toBeNull();
    expect(await reg.firstAvailable(["ghost/none", "bare"])).toBeNull();
  });
});

describe("InternalRegistry.getAllAnnotated — excluded reasons", () => {
  it("annotates oauth-incompatible, included, and no-credential entries", async () => {
    const reg = makeRegistry({
      builtins: { anthropic: anthropicBuiltins, openai: [{ id: "gpt-4o", provider: "openai" }] },
      auth: { anthropic: OAUTH }, // no openai credential
    });
    const byId = new Map(reg.getAllAnnotated().map((e) => [e.model.id, e.excludedReason]));
    expect(byId.get("claude-3-5-haiku-20241022")).toBe("oauth-incompatible");
    expect(byId.get("claude-haiku-4-5")).toBeNull();
    expect(byId.get("gpt-4o")).toBe("no-credential");
  });
});

describe("OAUTH_INCOMPATIBLE regression — current Claude-Code allowlist stays routable", () => {
  // Pin the live allowlist so a future edit never accidentally adds one here.
  const allowlist = ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5", "claude-sonnet-4-6", "claude-haiku-4-6"];

  it("no current allowlist model is flagged OAuth-incompatible", () => {
    for (const id of allowlist) {
      expect(OAUTH_INCOMPATIBLE.anthropic.has(id)).toBe(false);
    }
  });

  it("allowlist models keep oauthCompatible !== false and route over OAuth", async () => {
    const builtins = { anthropic: allowlist.map((id) => ({ id, provider: "anthropic" })) };
    const reg = makeRegistry({ builtins, auth: { anthropic: OAUTH } });
    for (const m of reg.getAll()) {
      expect(m.oauthCompatible).not.toBe(false);
    }
    expect(ids(await reg.getAvailable())).toEqual([...allowlist].sort());
  });
});
