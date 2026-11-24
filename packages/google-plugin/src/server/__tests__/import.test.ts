/**
 * Legacy Gmail import (test-plan B75–B83, GB13/GB14/GB20; design D10). See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { account, capturingLogger, memoryCredentials, OWN_BB } from "../../__tests__/fakes.js";
import { SCOPE } from "../../shared/products.js";
import { createLegacyImporter, type LegacyGmailAccount, type LegacyGmailSnapshot } from "../import.js";
import { acctKey, clientKey, GoogleStore, IMPORTED_GMAIL_KEY } from "../store.js";

const legacy = (sub: string, over: Partial<LegacyGmailAccount> = {}): LegacyGmailAccount => ({
  sub,
  email: `${sub}@x.com`,
  tier: "send",
  scopes: [SCOPE.gmailModify],
  refresh: `LEGACY-REFRESH-${sub}`,
  access: `LEGACY-ACCESS-${sub}`,
  expires: 123,
  status: "ok",
  addedAt: 7,
  ...over,
});
const snap = (accounts: LegacyGmailAccount[], client: LegacyGmailSnapshot["client"] = { ...OWN_BB, projectId: "bb-pi" }): LegacyGmailSnapshot => ({ client, accounts });

function setup(initial = {}, maxKeys = 256) {
  const creds = memoryCredentials(initial as never, maxKeys);
  const store = new GoogleStore(creds);
  const logger = capturingLogger();
  return { creds, store, logger, importer: createLegacyImporter({ store, logger }) };
}

describe("importLegacyGmail", () => {
  it("imports the client as own `gmail-legacy` and each account bound to it, without re-consent", async () => {
    const { importer, store, creds } = setup();
    expect(await importer.importLegacyGmail(snap([legacy("s1", { alias: "work", filters: true, testingHint: true }), legacy("s2", { tier: "readonly", scopes: [SCOPE.gmailReadonly], status: "reauth_required" })]))).toEqual({ ok: true, imported: 2, skipped: 0 });
    expect(await store.getClient("gmail-legacy")).toMatchObject({ type: "installed", label: "Gmail client (migrated)", clientId: OWN_BB.clientId, projectId: "bb-pi", domains: [] });
    expect(await store.get("s1")).toMatchObject({
      client: "own:gmail-legacy",
      alias: "work",
      products: { gmail: { level: "send", options: { filters: true } } },
      grant: { clientId: OWN_BB.clientId, refresh: "LEGACY-REFRESH-s1", access: "LEGACY-ACCESS-s1", scopes: [SCOPE.gmailModify], status: "ok", testingHint: true },
    });
    expect(await store.get("s2")).toMatchObject({ products: { gmail: { level: "readonly" } }, grant: { status: "reauth_required" } });
    expect((await store.get("s2"))?.products.gmail?.options).toBeUndefined();
    expect(creds.data.get(IMPORTED_GMAIL_KEY)).toEqual({ subs: ["s1", "s2"], client: true });
  });

  it("is idempotent and never undoes a disconnect: each sub is imported at most once", async () => {
    const { importer, store } = setup();
    const s = snap([legacy("s1")]);
    await importer.importLegacyGmail(s);
    await store.remove("s1");
    expect(await importer.importLegacyGmail(s)).toEqual({ ok: true, imported: 0, skipped: 0 });
    expect(await store.get("s1")).toBeUndefined();
  });

  it("accounts added to the legacy namespace later are imported on the next run; the client only once", async () => {
    const { importer, store, creds } = setup();
    await importer.importLegacyGmail(snap([legacy("s1")]));
    const clientBefore = JSON.stringify(creds.data.get(clientKey("gmail-legacy")));
    expect(await importer.importLegacyGmail(snap([legacy("s1"), legacy("s2")], { ...OWN_BB, clientSecret: "CHANGED" }))).toMatchObject({ imported: 1 });
    expect((await store.list()).map((a) => a.sub)).toEqual(["s1", "s2"]);
    expect(JSON.stringify(creds.data.get(clientKey("gmail-legacy")))).toBe(clientBefore);
  });

  it("never overwrites an existing Google Connect account", async () => {
    const { importer, store } = setup({ [acctKey("s1")]: account("s1", "mine@x.com", { alias: "mine", client: "own:bb" }) });
    const r = await importer.importLegacyGmail(snap([legacy("s1"), legacy("s2")]));
    expect(r).toMatchObject({ ok: true, imported: 1 });
    expect(await store.get("s1")).toMatchObject({ email: "mine@x.com", alias: "mine", client: "own:bb" });
  });

  it("an empty legacy namespace writes nothing — not even a marker (B20)", async () => {
    const { importer, creds } = setup();
    expect(await importer.importLegacyGmail(snap([]))).toEqual({ ok: true, imported: 0, skipped: 0 });
    expect(creds.data.size).toBe(0);
  });

  it("is atomic on a full store: nothing imported, no marker, retried later (B13)", async () => {
    const filler = Object.fromEntries(Array.from({ length: 253 }, (_, i) => [`acct:f${i}`, account(`f${i}`, `f${i}@x.com`)]));
    const { importer, creds, logger } = setup(filler);
    const before = creds.data.size;
    expect(await importer.importLegacyGmail(snap([legacy("a"), legacy("b")]))).toEqual({ ok: false, error: "too_many_keys" }); // 2 accounts + client + marker = 4 > 3 free
    expect(creds.data.size).toBe(before);
    expect(creds.data.has(IMPORTED_GMAIL_KEY)).toBe(false);
    expect(logger.warns).toHaveLength(1);
    // Room appears → the next run imports.
    for (let i = 0; i < 10; i++) creds.data.delete(`acct:f${i}`);
    expect(await importer.importLegacyGmail(snap([legacy("a"), legacy("b")]))).toMatchObject({ ok: true, imported: 2 });
  });

  it("legacy accounts without a legacy client are skipped and logged once (B14)", async () => {
    const { importer, store, logger } = setup();
    expect(await importer.importLegacyGmail({ accounts: [legacy("s1")] })).toEqual({ ok: true, imported: 0, skipped: 1 });
    await importer.importLegacyGmail({ accounts: [legacy("s1")] });
    expect(await store.list()).toEqual([]);
    expect(logger.warns).toHaveLength(1);
  });

  it("malformed accounts (no refresh token, bad tier) and malformed snapshots are ignored, not crashed on", async () => {
    const { importer, store } = setup();
    expect(await importer.importLegacyGmail(snap([legacy("ok"), legacy("norefresh", { refresh: "" }), legacy("badtier", { tier: "root" })]))).toMatchObject({ imported: 1 });
    expect((await store.list()).map((a) => a.sub)).toEqual(["ok"]);
    expect(await importer.importLegacyGmail(null as never)).toEqual({ ok: false, error: "invalid_snapshot" });
    expect(await importer.importLegacyGmail({ accounts: "x" } as never)).toEqual({ ok: false, error: "invalid_snapshot" });
  });

  it("concurrent calls serialize: the same sub is never imported twice", async () => {
    const { importer, store } = setup();
    const s = snap([legacy("s1")]);
    const rs = await Promise.all([importer.importLegacyGmail(s), importer.importLegacyGmail(s), importer.importLegacyGmail(s)]);
    expect(rs.map((r) => (r.ok ? r.imported : -1)).sort()).toEqual([0, 0, 1]);
    expect(await store.list()).toHaveLength(1);
  });

  it("logs a count only — no tokens, no emails", async () => {
    const { importer, logger } = setup();
    await importer.importLegacyGmail(snap([legacy("s1")]));
    expect(logger.lines.join("\n")).not.toMatch(/LEGACY|s1@x\.com/);
  });
});
