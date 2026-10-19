/**
 * Vault adapter + redactor of the ACME source.
 * See change: add-acme-dns01-certs (test-plan E7 redaction forms, E12, E13, E31, 6.45).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVaultStore, type VaultStore } from "../../../../vault/vault-store.js";
import { AcmeCredentialsError, createAcmeCredentials, redactSecrets } from "../credentials.js";

const TOKEN = "cf-Secret/1234+567890=abc ?&é";

describe("redactSecrets", () => {
  const cases: Array<[string, (s: string) => string]> = [
    ["raw", (s) => s],
    ["url-encoded", (s) => encodeURIComponent(s)],
    ["url-encoded, lower-case escapes", (s) => encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())],
    ["url-encoded, mixed-case escapes", (s) => encodeURIComponent(s).replace(/%([0-9A-F])([0-9A-F])/g, (_m, a, b) => `%${a}${b.toLowerCase()}`)],
    ["url-encoded with + for spaces", (s) => encodeURIComponent(s).replace(/%20/g, "+")],
    ["double url-encoded", (s) => encodeURIComponent(encodeURIComponent(s))],
    ["double url-encoded, lower-case", (s) => encodeURIComponent(encodeURIComponent(s)).toLowerCase()],
    ["RFC3986 strict", (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)],
    ["JSON-escaped", (s) => JSON.stringify(s).slice(1, -1)],
    ["base64", (s) => Buffer.from(s).toString("base64")],
    ["base64 without padding", (s) => Buffer.from(s).toString("base64").replace(/=+$/, "")],
    ["base64url", (s) => Buffer.from(s).toString("base64url")],
  ];

  it.each(cases)("redacts the %s form", (_name, form) => {
    for (const secret of [TOKEN, 'tok"en\\with\nescapes12', "plain-secret-1234567890", "it's(a)*!secret"]) {
      const out = redactSecrets(`request failed: ${form(secret)} (status 500)`, [secret]);
      expect(out, `${_name}: ${secret}`).toBe("request failed: [redacted] (status 500)");
    }
  });

  it("redacts every secret and every occurrence", () => {
    const out = redactSecrets("a user-aaaaaaaa b key-bbbbbbbbbb c user-aaaaaaaa", ["user-aaaaaaaa", "key-bbbbbbbbbb"]);
    expect(out).toBe("a [redacted] b [redacted] c [redacted]");
  });

  it("redacts Authorization / X-Api-Key / X-Api-User header values even for unknown secrets", () => {
    const msg = [
      "Authorization: Bearer abc.def-ghi",
      "x-api-key: 9f8e7d6c5b",
      "X-Api-User: 11111111-2222-3333-4444-555555555555",
      '{"headers":{"Authorization":"Basic dXNlcjpwYXNz","X-Api-Key":"zzzzzzzzzz"},"other":1}',
    ].join("\n");
    const out = redactSecrets(msg, []);
    for (const leaked of ["abc.def-ghi", "9f8e7d6c5b", "11111111-2222", "dXNlcjpwYXNz", "zzzzzzzzzz"]) expect(out).not.toContain(leaked);
    expect(out).toContain('"other":1');
    expect(out.match(/\[redacted\]/g)).toHaveLength(5);
  });

  it("redacts token= query values and keeps the rest of the URL", () => {
    expect(redactSecrets("GET https://x.test/v1/verify?zone=z&token=abcdef123456&x=1 failed", [])).toBe(
      "GET https://x.test/v1/verify?zone=z&token=[redacted]&x=1 failed",
    );
    expect(redactSecrets("access_token=abc", [])).toBe("access_token=[redacted]");
  });

  it("ignores empty secrets and leaves clean messages alone", () => {
    expect(redactSecrets("nothing to hide", ["", "x-never-present-1"])).toBe("nothing to hide");
  });
});

describe("createAcmeCredentials", () => {
  let dir: string;
  let file: string;
  let store: VaultStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "acme-creds-"));
    file = path.join(dir, "vault.json");
    store = createVaultStore(file);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const CF = "cf-secret-1234567890";

  it("E12/E13: cloudflare save stores one tls-solver account; token appears in no listing", async () => {
    const creds = createAcmeCredentials(store);
    await creds.save("home", "cloudflare", { token: CF });
    await creds.save("home", "cloudflare", { token: "cf-secret-0987654321" });
    const accounts = await store.listAccounts();
    expect(accounts).toEqual([{ id: expect.any(String), provider: "cloudflare", kind: "tls-solver", namespace: "tls:home", label: "cloudflareToken" }]);
    expect(JSON.stringify(accounts)).not.toMatch(/cf-secret/);
    expect(await creds.readSecret("home", "cloudflareToken")).toBe("cf-secret-0987654321");
    expect(await creds.isConfigured("home", "cloudflare")).toBe(true);
    expect(creds.vaultState()).toBe("ok");
  });

  it("acme-dns save writes both labels; trims surrounding whitespace", async () => {
    const creds = createAcmeCredentials(store);
    await creds.save("home", "acme-dns", { user: " user-aaaaaaaa\n", key: "key-aaaaaaaaaa" });
    expect(await creds.readSecret("home", "acmeDnsUser")).toBe("user-aaaaaaaa");
    expect(await creds.readSecret("home", "acmeDnsKey")).toBe("key-aaaaaaaaaa");
    expect(await creds.isConfigured("home", "acme-dns")).toBe(true);
  });

  it("rejects unknown, missing, non-string and empty fields with a 400 error and writes nothing", async () => {
    const creds = createAcmeCredentials(store);
    const bad: Array<[Parameters<typeof creds.save>[1], Record<string, unknown>]> = [
      ["cloudflare", {}],
      ["cloudflare", { token: 12345678901 }],
      ["cloudflare", { token: "   " }],
      ["cloudflare", { token: CF, extra: "x" }],
      ["cloudflare", { user: "u", key: "k" }],
      ["acme-dns", { user: "user-aaaaaaaa" }],
      ["acme-dns", { user: "user-aaaaaaaa", key: "key-aaaaaaaaaa", token: CF }],
      ["acme-dns", { user: "user-aaaaaaaa", key: null }],
    ];
    for (const [type, body] of bad) {
      await expect(creds.save("home", type, body)).rejects.toBeInstanceOf(AcmeCredentialsError);
    }
    await expect(creds.save("home", "cloudflare", { token: "short" })).rejects.toMatchObject({ name: "AcmeCredentialsError", statusCode: 400 });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("E31: a bad second value leaves an existing pair unchanged (atomic)", async () => {
    const creds = createAcmeCredentials(store);
    await creds.save("home", "acme-dns", { user: "user-aaaaaaaa", key: "key-aaaaaaaaaa" });
    await expect(creds.save("home", "acme-dns", { user: "user-bbbbbbbb", key: "short" })).rejects.toBeInstanceOf(AcmeCredentialsError);
    expect(await creds.readSecret("home", "acmeDnsUser")).toBe("user-aaaaaaaa");
    expect(await creds.readSecret("home", "acmeDnsKey")).toBe("key-aaaaaaaaaa");
  });

  it("6.45: configured is false with only the user label present, and when nothing is stored", async () => {
    const creds = createAcmeCredentials(store);
    expect(await creds.isConfigured("home", "acme-dns")).toBe(false);
    await store.upsertTlsSecrets({ sourceId: "home", provider: "acme-dns", entries: [{ label: "acmeDnsUser", value: "user-aaaaaaaa" }] });
    expect(await creds.isConfigured("home", "acme-dns")).toBe(false);
    expect(await creds.isConfigured("home", "cloudflare")).toBe(false);
    expect(await creds.isConfigured("other", "acme-dns")).toBe(false);
  });

  it("an unreadable (corrupt) vault is `unavailable`, never configured, and readSecret throws", async () => {
    fs.writeFileSync(file, "{ not json", { mode: 0o600 });
    const creds = createAcmeCredentials(store);
    expect(creds.vaultState()).toBe("unavailable");
    expect(await creds.isConfigured("home", "cloudflare")).toBe(false);
    await expect(creds.readSecret("home", "cloudflareToken")).rejects.toMatchObject({ code: "vault_corrupt" });
    await expect(creds.save("home", "cloudflare", { token: CF })).rejects.toMatchObject({ code: "vault_corrupt" });
    expect((await creds.redactorFor("home", "cloudflare"))("Authorization: Bearer x")).toBe("Authorization: [redacted]");
  });

  it("redactorFor removes the source's current secrets in all forms and nothing from other sources", async () => {
    const creds = createAcmeCredentials(store);
    await creds.save("home", "acme-dns", { user: "user-aaaaaaaa", key: "key/with+chars=1" });
    await creds.save("lab", "cloudflare", { token: CF });
    const redact = await creds.redactorFor("home", "acme-dns");
    const msg = `u=user-aaaaaaaa k=${encodeURIComponent("key/with+chars=1")} k2=${Buffer.from("key/with+chars=1").toString("base64url")} lab=${CF}`;
    expect(redact(msg)).toBe(`u=[redacted] k=[redacted] k2=[redacted] lab=${CF}`);
    // a rotated secret is no longer current: the redactor is a snapshot taken at call time
    await creds.save("home", "acme-dns", { user: "user-cccccccc", key: "key-cccccccccc" });
    expect((await creds.redactorFor("home", "acme-dns"))("user-cccccccc user-aaaaaaaa")).toBe("[redacted] user-aaaaaaaa");
  });

  it("deleteNamespace / listNamespaces", async () => {
    const creds = createAcmeCredentials(store);
    await creds.save("home", "cloudflare", { token: CF });
    await creds.save("lab", "cloudflare", { token: CF });
    expect((await creds.listNamespaces()).sort()).toEqual(["home", "lab"]);
    await creds.deleteNamespace("home");
    expect(await creds.listNamespaces()).toEqual(["lab"]);
    expect(await creds.isConfigured("home", "cloudflare")).toBe(false);
  });
});
