/**
 * Flow lifecycle tests (test-plan X1, X2, X3, X4, X7, X8, X12, E18, E19, E31, P2).
 *
 * Storage is REAL here (not mocked): X7 depends on `writeCredential`'s actual
 * cross-type refusal, and E19/X12 depend on a real prune over a real store.
 * Only the pi runtime and the model-proxy refresh are stubbed.
 *
 * See change: delegate-provider-oauth-to-pi-ai (D6, D7).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../model-proxy/registry-singleton.js", () => ({
  refreshModelRegistry: () => Promise.resolve(),
}));

import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";
import type { OAuthRegistryEntry } from "../auth/pi-oauth-types.js";
import {
  abortAllFlows,
  flowStoreSize,
  getFlow,
  pendingFlowsFor,
  pruneFlows,
} from "../auth/provider-auth-adapter.js";
import {
  anthropicFlow,
  createFakeOAuthFlow,
  deviceCodeFlow,
  resetFakeFlows,
  totalOpenListenerCount,
  type FakeOAuthFlow,
} from "./helpers/fake-oauth-flow.js";

const authDir = path.join(os.homedir(), ".pi", "agent");
const authPath = path.join(authDir, "auth.json");

let originalAuth: string | null = null;

let fakes: FakeOAuthFlow[] = [];
let logLines: string[] = [];

const piGateway = {
  broadcast: vi.fn(),
  sendToSession: vi.fn(),
  getConnectedSessionIds: () => [],
};
const browserGateway = { broadcastToAll: vi.fn() };

function registryFrom(
  factories: Record<string, () => FakeOAuthFlow>,
): OAuthRegistryEntry[] {
  return Object.entries(factories).map(([id, make]) => ({
    id,
    name: id,
    flowType: "auth_code",
    auth: {
      name: id,
      login: (interaction) => {
        const fake = make();
        fakes.push(fake);
        return fake.login(interaction);
      },
    },
  }));
}

async function buildApp(registry: OAuthRegistryEntry[]) {
  const app = Fastify({ logger: false });
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

beforeEach(async () => {
  fs.mkdirSync(authDir, { recursive: true });
  try {
    originalAuth = fs.readFileSync(authPath, "utf-8");
  } catch {
    originalAuth = null;
  }
  fakes = [];
  logLines = [];
  resetFakeFlows();
  abortAllFlows();
  app = await buildApp(registryFrom({}));
});

afterEach(async () => {
  await app.close();
  abortAllFlows();
  if (originalAuth !== null) fs.writeFileSync(authPath, originalAuth);
  else fs.rmSync(authPath, { force: true });
  vi.useRealTimers();
});

/** Simulate elapsed wall-clock time on a record instead of faking the clock.
 *
 * Faking timers around `app.inject` is a trap here: light-my-request yields
 * through a scheduler that a faked clock can starve, so an awaited inject
 * deadlocks. Aging the record is the honest equivalent — `pruneFlows` and the
 * TTL rule are pure functions of `Date.now()` vs `flow.expiresAt`, and the
 * expiry ARITHMETIC itself is pinned in `provider-auth-adapter.test.ts` with a
 * faked clock where no HTTP layer is involved. */
function ageFlow(flowId: string, byMs: number): void {
  const flow = getFlow(flowId);
  if (!flow) throw new Error(`no flow ${flowId}`);
  flow.createdAt -= byMs;
  flow.expiresAt -= byMs;
  if (flow.deviceCodeDeadline !== undefined) flow.deviceCodeDeadline -= byMs;
}

/** Poll a flow record to a terminal state using REAL timers. */
async function waitForTerminal(flowId: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const flow = getFlow(flowId);
    if (flow && flow.status !== "pending") return flow;
    if (Date.now() > deadline) throw new Error(`flow ${flowId} never settled`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const start = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/provider-auth/start", payload });

const getFlowStatus = (flowId: string) =>
  app.inject({ method: "GET", url: `/api/provider-auth/flow/${flowId}` });

// ── X1: a bound callback port ────────────────────────────────────────────────

describe("X1: start failure before any event", () => {
  it("maps a synchronous bind failure to 500 naming the port, and forgets the flow", async () => {
    app = await buildApp(
      registryFrom({
        anthropic: () =>
          createFakeOAuthFlow([
            {
              kind: "reject",
              message: "listen EADDRINUSE: address already in use 127.0.0.1:53692",
            },
          ]),
      }),
    );

    const res = await start({ provider: "anthropic" });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toContain("53692");
    expect(flowStoreSize()).toBe(0);
  });
});

// ── X2: no response ──────────────────────────────────────────────────────────

describe("X2: the 15 s start handshake", () => {
  it("504s a silent flow, aborts it, and forgets the record", async () => {
    vi.useFakeTimers();
    app = await buildApp(
      registryFrom({ anthropic: () => createFakeOAuthFlow([{ kind: "hang" }]) }),
    );

    const pending = start({ provider: "anthropic" });
    await vi.advanceTimersByTimeAsync(15_000);
    const res = await pending;

    expect(res.statusCode).toBe(504);
    expect(JSON.parse(res.payload).error).toBe("Provider did not respond");
    expect(fakes[0]?.aborted).toBe(true);
    expect(flowStoreSize()).toBe(0);
  });

  it("200s a flow that emits at 14.9 s", async () => {
    vi.useFakeTimers();
    app = await buildApp(
      registryFrom({
        anthropic: () =>
          createFakeOAuthFlow([
            { kind: "wait", ms: 14_900 },
            {
              kind: "notify",
              event: { type: "device_code", userCode: "U", verificationUri: "https://v" },
            },
            { kind: "hang" },
          ]),
      }),
    );

    const pending = start({ provider: "anthropic" });
    await vi.advanceTimersByTimeAsync(14_900);
    const res = await pending;

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).pending.kind).toBe("device_code");
  });
});

// ── X3: supersede ────────────────────────────────────────────────────────────

describe("X3: a second start for the same provider supersedes the first", () => {
  it("cancels the outgoing flow and leaves exactly one pending", async () => {
    app = await buildApp(registryFrom({ anthropic: anthropicFlow }));

    const first = JSON.parse((await start({ provider: "anthropic" })).payload).flowId;
    const second = JSON.parse((await start({ provider: "anthropic" })).payload).flowId;
    expect(second).not.toBe(first);

    // The earlier flow remains READABLE (the spec requires it to report
    // Cancelled) but is no longer pending.
    const firstStatus = JSON.parse((await getFlowStatus(first)).payload);
    expect(firstStatus.status).toBe("error");
    expect(firstStatus.error).toBe("Cancelled");

    expect(pendingFlowsFor("anthropic").map((f) => f.id)).toEqual([second]);
    expect(fakes[0]?.aborted).toBe(true);
    expect(fakes[0]?.listenerClosed).toBe(true);
  });
});

// ── X4: cancel releases the listener ─────────────────────────────────────────

describe("X4: cancel releases the callback listener", () => {
  it("204s, reports Cancelled, and closes the fake's prompt listener", async () => {
    app = await buildApp(registryFrom({ anthropic: anthropicFlow }));
    const { flowId } = JSON.parse((await start({ provider: "anthropic" })).payload);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/provider-auth/flow/${flowId}`,
    });
    expect(del.statusCode).toBe(204);

    const flow = await waitForTerminal(flowId);
    expect(flow.error).toBe("Cancelled");
    const status = JSON.parse((await getFlowStatus(flowId)).payload);
    expect(status.status).toBe("error");
    expect(status.error).toBe("Cancelled");
    expect(fakes[0]?.listenerClosed).toBe(true);

    // A subsequent start must not hit a port-in-use error.
    const again = await start({ provider: "anthropic" });
    expect(again.statusCode).toBe(200);
  });

  it("404s an unknown flow id", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/provider-auth/flow/never-issued",
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── X7: the write path refuses a cross-type clobber ──────────────────────────

describe("X7: a refused credential write", () => {
  it("reports the conflict and leaves auth.json byte-identical", async () => {
    const before = JSON.stringify({ openrouter: { type: "api_key", key: "sk-stored" } }, null, 2) + "\n";
    fs.writeFileSync(authPath, before);

    app = await buildApp(
      registryFrom({
        openrouter: () =>
          createFakeOAuthFlow([
            {
              kind: "prompt",
              prompt: { type: "manual_code", message: "Paste the code" },
            },
            { kind: "resolve" },
          ]),
      }),
    );

    const { flowId } = JSON.parse((await start({ provider: "openrouter" })).payload);
    const input = await app.inject({
      method: "POST",
      url: `/api/provider-auth/flow/${flowId}/input`,
      payload: { value: "code" },
    });
    expect(input.statusCode).toBe(202);

    await waitForTerminal(flowId);
    const status = JSON.parse((await getFlowStatus(flowId)).payload);
    expect(status.status).toBe("error");
    expect(status.error).toContain("api_key");
    expect(fs.readFileSync(authPath, "utf-8")).toBe(before);
  });
});

// ── X8: the flow's own verdict ───────────────────────────────────────────────

describe("X8: a state mismatch is the flow's verdict", () => {
  it("202s the input and surfaces the flow's message on the next read", async () => {
    app = await buildApp(
      registryFrom({
        anthropic: () =>
          createFakeOAuthFlow([
            { kind: "notify", event: { type: "auth_url", url: "https://a.example/auth" } },
            {
              kind: "prompt",
              prompt: { type: "manual_code", message: "Paste the redirect URL" },
            },
            { kind: "reject", message: "OAuth state mismatch" },
          ]),
      }),
    );

    const { flowId } = JSON.parse((await start({ provider: "anthropic" })).payload);
    const input = await app.inject({
      method: "POST",
      url: `/api/provider-auth/flow/${flowId}/input`,
      payload: { value: "http://localhost/callback?code=c&state=WRONG" },
    });
    expect(input.statusCode).toBe(202);

    await waitForTerminal(flowId);
    const status = JSON.parse((await getFlowStatus(flowId)).payload);
    expect(status.status).toBe("error");
    expect(status.error).toBe("OAuth state mismatch");
  });
});

// ── E18/E19/X12: lifetime + pruning ──────────────────────────────────────────

describe("flow lifetime and pruning", () => {
  it("E18: a 900 s device code extends the lifetime past the 10-minute default", async () => {
    app = await buildApp(
      registryFrom({ xai: () => deviceCodeFlow({ expiresInSeconds: 900 }) }),
    );
    const { flowId } = JSON.parse((await start({ provider: "xai" })).payload);
    const flow = getFlow(flowId);
    expect(flow).toBeDefined();

    // ≥ expiresInSeconds + 60 s, i.e. at least 16 minutes.
    expect((flow as NonNullable<typeof flow>).expiresAt - (flow as NonNullable<typeof flow>).createdAt)
      .toBeGreaterThanOrEqual(16 * 60 * 1000);
    // 12 minutes in it is still alive…
    ageFlow(flowId, 12 * 60 * 1000);
    expect((await getFlowStatus(flowId)).statusCode).toBe(200);
    // …and only past 16 minutes does it prune.
    ageFlow(flowId, 4 * 60 * 1000 + 2_000);
    expect((await getFlowStatus(flowId)).statusCode).toBe(404);
  });

  it("E19: the default lifetime is 10 minutes", async () => {
    app = await buildApp(registryFrom({ anthropic: anthropicFlow }));
    const { flowId } = JSON.parse((await start({ provider: "anthropic" })).payload);
    const flow = getFlow(flowId);
    expect((flow as NonNullable<typeof flow>).expiresAt - (flow as NonNullable<typeof flow>).createdAt)
      .toBe(10 * 60 * 1000);

    // 9 min 59 s in → alive.
    ageFlow(flowId, 9 * 60 * 1000 + 59_000);
    expect((await getFlowStatus(flowId)).statusCode).toBe(200);

    // 10 min 1 s in → pruned.
    ageFlow(flowId, 2_000);
    expect((await getFlowStatus(flowId)).statusCode).toBe(404);
  });

  it("X12: pruning aborts a live flow and closes its listener", async () => {
    app = await buildApp(registryFrom({ anthropic: anthropicFlow }));
    const { flowId } = JSON.parse((await start({ provider: "anthropic" })).payload);
    const flow = getFlow(flowId);
    expect(flow).toBeDefined();

    ageFlow(flowId, 10 * 60 * 1000 + 1_000);
    pruneFlows();
    await fakes[0]?.settled;

    expect(fakes[0]?.aborted).toBe(true);
    expect(fakes[0]?.listenerClosed).toBe(true);
    expect(getFlow(flowId)).toBeUndefined();

    const again = await start({ provider: "anthropic" });
    expect(again.statusCode).toBe(200);
  });
});

// ── E31: shutdown ────────────────────────────────────────────────────────────

describe("E31: server shutdown aborts every pending flow", () => {
  it("aborts all three and empties the store", async () => {
    app = await buildApp(
      registryFrom({
        anthropic: anthropicFlow,
        xai: () => deviceCodeFlow({ expiresInSeconds: 900 }),
        meta: () => deviceCodeFlow({ expiresInSeconds: 900 }),
      }),
    );
    for (const provider of ["anthropic", "xai", "meta"]) {
      expect((await start({ provider })).statusCode).toBe(200);
    }
    expect(flowStoreSize()).toBe(3);

    await app.close();

    expect(flowStoreSize()).toBe(0);
    for (const fake of fakes) expect(fake.aborted).toBe(true);
  });
});

// ── P2: soak ─────────────────────────────────────────────────────────────────

describe("P2: 200 flows over a simulated 30 minutes", () => {
  it("leaves no record, no aborted flow, and no open listener", async () => {
    const factories: Record<string, () => FakeOAuthFlow> = {};
    for (let i = 0; i < 200; i += 1) {
      factories[`provider-${i}`] = () =>
        createFakeOAuthFlow([
          { kind: "notify", event: { type: "auth_url", url: `https://p${i}.example/auth` } },
          { kind: "prompt", prompt: { type: "manual_code", message: "Paste" } },
        ]);
    }
    app = await buildApp(registryFrom(factories));

    const flowIds: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      const res = await start({ provider: `provider-${i}` });
      expect(res.statusCode, String(i)).toBe(200);
      flowIds.push(JSON.parse(res.payload).flowId as string);
    }
    expect(flowStoreSize()).toBe(200);
    expect(totalOpenListenerCount()).toBe(200);

    // 30 simulated minutes: every record is now past its lifetime.
    for (const flowId of flowIds) ageFlow(flowId, 30 * 60 * 1000);
    pruneFlows();
    await Promise.all(fakes.map((f) => f.settled));

    expect(flowStoreSize()).toBe(0);
    expect(totalOpenListenerCount()).toBe(0);
    for (const fake of fakes) expect(fake.aborted).toBe(true);
  });
});
