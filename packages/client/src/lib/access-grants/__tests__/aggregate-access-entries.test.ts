/**
 * Fixture tests for the Access-tab aggregation (change:
 * add-access-grants-and-review, tasks 7.2 / 7.3 / 7.6 / 7.13).
 *
 * Pure-module fixtures — no live server (the snapshot shapes mirror what
 * `GET /api/access/grants` will return).
 */
import { describe, expect, it } from "vitest";
import {
  ACCESS_STORES,
  type AccessGrantSnapshot,
  emptyAccessGrantSnapshot,
} from "../access-grants-types.js";
import { aggregateAccessEntries, groupAccessEntriesByStore } from "../aggregate-access-entries.js";

/** One entry per store — the nine-store fixture (task 7.2). */
function nineStoreSnapshot(): AccessGrantSnapshot {
  return {
    pathGrants: [
      { subject: "/repo/allowed/subdir", scope: "project", grantedAt: "2026-01-01T00:00:00Z", origin: "sess-a" },
      // Session-scoped grant alongside the persisted one (task 7.13, D17):
      // same four fields, memory-only server-side.
      { subject: "/repo/session-only", scope: "session", grantedAt: "2026-01-02T00:00:00Z", origin: "sess-b" },
    ],
    worktreeTrust: ["/repo\u0000abc123"],
    kbTrust: [
      { hash: "deadbeef", subject: "github.com/org/repo" },
      // Legacy hash-only entry — the subject was never recorded (task 7.6).
      { hash: "c0ffee00" },
    ],
    projectTrust: ["/home/dev/project"],
    trustedNetworks: ["192.168.1.0/24"],
    bypassHosts: ["nas.local"],
    corsOrigins: ["https://dashboard.example.com"],
    pinnedDirectories: ["/home/dev/pinned"],
    previewEgress: [{ project: "/p", origin: "https://cdn.tailwindcss.com" }],
  };
}

describe("aggregateAccessEntries", () => {
  it("lists entries from every one of the nine in-scope stores", () => {
    const entries = aggregateAccessEntries(nineStoreSnapshot());
    const stores = new Set(entries.map((e) => e.store));
    for (const store of ACCESS_STORES) {
      expect(stores.has(store), `store ${store} missing from the aggregate`).toBe(true);
    }
    expect(stores.size).toBe(9);
  });

  it("labels every entry with its origin store", () => {
    for (const entry of aggregateAccessEntries(nineStoreSnapshot())) {
      expect(ACCESS_STORES).toContain(entry.store);
    }
  });

  it("keeps auth.bypassHosts distinguishable from config.trustedNetworks", () => {
    const entries = aggregateAccessEntries(nineStoreSnapshot());
    const host = entries.find((e) => e.subject === "nas.local");
    const cidr = entries.find((e) => e.subject === "192.168.1.0/24");
    expect(host?.store).toBe("bypassHosts");
    expect(cidr?.store).toBe("trustedNetworks");
    // Same value in both stores would still yield two independently-revocable
    // rows; here the values differ, but the STORE labels must never merge.
    expect(host?.store).not.toBe(cidr?.store);
  });

  it("carries the four session-grant fields on session-scoped path grants (D17)", () => {
    const entry = aggregateAccessEntries(nineStoreSnapshot()).find(
      (e) => e.subject === "/repo/session-only",
    );
    expect(entry).toBeDefined();
    expect(entry!.scope).toBe("session");
    expect(entry!.grantedAt).toBe("2026-01-02T00:00:00Z");
    expect(entry!.origin).toBe("sess-b");
    // Renders alongside the persisted grant, not in a separate universe.
    const persisted = aggregateAccessEntries(nineStoreSnapshot()).find(
      (e) => e.subject === "/repo/allowed/subdir",
    );
    expect(persisted!.store).toBe(entry!.store);
  });

  it("renders a legacy hash-only KB entry as its opaque hash without erroring (7.6)", () => {
    const entries = aggregateAccessEntries(nineStoreSnapshot());
    const legacy = entries.find((e) => e.id === "c0ffee00");
    expect(legacy).toBeDefined();
    expect(legacy!.legacyHashOnly).toBe(true);
    expect(legacy!.subject).toBe("c0ffee00");
    // New-style entries keep their recovered subject while revoking by hash.
    const modern = entries.find((e) => e.id === "deadbeef");
    expect(modern!.subject).toBe("github.com/org/repo");
    expect(modern!.legacyHashOnly).toBe(false);
  });

  it("aggregates nothing without erroring when every store is empty (7.4 precondition)", () => {
    expect(aggregateAccessEntries(emptyAccessGrantSnapshot())).toEqual([]);
    expect(groupAccessEntriesByStore(aggregateAccessEntries(emptyAccessGrantSnapshot()))).toEqual([]);
  });

  it("groups by store in ACCESS_STORES order with only non-empty groups", () => {
    const groups = groupAccessEntriesByStore(aggregateAccessEntries(nineStoreSnapshot()));
    expect(groups.map((g) => g.store)).toEqual([...ACCESS_STORES]);
  });
});

describe("store exclusions (design D6, task 7.3)", () => {
  it("paired-devices.json is excluded — device pairing has its own management surface", () => {
    expect(ACCESS_STORES).not.toContain("pairedDevices");
  });

  it("auth.bypassUrls is excluded — route access belongs to the auth config surface", () => {
    expect(ACCESS_STORES).not.toContain("bypassUrls");
  });

  it("the in-scope set is exactly the nine stores", () => {
    expect([...ACCESS_STORES].sort()).toEqual(
      [
        "pathGrants",
        "worktreeTrust",
        "kbTrust",
        "projectTrust",
        "trustedNetworks",
        "bypassHosts",
        "corsOrigins",
        "pinnedDirectories",
        "previewEgress",
      ].sort(),
    );
  });
});

describe("preview-egress rows (improve-canvas-html-and-url-ux)", () => {
  it("one row per (project, origin), showing the project; the same origin in two projects is two rows", () => {
    const entries = aggregateAccessEntries({
      ...emptyAccessGrantSnapshot(),
      previewEgress: [
        { project: "/p", origin: "https://cdn.tailwindcss.com" },
        { project: "/q", origin: "https://cdn.tailwindcss.com" },
      ],
    });
    expect(entries.map((e) => [e.store, e.subject, e.project])).toEqual([
      ["previewEgress", "https://cdn.tailwindcss.com", "/p"],
      ["previewEgress", "https://cdn.tailwindcss.com", "/q"],
    ]);
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
  });

  it("a server that predates the store (no field) lists nothing and does not throw", () => {
    const { previewEgress: _omit, ...legacy } = emptyAccessGrantSnapshot();
    expect(aggregateAccessEntries(legacy)).toEqual([]);
  });
});
