/**
 * Vault routes × credential encryption: every write route answers HTTP 409
 * `vault_locked` (with a non-secret reason + the shared remedy, never file
 * content) for a locked vault and for a plaintext vault without a key; status
 * reporting; lazy key creation through the route. Stub keychain / test codec only.
 * See change: encrypt-credentials-at-rest (test-plan E17, E21, E35, E40, X12).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeEnvelope } from "../auth/credential-envelope.js";
import { _resetCredentialKeyForTests, getCredentialCodec, getCredentialKeyState, initCredentialKey } from "../auth/credential-key.js";
import { createLocalTrustContext } from "../auth/local-proof.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { _resetQuarantineDedupForTests } from "../auth/locked-json-file.js";
import { createVaultImport } from "../vault/vault-import.js";
import { registerVaultRoutes } from "../vault/vault-routes.js";
import { createVaultStore, type VaultStore } from "../vault/vault-store.js";
import {
  filePath,
  KEY_1,
  KEY_2,
  logSink,
  resetCredentialFiles,
  sha256,
  stubKeychain,
  writePlain,
} from "./helpers/credential-key-kit.js";
import { keylessVaultCodec, testVaultCodec } from "./helpers/vault-test-codec.js";

const MARKER = "val-P8gN4vY6rM3a";
const ACCOUNT = { id: "a1", provider: "gemini", kind: "key", namespace: "user", label: "lbl-K5dF9sJ2qW7e", value: MARKER };
const apps: FastifyInstance[] = [];
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-routes-locked-"));
  _resetCredentialKeyForTests();
  _resetQuarantineDedupForTests();
  resetCredentialFiles();
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  _resetCredentialKeyForTests();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function mkApp(store: VaultStore): Promise<FastifyInstance> {
  const localTrust = createLocalTrustContext("local-token-xyz", () => false);
  const app = Fastify();
  apps.push(app);
  app.decorateRequest("isAuthenticated", false);
  registerVaultRoutes(app, {
    store,
    importer: createVaultImport({ store, candidates: () => [] }),
    networkGuard: createNetworkGuard(["198.51.100.0/24"], { localTrust }),
    localTrust,
    loginAvailable: () => false,
    listOpenProjects: () => [],
    projects: { list: () => [] },
    getSessionBindingState: () => undefined,
  });
  await app.ready();
  return app;
}

const call = (app: FastifyInstance, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, remoteAddress: "127.0.0.1", payload: payload as object | undefined });

/** The write routes of the vault (task 6.2), each with a valid body so only the lock can refuse it. */
const WRITES: Array<[string, "POST" | "PUT" | "DELETE", string, unknown]> = [
  ["add", "POST", "/api/vault/accounts", { provider: "gemini", label: "personal", value: "abcdefgh12" }],
  ["rotate", "PUT", "/api/vault/accounts/a1/value", { value: "rotated-value-1" }],
  ["revoke", "DELETE", "/api/vault/accounts/a1", undefined],
  ["binding", "POST", "/api/vault/bindings", { name: "GEMINI_API_KEY" }],
  ["binding default", "PUT", "/api/vault/bindings/GEMINI_API_KEY/default", { accountId: "a1" }],
  ["binding delete", "DELETE", "/api/vault/bindings/GEMINI_API_KEY", undefined],
  ["grant", "POST", "/api/vault/grants", { subject: "dir:hub:/p", bindingName: "GEMINI_API_KEY" }],
  ["grant delete", "DELETE", "/api/vault/grants", { subject: "dir:hub:/p", bindingName: "GEMINI_API_KEY" }],
  ["confirmation", "POST", "/api/vault/confirmations", { deviceId: "d", dir: "/p", repoKey: "r" }],
  ["plugin approval", "PUT", "/api/vault/plugin-approvals/p1/GEMINI_API_KEY", undefined],
];

describe("E35: locked vault write → 409", () => {
  it("every write route (and import confirm) answers 409 vault_locked / key_mismatch; no content; bytes unchanged; no .corrupt-*", async () => {
    const file = path.join(dir, "vault.json");
    fs.writeFileSync(file, encodeEnvelope({ accounts: [ACCOUNT] }, KEY_1, "vault"), { mode: 0o600 });
    const before = sha256(file);
    const store = createVaultStore({ codec: testVaultCodec(KEY_2), path: file });
    const app = await mkApp(store);

    for (const [label, method, url, payload] of WRITES) {
      const res = await call(app, method, url, payload);
      expect(res.statusCode, `${label}: ${res.body}`).toBe(409);
      const body = res.json() as Record<string, unknown>;
      expect(body).toMatchObject({ success: false, error: "vault_locked", reason: "key_mismatch" });
      expect(String(body.remedy)).toContain("pi-dashboard credentials reset --vault");
      expect(res.body).not.toContain(MARKER);
      expect(res.body).not.toContain(ACCOUNT.label);
    }
    const proposal = (await call(app, "POST", "/api/vault/import/propose", { content: "GEMINI_API_KEY=abcdefgh12" })).json().data as { id: string };
    const imp = await call(app, "POST", "/api/vault/import/confirm", { proposalId: proposal.id, names: ["GEMINI_API_KEY"] });
    expect(imp.statusCode, imp.body).toBe(409);
    expect(imp.json()).toMatchObject({ error: "vault_locked", reason: "key_mismatch" });

    expect(sha256(file)).toBe(before);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"))).toEqual([]);
  });

  it("GET /api/vault reports status locked with the reason and no accounts", async () => {
    const file = path.join(dir, "vault.json");
    fs.writeFileSync(file, encodeEnvelope({ accounts: [ACCOUNT] }, KEY_1, "vault"), { mode: 0o600 });
    const app = await mkApp(createVaultStore({ codec: testVaultCodec(KEY_2), path: file }));
    const res = await call(app, "GET", "/api/vault");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: { state: "locked", reason: "key_mismatch" }, accounts: [] });
    expect(res.body).not.toContain(MARKER);
  });
});

describe("E40: plaintext vault, no key", () => {
  it("POST → 409 vault_locked with keychain_unavailable and a remedy naming the key file env; status ok/writable:false; the account is still listed; bytes unchanged", async () => {
    const file = path.join(dir, "vault.json");
    fs.writeFileSync(file, `${JSON.stringify({ accounts: [ACCOUNT] }, null, 2)}\n`, { mode: 0o600 });
    const before = sha256(file);
    const app = await mkApp(createVaultStore({ codec: keylessVaultCodec("keychain_unavailable"), path: file }));
    const post = await call(app, "POST", "/api/vault/accounts", { provider: "gemini", label: "second", value: "abcdefgh12" });
    expect(post.statusCode, post.body).toBe(409);
    expect(post.json()).toMatchObject({ error: "vault_locked", reason: "keychain_unavailable" });
    expect(post.json().remedy).toContain("PI_DASHBOARD_DATA_KEY_FILE");
    expect(post.json().message).toContain("PI_DASHBOARD_DATA_KEY_FILE");
    const get = (await call(app, "GET", "/api/vault")).json().data as { status: unknown; accounts: Array<{ id: string }> };
    expect(get.status).toEqual({ state: "ok", writable: false, reason: "keychain_unavailable" });
    expect(get.accounts.map((a) => a.id)).toEqual(["a1"]);
    expect(sha256(file)).toBe(before);
  });
});

describe("X12: headless Linux, no keyring (route)", () => {
  it("the provider throws 'no session bus': POST → 409 keychain_unavailable naming PI_DASHBOARD_DATA_KEY_FILE; vault.json unchanged", async () => {
    const f = writePlain("vault", { accounts: [ACCOUNT] });
    const before = sha256(f);
    const noBus = () => { throw new Error("Couldn't access platform storage: NoStorageAccess (no session bus)"); };
    await initCredentialKey({ entryFactory: () => ({ getPassword: noBus, setPassword: noBus }), log: logSink().log });
    const app = await mkApp(createVaultStore({ codec: getCredentialCodec("vault") }));
    const post = await call(app, "POST", "/api/vault/accounts", { provider: "gemini", label: "second", value: "abcdefgh12" });
    expect(post.statusCode).toBe(409);
    expect(post.json()).toMatchObject({ error: "vault_locked", reason: "keychain_unavailable" });
    expect(post.json().message).toContain("PI_DASHBOARD_DATA_KEY_FILE");
    expect(sha256(f)).toBe(before);
  });
});

describe("E17 (route): lazy, no files → no keychain", () => {
  it("init then GET /api/vault: absent, key state deferred, 0 keychain calls, no credential file created", async () => {
    const kc = stubKeychain(null);
    const sink = logSink();
    await initCredentialKey({ entryFactory: kc.factory, log: sink.log });
    const app = await mkApp(createVaultStore({ codec: getCredentialCodec("vault") }));
    const res = await call(app, "GET", "/api/vault");
    expect(res.json().data.status).toEqual({ state: "absent" });
    expect(getCredentialKeyState().state).toBe("deferred");
    expect(sink.lines.join("\n")).toContain("state=deferred");
    expect(kc.calls.get + kc.calls.set + kc.calls.ctor.length).toBe(0);
    expect(fs.existsSync(filePath("vault"))).toBe(false);
    expect(fs.existsSync(filePath("plugin-credentials"))).toBe(false);
  });
});

describe("E21 (route): first write creates the key", () => {
  it("POST ×3: setPassword ×1 on the first write (the file is an envelope); writes 2–3 make no further keychain call", async () => {
    const kc = stubKeychain(null);
    await initCredentialKey({ entryFactory: kc.factory, log: logSink().log });
    const app = await mkApp(createVaultStore({ codec: getCredentialCodec("vault") }));
    const post = (label: string) => call(app, "POST", "/api/vault/accounts", { provider: "gemini", label, value: "abcdefgh12" });
    expect((await post("one")).statusCode).toBe(200);
    expect(kc.calls.set).toBe(1);
    expect(fs.readFileSync(filePath("vault"), "utf8").split("\n")[0]).toBe("pi-dashboard-encrypted:v1");
    const calls = kc.calls.get + kc.calls.set;
    expect((await post("two")).statusCode).toBe(200);
    expect((await post("three")).statusCode).toBe(200);
    expect(kc.calls.get + kc.calls.set).toBe(calls);
  });
});
