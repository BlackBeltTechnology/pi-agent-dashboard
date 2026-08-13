/**
 * Tests for TrustedNetworksSection logic, covering the behavior contracts
 * from openspec/changes/consolidate-trusted-networks/.
 *
 * The component's mutation logic is extracted into pure helpers for unit testing;
 * the wire-up between the component and the SettingsPanel config object is covered
 * by simulating the onChange callback path.
 */
import { describe, expect, it } from "vitest";
import {
  addTrustedEntry,
  removeTrustedEntry,
  shouldShowLegacyHint,
} from "../components/settings/SettingsPanel.js";
import { dedupeInterfaceOffers } from "../lib/gateway/gateway-config-ops.js";

describe("addTrustedEntry (Trusted Networks section — pure add logic)", () => {
  it("appends a trimmed CIDR entry", () => {
    expect(addTrustedEntry([], "192.168.1.0/24")).toEqual(["192.168.1.0/24"]);
  });

  it("appends a wildcard entry (task 3.3)", () => {
    expect(addTrustedEntry([], "10.0.0.*")).toEqual(["10.0.0.*"]);
  });

  it("appends an exact IP entry (task 3.3)", () => {
    expect(addTrustedEntry([], "192.168.1.50")).toEqual(["192.168.1.50"]);
  });

  it("trims whitespace before appending", () => {
    expect(addTrustedEntry([], "  10.0.0.5  ")).toEqual(["10.0.0.5"]);
  });

  it("rejects empty/whitespace-only input", () => {
    expect(addTrustedEntry(["10.0.0.5"], "")).toEqual(["10.0.0.5"]);
    expect(addTrustedEntry(["10.0.0.5"], "   ")).toEqual(["10.0.0.5"]);
  });

  it("does not duplicate an existing entry", () => {
    const current = ["192.168.1.0/24"];
    expect(addTrustedEntry(current, "192.168.1.0/24")).toBe(current);
  });

  it("preserves order when appending", () => {
    expect(addTrustedEntry(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });
});

describe("removeTrustedEntry (Trusted Networks section — pure remove logic, task 3.5)", () => {
  it("removes the matching entry only", () => {
    expect(removeTrustedEntry(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("no-op when entry is absent", () => {
    expect(removeTrustedEntry(["a", "b"], "missing")).toEqual(["a", "b"]);
  });

  it("removes all duplicates of the exact value (defensive)", () => {
    expect(removeTrustedEntry(["a", "a"], "a")).toEqual([]);
  });
});

describe("shouldShowLegacyHint (task 3.4)", () => {
  it("hint is visible when legacy trustedNetworks has entries", () => {
    expect(shouldShowLegacyHint(["192.168.1.0/24"])).toBe(true);
  });

  it("hint is hidden when legacy trustedNetworks is empty", () => {
    expect(shouldShowLegacyHint([])).toBe(false);
  });
});

/**
 * Integration-style: simulate the SettingsPanel wire-up to verify UI writes
 * target `auth.bypassHosts` and never touch top-level `trustedNetworks`.
 * This mirrors the onChange callback registered in SettingsPanel.tsx.
 */
describe("SettingsPanel → TrustedNetworksSection wire-up (tasks 3.2, 3.5)", () => {
  type Config = {
    auth?: { secret: string; providers: Record<string, unknown>; bypassHosts?: string[] };
    trustedNetworks?: string[];
  };

  /** Replicates the onChange handler from SettingsPanel Security tab. */
  function applyOnChange(config: Config, nets: string[]): Config {
    const next: Config = {
      ...config,
      auth: config.auth
        ? { ...config.auth, bypassHosts: nets }
        : { secret: "", providers: {}, bypassHosts: nets },
    };
    return next;
  }

  it("adding a CIDR writes to auth.bypassHosts, not top-level trustedNetworks (task 3.2)", () => {
    const before: Config = { trustedNetworks: [] };
    const after = applyOnChange(before, addTrustedEntry([], "192.168.1.0/24"));

    expect(after.auth?.bypassHosts).toEqual(["192.168.1.0/24"]);
    expect(after.trustedNetworks).toEqual([]);
  });

  it("removing an entry targets auth.bypassHosts and leaves trustedNetworks untouched (task 3.5)", () => {
    const before: Config = {
      auth: { secret: "", providers: {}, bypassHosts: ["192.168.1.0/24", "10.0.0.*"] },
      trustedNetworks: ["192.168.1.0/24"], // same entry lives in both (legacy)
    };

    const after = applyOnChange(
      before,
      removeTrustedEntry(before.auth!.bypassHosts!, "192.168.1.0/24"),
    );

    expect(after.auth?.bypassHosts).toEqual(["10.0.0.*"]);
    expect(after.trustedNetworks).toEqual(["192.168.1.0/24"]);
  });

  it("initializes auth if absent when first entry is added", () => {
    const before: Config = {};
    const after = applyOnChange(before, addTrustedEntry([], "10.0.0.5"));
    expect(after.auth).toBeDefined();
    expect(after.auth?.bypassHosts).toEqual(["10.0.0.5"]);
  });
});

/**
 * Task 3.6 — General-tab placement guard.
 * This is a static-source assertion: the SettingsPanel.tsx source must contain
 * exactly ONE TrustedNetworksSection invocation (on the Security tab) and
 * zero TrustedNetworksSection occurrences inside the General tab block.
 */
describe("SettingsPanel source layout (task 3.6)", () => {
  it("TrustedNetworksSection is invoked once in SettingsPanel.tsx", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const panelPath = path.resolve(here, "../components/settings/SettingsPanel.tsx");
    const source = fs.readFileSync(panelPath, "utf-8");

    // Count `<TrustedNetworksSection` JSX usages (not the `function` def or `export`).
    const matches = source.match(/<TrustedNetworksSection\b/g) || [];
    expect(matches).toHaveLength(1);

    // General page block: from `activeTab === "general"` to the next page
    // (`activeTab === "server"`). Assert no TrustedNetworksSection inside it.
    // See change: reorganize-settings-into-pages.
    const generalStart = source.indexOf('activeTab === "general"');
    const serverStart = source.indexOf('activeTab === "server"');
    expect(generalStart).toBeGreaterThan(-1);
    expect(serverStart).toBeGreaterThan(generalStart);
    const generalBlock = source.slice(generalStart, serverStart);
    expect(generalBlock).not.toMatch(/<TrustedNetworksSection\b/);
    expect(generalBlock).not.toMatch(/\+ Add Local Network/);

    // The old Security-tab textarea must be gone.
    expect(source).not.toMatch(/bypass-hosts-textarea/);
  });
});

// ── Dropdown offer rows (test-plan #E26–#E27) ─────────────────────────
// Deduplication is a DROPDOWN concern, keyed on the suggestion `value`.
// `/api/network-interfaces` must keep one entry per address — the
// listen-interface picker keys its options on `address`, so collapsing
// server-side would make a real bind address unselectable (Decision 12).
// See change: warn-unreachable-trusted-networks.
describe("dedupeInterfaceOffers (Add Local Network dropdown rows)", () => {
  it("#E26 collapses two NICs on one subnet into one row, labelled by the first", () => {
    const rows = dedupeInterfaceOffers([
      {
        name: "en0",
        label: "en0",
        suggestions: [{ value: "192.168.10.0/24", label: "interface subnet 192.168.10.0/24", wide: false }],
      },
      {
        name: "en7",
        label: "en7",
        suggestions: [{ value: "192.168.10.0/24", label: "interface subnet 192.168.10.0/24", wide: false }],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("192.168.10.0/24");
    expect(rows[0].label).toBe("en0");
  });

  it("#E27 collapses two /32 tunnels that both offer the CGNAT range", () => {
    const rows = dedupeInterfaceOffers([
      {
        name: "utun4",
        label: "tailnet",
        pointToPoint: true,
        suggestions: [{ value: "100.64.0.0/10", label: "tailnet CGNAT range", wide: true }],
      },
      {
        name: "utun6",
        label: "tailnet",
        pointToPoint: true,
        suggestions: [{ value: "100.64.0.0/10", label: "tailnet CGNAT range", wide: true }],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("100.64.0.0/10");
    expect(rows[0].wide).toBe(true);
  });

  it("offers nothing for a /32 interface with no derivable range (#F15 source data)", () => {
    const rows = dedupeInterfaceOffers([
      { name: "utun9", label: "utun9", pointToPoint: true, suggestions: [] },
    ]);
    expect(rows).toEqual([]);
  });
});
