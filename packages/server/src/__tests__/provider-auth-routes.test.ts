/**
 * Route tests for the delegated OAuth surface (test-plan E4–E6, E8, E10–E17).
 *
 * The pi runtime is never touched: a scripted fake flow is injected as the
 * registry, so every provider's first-interaction shape is exercised without a
 * network call or a callback port.
 *
 * See change: delegate-provider-oauth-to-pi-ai (D2, D6).
 */

import { Writable } from "node:stream";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { writeCredential } = vi.hoisted(() => ({
  writeCredential: vi.fn(async () => {}),
}));

vi.mock("../auth/provider-auth-storage.js", () => ({
  CredentialTypeConflictError: class CredentialTypeConflictError extends Error {},
  getAuthStatus: () => [],
  getOAuthProvidersMeta: (entries: { id: string; name: string; flowType: string }[] = []) =>
    entries.map((e) => ({ id: e.id, name: e.name, flowType: e.flowType })),
  oauthIdSet: () => new Set<string>(),
  removeCredential: vi.fn(),
  resolveAuthJsonKey: (id: string) => id,
  writeCredential,
}));

vi.mock("../model-proxy/registry-singleton.js", () => ({
  refreshModelRegistry: () => Promise.resolve(),
}));

import type { OAuthRegistryEntry } from "../auth/pi-oauth-types.js";
import { abortAllFlows, flowStoreSize } from "../auth/provider-auth-adapter.js";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";
import {
  anthropicFlow,
  codexFlow,
  createFakeOAuthFlow,
  deviceCodeFlow,
  type FakeOAuthFlow,
  githubCopilotFlow,
  openrouterFlow,
  resetFakeFlows,
} from "./helpers/fake-oauth-flow.js";

const FLOW_TYPE_HINT: Record<string, "auth_code" | "device_code"> = {
  anthropic: "auth_code",
  "openai-codex": "auth_code",
  openrouter: "auth_code",
};

/** Fakes created by the registry, in order, so tests can inspect them. */
let fakes: FakeOAuthFlow[] = [];

function registryFrom(
  factories: Record<string, () => FakeOAuthFlow>,
): OAuthRegistryEntry[] {
  return Object.entries(factories).map(([id, make]) => ({
    id,
    name: `${id} display`,
    flowType: FLOW_TYPE_HINT[id] ?? "device_code",
    auth: {
      name: `${id} display`,
      login: (interaction) => {
        const fake = make();
        fakes.push(fake);
        return fake.login(interaction);
      },
    },
  }));
}

function lastFake(): FakeOAuthFlow {
  const fake = fakes[fakes.length - 1];
  if (!fake) throw new Error("no fake created");
  return fake;
}

const piGateway = {
  broadcast: vi.fn(),
  sendToSession: vi.fn(),
  getConnectedSessionIds: () => [],
};
const browserGateway = { broadcastToAll: vi.fn() };

let logLines: string[] = [];

async function buildApp(registry: OAuthRegistryEntry[]) {
  logLines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      logLines.push(String(chunk));
      cb();
    },
  });
  const app = Fastify({ logger: { level: "trace", stream } });
  registerProviderAuthRoutes(app, {
    piGateway: piGateway as never,
    browserGateway: browserGateway as never,
    oauthRegistry: registry,
    oauthReady: Promise.resolve(),
  });
  await app.ready();
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

function setRegistry(factories: Record<string, () => FakeOAuthFlow>): OAuthRegistryEntry[] {
  return registryFrom(factories);
}

beforeEach(async () => {
  fakes = [];
  resetFakeFlows();
  abortAllFlows();
  app = await buildApp(setRegistry({}));
});

afterEach(async () => {
  await app.close();
  abortAllFlows();
});

async function start(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/provider-auth/start", payload });
}

// ── E4: per-provider first step ──────────────────────────────────────────────

describe("POST /start — first step per provider (E4)", () => {
  it("anthropic → authUrl + manual_code", async () => {
    app = await buildApp(setRegistry({ anthropic: anthropicFlow }));
    const res = await start({ provider: "anthropic" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.pending.kind).toBe("manual_code");
    expect(body.authUrl).toContain("claude.ai/oauth/authorize");
  });

  it("openrouter → authUrl + manual_code, and a leading `progress` did NOT end the handshake", async () => {
    app = await buildApp(setRegistry({ openrouter: openrouterFlow }));
    const res = await start({ provider: "openrouter" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.pending.kind).toBe("manual_code");
    expect(body.authUrl).toContain("openrouter.ai/auth");
    // The progress text is recorded as `message`, which proves it was consumed
    // without being mistaken for a renderable step.
    expect(body.message).toBe("Waiting for authorization");
  });

  it("openai-codex → select with both methods and no authUrl yet", async () => {
    app = await buildApp(setRegistry({ "openai-codex": codexFlow }));
    const res = await start({ provider: "openai-codex" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.pending.kind).toBe("select");
    expect(body.pending.options.map((o: { id: string }) => o.id)).toEqual([
      "browser",
      "device_code",
    ]);
    expect(body.authUrl).toBeUndefined();
  });

  it("github-copilot with a domain → device_code directly", async () => {
    app = await buildApp(setRegistry({ "github-copilot": githubCopilotFlow }));
    const res = await start({ provider: "github-copilot", enterpriseDomain: "" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.pending.kind).toBe("device_code");
    expect(body.pending.userCode).toBe("ABCD-1234");
    expect(body.pending.intervalSeconds).toBe(5);
    expect(body.pending.expiresInSeconds).toBe(900);
    expect(lastFake().answers).toEqual([""]);
  });

  it("kimi-coding / meta / xai → device_code with no provider-specific code", async () => {
    app = await buildApp(
      setRegistry({
        "kimi-coding": () => deviceCodeFlow(),
        meta: () => deviceCodeFlow(),
        xai: () => deviceCodeFlow(),
      }),
    );
    for (const provider of ["kimi-coding", "meta", "xai"]) {
      const res = await start({ provider });
      expect(res.statusCode, provider).toBe(200);
      expect(JSON.parse(res.payload).pending.kind, provider).toBe("device_code");
    }
  });
});

// ── E5/E6: the pre-answer ────────────────────────────────────────────────────

describe("enterpriseDomain pre-answer (E5, E6)", () => {
  it("E5: an empty string is a real pre-answer and never becomes pending", async () => {
    app = await buildApp(setRegistry({ "github-copilot": githubCopilotFlow }));
    const res = await start({ provider: "github-copilot", enterpriseDomain: "" });
    const body = JSON.parse(res.payload);
    expect(body.pending.kind).toBe("device_code");
    expect(lastFake().answers).toEqual([""]);
    expect(body.pending.kind).not.toBe("text");
  });

  it("E6: null and 42 are NOT pre-answers — the text prompt surfaces instead", async () => {
    app = await buildApp(setRegistry({ "github-copilot": githubCopilotFlow }));
    for (const value of [null, 42]) {
      fakes = [];
      const res = await start({ provider: "github-copilot", enterpriseDomain: value });
      expect(res.statusCode, String(value)).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.pending.kind, String(value)).toBe("text");
      expect(body.pending.message).toContain("Enterprise");
    }
  });
});

// ── E8: unknown / excluded ids ───────────────────────────────────────────────

describe("unknown providers (E8)", () => {
  it("400s every id outside the registry and creates no record", async () => {
    app = await buildApp(setRegistry({ anthropic: anthropicFlow }));
    const ids = [
      "radius",
      "google-gemini-cli",
      "google-antigravity",
      "custom-llm",
      "mistral",
      "",
    ];
    for (const provider of ids) {
      const res = await start({ provider });
      expect(res.statusCode, provider).toBe(400);
      expect(JSON.parse(res.payload).error, provider).toBe(
        `Unknown OAuth provider: ${provider}`,
      );
    }
    expect(flowStoreSize()).toBe(0);
  });
});

// ── E10/E11: codex select answered ───────────────────────────────────────────

describe("codex select (E10, E11)", () => {
  async function startCodex() {
    app = await buildApp(setRegistry({ "openai-codex": codexFlow }));
    const res = await start({ provider: "openai-codex" });
    return JSON.parse(res.payload).flowId as string;
  }

  it("E10: browser → authUrl + manual_code", async () => {
    const flowId = await startCodex();
    const input = await app.inject({
      method: "POST",
      url: `/api/provider-auth/flow/${flowId}/input`,
      payload: { value: "browser" },
    });
    expect(input.statusCode).toBe(202);

    const res = await app.inject({ method: "GET", url: `/api/provider-auth/flow/${flowId}` });
    const body = JSON.parse(res.payload);
    expect(body.authUrl).toContain("auth.openai.com");
    expect(body.pending.kind).toBe("manual_code");
  });

  it("E11: device_code → device pane with no authUrl", async () => {
    const flowId = await startCodex();
    await app.inject({
      method: "POST",
      url: `/api/provider-auth/flow/${flowId}/input`,
      payload: { value: "device_code" },
    });

    const res = await app.inject({ method: "GET", url: `/api/provider-auth/flow/${flowId}` });
    const body = JSON.parse(res.payload);
    expect(body.pending.kind).toBe("device_code");
    expect(body.pending.userCode).toBe("CODEX-1234");
    expect(body.pending.verificationUri).toContain("auth.openai.com");
    expect(body.authUrl).toBeUndefined();
  });
});

// ── E12/E13: serialisation + id shape ───────────────────────────────────────

describe("status shape (E12, E13)", () => {
  it("E12: exposes only the documented keys", async () => {
    app = await buildApp(setRegistry({ anthropic: anthropicFlow }));
    const { flowId } = JSON.parse((await start({ provider: "anthropic" })).payload);
    const res = await app.inject({ method: "GET", url: `/api/provider-auth/flow/${flowId}` });
    const allowed = new Set([
      "flowId",
      "provider",
      "status",
      "authUrl",
      "message",
      "pending",
      "error",
    ]);
    for (const key of Object.keys(JSON.parse(res.payload))) {
      expect(allowed.has(key), key).toBe(true);
    }
    const raw = res.payload;
    for (const forbidden of ["resolveInput", "rejectInput", "preAnswers", "promptCount", "abort"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("E13: 50 starts produce distinct UUID v4 ids", async () => {
    app = await buildApp(setRegistry({ xai: () => deviceCodeFlow({ expiresInSeconds: 900 }) }));
    const ids = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const res = await start({ provider: "xai" });
      expect(res.statusCode).toBe(200);
      ids.add(JSON.parse(res.payload).flowId as string);
    }
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});

// ── E15/E17: input ───────────────────────────────────────────────────────────

describe("POST /flow/:id/input", () => {
  it("E15: a device_code pending is not answerable → 409", async () => {
    app = await buildApp(setRegistry({ xai: () => deviceCodeFlow({ expiresInSeconds: 900 }) }));
    const { flowId } = JSON.parse((await start({ provider: "xai" })).payload);
    const res = await app.inject({
      method: "POST",
      url: `/api/provider-auth/flow/${flowId}/input`,
      payload: { value: "x" },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload).error).toBe("No input pending for this flow");
  });

  it("E17: a text answer reaches the flow and yields the device pane on that domain", async () => {
    app = await buildApp(setRegistry({ "github-copilot": githubCopilotFlow }));
    const { flowId } = JSON.parse((await start({ provider: "github-copilot" })).payload);

    const input = await app.inject({
      method: "POST",
      url: `/api/provider-auth/flow/${flowId}/input`,
      payload: { value: "company.ghe.com" },
    });
    expect(input.statusCode).toBe(202);
    expect(JSON.parse(input.payload)).toEqual({ ok: true });

    const res = await app.inject({ method: "GET", url: `/api/provider-auth/flow/${flowId}` });
    const body = JSON.parse(res.payload);
    expect(body.pending.kind).toBe("device_code");
    expect(new URL(body.pending.verificationUri).host).toBe("company.ghe.com");
  });

  it("404s an unknown flow id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/provider-auth/flow/not-a-flow/input",
      payload: { value: "x" },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toBe("Invalid or expired flow");
  });
});

// ── E16: secret hygiene ──────────────────────────────────────────────────────

describe("E16: submitted values never leak", () => {
  const SECRET = "SECRET123";

  it("does not appear in logs, responses, or the flow's error", async () => {
    app = await buildApp(setRegistry({ anthropic: anthropicFlow }));
    const started = await start({ provider: "anthropic" });
    const { flowId } = JSON.parse(started.payload);
    const value = `http://localhost:53692/callback?code=${SECRET}&state=fake-state`;

    const input = await app.inject({
      method: "POST",
      url: `/api/provider-auth/flow/${flowId}/input`,
      payload: { value },
    });
    expect(input.statusCode).toBe(202);
    expect(input.payload).not.toContain(SECRET);

    const status = await app.inject({
      method: "GET",
      url: `/api/provider-auth/flow/${flowId}`,
    });
    expect(status.payload).not.toContain(SECRET);

    // The flow itself received it (proving the answer was forwarded)…
    expect(lastFake().answers).toEqual([value]);
    // …but nothing wrote it out.
    expect(logLines.join("\n")).not.toContain(SECRET);
    expect(logLines.join("\n")).not.toContain("code=");
  });
});

// ── E9/route-level cross-check: authUrl and pending together ─────────────────

describe("status retention (E9 via HTTP)", () => {
  it("keeps the authorization link alongside a later prompt", async () => {
    app = await buildApp(setRegistry({ anthropic: anthropicFlow }));
    const { flowId } = JSON.parse((await start({ provider: "anthropic" })).payload);
    const res = await app.inject({ method: "GET", url: `/api/provider-auth/flow/${flowId}` });
    const body = JSON.parse(res.payload);
    expect(body.authUrl).toContain("claude.ai");
    expect(body.pending.kind).toBe("manual_code");
  });
});

// ── helpers exercised only through the routes ────────────────────────────────

describe("provider list + handler ids", () => {
  it("derives /providers and /handlers from the registry, excluding radius", async () => {
    app = await buildApp(
      setRegistry({
        anthropic: anthropicFlow,
        xai: () => deviceCodeFlow(),
      }),
    );
    const providers = JSON.parse(
      (await app.inject({ method: "GET", url: "/api/provider-auth/providers" })).payload,
    );
    expect(providers.map((p: { id: string }) => p.id).sort()).toEqual(["anthropic", "xai"]);
    expect(providers[0].flowType).toBe("auth_code");

    const handlers = JSON.parse(
      (await app.inject({ method: "GET", url: "/api/provider-auth/handlers" })).payload,
    );
    expect(handlers.ids).toEqual(["anthropic", "xai"]);
  });
});

// ── a custom flow builder is exercised so the helper stays honest ────────────

describe("custom scripted flow", () => {
  it("supports a prompt that is never answered (pane stays pending)", async () => {
    app = await buildApp(
      setRegistry({
        anthropic: () =>
          createFakeOAuthFlow([
            {
              kind: "prompt",
              prompt: { type: "manual_code", message: "Paste the code" },
            },
          ]),
      }),
    );
    const res = await start({ provider: "anthropic" });
    const body = JSON.parse(res.payload);
    expect(body.pending).toEqual({ kind: "manual_code", message: "Paste the code" });
  });
});
