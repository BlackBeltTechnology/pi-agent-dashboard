/**
 * Radius provider sign-in: registry membership, models.json override, twin
 * naming, handler ids, generic select flow, port-bound failure.
 * test-plan #E5 #E7 #E8 #E9 #E10 #E11 #X1.
 *
 * See change: add-radius-provider-login.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import Fastify from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OAuthRegistryEntry } from "../auth/pi-oauth-types.js";
import { abortAllFlows } from "../auth/provider-auth-adapter.js";
import {
  getOAuthRegistry,
  oauthRegistryReady,
  setOAuthRegistryRuntimeSource,
} from "../auth/provider-auth-registry.js";
import { readAuthJson } from "../auth/provider-auth-storage.js";
import { _resetRadiusOverrideCacheForTests } from "../auth/radius-override.js";
import { getServerModelRuntime } from "../model-proxy/server-model-runtime.js";
import {
  _resetForTests as resetCatalogueCache,
  setCatalogueForSession,
} from "../package/provider-catalogue-cache.js";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";
import { createFakeOAuthFlow, type FakeOAuthFlow } from "./helpers/fake-oauth-flow.js";

const OVERRIDE = JSON.stringify({
  providers: { radius: { oauth: "radius", baseUrl: "https://gw.example.com/v1" } },
});

let agentDir: string;
let prevAgentDir: string | undefined;
let prevAuth: string | null = null;
const authPath = () => path.join(os.homedir(), ".pi", "agent", "auth.json");

beforeAll(async () => {
  setOAuthRegistryRuntimeSource(getServerModelRuntime);
  await oauthRegistryReady();
});

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "radius-login-"));
  prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  _resetRadiusOverrideCacheForTests();
  fs.mkdirSync(path.dirname(authPath()), { recursive: true });
  try {
    prevAuth = fs.readFileSync(authPath(), "utf8");
  } catch {
    prevAuth = null;
  }
});

afterEach(() => {
  if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  fs.rmSync(agentDir, { recursive: true, force: true });
  if (prevAuth !== null) fs.writeFileSync(authPath(), prevAuth);
  else fs.rmSync(authPath(), { force: true });
  resetCatalogueCache();
  abortAllFlows();
  _resetRadiusOverrideCacheForTests();
});

const setOverride = () => {
  fs.writeFileSync(path.join(agentDir, "models.json"), OVERRIDE);
  _resetRadiusOverrideCacheForTests();
};

const gw = { getConnectedSessionIds: () => [], sendToSession: () => {}, broadcast: () => {} };

async function app(registry?: OAuthRegistryEntry[]) {
  const a = Fastify();
  registerProviderAuthRoutes(a, {
    piGateway: gw as never,
    browserGateway: {} as never,
    ...(registry ? { oauthRegistry: registry, oauthReady: Promise.resolve() } : {}),
  });
  await a.ready();
  return a;
}

function fakeRadius(flow: () => FakeOAuthFlow): OAuthRegistryEntry {
  return {
    id: "radius",
    name: "Radius",
    flowType: "auth_code",
    subscription: false,
    auth: { name: "Radius", login: (i) => flow().login(i) },
  };
}

describe("custom agent dir honoured (E5)", () => {
  it("override in PI_CODING_AGENT_DIR hides radius from /providers", async () => {
    setOverride();
    const a = await app();
    const res = await a.inject({ method: "GET", url: "/api/provider-auth/providers" });
    expect(JSON.parse(res.payload).map((p: { id: string }) => p.id)).not.toContain("radius");
    await a.close();
  });
});

describe("override hides radius on every route (E7)", () => {
  it("injected registry: absent from /providers + /handlers, /start 400", async () => {
    setOverride();
    const a = await app([fakeRadius(() => createFakeOAuthFlow([{ kind: "resolve" }]))]);
    const providers = JSON.parse(
      (await a.inject({ method: "GET", url: "/api/provider-auth/providers" })).payload,
    );
    const handlers = JSON.parse(
      (await a.inject({ method: "GET", url: "/api/provider-auth/handlers" })).payload,
    );
    expect(providers.map((p: { id: string }) => p.id)).not.toContain("radius");
    expect(handlers.ids).not.toContain("radius");
    const res = await a.inject({
      method: "POST",
      url: "/api/provider-auth/start",
      payload: { provider: "radius" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe("Unknown OAuth provider: radius");
    await a.close();
  });
});

describe("handler ids + subscription flag (E9, E10)", () => {
  it("9 ids with radius, 8 with the override", async () => {
    const a = await app();
    const ids = async () =>
      JSON.parse((await a.inject({ method: "GET", url: "/api/provider-auth/handlers" })).payload)
        .ids as string[];
    expect(await ids()).toHaveLength(9);
    expect(await ids()).toContain("radius");
    setOverride();
    const without = await ids();
    expect(without).toHaveLength(8);
    expect(without).not.toContain("radius");
    await a.close();
  });

  it("anthropic subscription:true; openrouter + radius false", async () => {
    const a = await app();
    const list = JSON.parse(
      (await a.inject({ method: "GET", url: "/api/provider-auth/providers" })).payload,
    ) as Array<{ id: string; subscription: boolean }>;
    const sub = (id: string) => list.find((p) => p.id === id)?.subscription;
    expect(sub("anthropic")).toBe(true);
    expect(sub("openrouter")).toBe(false);
    expect(sub("radius")).toBe(false);
    await a.close();
  });
});

describe("api-key twin naming (E8)", () => {
  const radiusEnv: ProviderInfo = {
    id: "radius",
    displayName: "Radius",
    hasOAuth: true,
    configured: true,
    source: "environment",
    envVar: "RADIUS_API_KEY",
  };
  const status = async () => {
    const a = await app();
    const rows = JSON.parse(
      (await a.inject({ method: "GET", url: "/api/provider-auth/status" })).payload,
    ) as Array<{ id: string; name: string; flowType: string; authenticated?: boolean; configured?: boolean }>;
    await a.close();
    return rows.filter((r) => r.id === "radius" || r.id === "radius-api");
  };

  beforeEach(() => setCatalogueForSession("s", [radiusEnv]));

  it("(a) no override: radius-api twin + radius OAuth row", async () => {
    const rows = await status();
    expect(rows.map((r) => r.id).sort()).toEqual(["radius", "radius-api"]);
    expect(rows.find((r) => r.id === "radius-api")?.name).toBe("Radius (API Key)");
  });

  it("(b) override, nothing stored: single bare api-key row", async () => {
    setOverride();
    const rows = await status();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "radius", flowType: "api_key" });
  });

  it("(c) override + stored oauth: OAuth row stays, plus the twin", async () => {
    setOverride();
    fs.writeFileSync(
      authPath(),
      JSON.stringify({ radius: { type: "oauth", refresh: "r", access: "a", expires: Date.now() + 3.6e6 } }),
    );
    const rows = await status();
    expect(rows.map((r) => r.id).sort()).toEqual(["radius", "radius-api"]);
    expect(rows.find((r) => r.id === "radius")?.flowType).not.toBe("api_key");
  });
});

describe("registry lists radius by default (E1)", () => {
  it("real registry has radius with Account semantics", () => {
    expect(getOAuthRegistry().find((e) => e.id === "radius")).toMatchObject({
      name: "Radius",
      flowType: "auth_code",
      subscription: false,
    });
  });
});

describe("Start Radius through the generic select (E11)", () => {
  it("select → device code → credential persisted", async () => {
    const cred = { type: "oauth" as const, refresh: "rr", access: "aa", expires: Date.now() + 3.6e6 };
    const a = await app([
      fakeRadius(() =>
        createFakeOAuthFlow([
          {
            kind: "prompt",
            prompt: {
              type: "select",
              message: "Sign in to Radius",
              options: [
                { id: "browser", label: "Sign in with browser" },
                { id: "device-code", label: "Sign in with device code" },
              ],
            },
            then: {
              "device-code": [
                {
                  kind: "notify",
                  event: {
                    type: "device_code",
                    userCode: "RAD-1",
                    verificationUri: "https://radius.pi.dev/device",
                    intervalSeconds: 5,
                    expiresInSeconds: 900,
                  },
                },
                { kind: "wait", ms: 50 },
                { kind: "resolve", credential: cred },
              ],
            },
          },
        ]),
      ),
    ]);
    const start = await a.inject({
      method: "POST",
      url: "/api/provider-auth/start",
      payload: { provider: "radius" },
    });
    expect(start.statusCode).toBe(200);
    const first = JSON.parse(start.payload);
    expect(first.pending.kind).toBe("select");
    expect(first.pending.options.map((o: { id: string }) => o.id)).toEqual(["browser", "device-code"]);
    const input = await a.inject({
      method: "POST",
      url: `/api/provider-auth/flow/${first.flowId}/input`,
      payload: { value: "device-code" },
    });
    expect(input.statusCode).toBe(202);
    let body: { pending?: { kind: string }; status: string } = first;
    for (let i = 0; i < 40 && body.status !== "complete"; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      body = JSON.parse(
        (await a.inject({ method: "GET", url: `/api/provider-auth/flow/${first.flowId}` })).payload,
      );
      if (i === 0) expect(body.pending?.kind ?? "device_code").toBe("device_code");
    }
    expect(body.status).toBe("complete");
    expect(readAuthJson().radius).toEqual(cred);
    await a.close();
  });
});

describe("callback port bound after select (X1)", () => {
  it("surfaces EADDRINUSE 1456 as a flow error", async () => {
    const a = await app([
      fakeRadius(() =>
        createFakeOAuthFlow([
          {
            kind: "prompt",
            prompt: {
              type: "select",
              message: "Sign in to Radius",
              options: [
                { id: "browser", label: "Sign in with browser" },
                { id: "device-code", label: "Sign in with device code" },
              ],
            },
            then: {
              browser: [{ kind: "reject", message: "listen EADDRINUSE: address already in use 127.0.0.1:1456" }],
            },
          },
        ]),
      ),
    ]);
    const start = await a.inject({
      method: "POST",
      url: "/api/provider-auth/start",
      payload: { provider: "radius" },
    });
    const first = JSON.parse(start.payload);
    expect(start.statusCode).toBe(200);
    expect(first.pending.kind).toBe("select");
    await a.inject({
      method: "POST",
      url: `/api/provider-auth/flow/${first.flowId}/input`,
      payload: { value: "browser" },
    });
    let body: { status: string; error?: string } = first;
    for (let i = 0; i < 40 && body.status !== "error"; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      body = JSON.parse(
        (await a.inject({ method: "GET", url: `/api/provider-auth/flow/${first.flowId}` })).payload,
      );
    }
    expect(body.status).toBe("error");
    expect(body.error).toContain("1456");
    await a.close();
  });
});
