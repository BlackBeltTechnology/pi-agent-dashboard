/**
 * One-time legacy Gmail import (design D10) — the ONLY in-process surface the google plugin `provide`s
 * (`google.connect`). The gmail plugin hands over a snapshot of its own namespace; this module turns it
 * into own client `gmail-legacy` plus one account per legacy `sub`, without re-consent:
 *  - each `sub` is imported AT MOST once (`imported:gmail` ledger), so a later disconnect is never undone
 *    and an existing Google Connect account is never overwritten;
 *  - accounts added to the legacy namespace later are imported on the next run; an empty legacy namespace
 *    writes no marker (scenario-gate B20);
 *  - atomic on a full store: when the batch does not fit, NOTHING is written (B13);
 *  - legacy accounts without a legacy client are skipped and logged once (B14).
 * Tokens never cross plugins except in this one hand-over by a trusted in-process plugin.
 * See change: add-google-connect.
 */
import type { PluginCredentialRecord } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { Product } from "../shared/products.js";
import { acctKey, clientKey, type GoogleStore, IMPORTED_GMAIL_KEY, MAX_KEYS, type OwnClient } from "./store.js";

const LEGACY_CLIENT_ID = "gmail-legacy";

/** Secret-bearing legacy account as the gmail plugin stores it (`packages/gmail-plugin/src/server/accounts.ts`). */
export interface LegacyGmailAccount {
  sub: string;
  email: string;
  alias?: string;
  tier: string;
  scopes: string[];
  refresh: string;
  access: string;
  expires: number;
  status: "ok" | "reauth_required";
  testingHint?: boolean;
  filters?: boolean;
  addedAt: number;
}

export interface LegacyGmailSnapshot {
  client?: { clientId: string; clientSecret: string; projectId?: string };
  accounts: LegacyGmailAccount[];
}

type ImportResult =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; error: "too_many_keys" | "invalid_snapshot" };

export interface LegacyImporter {
  importLegacyGmail(snapshot: LegacyGmailSnapshot): Promise<ImportResult>;
}

const TIERS = new Set(["readonly", "draft", "send"]);

function validAccount(a: unknown): a is LegacyGmailAccount {
  const x = a as Partial<LegacyGmailAccount> | null;
  return (
    !!x &&
    typeof x.sub === "string" &&
    typeof x.email === "string" &&
    typeof x.refresh === "string" &&
    !!x.refresh &&
    typeof x.tier === "string" &&
    TIERS.has(x.tier) &&
    Array.isArray(x.scopes)
  );
}

type LegacyClient = NonNullable<LegacyGmailSnapshot["client"]>;

function clientRecord(cl: LegacyClient, now: number): OwnClient {
  const rec: OwnClient = {
    id: LEGACY_CLIENT_ID,
    label: "Gmail client (migrated)",
    type: "installed",
    clientId: cl.clientId,
    clientSecret: cl.clientSecret,
    domains: [],
    addedAt: now,
  };
  if (cl.projectId) rec.projectId = cl.projectId;
  return rec;
}

function accountRecord(a: LegacyGmailAccount, cl: LegacyClient): PluginCredentialRecord {
  const gmail: { level: string; options?: Record<string, boolean> } = { level: a.tier };
  if (a.filters) gmail.options = { filters: true };
  const rec: PluginCredentialRecord = {
    sub: a.sub,
    email: a.email,
    client: `own:${LEGACY_CLIENT_ID}`,
    grant: {
      clientId: cl.clientId,
      refresh: a.refresh,
      access: a.access,
      expires: a.expires,
      scopes: [...a.scopes],
      status: a.status,
      ...(a.testingHint ? { testingHint: true } : {}),
      grantedAt: a.addedAt,
    },
    products: { gmail } as Partial<Record<Product, PluginCredentialRecord>>,
    addedAt: a.addedAt,
  };
  if (a.alias) rec.alias = a.alias;
  return rec;
}

export function createLegacyImporter(deps: {
  store: GoogleStore;
  logger: { info(m: string): void; warn(m: string): void };
  now?: () => number;
}): LegacyImporter {
  const { store, logger } = deps;
  let chain: Promise<unknown> = Promise.resolve();
  let warnedNoClient = false;

  /** Legacy accounts not yet imported and not already present in Google Connect. */
  async function pending(snapshot: LegacyGmailSnapshot, ledgerSubs: readonly string[]): Promise<LegacyGmailAccount[]> {
    const done = new Set([...ledgerSubs, ...(await store.list()).map((a) => a.sub)]);
    return snapshot.accounts.filter(validAccount).filter((a) => !done.has(a.sub));
  }

  /** Legacy accounts need a legacy client to bind to; without one they stay legacy-only (logged once, B14). */
  function skipWithoutClient(count: number): ImportResult {
    if (!warnedNoClient) {
      warnedNoClient = true;
      logger.warn("[google] legacy gmail accounts skipped: no legacy client to bind them to");
    }
    return { ok: true, imported: 0, skipped: count };
  }

  /** Keys the batch will add: accounts + the legacy client (once) + the ledger (once). */
  function keysNeeded(keys: Set<string>, accounts: number): number {
    return accounts + (keys.has(clientKey(LEGACY_CLIENT_ID)) ? 0 : 1) + (keys.has(IMPORTED_GMAIL_KEY) ? 0 : 1);
  }

  async function run(snapshot: LegacyGmailSnapshot): Promise<ImportResult> {
    if (!snapshot || !Array.isArray(snapshot.accounts)) return { ok: false, error: "invalid_snapshot" };
    const ledger = await store.getImportLedger();
    const fresh = await pending(snapshot, ledger.subs);
    if (fresh.length === 0) return { ok: true, imported: 0, skipped: 0 };
    const cl = snapshot.client;
    if (!cl?.clientId) return skipWithoutClient(fresh.length);
    const creds = store.rawCredentials();
    const keys = new Set(await creds.list());
    if (keys.size + keysNeeded(keys, fresh.length) > MAX_KEYS) {
      logger.warn("[google] legacy gmail import deferred: the credential store is full");
      return { ok: false, error: "too_many_keys" };
    }
    if (!keys.has(clientKey(LEGACY_CLIENT_ID))) {
      await creds.set(clientKey(LEGACY_CLIENT_ID), clientRecord(cl, deps.now?.() ?? Date.now()) as unknown as PluginCredentialRecord);
    }
    for (const a of fresh) await creds.set(acctKey(a.sub), accountRecord(a, cl));
    // The ledger is written LAST: a crash earlier retries (already-imported subs are skipped as existing).
    await store.setImportLedger({ subs: [...ledger.subs, ...fresh.map((a) => a.sub)], client: true });
    logger.info(`[google] legacy gmail import: ${fresh.length} account(s)`);
    return { ok: true, imported: fresh.length, skipped: 0 };
  }

  return {
    importLegacyGmail(snapshot) {
      const next = chain.then(() => run(snapshot));
      chain = next.catch(() => {});
      return next;
    },
  };
}
