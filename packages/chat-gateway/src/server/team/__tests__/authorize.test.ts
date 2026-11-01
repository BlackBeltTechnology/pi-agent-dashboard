/**
 * Tier authorization chokepoint (change: add-chat-gateway-team-controls).
 * Scenarios: E1–E8, E10–E13, P4, X12, X16.
 */

import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { describe, expect, it, vi } from "vitest";
import {
  type AuthorizeInput,
  authorize,
  type BindingContext,
  type RefusalReason,
} from "../authorize.js";
import {
  CHAT_COMMAND_ALLOWLIST,
  CHAT_LOCAL_VERB_TIERS,
  NON_DELEGABLE,
  tierOfVerb,
  VERB_TIERS,
} from "../tier.js";

function binding(over: Partial<BindingContext> = {}): BindingContext {
  return {
    workspaceId: "ws_a",
    folders: ["/a"],
    principals: {},
    roles: {},
    ceiling: "operate",
    ...over,
  };
}

function run(over: Partial<AuthorizeInput>): AuthorizeInput & { result: ReturnType<typeof authorize> } {
  const input: AuthorizeInput = {
    author: { id: "u1" },
    channelId: "chan",
    binding: binding({ principals: { u1: "control" } }),
    verb: "send_prompt",
    ...over,
  };
  return { ...input, result: authorize(input) };
}

describe("verb allowlist coverage", () => {
  it("3.1: every allowlisted command resolves to a tier — shared table, or the chat-local one", () => {
    for (const verb of CHAT_COMMAND_ALLOWLIST) {
      expect(tierOfVerb(verb), verb).toBeDefined();
    }
  });

  it("3.1: the chat-local table never SHADOWS a platform verb", () => {
    // It exists for chat-ONLY verbs (`disarm`) that have no MCP counterpart, so
    // there is nothing for them to drift from. Re-declaring a PLATFORM verb here
    // would silently override the shared table — exactly the drift that reading
    // tiers from the manifest exists to prevent.
    for (const verb of CHAT_LOCAL_VERB_TIERS.keys()) {
      expect(VERB_TIERS.has(verb), verb).toBe(false);
    }
  });
});

describe("team authorize", () => {
  it("E1: identifier observe + role control → effective tier control", () => {
    const { result } = run({
      author: { id: "u1", roleIds: ["r1"] },
      binding: binding({ principals: { u1: "observe" }, roles: { r1: "control" } }),
    });
    expect(result).toMatchObject({ kind: "grant", tier: "control" });
  });

  it("E2: ceiling clamps operate down to control", () => {
    const { result } = run({
      binding: binding({ principals: { u1: "operate" }, ceiling: "control" }),
    });
    expect(result).toMatchObject({ kind: "grant", tier: "control" });
  });

  it("E3: default ceiling is observe → insufficient_tier", () => {
    const { result } = run({
      binding: binding({ principals: { u1: "operate" }, ceiling: undefined }),
    });
    expect(result).toEqual({ kind: "refusal", reason: "insufficient_tier", verb: "send_prompt" });
  });

  it("E4: a principal mapped on binding A gains nothing on binding B", () => {
    const { result } = run({ binding: binding({ principals: {} }) });
    expect(result).toMatchObject({ kind: "refusal", reason: "no_principal_mapping" });
  });

  it("E5: a fresh binding grants nobody, regardless of other bindings", () => {
    const other = { u1: "operate", u2: "operate", u3: "operate" };
    const fresh = binding({ principals: {} });
    for (const id of Object.keys(other)) {
      const r = authorize({ author: { id }, channelId: "new", binding: fresh, verb: "send_prompt" });
      expect(r).toMatchObject({ kind: "refusal", reason: "no_principal_mapping" });
    }
  });

  it("E6: seven refusal causes each report their own distinct reason", () => {
    const cases: Array<{ label: string; input: AuthorizeInput }> = [
      {
        label: "non_human_author",
        input: {
          author: { id: "u1", isBot: true },
          channelId: "c",
          binding: binding({ principals: { u1: "operate" } }),
          verb: "send_prompt",
        },
      },
      {
        label: "unbound_channel",
        input: { author: { id: "u1" }, channelId: "c", binding: undefined, verb: "send_prompt" },
      },
      {
        label: "no_principal_mapping",
        input: { author: { id: "u1" }, channelId: "c", binding: binding(), verb: "send_prompt" },
      },
      {
        label: "scope_violation",
        input: {
          author: { id: "u1" },
          channelId: "c",
          binding: binding({ principals: { u1: "control" } }),
          verb: "send_prompt",
          targetCwd: "/elsewhere/x",
        },
      },
      {
        label: "disarmed",
        input: {
          author: { id: "u1" },
          channelId: "c",
          binding: binding({ principals: { u1: "control" } }),
          verb: "send_prompt",
          disarmed: true,
        },
      },
      {
        label: "non_delegable_verb",
        input: {
          author: { id: "u1" },
          channelId: "c",
          binding: binding({ principals: { u1: "operate" } }),
          verb: "mint_device_token",
        },
      },
      {
        label: "insufficient_tier",
        input: {
          author: { id: "u1" },
          channelId: "c",
          binding: binding({ principals: { u1: "observe" } }),
          verb: "send_prompt",
        },
      },
    ];
    const reasons = cases.map((c) => {
      const r = authorize(c.input);
      expect(r.kind, c.label).toBe("refusal");
      return (r as { reason: RefusalReason }).reason;
    });
    for (let i = 0; i < cases.length; i++) expect(reasons[i], cases[i].label).toBe(cases[i].label);
    expect(new Set(reasons).size).toBe(7);
  });

  it("E7: a bot author whose id matches a principal is still refused", () => {
    const { result } = run({
      author: { id: "u1", isBot: true },
      binding: binding({ principals: { u1: "operate" } }),
    });
    expect(result).toMatchObject({ kind: "refusal", reason: "non_human_author" });
  });

  it("E8: a webhook author is refused", () => {
    const { result } = run({
      author: { id: "u1", isWebhook: true },
      binding: binding({ principals: { u1: "operate" } }),
    });
    expect(result).toMatchObject({ kind: "refusal", reason: "non_human_author" });
  });

  it("E10: the verb tier is READ from the shared table, not declared", () => {
    const table = new Map<string, Tier>(VERB_TIERS);
    table.set("resume_session", "operate");
    const { result } = run({
      author: { id: "u1" },
      binding: binding({ principals: { u1: "control" } }),
      verb: "resume_session",
      verbTiers: table,
    });
    expect(result).toMatchObject({ kind: "refusal", reason: "insufficient_tier" });
  });

  it("E11: a verb outside the curated allowlist is refused even at operate", () => {
    const { result } = run({
      binding: binding({ principals: { u1: "operate" } }),
      verb: "shutdown_server",
    });
    expect(result).toMatchObject({ kind: "refusal", reason: "verb_not_allowlisted" });
  });

  it("E12: an allowlisted verb with no tier row is refused with no tier inferred", () => {
    const { result } = run({
      binding: binding({ principals: { u1: "operate" } }),
      verb: "ghost_verb",
      allowlist: ["ghost_verb"],
    });
    expect(result).toMatchObject({ kind: "refusal", reason: "verb_unknown_tier" });
  });

  it("E13: every non-delegable verb is refused at operate", () => {
    for (const verb of NON_DELEGABLE) {
      const { result } = run({
        binding: binding({ principals: { u1: "operate" } }),
        verb,
      });
      expect(result, verb).toMatchObject({ kind: "refusal", reason: "non_delegable_verb" });
    }
  });

  it("X12: a target session outside the binding's workspace refuses scope_violation", () => {
    const { result } = run({
      binding: binding({ principals: { u1: "control" }, folders: ["/a"] }),
      verb: "send_prompt",
      targetCwd: "/b/session",
    });
    expect(result).toMatchObject({ kind: "refusal", reason: "scope_violation" });
  });

  it("X12b: a target inside the workspace grants", () => {
    const { result } = run({
      binding: binding({ principals: { u1: "control" }, folders: ["/a"] }),
      verb: "send_prompt",
      targetCwd: "/a/project",
    });
    expect(result).toMatchObject({ kind: "grant" });
  });

  it("X16: removing the granting role between requests re-resolves on the next call", () => {
    const b = binding({ principals: {}, roles: { r1: "control" } });
    const author = { id: "u1", roleIds: ["r1"] };
    const first = authorize({ author, channelId: "c", binding: b, verb: "send_prompt" });
    expect(first).toMatchObject({ kind: "grant" });
    const second = authorize({
      author: { id: "u1", roleIds: [] },
      channelId: "c",
      binding: b,
      verb: "send_prompt",
    });
    expect(second).toMatchObject({ kind: "refusal", reason: "no_principal_mapping" });
  });

  it("X28: an untiered user's explicit pull is refused", () => {
    const { result } = run({
      author: { id: "nobody" },
      binding: binding({ principals: {} }),
      verb: "get_session_diff",
    });
    expect(result).toMatchObject({ kind: "refusal", reason: "no_principal_mapping" });
  });

  it("X29: a control principal's explicit pull is granted (tier-gated, not filter-gated)", () => {
    const { result } = run({
      author: { id: "u1" },
      binding: binding({ principals: { u1: "control" } }),
      verb: "get_session_diff",
    });
    expect(result).toMatchObject({ kind: "grant" });
  });

  it("P4: 10k sequential authorizations over 50 principals × 20 roles, p95 < 1ms", () => {
    const principals: Record<string, Tier> = {};
    for (let i = 0; i < 50; i++) principals[`u${i}`] = "control";
    const roles: Record<string, "observe" | "control"> = {};
    for (let i = 0; i < 20; i++) roles[`r${i}`] = "control";
    const b = binding({ principals, roles });
    const authors = Array.from({ length: 50 }, (_, i) => ({
      id: `u${i}`,
      roleIds: Array.from({ length: 20 }, (_, j) => `r${j}`),
    }));

    const times: number[] = [];
    for (let n = 0; n < 10_000; n++) {
      const t0 = performance.now();
      authorize({ author: authors[n % 50], channelId: "c", binding: b, verb: "send_prompt" });
      times.push(performance.now() - t0);
    }
    times.sort((a, b2) => a - b2);
    const p95 = times[Math.floor(0.95 * times.length)];
    expect(p95).toBeLessThan(1);
  });
});

// See change: close-security-map-high-findings (D2, test-plan #E52, #E53, #E54):
// `prompt_response` left the generated MCP table, so chat answers resolve from the
// chat-local table at the dashboard's WS tier (control).
describe("D2 — chat prompt_response resolves from the chat-local table", () => {
  it("E52: observe refused insufficient_tier; control and operate permitted; never verb_unknown_tier", () => {
    expect(VERB_TIERS.has("prompt_response")).toBe(false);
    for (const [tier, kind] of [
      ["observe", "refusal"],
      ["control", "grant"],
      ["operate", "grant"],
    ] as const) {
      const { result } = run({
        verb: "prompt_response",
        binding: binding({ principals: { u1: tier } }),
      });
      expect(result.kind, tier).toBe(kind);
      if (result.kind === "refusal") {
        expect(result.reason).toBe("insufficient_tier");
        expect(result.reason).not.toBe("verb_unknown_tier");
      }
    }
    expect(CHAT_COMMAND_ALLOWLIST).toContain("prompt_response");
  });

  it("E54: only the chat-local table has prompt_response; the other chat-local verbs are unchanged", () => {
    expect(CHAT_LOCAL_VERB_TIERS.has("prompt_response")).toBe(true);
    expect(VERB_TIERS.has("prompt_response")).toBe(false);
    for (const verb of CHAT_LOCAL_VERB_TIERS.keys()) expect(VERB_TIERS.has(verb), verb).toBe(false);
    expect(CHAT_LOCAL_VERB_TIERS.get("disarm")).toBe("observe");
    expect(CHAT_LOCAL_VERB_TIERS.get("attach_session")).toBe("observe");
    expect(CHAT_LOCAL_VERB_TIERS.get("close_session")).toBe("control");
    expect([...CHAT_LOCAL_VERB_TIERS.keys()].sort()).toEqual(
      ["attach_session", "close_session", "disarm", "prompt_response"].sort(),
    );
  });

  describe("E53: the chat-local tier tracks WS_MESSAGE_TIERS, not a literal", () => {
    async function tierWith(table: Record<string, Tier>): Promise<Tier | undefined> {
      vi.resetModules();
      vi.doMock("@blackbelt-technology/pi-dashboard-shared/ws-message-tiers.js", async () => {
        const actual = await vi.importActual<typeof import("@blackbelt-technology/pi-dashboard-shared/ws-message-tiers.js")>(
          "@blackbelt-technology/pi-dashboard-shared/ws-message-tiers.js",
        );
        return {
          ...actual,
          wsMessageTier: (type: string): Tier => (Object.hasOwn(table, type) ? table[type]! : "operate"),
        };
      });
      try {
        const mod = await import("../tier.js");
        return mod.tierOfVerb("prompt_response");
      } finally {
        vi.doUnmock("@blackbelt-technology/pi-dashboard-shared/ws-message-tiers.js");
        vi.resetModules();
      }
    }

    it("follows a mocked operate / observe row", async () => {
      expect(await tierWith({ prompt_response: "operate" })).toBe("operate");
      expect(await tierWith({ prompt_response: "observe" })).toBe("observe");
    });

    it("a removed row fails closed to operate", async () => {
      expect(await tierWith({})).toBe("operate");
    });

    it("the real table says control today", () => {
      expect(tierOfVerb("prompt_response")).toBe("control");
    });
  });
});
