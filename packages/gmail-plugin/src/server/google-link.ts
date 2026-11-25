/**
 * Gmail's soft link to Google Connect (add-google-connect D1/D10). Gmail declares no `dependsOn` on the
 * `google` plugin: at the FIRST request after start it asks `consumeAll("google.connect")` for an entry whose
 * provider is `google` (any other provider is ignored — nothing is handed over to it), hands the legacy
 * client + accounts over once, and decides — for the life of the process — whether it delegates leases or
 * keeps leasing from its own namespace. Enabling/disabling `google` therefore takes effect after a restart.
 *
 * - `usable`     Google Connect is present: Gmail's management routes answer 410 `moved`.
 * - `delegating` usable AND every legacy account is (now) in Google Connect: `gmail/lease` + `gmail/accounts`
 *                answer `{delegate:"google"}`; no fallback to legacy tokens (an imported account that was
 *                disconnected must stay disconnected).
 * A failed / partial hand-off leaves Gmail leasing from the legacy data and is retried on the next start.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { GOOGLE_CONNECT_SERVICE, GOOGLE_PLUGIN_ID } from "../shared/protocol.js";
import type { AccountStore } from "./accounts.js";

const MIGRATION_VERSION = 1;

/** Structural mirror of the google plugin's `importLegacyGmail` (no import edge between the plugins). */
interface LegacyImporter {
  importLegacyGmail(snapshot: { client?: unknown; accounts: unknown[] }): Promise<
    { ok: true; imported: number; skipped: number } | { ok: false; error: string }
  >;
}

interface LinkState {
  usable: boolean;
  delegating: boolean;
}

export interface GoogleLink {
  ensure(): Promise<LinkState>;
}

export function createGoogleLink(deps: {
  consumeAll?: ServerPluginContext["consumeAll"];
  store: AccountStore;
  logger: { info(m: string): void; warn(m: string): void };
  now?: () => number;
}): GoogleLink {
  const { store, logger } = deps;

  function provider(): LegacyImporter | undefined {
    for (const e of deps.consumeAll?.<LegacyImporter>(GOOGLE_CONNECT_SERVICE) ?? []) {
      if (e.provider === GOOGLE_PLUGIN_ID && typeof e.value?.importLegacyGmail === "function") return e.value;
    }
    return undefined;
  }

  async function migrate(importer: LegacyImporter): Promise<boolean> {
    const accounts = await store.list();
    const known = new Set((await store.getMigrated())?.subs ?? []);
    // Nothing legacy, or nothing new since the last hand-off: no call, no marker for an empty namespace (B20).
    if (accounts.every((a) => known.has(a.sub))) return true;
    const client = await store.getClient();
    const result = await importer.importLegacyGmail({ client, accounts });
    if (!result.ok || result.skipped > 0) {
      logger.warn(`[gmail] legacy import to Google accounts incomplete (${result.ok ? "skipped" : result.error}); using Gmail's own data`);
      return false;
    }
    await store.setMigrated({ at: (deps.now ?? Date.now)(), version: MIGRATION_VERSION, subs: accounts.map((a) => a.sub) });
    logger.info(`[gmail] legacy import to Google accounts: ${result.imported} account(s)`);
    return true;
  }

  let state: Promise<LinkState> | undefined;
  async function compute(): Promise<LinkState> {
    const importer = provider();
    if (!importer) return { usable: false, delegating: false };
    try {
      return { usable: true, delegating: await migrate(importer) };
    } catch {
      // Store locked / importer threw: keep leasing from the legacy data; one attempt per process.
      logger.warn("[gmail] legacy import to Google accounts failed; using Gmail's own data until the next start");
      return { usable: true, delegating: false };
    }
  }

  return { ensure: () => (state ??= compute()) };
}
