import { describe, it, expect } from "vitest";
import {
  createSlotRegistry,
  forSession,
  forSessionRendered,
  forTab,
  forToolName,
  forCommand,
  type ClaimEntry,
} from "../slot-registry.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeClaim(
  pluginId: string,
  priority: number,
  slot: ClaimEntry["slot"] = "session-card-badge",
  extra: Partial<ClaimEntry> = {},
): ClaimEntry {
  return { pluginId, priority, slot, ...extra };
}

function fakeSession(id = "s1"): DashboardSession {
  return {
    id,
    cwd: "/home/user/repo",
    source: "tui",
    status: "active",
    startedAt: Date.now(),
  };
}

describe("createSlotRegistry", () => {
  it("returns empty array for unknown slot", () => {
    const r = createSlotRegistry();
    expect(r.getClaims("session-card-badge")).toEqual([]);
  });

  it("sorts by priority asc, then plugin id asc", () => {
    const r = createSlotRegistry();
    r.addClaim(makeClaim("z-plugin", 100));
    r.addClaim(makeClaim("a-plugin", 200));
    r.addClaim(makeClaim("m-plugin", 100));

    const claims = r.getClaims("session-card-badge");
    expect(claims.map(c => c.pluginId)).toEqual(["m-plugin", "z-plugin", "a-plugin"]);
  });

  it("sort is deterministic across two runs", () => {
    const buildRegistry = () => {
      const r = createSlotRegistry();
      r.addClaim(makeClaim("c", 50));
      r.addClaim(makeClaim("a", 100));
      r.addClaim(makeClaim("b", 100));
      return r.getClaims("session-card-badge").map(c => c.pluginId);
    };
    expect(buildRegistry()).toEqual(buildRegistry());
  });

  it("removeClaims removes all claims for that plugin", () => {
    const r = createSlotRegistry();
    r.addClaim(makeClaim("alpha", 100));
    r.addClaim(makeClaim("beta", 100));
    r.removeClaims("alpha");
    const claims = r.getClaims("session-card-badge");
    expect(claims).toHaveLength(1);
    expect(claims[0].pluginId).toBe("beta");
  });

  it("getAllClaims returns claims from all slots", () => {
    const r = createSlotRegistry();
    r.addClaim(makeClaim("a", 100, "session-card-badge"));
    r.addClaim(makeClaim("b", 100, "tool-renderer"));
    expect(r.getAllClaims()).toHaveLength(2);
  });
});

describe("forSession filter", () => {
  it("returns all claims when no predicate", () => {
    const claims = [makeClaim("a", 100), makeClaim("b", 200)];
    expect(forSession(claims, fakeSession())).toHaveLength(2);
  });

  it("filters by predicate", () => {
    const session = fakeSession();
    const claims = [
      { ...makeClaim("a", 100), predicate: (_: unknown) => true },
      { ...makeClaim("b", 200), predicate: (_: unknown) => false },
    ];
    expect(forSession(claims, session)).toHaveLength(1);
    expect(forSession(claims, session)[0].pluginId).toBe("a");
  });

  it("ignores shouldRender (only respects predicate)", () => {
    const session = fakeSession();
    const claims = [
      { ...makeClaim("a", 100), shouldRender: (_: unknown) => false },
      { ...makeClaim("b", 200) },
    ];
    // forSession is the structural variant — shouldRender does not affect it.
    expect(forSession(claims, session)).toHaveLength(2);
  });
});

describe("forSessionRendered filter", () => {
  it("returns all claims when neither predicate nor shouldRender declared", () => {
    const claims = [makeClaim("a", 100), makeClaim("b", 200)];
    expect(forSessionRendered(claims, fakeSession())).toHaveLength(2);
  });

  it("filters by predicate (same as forSession)", () => {
    const session = fakeSession();
    const claims = [
      { ...makeClaim("a", 100), predicate: (_: unknown) => true },
      { ...makeClaim("b", 200), predicate: (_: unknown) => false },
    ];
    expect(forSessionRendered(claims, session)).toHaveLength(1);
    expect(forSessionRendered(claims, session)[0].pluginId).toBe("a");
  });

  it("filters by shouldRender", () => {
    const session = fakeSession();
    const claims = [
      { ...makeClaim("a", 100), shouldRender: (_: unknown) => true },
      { ...makeClaim("b", 200), shouldRender: (_: unknown) => false },
    ];
    expect(forSessionRendered(claims, session)).toHaveLength(1);
    expect(forSessionRendered(claims, session)[0].pluginId).toBe("a");
  });

  it("applies BOTH predicate AND shouldRender", () => {
    const session = fakeSession();
    const claims = [
      {
        ...makeClaim("a", 100),
        predicate: (_: unknown) => true,
        shouldRender: (_: unknown) => true,
      },
      {
        ...makeClaim("b", 200),
        predicate: (_: unknown) => true,
        shouldRender: (_: unknown) => false,
      },
      {
        ...makeClaim("c", 300),
        predicate: (_: unknown) => false,
        shouldRender: (_: unknown) => true,
      },
    ];
    const result = forSessionRendered(claims, session);
    expect(result.map(c => c.pluginId)).toEqual(["a"]);
  });

  it("treats absent shouldRender as pass-through", () => {
    const session = fakeSession();
    const claims = [
      { ...makeClaim("a", 100), predicate: (_: unknown) => true },
      { ...makeClaim("b", 200) },
    ];
    expect(forSessionRendered(claims, session)).toHaveLength(2);
  });

  it("returns empty when every claim is gated out by shouldRender", () => {
    const session = fakeSession();
    const claims = [
      { ...makeClaim("a", 100), shouldRender: (_: unknown) => false },
      { ...makeClaim("b", 200), shouldRender: (_: unknown) => false },
    ];
    expect(forSessionRendered(claims, session)).toEqual([]);
  });
});

describe("forTab filter", () => {
  it("returns claims matching tab", () => {
    const claims = [
      { ...makeClaim("a", 100, "settings-section"), tab: "general" },
      { ...makeClaim("b", 100, "settings-section"), tab: "security" },
      { ...makeClaim("c", 100, "settings-section") }, // defaults to "general"
    ];
    const generalClaims = forTab(claims, "general");
    expect(generalClaims.map(c => c.pluginId)).toContain("a");
    expect(generalClaims.map(c => c.pluginId)).toContain("c");
    expect(generalClaims.map(c => c.pluginId)).not.toContain("b");
  });

  it("renders claims targeting a new page id on that page", () => {
    const claims = [
      { ...makeClaim("a", 100, "settings-section"), tab: "developer" },
    ];
    expect(forTab(claims, "developer").map(c => c.pluginId)).toContain("a");
    expect(forTab(claims, "general").map(c => c.pluginId)).not.toContain("a");
  });

  it("falls back unknown tab ids to general", () => {
    const claims = [
      { ...makeClaim("a", 100, "settings-section"), tab: "bogus" },
    ];
    // An id outside VALID_SETTINGS_TABS is treated as general.
    expect(forTab(claims, "general").map(c => c.pluginId)).toContain("a");
    expect(forTab(claims, "bogus").map(c => c.pluginId)).not.toContain("a");
  });
});

describe("forToolName filter", () => {
  it("returns claims matching toolName", () => {
    const claims = [
      { ...makeClaim("a", 100, "tool-renderer"), toolName: "Agent" },
      { ...makeClaim("b", 100, "tool-renderer"), toolName: "Bash" },
    ];
    const matches = forToolName(claims, "Agent");
    expect(matches).toHaveLength(1);
    expect(matches[0].pluginId).toBe("a");
  });
});

describe("forCommand filter", () => {
  it("returns claims matching command", () => {
    const claims = [
      { ...makeClaim("a", 100, "command-route"), command: "/specs" },
      { ...makeClaim("b", 100, "command-route"), command: "/archive" },
    ];
    expect(forCommand(claims, "/specs")).toHaveLength(1);
    expect(forCommand(claims, "/specs")[0].pluginId).toBe("a");
  });
});
