/**
 * Task 8.5 / scenario F6 — configuration is editable ONLY from the dashboard.
 *
 * Every configuration-mutating verb must be refused at EVERY tier, because the
 * config surface is the only writer. The mechanism is the chat-command
 * allowlist: a verb that is not on it can never reach an action, whatever the
 * caller's tier.
 */
import { describe, expect, it } from "vitest";
import { createCommandLog } from "../team/audit.js";
import { createTeamController } from "../team/controller.js";
import { validateTeamControls } from "../team/team-config.js";
import { CHAT_COMMAND_ALLOWLIST, VERB_TIERS } from "../team/tier.js";

/**
 * Verbs that change providers, packages, plugins or gateway settings. Spelled
 * out because the assertion is "THIS verb is refused" — deriving the list from
 * "not allowlisted" would make the test pass even if every config verb started
 * out allowlisted.
 */
const CONFIG_MUTATING = [
  "set_config",
  "set_openspec_config",
  "set_providers",
  "install_package",
  "update_package",
  "remove_package",
  "packages_move",
  "packages_reset_to_npm",
  "config_auth_providers_id",
  "config_plugins_id",
];

/**
 * The two independent gates a config verb can trip, in the order they run:
 * `non_delegable_verb` (the verb is never delegable to chat at all) is checked
 * BEFORE `verb_not_allowlisted` (the verb is delegable, just not from chat).
 * Both are refusals; asserting only one would encode a gate ORDER as policy.
 */
const CONFIG_REFUSAL_REASONS = ["non_delegable_verb", "verb_not_allowlisted"];

/** One principal per tier, so "at any tier" is actually enumerated. */
const PRINCIPALS: Array<[string, string]> = [
  ["u_observer", "observe"],
  ["u_controller", "control"],
  ["u_operator", "operate"],
];

const WORKSPACES = [{ id: "ws_1", name: "One", folders: ["/srv/ok/proj"] }];

function makeTeam() {
  const parsed = validateTeamControls({
    bindings: {
      ws_1: { principals: Object.fromEntries(PRINCIPALS), mirrorLevel: "names-only" },
    },
    ceiling: "operate",
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const log = createCommandLog({ limit: 100 });
  const team = createTeamController({
    config: () => parsed.value,
    log,
    listWorkspaces: () => WORKSPACES,
    channelBindings: () => new Map([["chan1", "ws_1"]]),
  });
  return { team, log };
}

describe("configuration immutability from chat (8.5, F6)", () => {
  it("does not allowlist any configuration-mutating verb", () => {
    for (const verb of CONFIG_MUTATING) {
      expect(CHAT_COMMAND_ALLOWLIST).not.toContain(verb);
    }
  });

  it("knows every config-mutating verb in the shared tier table", () => {
    // Guards the test against going VACUOUS: a renamed verb would still be
    // refused, but for the wrong reason (`verb_unknown_tier`), and the
    // assertions below would then be testing a typo instead of a policy.
    for (const verb of CONFIG_MUTATING) {
      expect(VERB_TIERS.get(verb), `${verb} is missing from the tier table`).toBeDefined();
    }
  });

  it("refuses every configuration-mutating verb at every tier", () => {
    const { team } = makeTeam();
    for (const verb of CONFIG_MUTATING) {
      for (const [id] of PRINCIPALS) {
        const result = team.authorizeRequest({ author: { id }, channelId: "chan1", verb });
        expect(result.kind, `${verb} as ${id}`).toBe("refusal");
        // A SPECIFIC config-refusal reason, so a pass cannot come from an
        // unrelated failure (an unbound channel, a disarm, a typo'd verb).
        if (result.kind === "refusal") {
          expect(CONFIG_REFUSAL_REASONS, `${verb} as ${id} → ${result.reason}`).toContain(
            result.reason,
          );
        }
      }
    }
  });

  it("records each refused attempt with its reason, so the attempt is auditable", () => {
    const { team, log } = makeTeam();
    team.authorizeRequest({ author: { id: "u_operator" }, channelId: "chan1", verb: "set_config" });
    team.authorizeRequest({ author: { id: "u_observer" }, channelId: "chan1", verb: "set_providers" });
    const attempted = log.entries().filter((e) => CONFIG_MUTATING.includes(e.verb));
    expect(attempted).toHaveLength(2);
    expect(attempted.every((e) => e.outcome === "refused")).toBe(true);
    // `set_providers` is never delegable, so it stops at the earlier gate.
    expect(attempted.map((e) => e.reason)).toEqual(["verb_not_allowlisted", "non_delegable_verb"]);
    expect(attempted.every((e) => CONFIG_REFUSAL_REASONS.includes(e.reason ?? ""))).toBe(true);
  });

  it("marks the non-delegable config verbs as never delegable", () => {
    // `set_providers` / `install_package` are refused for a stronger reason
    // than "not allowlisted": no tier can ever be granted them.
    const { team } = makeTeam();
    const NON_DELEGABLE_CONFIG = ["set_providers", "install_package"];
    for (const verb of NON_DELEGABLE_CONFIG) {
      for (const [id] of PRINCIPALS) {
        const result = team.authorizeRequest({ author: { id }, channelId: "chan1", verb });
        expect(result, `${verb} as ${id}`).toMatchObject({
          kind: "refusal",
          reason: "non_delegable_verb",
        });
      }
    }
  });

  it("refuses a config verb even for an operate principal inside its own workspace", () => {
    // The strongest case: correct tier, correct scope, correct channel — and
    // still refused, because the ACTION is not delegable to chat at all.
    const { team } = makeTeam();
    const result = team.authorizeRequest({
      author: { id: "u_operator" },
      channelId: "chan1",
      verb: "set_config",
      targetCwd: "/srv/ok/proj",
    });
    expect(result).toMatchObject({ kind: "refusal", reason: "verb_not_allowlisted" });
  });

  it("still grants an allowlisted read verb, so the refusal is about the verb", () => {
    // Non-vacuity in the other direction: the chokepoint is not simply inert.
    const { team } = makeTeam();
    const result = team.authorizeRequest({
      author: { id: "u_observer" },
      channelId: "chan1",
      verb: "list_sessions",
    });
    expect(result.kind).toBe("grant");
  });
});
