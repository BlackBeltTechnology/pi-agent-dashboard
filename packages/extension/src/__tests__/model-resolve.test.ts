/**
 * Tests for the `model:resolve` event listener registered by provider-register.ts.
 *
 * Spec: openspec/changes/adopt-model-resolve-handler-and-roles-ownership/
 *       specs/dashboard-model-resolution/spec.md
 *
 * Approach: stand up a fake ExtensionAPI that captures `pi.on(...)` and
 * `pi.events.on(...)` handlers. Call activate() with no providers.json
 * (so provider registration is a no-op), then drive a synthesized
 * `session_start` event to inject a stubbed `modelRegistry`. Finally
 * emit `model:resolve` probes and assert the listener's behaviour.
 *
 * Mirrors the structure of pi-dashboard-subagents' `model-resolve.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Note: provider-register.ts keeps module-level state (`modelRegistryRef`)
// that is set lazily by session_start and gated by a `!modelRegistryRef`
// check. Tests reset modules in beforeEach so each test gets a fresh import
// and can inject its own registry.

const CONFIG = () => join(homedir(), ".pi", "agent", "providers.json");

type AnyModel = { id: string; provider?: string };

interface FakePi {
  pi: any;
  events: Map<string, Array<(data: any) => any>>;
  lifecycle: Map<string, Array<(event: any, ctx: any) => any>>;
  emit: (name: string, data: any) => Promise<void>;
  fireLifecycle: (name: string, event: any, ctx: any) => Promise<void>;
}

function mkPi(): FakePi {
  const events = new Map<string, Array<(data: any) => any>>();
  const lifecycle = new Map<string, Array<(event: any, ctx: any) => any>>();
  const pi: any = {
    events: {
      on: (name: string, fn: (data: any) => any) => {
        const list = events.get(name) ?? [];
        list.push(fn);
        events.set(name, list);
      },
      emit: async (name: string, data: any) => {
        for (const fn of events.get(name) ?? []) await fn(data);
      },
    },
    on: (name: string, fn: (event: any, ctx: any) => any) => {
      const list = lifecycle.get(name) ?? [];
      list.push(fn);
      lifecycle.set(name, list);
    },
    registerProvider: () => {},
    unregisterProvider: () => {},
    setModel: async () => {},
  };
  return {
    pi,
    events,
    lifecycle,
    emit: async (name, data) => {
      for (const fn of events.get(name) ?? []) await fn(data);
    },
    fireLifecycle: async (name, event, ctx) => {
      for (const fn of lifecycle.get(name) ?? []) await fn(event, ctx);
    },
  };
}

function makeRegistry(opts: {
  models?: AnyModel[];
  authOk?: boolean;
  authError?: string;
}) {
  const models = opts.models ?? [];
  return {
    find: (provider: string, id: string) =>
      models.find((m) => m.provider === provider && m.id === id),
    getAll: () => models,
    getApiKeyAndHeaders: async (_m: AnyModel) =>
      opts.authOk === false
        ? { ok: false, error: opts.authError ?? "missing" }
        : { ok: true, apiKey: "sk-test", headers: {} },
  };
}

async function bootstrap(registry: any) {
  const fake = mkPi();
  const { activate } = await import("../provider-register.js");
  activate(fake.pi);
  // Inject modelRegistry via the session_start lifecycle hook (the same path
  // production code uses to capture it).
  await fake.fireLifecycle("session_start", {}, { modelRegistry: registry, model: null, ui: { notify: () => {} } });
  return fake;
}

function resetConfig() {
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
  if (existsSync(CONFIG())) rmSync(CONFIG());
}

beforeEach(() => {
  resetConfig();
  vi.resetModules();
});

afterEach(() => {
  resetConfig();
});

describe("model:resolve — @role resolution", () => {
  it("resolves @fast from providers.json#roles to a Model + auth", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "anthropic/claude-haiku-4-5" },
    }));
    const registry = makeRegistry({
      models: [{ id: "claude-haiku-4-5", provider: "anthropic" }],
    });
    const fake = await bootstrap(registry);

    const probe: any = { ref: "@fast" };
    await fake.emit("model:resolve", probe);

    expect(probe.error).toBeUndefined();
    expect(probe.model).toEqual({ id: "claude-haiku-4-5", provider: "anthropic" });
    expect(probe.resolved).toBe("anthropic/claude-haiku-4-5");
    expect(probe.auth).toEqual({ ok: true, apiKey: "sk-test", headers: {} });
  });

  it("unknown @role sets probe.error and probe.available.roles hint", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "anthropic/haiku", research: "anthropic/opus" },
    }));
    const fake = await bootstrap(makeRegistry({ models: [] }));

    const probe: any = { ref: "@unknownrole" };
    await fake.emit("model:resolve", probe);

    expect(probe.model).toBeUndefined();
    expect(probe.error).toMatch(/Role "@unknownrole"/);
    expect(probe.available?.roles).toEqual({ fast: "anthropic/haiku", research: "anthropic/opus" });
  });

  it("empty @role name surfaces an error", async () => {
    const fake = await bootstrap(makeRegistry({ models: [] }));
    const probe: any = { ref: "@" };
    await fake.emit("model:resolve", probe);
    expect(probe.model).toBeUndefined();
    expect(probe.error).toMatch(/Invalid role alias/);
  });
});

describe("model:resolve — provider/model resolution", () => {
  it("resolves a literal provider/model via registry.find", async () => {
    const m = { id: "claude-opus-4", provider: "anthropic" };
    const fake = await bootstrap(makeRegistry({ models: [m] }));

    const probe: any = { ref: "anthropic/claude-opus-4" };
    await fake.emit("model:resolve", probe);

    expect(probe.model).toBe(m);
    expect(probe.resolved).toBe("anthropic/claude-opus-4");
  });

  it("unknown provider/model surfaces error with available models hint", async () => {
    const fake = await bootstrap(makeRegistry({
      models: [
        { id: "a", provider: "p" },
        { id: "b", provider: "p" },
      ],
    }));
    const probe: any = { ref: "anthropic/made-up" };
    await fake.emit("model:resolve", probe);
    expect(probe.model).toBeUndefined();
    expect(probe.error).toMatch(/No model matched "anthropic\/made-up"/);
    expect(probe.available?.models).toEqual(["a", "b"]);
  });
});

describe("model:resolve — bare id resolution", () => {
  it("resolves a bare id via registry.getAll first-match", async () => {
    const m = { id: "claude-haiku-4-5", provider: "anthropic" };
    const fake = await bootstrap(makeRegistry({ models: [m] }));

    const probe: any = { ref: "claude-haiku-4-5" };
    await fake.emit("model:resolve", probe);

    expect(probe.model).toBe(m);
    expect(probe.resolved).toBe("anthropic/claude-haiku-4-5");
  });

  it("unknown bare id surfaces error with available models hint", async () => {
    const fake = await bootstrap(makeRegistry({
      models: [
        { id: "a", provider: "p" },
        { id: "b", provider: "p" },
        { id: "c", provider: "p" },
      ],
    }));
    const probe: any = { ref: "made-up-model" };
    await fake.emit("model:resolve", probe);
    expect(probe.model).toBeUndefined();
    expect(probe.error).toMatch(/No model matched "made-up-model"/);
    expect(probe.available?.models).toEqual(["a", "b", "c"]);
  });
});

describe("model:resolve — thinking suffix", () => {
  it("parses :high off provider/model before registry lookup", async () => {
    const m = { id: "claude-opus-4", provider: "anthropic" };
    let findArgs: [string, string] | undefined;
    const registry = {
      find: (p: string, id: string) => {
        findArgs = [p, id];
        return p === "anthropic" && id === "claude-opus-4" ? m : undefined;
      },
      getAll: () => [m],
      getApiKeyAndHeaders: async () => ({ ok: true }),
    };
    const fake = await bootstrap(registry);
    const probe: any = { ref: "anthropic/claude-opus-4:high" };
    await fake.emit("model:resolve", probe);

    expect(probe.thinkingLevel).toBe("high");
    expect(findArgs).toEqual(["anthropic", "claude-opus-4"]);
    expect(probe.resolved).toBe("anthropic/claude-opus-4");
    expect(probe.model).toBe(m);
  });

  it("parses :medium off bare id before registry lookup", async () => {
    const m = { id: "claude-haiku-4-5", provider: "anthropic" };
    const fake = await bootstrap(makeRegistry({ models: [m] }));
    const probe: any = { ref: "claude-haiku-4-5:medium" };
    await fake.emit("model:resolve", probe);
    expect(probe.thinkingLevel).toBe("medium");
    expect(probe.model).toBe(m);
  });

  it("parses :low off @role-resolved literal", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "anthropic/claude-haiku-4-5:low" },
    }));
    const m = { id: "claude-haiku-4-5", provider: "anthropic" };
    const fake = await bootstrap(makeRegistry({ models: [m] }));
    const probe: any = { ref: "@fast" };
    await fake.emit("model:resolve", probe);
    expect(probe.thinkingLevel).toBe("low");
    expect(probe.model).toBe(m);
  });
});

describe("model:resolve — cooperative early-return", () => {
  it("returns immediately when probe.model is already set", async () => {
    let findCalled = false;
    const registry = {
      find: () => { findCalled = true; return undefined; },
      getAll: () => { findCalled = true; return []; },
      getApiKeyAndHeaders: async () => ({ ok: true }),
    };
    const fake = await bootstrap(registry);

    const preset = { id: "preset", provider: "p" };
    const probe: any = { ref: "anything", model: preset };
    await fake.emit("model:resolve", probe);

    expect(probe.model).toBe(preset);
    expect(findCalled).toBe(false);
    expect(probe.error).toBeUndefined();
    expect(probe.resolved).toBeUndefined();
  });

  it("ignores empty / non-string ref", async () => {
    const fake = await bootstrap(makeRegistry({ models: [] }));
    const probe: any = { ref: "" };
    await fake.emit("model:resolve", probe);
    expect(probe.model).toBeUndefined();
    expect(probe.error).toBeUndefined();

    const probe2: any = { ref: 42 };
    await fake.emit("model:resolve", probe2);
    expect(probe2.model).toBeUndefined();
    expect(probe2.error).toBeUndefined();
  });
});

describe("model:resolve — malformed providers.json tolerated", () => {
  it("malformed JSON during @role lookup returns empty available.roles", async () => {
    writeFileSync(CONFIG(), "{ not json");
    const fake = await bootstrap(makeRegistry({ models: [] }));
    const probe: any = { ref: "@fast" };
    await fake.emit("model:resolve", probe);
    expect(probe.model).toBeUndefined();
    expect(probe.error).toMatch(/Role "@fast"/);
    expect(probe.available?.roles).toEqual({});
  });
});

// ── Dead pi.modelRegistry fallback removed ────────────────────────────
//
// See change: add-agent-role-model-tools. The former getModelRegistry()
// fallback read `(piRef as any).modelRegistry` — a property that does NOT
// exist on ExtensionAPI in pi 0.80 (it lives on ExtensionContext). These
// tests pin the corrected behaviour: the ONLY registry source is the
// `ctx.modelRegistry`-captured `modelRegistryRef`, and when it is unpopulated
// the handler sets probe.error (never throws, never resolves via pi.*).

async function bootstrapCold(piModelRegistry: any) {
  const fake = mkPi();
  if (piModelRegistry !== undefined) {
    fake.pi.modelRegistry = piModelRegistry;
  }
  const { activate } = await import("../provider-register.js");
  activate(fake.pi);
  // Intentionally NO `session_start` / `model_select` fired.
  return fake;
}

describe("model:resolve — dead pi.modelRegistry fallback is gone", () => {
  it("does NOT resolve via pi.modelRegistry when modelRegistryRef is null (known model)", async () => {
    // Repro (task 1.1): pi.modelRegistry is set but modelRegistryRef is not.
    // The dead fallback would have resolved; the corrected handler must NOT —
    // probe.model stays unset and probe.error fires for a known model.
    const m = { id: "claude-haiku-4-5", provider: "anthropic" };
    const piRegistry = makeRegistry({ models: [m] });
    const fake = await bootstrapCold(piRegistry);

    const probe: any = { ref: "anthropic/claude-haiku-4-5" };
    await fake.emit("model:resolve", probe);

    expect(probe.model).toBeUndefined();
    expect(probe.error).toBe('Model registry unavailable — cannot resolve "anthropic/claude-haiku-4-5".');
  });

  it("fills probe.model from the ctx.modelRegistry-captured warm ref", async () => {
    const warmModel = { id: "warm-only", provider: "anthropic" };
    const warmRegistry = makeRegistry({ models: [warmModel] });

    const fake = mkPi();
    // Even with a bogus pi.modelRegistry present, the warm ref is the source.
    fake.pi.modelRegistry = makeRegistry({ models: [] });
    const { activate } = await import("../provider-register.js");
    activate(fake.pi);
    await fake.fireLifecycle("session_start", {}, { modelRegistry: warmRegistry, model: null, ui: { notify: () => {} } });

    const probe: any = { ref: "anthropic/warm-only" };
    await fake.emit("model:resolve", probe);

    expect(probe.error).toBeUndefined();
    expect(probe.model).toBe(warmModel);
  });

  it("no registry handle yields the unavailable error, not a throw", async () => {
    const fake = await bootstrapCold(undefined);
    const probe: any = { ref: "anthropic/claude-haiku-4-5" };
    await expect(fake.emit("model:resolve", probe)).resolves.toBeUndefined();
    expect(probe.model).toBeUndefined();
    expect(probe.error).toBe('Model registry unavailable — cannot resolve "anthropic/claude-haiku-4-5".');
  });

  it("@role with a captured warm ref fills probe.model", async () => {
    writeFileSync(CONFIG(), JSON.stringify({
      roles: { fast: "anthropic/claude-haiku-4-5" },
    }));
    const m = { id: "claude-haiku-4-5", provider: "anthropic" };
    const fake = await bootstrap(makeRegistry({ models: [m] }));

    const probe: any = { ref: "@fast" };
    await fake.emit("model:resolve", probe);

    expect(probe.error).toBeUndefined();
    expect(probe.model).toBe(m);
    expect(probe.resolved).toBe("anthropic/claude-haiku-4-5");
    expect(probe.auth).toEqual({ ok: true, apiKey: "sk-test", headers: {} });
  });
});
