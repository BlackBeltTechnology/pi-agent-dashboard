/**
 * Grants: account choice, directory-exact match, checkout confirmation,
 * revocation without fallback.
 * See change: add-credential-vault (test-plan E10, E11, E13, E14, E15).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBinding, setBindingDefault } from "../vault/vault-bindings.js";
import {
  buildDeliverySnapshot,
  confirmCheckout,
  createGrant,
  dirSubject,
  listGrantStates,
  repoSubject,
  resolveBindings,
  revokeAccount,
} from "../vault/vault-grants.js";
import { approvePluginBinding, createPluginVaultReader } from "../vault/vault-plugin-read.js";
import { createVaultStore, type VaultStore } from "../vault/vault-store.js";
import { testVaultCodec } from "./helpers/vault-test-codec.js";

let dir: string;
let store: VaultStore;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-grants-"));
  store = createVaultStore({ codec: testVaultCodec(), path: path.join(dir, "vault.json") });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const snap = (project: { deviceId: string; dir: string; repoKey?: string }) =>
  buildDeliverySnapshot(store.readDocument().doc, project, (id) => store.getKeyValue(id));

async function twoAccounts() {
  const personal = await store.addAccount({ provider: "gemini", label: "personal", value: "personal-key-1" });
  const work = await store.addAccount({ provider: "gemini", label: "work", value: "work-key-0001" });
  await createBinding(store, { name: "GEMINI_API_KEY", defaultAccountId: personal.id });
  return { personal, work };
}

describe("grants — account choice (E10)", () => {
  it("override wins, no override uses the default, no grant gets nothing", async () => {
    const { work } = await twoAccounts();
    await createGrant(store, { subject: repoSubject("github.com/acme/a"), bindingName: "GEMINI_API_KEY", accountId: work.id });
    await createGrant(store, { subject: repoSubject("github.com/acme/b"), bindingName: "GEMINI_API_KEY" });
    for (const k of ["a", "b"]) await confirmCheckout(store, { deviceId: "hub", dir: `/src/${k}`, repoKey: `github.com/acme/${k}` });
    const val = (k: string) => snap({ deviceId: "hub", dir: `/src/${k}`, repoKey: `github.com/acme/${k}` }).entries;
    expect(val("a")).toEqual([{ name: "GEMINI_API_KEY", value: "work-key-0001" }]);
    expect(val("b")).toEqual([{ name: "GEMINI_API_KEY", value: "personal-key-1" }]);
    expect(snap({ deviceId: "hub", dir: "/src/c", repoKey: "github.com/acme/c" }).entries).toEqual([]);
  });

  it("the provider rule holds when the binding has no default, and a new default must match existing overrides", async () => {
    const g1 = await store.addAccount({ provider: "gemini", label: "g1", value: "gemini-key-0001" });
    const g2 = await store.addAccount({ provider: "gemini", label: "g2", value: "gemini-key-0002" });
    const s1 = await store.addAccount({ provider: "soniox", label: "s1", value: "soniox-key-0001" });
    await createBinding(store, { name: "GEMINI_API_KEY" }); // no default
    await createGrant(store, { subject: dirSubject("hub", "/a"), bindingName: "GEMINI_API_KEY", accountId: g1.id });
    await expect(
      createGrant(store, { subject: dirSubject("hub", "/b"), bindingName: "GEMINI_API_KEY", accountId: s1.id }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    await createGrant(store, { subject: dirSubject("hub", "/b"), bindingName: "GEMINI_API_KEY", accountId: g2.id });
    await expect(setBindingDefault(store, "GEMINI_API_KEY", s1.id)).rejects.toMatchObject({ code: "invalid_request" });
    await setBindingDefault(store, "GEMINI_API_KEY", g2.id);
  });

  it("rejects an override account of a different provider", async () => {
    await twoAccounts();
    const other = await store.addAccount({ provider: "soniox", label: "s", value: "soniox-key-001" });
    await expect(
      createGrant(store, { subject: dirSubject("hub", "/p"), bindingName: "GEMINI_API_KEY", accountId: other.id }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

describe("grants — directory key is exact (E11)", () => {
  it("delivers only to the same device and the same directory", async () => {
    await twoAccounts();
    await createGrant(store, { subject: dirSubject("A", "/work/scratch"), bindingName: "GEMINI_API_KEY" });
    expect(snap({ deviceId: "B", dir: "/work/scratch" }).entries).toEqual([]);
    expect(snap({ deviceId: "A", dir: "/work/scratch/sub" }).entries).toEqual([]);
    expect(snap({ deviceId: "A", dir: "/work/scratch" }).entries).toHaveLength(1);
  });

  it("a session with a repository key ignores directory grants", async () => {
    await twoAccounts();
    await createGrant(store, { subject: dirSubject("A", "/work/scratch"), bindingName: "GEMINI_API_KEY" });
    expect(snap({ deviceId: "A", dir: "/work/scratch", repoKey: "github.com/x/y" }).entries).toEqual([]);
  });
});

describe("grants — checkout confirmation (E13)", () => {
  it("withholds until confirmed, and a re-pointed origin needs a new confirmation", async () => {
    await twoAccounts();
    await createGrant(store, { subject: repoSubject("github.com/acme/app"), bindingName: "GEMINI_API_KEY" });
    await createGrant(store, { subject: repoSubject("github.com/acme/other"), bindingName: "GEMINI_API_KEY" });
    const app = { deviceId: "A", dir: "/src/app", repoKey: "github.com/acme/app" };
    expect(snap(app).entries).toEqual([]);
    expect(resolveBindings(store.readDocument().doc, app)[0]).toMatchObject({ name: "GEMINI_API_KEY", state: "pending-confirmation" });
    await confirmCheckout(store, { deviceId: "A", dir: "/src/app", repoKey: "github.com/acme/app" });
    expect(snap(app).entries).toHaveLength(1);
    const repointed = { ...app, repoKey: "github.com/acme/other" };
    expect(snap(repointed).entries).toEqual([]);
    expect(resolveBindings(store.readDocument().doc, repointed)[0].state).toBe("pending-confirmation");
  });

  it("a confirmation is bound to the device", async () => {
    await twoAccounts();
    await createGrant(store, { subject: repoSubject("github.com/acme/app"), bindingName: "GEMINI_API_KEY" });
    await confirmCheckout(store, { deviceId: "A", dir: "/src/app", repoKey: "github.com/acme/app" });
    expect(snap({ deviceId: "B", dir: "/src/app", repoKey: "github.com/acme/app" }).entries).toEqual([]);
  });
});

describe("grants — revocation never falls back (E14, E15)", () => {
  it("E14: revoking an override account leaves the grant no-account and delivers nothing", async () => {
    const { work } = await twoAccounts();
    await createGrant(store, { subject: dirSubject("hub", "/p/a"), bindingName: "GEMINI_API_KEY", accountId: work.id });
    expect(snap({ deviceId: "hub", dir: "/p/a" }).entries).toHaveLength(1);
    await revokeAccount(store, work.id);
    expect(snap({ deviceId: "hub", dir: "/p/a" }).entries).toEqual([]);
    expect(listGrantStates(store.readDocument().doc)).toEqual([
      expect.objectContaining({ subject: dirSubject("hub", "/p/a"), bindingName: "GEMINI_API_KEY", state: "no-account" }),
    ]);
  });

  it("E15: revoking a default drops the default, grants become no-account, holders are notified", async () => {
    const { personal } = await twoAccounts();
    await createGrant(store, { subject: dirSubject("hub", "/p/a"), bindingName: "GEMINI_API_KEY" });
    const listener = vi.fn();
    store.onChange(listener);
    await revokeAccount(store, personal.id);
    const doc = store.readDocument().doc as { bindings: Array<{ defaultAccountId?: string }> };
    expect(doc.bindings[0].defaultAccountId).toBeUndefined();
    expect(listGrantStates(store.readDocument().doc)[0].state).toBe("no-account");
    expect(snap({ deviceId: "hub", dir: "/p/a" }).entries).toEqual([]);
    expect(listener).toHaveBeenCalled();
  });

  it("a binding whose default is re-set delivers again", async () => {
    const { personal, work } = await twoAccounts();
    await createGrant(store, { subject: dirSubject("hub", "/p/a"), bindingName: "GEMINI_API_KEY" });
    await revokeAccount(store, personal.id);
    await setBindingDefault(store, "GEMINI_API_KEY", work.id);
    expect(snap({ deviceId: "hub", dir: "/p/a" }).entries).toEqual([{ name: "GEMINI_API_KEY", value: "work-key-0001" }]);
  });

  it("only key accounts are delivered", async () => {
    fs.writeFileSync(store.filePath, JSON.stringify({
      accounts: [{ id: "o", provider: "g", kind: "oauth", namespace: "user", label: "l", value: "abcdefgh12" }],
      bindings: [{ name: "GEMINI_API_KEY", target: "env", defaultAccountId: "o" }],
      grants: [{ subject: dirSubject("hub", "/p"), bindingName: "GEMINI_API_KEY" }],
    }));
    expect(snap({ deviceId: "hub", dir: "/p" }).entries).toEqual([]);
  });
});

describe("TLS solver accounts — vault isolation (add-acme-dns01-certs E25)", () => {
  const TOKEN = "cf-secret-1234567890";

  async function withTls() {
    const { personal, work } = await twoAccounts();
    await store.upsertTlsSecrets({ sourceId: "home", provider: "cloudflare", entries: [{ label: "cloudflareToken", value: TOKEN }] });
    const tls = (await store.listAccounts()).find((a) => a.kind === "tls-solver")!;
    return { personal, work, tls };
  }

  it("refuses it as a binding default, creating or changing, and as a grant override; nothing changes", async () => {
    const { tls } = await withTls();
    const before = fs.readFileSync(store.filePath, "utf8");
    await expect(createBinding(store, { name: "CF_TOKEN_KEY", defaultAccountId: tls.id })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(setBindingDefault(store, "GEMINI_API_KEY", tls.id)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      createGrant(store, { subject: repoSubject("github.com/acme/a"), bindingName: "GEMINI_API_KEY", accountId: tls.id }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(fs.readFileSync(store.filePath, "utf8")).toBe(before);
  });

  it("generic rotate is refused and the account is unchanged", async () => {
    const { tls } = await withTls();
    await expect(store.rotateAccount(tls.id, "replacement-value-1")).rejects.toMatchObject({ name: "VaultError" });
    expect(await store.readTlsSecret("home", "cloudflareToken")).toBe(TOKEN);
  });

  it("generic revoke answers managed_account and the account is unchanged", async () => {
    const { tls } = await withTls();
    const before = fs.readFileSync(store.filePath, "utf8");
    await expect(revokeAccount(store, tls.id)).rejects.toMatchObject({ name: "VaultError", code: "managed_account" });
    expect(fs.readFileSync(store.filePath, "utf8")).toBe(before);
    expect(await store.readTlsSecret("home", "cloudflareToken")).toBe(TOKEN);
  });

  it("a hand-edited binding/grant pointing at it delivers nothing; plugin read and snapshot never contain the value", async () => {
    const { tls } = await withTls();
    // Bypass the guards the way a hand edit (or a downgrade) could.
    await store.update((doc) => {
      (doc.bindings as Array<Record<string, unknown>>)[0].defaultAccountId = tls.id;
    });
    await createGrant(store, { subject: dirSubject("hub", "/p"), bindingName: "GEMINI_API_KEY" });
    await store.update((doc) => {
      (doc.grants as Array<Record<string, unknown>>)[0].accountId = tls.id;
    });
    const snapshot = snap({ deviceId: "hub", dir: "/p" });
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN);
    expect(snapshot.entries).toEqual([]);
    await approvePluginBinding(store, "deck3d", "GEMINI_API_KEY");
    expect(await createPluginVaultReader(store, "deck3d", ["GEMINI_API_KEY"]).read("GEMINI_API_KEY")).toBeUndefined();
    expect(store.getKeyValue(tls.id)).toBeUndefined();
  });
});
