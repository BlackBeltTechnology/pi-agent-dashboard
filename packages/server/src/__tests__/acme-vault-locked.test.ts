/**
 * ACME consumers × a locked credential vault: `vaultState()` treats `locked`
 * like `corrupt`; the config projection, the readiness gate and the GC follow;
 * the credentials route answers 409 `vault_locked` with reason + remedy.
 * The vault is encrypted under key B while the store holds key A (test codec).
 * See change: encrypt-credentials-at-rest (test-plan E39, E41, X25).
 */
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeEnvelope } from "../auth/credential-envelope.js";
import { _resetQuarantineDedupForTests } from "../auth/locked-json-file.js";
import { AcmeCertSource } from "../tls/sources/acme/acme-source.js";
import { projectAcmeConfigured } from "../tls/sources/acme/config-projection.js";
import { normalizeAcmeEntry } from "../tls/sources/acme/entry.js";
import { acmeGc } from "../tls/sources/acme/gc.js";
import { getAcmeRuntime } from "../tls/sources/acme/runtime.js";
import type { VaultStatus } from "../vault/vault-store.js";
import {
  ACME_TOKEN,
  type AcmeEnv,
  buildAcmeApp,
  homeEntry,
  makeFakeAcmeParts,
  makeFakeListener,
  putJson,
  resetAcmeEnv,
  setupAcmeEnv,
  vaultBytes,
  vaultFile,
  writeCfg,
} from "./helpers/acme-test-kit.js";
import { KEY_2 } from "./helpers/credential-key-kit.js";

let env: AcmeEnv;
let app: FastifyInstance | undefined;

beforeEach(() => {
  env = setupAcmeEnv();
  _resetQuarantineDedupForTests();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
  resetAcmeEnv();
});

/** Replace vault.json by an envelope under key B: the kit's store (key A) sees it locked `key_mismatch`. */
function lockVault(): void {
  const secrets = { accounts: [{ id: "t1", provider: "cloudflare", kind: "tls-solver", namespace: "tls:home", label: "cloudflareToken", value: "cf-secret-1234567890" },
    { id: "t2", provider: "cloudflare", kind: "tls-solver", namespace: "tls:lab", label: "cloudflareToken", value: "cf-secret-0987654321" }] };
  fs.writeFileSync(vaultFile(), encodeEnvelope(secrets, KEY_2, "vault"), { mode: 0o600 });
}

const sourceFor = (entry: Record<string, any>): AcmeCertSource => {
  const parts = makeFakeAcmeParts();
  return new AcmeCertSource({ id: entry.id, entry: normalizeAcmeEntry(entry), clientFactory: () => parts.client, solver: parts.solver, dns: parts.dns });
};

const cfgWith = (...sources: Array<Record<string, any>>) => ({ tls: { enabled: false, sources } });

describe("E39: locked vault: ACME", () => {
  it("vaultState is ok / unavailable / unavailable for ok / corrupt / locked", async () => {
    const creds = getAcmeRuntime().credentials;
    await env.store.upsertTlsSecrets({ sourceId: "home", provider: "cloudflare", entries: [{ label: "cloudflareToken", value: "cf-secret-1234567890" }] });
    const states: VaultStatus["state"][] = [env.store.readDocument().status.state];
    expect(creds.vaultState()).toBe("ok");

    fs.writeFileSync(vaultFile(), "{ not json");
    states.push(env.store.readDocument().status.state);
    expect(creds.vaultState()).toBe("unavailable");

    lockVault();
    states.push(env.store.readDocument().status.state);
    expect(creds.vaultState()).toBe("unavailable");
    expect(states).toEqual(["ok", "corrupt", "locked"]);
  });

  it("config projection: configured false for a corrupt and for a locked vault", async () => {
    writeCfg(cfgWith(homeEntry()));
    const data = { tls: { sources: [homeEntry()] } };
    const configured = async () => ((await projectAcmeConfigured(data)).tls.sources[0] as any).solver.configured;
    await env.store.upsertTlsSecrets({ sourceId: "home", provider: "cloudflare", entries: [{ label: "cloudflareToken", value: "cf-secret-1234567890" }] });
    expect(await configured()).toBe(true);
    fs.writeFileSync(vaultFile(), "{ not json");
    expect(await configured()).toBe(false);
    lockVault();
    expect(await configured()).toBe(false);
  });

  it("acme-source readiness gate: 'credential vault unavailable' for corrupt and locked", async () => {
    const src = sourceFor(homeEntry());
    fs.writeFileSync(vaultFile(), "{ not json");
    const corrupt = await src.readiness({ force: true });
    lockVault();
    const locked = await src.readiness({ force: true });
    for (const r of [corrupt, locked]) {
      expect(r.gates).toEqual([{ id: "credentials", ok: false, hint: "credential vault unavailable" }]);
    }
  });
});

describe("X25: locked vault keeps ACME", () => {
  it("GC and a source reconcile delete nothing and read no solver secret", async () => {
    writeCfg(cfgWith(homeEntry({ id: "keep", domains: ["keep.example.com"] })));
    lockVault();
    const before = vaultBytes();
    const del = vi.spyOn(env.store, "deleteTlsNamespace");
    const read = vi.spyOn(env.store, "readTlsSecret");
    await acmeGc();
    await sourceFor(homeEntry({ id: "keep", domains: ["keep.example.com"] })).onReconciled();
    const status = await sourceFor(homeEntry()).readiness({ force: true });
    expect(del).toHaveBeenCalledTimes(0);
    expect(read).toHaveBeenCalledTimes(0);
    expect(status.gates[0]).toMatchObject({ id: "credentials", ok: false, hint: "credential vault unavailable" });
    expect(vaultBytes()).toBe(before);
  });
});

describe("E41: ACME credentials route", () => {
  it("a locked vault → 409 vault_locked with reason + remedy; the vault is unchanged and no secret is echoed", async () => {
    writeCfg(cfgWith(homeEntry()));
    lockVault();
    const before = vaultBytes();
    const built = await buildAcmeApp({ listener: makeFakeListener().asListener(), vaultRoutes: env.store });
    app = built.app;
    const res = await putJson(app, "/api/tls/acme/home/credentials", { token: ACME_TOKEN });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ success: false, error: "vault_locked", reason: "key_mismatch" });
    expect(res.json().remedy).toContain("pi-dashboard credentials reset --vault");
    expect(res.body).not.toContain(ACME_TOKEN);
    expect(res.body).not.toContain("cf-secret");
    expect(vaultBytes()).toBe(before);
  });
});
