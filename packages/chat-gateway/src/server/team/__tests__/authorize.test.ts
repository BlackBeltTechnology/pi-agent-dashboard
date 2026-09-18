/**
 * Tier authorization chokepoint (change: add-chat-gateway-team-controls).
 * Scenarios: E1–E8, E10–E13, P4, X12, X16.
 */
import { describe, expect, it } from "vitest";
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import {
  type AuthorizeInput,
  authorize,
  type BindingContext,
  type RefusalReason,
} from "../authorize.js";
import { CHAT_COMMAND_ALLOWLIST, NON_DELEGABLE, tierOfVerb, VERB_TIERS } from "../tier.js";

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
  it("3.1: every allowlisted command resolves to a tier in the shared table", () => {
    for (const verb of CHAT_COMMAND_ALLOWLIST) {
      expect(tierOfVerb(verb), verb).toBeDefined();
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
