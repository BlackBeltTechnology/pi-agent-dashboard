/**
 * Cross-type credential clobber refusal — provider-auth-server "API key CRUD"
 * (test-plan X1–X5; spec scenarios "API-key write over a stored OAuth credential
 * is refused" … "Token refresh is unaffected").
 *
 * Several UI rows resolve to ONE auth.json key (`anthropic-api` → `anthropic`),
 * so an api-key save used to silently destroy a stored OAuth login and a
 * completed OAuth sign-in used to silently destroy a stored key. D2 closes the
 * clobber in `writeCredential` itself: a write whose credential `type` differs
 * from the stored one THROWS (all call sites ignore return values — a return
 * value would be silent), and each surface reports the refusal: 409 on the
 * api-key route, the callback error page for auth-code, `flow.status = "error"`
 * for device-code. See change: redesign-providers-settings-page (D2).
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";
import {
  type OAuthCredential,
  readAuthJson,
  removeCredential,
  writeCredential,
} from "../auth/provider-auth-storage.js";
import { closeAllCallbackServers, startCallbackServer } from "../auth/oauth-callback-server.js";

const authDir = path.join(os.homedir(), ".pi", "agent");
const authPath = path.join(authDir, "auth.json");

function oauthCred(expires = Date.now() + 3_600_000): OAuthCredential {
  return { type: "oauth", refresh: "r", access: "a", expires };
}

/**
 * The refusal `writeCredential` throws once D2 lands. Asserted DUCK-TYPED
 * (`code`/`storedType` properties) so the RED run fails on behavior — the
 * write silently succeeding — not on a missing class export.
 */
function credentialTypeConflict(provider: string, storedType: string): Error {
  return Object.assign(
    new Error(
      `"${provider}" already holds a ${storedType} credential. Remove it before writing a replacement.`,
    ),
    { code: "provider_auth.credential_type_conflict", storedType, provider },
  );
}

let originalAuth: string | null = null;
beforeEach(() => {
  fs.mkdirSync(authDir, { recursive: true });
  try { originalAuth = fs.readFileSync(authPath, "utf-8"); } catch { originalAuth = null; }
});
afterEach(async () => {
  if (originalAuth !== null) fs.writeFileSync(authPath, originalAuth);
  else fs.rmSync(authPath, { force: true });
  await closeAllCallbackServers();
});

function seedAuth(data: Record<string, unknown>): string {
  const bytes = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(authPath, bytes);
  return bytes;
}

function readStoredBytes(): string {
  return fs.readFileSync(authPath, "utf-8");
}

async function buildApp() {
  const app = Fastify({ logger: false });
  registerProviderAuthRoutes(app, {
    piGateway: { broadcast: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as any,
    browserGateway: { broadcastToAll: vi.fn() } as any,
  });
  await app.ready();
  return app;
}

describe("cross-type credential refusal (X1–X5)", () => {
  it("X1: PUT api-key over a stored OAuth credential → 409, typed code, stored credential byte-unchanged", async () => {
    const before = seedAuth({ anthropic: oauthCred() });
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/api/provider-auth/api-key",
      payload: { provider: "anthropic-api", key: "sk-new" },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe("provider_auth.credential_type_conflict");
    expect(body.vars.storedType).toBe("oauth");
    // English fallback names the stored type and the remove-first path.
    expect(body.error).toContain("oauth");
    expect(body.error).toMatch(/remove/i);
    // The refusal must not have touched the stored credential.
    expect(readStoredBytes()).toBe(before);
  });

  it("X3: an OAuth completion over a stored API key is refused at the write path", async () => {
    const before = seedAuth({ anthropic: { type: "api_key", key: "sk-stored" } });

    await expect(writeCredential("anthropic", oauthCred())).rejects.toMatchObject({
      code: "provider_auth.credential_type_conflict",
      storedType: "api_key",
    });
    // The stored key must be untouched.
    expect(readStoredBytes()).toBe(before);
    expect(readAuthJson().anthropic).toEqual({ type: "api_key", key: "sk-stored" });
  });

  it("X3 (auth-code surface): the callback error page renders the refusal", async () => {
    const srv = net.createServer();
    srv.on("error", () => {});
    const port = await new Promise<number>((resolve) => {
      srv.listen(0, "127.0.0.1", () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });

    // The wired onCode in provider-auth-routes calls `writeCredential`, which
    // throws the typed refusal; the callback server renders whatever onCode
    // throws on its error page. This pins that surface with the refusal shape.
    await startCallbackServer({
      providerId: "conflict-test-provider",
      port,
      path: "/callback",
      timeoutMs: 5000,
      onCode: async () => {
        throw credentialTypeConflict("anthropic", "api_key");
      },
    });

    const body = await new Promise<string>((resolve, reject) => {
      http.get(`http://localhost:${port}/callback?code=abc&state=s`, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve(b));
      }).on("error", reject);
    });
    expect(body).toContain("api_key");
    expect(body).toMatch(/remove it before/i);
  });

  it("X4: remove-first makes the refused write possible", async () => {
    seedAuth({ anthropic: oauthCred() });
    const app = await buildApp();

    // Remove-first: the OAuth row's own delete is allowed (row kind matches).
    const del = await app.inject({ method: "DELETE", url: "/api/provider-auth/anthropic" });
    expect(del.statusCode).toBe(200);

    const res = await app.inject({
      method: "PUT",
      url: "/api/provider-auth/api-key",
      payload: { provider: "anthropic-api", key: "sk-new" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).ok).toBe(true);
    expect(readAuthJson().anthropic).toEqual({ type: "api_key", key: "sk-new" });
  });

  it("X5: same-type api-key overwrite still succeeds", async () => {
    seedAuth({});
    const app = await buildApp();

    await app.inject({
      method: "PUT",
      url: "/api/provider-auth/api-key",
      payload: { provider: "anthropic-api", key: "sk-1" },
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/provider-auth/api-key",
      payload: { provider: "anthropic-api", key: "sk-2" },
    });
    expect(res.statusCode).toBe(200);
    expect(readAuthJson().anthropic).toEqual({ type: "api_key", key: "sk-2" });
  });

  it("X5: OAuth refresh over the stored OAuth credential (same type) is unaffected", async () => {
    seedAuth({ anthropic: oauthCred() });

    // InternalAuthStorage.refreshOAuth writes the refreshed OAuth credential
    // over the stored one — same type, must NOT refuse.
    await expect(writeCredential("anthropic", oauthCred(123))).resolves.toBeUndefined();
    expect((readAuthJson().anthropic as OAuthCredential).expires).toBe(123);
  });

  it("X2: DELETE of the api-key row over a stored OAuth credential is refused", async () => {
    const before = seedAuth({ anthropic: oauthCred() });
    const app = await buildApp();

    const res = await app.inject({ method: "DELETE", url: "/api/provider-auth/anthropic-api" });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe("provider_auth.credential_type_conflict");
    expect(body.vars.storedType).toBe("oauth");
    // The OAuth credential must remain stored.
    expect(readStoredBytes()).toBe(before);
  });

  it("removing the credential the row owns still succeeds (anthropic-api over stored api_key)", async () => {
    seedAuth({ anthropic: { type: "api_key", key: "sk-stored" } });
    const app = await buildApp();

    const res = await app.inject({ method: "DELETE", url: "/api/provider-auth/anthropic-api" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).ok).toBe(true);
    expect(readAuthJson().anthropic).toBeUndefined();
  });

  it("storage-level: removeCredential refuses when the stored type differs from the addressed kind", async () => {
    // ONE credential instance for both the seed and the assertion: `oauthCred()`
    // derives `expires` from `Date.now()`, so calling it twice makes this test
    // fail whenever a millisecond ticks between the two calls (~1/2 of runs).
    const cred = oauthCred();
    seedAuth({ anthropic: cred });

    await expect(removeCredential("anthropic", "api_key")).rejects.toMatchObject({
      code: "provider_auth.credential_type_conflict",
      storedType: "oauth",
    });
    // The stored credential must survive the refusal byte-for-byte.
    expect(readAuthJson().anthropic).toEqual(cred);

    // Same-kind removal succeeds.
    await expect(removeCredential("anthropic", "oauth")).resolves.toBeUndefined();
    expect(readAuthJson().anthropic).toBeUndefined();
  });
});
