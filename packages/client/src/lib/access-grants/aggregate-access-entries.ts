/**
 * Pure aggregation for the Settings → Access review surface (change:
 * add-access-grants-and-review, task 7.2).
 *
 * Maps an `AccessGrantSnapshot` (the eight in-scope stores, read in place —
 * design D6) into labelled, revocable rows. Kept PURE so fixture tests can
 * exercise it without a live server.
 *
 * Invariants pinned here:
 * - every entry is labelled with its origin store;
 * - `auth.bypassHosts` entries are distinct from `config.trustedNetworks`
 *   entries (separate stores, separate revoke targets);
 * - a legacy hash-only KB trust entry renders as its opaque hash and never
 *   throws (spec: pre-existing entries degrade gracefully);
 * - session-scoped path grants render alongside persisted ones with all four
 *   fields (design D17).
 */
import {
  ACCESS_STORES,
  type AccessEntry,
  type AccessGrantSnapshot,
  type AccessStoreId,
} from "./access-grants-types.js";

/**
 * Aggregate every store's snapshot into display rows, in `ACCESS_STORES`
 * order, then by subject within a store (stable for tests and for the UI).
 */
export function aggregateAccessEntries(snapshot: AccessGrantSnapshot): AccessEntry[] {
  const entries: AccessEntry[] = [];

  for (const store of ACCESS_STORES) {
    entries.push(...entriesForStore(store, snapshot));
  }

  return entries.sort((a, b) => {
    const storeDelta = ACCESS_STORES.indexOf(a.store) - ACCESS_STORES.indexOf(b.store);
    if (storeDelta !== 0) return storeDelta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Group aggregated rows by store, preserving `ACCESS_STORES` display order. */
export function groupAccessEntriesByStore(entries: AccessEntry[]): Array<{
  store: AccessStoreId;
  entries: AccessEntry[];
}> {
  return ACCESS_STORES.map((store) => ({
    store,
    entries: entries.filter((e) => e.store === store),
  })).filter((group) => group.entries.length > 0);
}

function entriesForStore(store: AccessStoreId, snapshot: AccessGrantSnapshot): AccessEntry[] {
  switch (store) {
    case "pathGrants":
      // Session-scoped grants ride the same array with the same four fields
      // (D17) — the tab must not distinguish them structurally.
      return snapshot.pathGrants.map((g) => ({
        id: `${g.scope}\u0000${g.subject}`,
        store,
        subject: g.subject,
        legacyHashOnly: false,
        scope: g.scope,
        grantedAt: g.grantedAt,
        origin: g.origin,
        ...(g.via ? { via: g.via } : {}),
        ...(g.widenedFrom ? { widenedFrom: g.widenedFrom } : {}),
      }));
    case "worktreeTrust":
      return snapshot.worktreeTrust.map((subject) => ({
        id: subject,
        store,
        subject,
        legacyHashOnly: false,
      }));
    case "kbTrust":
      // Legacy entries carry only a hash: display the opaque hash as the
      // subject rather than erroring; the revoke target stays the hash.
      return snapshot.kbTrust.map((k) => ({
        id: k.hash,
        store,
        subject: k.subject ?? k.hash,
        legacyHashOnly: k.subject === undefined,
      }));
    case "projectTrust":
      return snapshot.projectTrust.map((path) => ({
        id: path,
        store,
        subject: path,
        legacyHashOnly: false,
      }));
    case "trustedNetworks":
      return snapshot.trustedNetworks.map((value) => ({
        id: value,
        store,
        subject: value,
        legacyHashOnly: false,
      }));
    case "bypassHosts":
      return snapshot.bypassHosts.map((value) => ({
        id: value,
        store,
        subject: value,
        legacyHashOnly: false,
      }));
    case "corsOrigins":
      return snapshot.corsOrigins.map((value) => ({
        id: value,
        store,
        subject: value,
        legacyHashOnly: false,
      }));
    case "pinnedDirectories":
      return snapshot.pinnedDirectories.map((value) => ({
        id: value,
        store,
        subject: value,
        legacyHashOnly: false,
      }));
  }
}
