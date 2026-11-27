/**
 * Templates-hooks contracts (tasks 1.5): the role/tool table, start ops kept out
 * of the agent tool surface, the new error vocabulary, the four mail kinds and
 * the persisted-type round trip is covered by `server/__tests__/store-persistence`.
 * See change: add-agent-teams-templates-hooks.
 */
import { describe, expect, it } from "vitest";
import { createTeamTools, TEAM_TOOL_NAMES } from "../../bridge/tools.js";
import {
  APPROVAL_MAIL_KINDS,
  CUSTOM_TYPE_APPROVAL,
  CUSTOM_TYPE_PLAYBOOK,
  registerApprovalMailKinds,
} from "../approval-mail.js";
import { customTypeForKind, formatEnvelope, isRegisteredMailKind, parseEnvelope } from "../mail-format.js";
import {
  CORE_TEAM_OPS,
  ERROR_CODES,
  HOOK_FEEDBACK_CODES,
  isStartOp,
  isTeamOp,
  LEAD_ONLY_OPS,
  LEAD_ONLY_TOOLS,
  LOCK_OPS,
  PLAN_OPS,
  START_OPS,
  TEAM_OPS,
  TEAM_TOOLS_BY_ROLE,
  TEMPLATE_ERROR_CODES,
} from "../protocol.js";

describe("role → tool table", () => {
  it("PlanSubmit is a teammate tool only; PlanDecision is a lead tool only", () => {
    expect(TEAM_TOOLS_BY_ROLE.member).toContain("PlanSubmit");
    expect(TEAM_TOOLS_BY_ROLE.member).not.toContain("PlanDecision");
    expect(TEAM_TOOLS_BY_ROLE.lead).toContain("PlanDecision");
    expect(TEAM_TOOLS_BY_ROLE.lead).not.toContain("PlanSubmit");
    expect(TEAM_TOOLS_BY_ROLE.plain).toEqual(["TeamCreate", "TeammateSpawn"]);
    expect(LEAD_ONLY_TOOLS).toContain("PlanDecision");
    expect(LEAD_ONLY_OPS).toContain("PlanDecision");
  });

  it("TEAM_OPS = core ops + plan ops + lock ops; every op has exactly one tool definition", () => {
    expect([...TEAM_OPS]).toEqual([...CORE_TEAM_OPS, ...PLAN_OPS, ...LOCK_OPS]);
    expect([...TEAM_TOOL_NAMES].sort()).toEqual([...TEAM_OPS].sort());
    const defs = createTeamTools({ call: async () => ({ ok: true, data: {} }) });
    expect(defs.map((d) => d.name).sort()).toEqual([...TEAM_OPS].sort());
  });

  it("team.start / team.templates are server ops, never agent tools", () => {
    expect([...START_OPS]).toEqual(["team.start", "team.templates"]);
    for (const op of START_OPS) {
      expect(isStartOp(op)).toBe(true);
      expect(isTeamOp(op)).toBe(false);
      for (const role of Object.values(TEAM_TOOLS_BY_ROLE)) expect(role as readonly string[]).not.toContain(op);
      expect(TEAM_TOOL_NAMES as readonly string[]).not.toContain(op);
    }
    expect(isStartOp("TeamCreate")).toBe(false);
  });
});

describe("tool schemas", () => {
  const defs = createTeamTools({ call: async () => ({ ok: true, data: {} }) });
  const schema = (name: string) => defs.find((d) => d.name === name)?.parameters as { properties: Record<string, unknown>; required?: string[] };
  const props = (name: string) => schema(name).properties;

  it("TeammateSpawn gains optional agent and requirePlanApproval", () => {
    expect(Object.keys(props("TeammateSpawn"))).toEqual(expect.arrayContaining(["agent", "requirePlanApproval"]));
    expect(schema("TeammateSpawn").required).toEqual(["name", "prompt"]);
  });

  it("PlanSubmit {plan} and PlanDecision {member, planId, approve, feedback?}", () => {
    expect(Object.keys(props("PlanSubmit"))).toEqual(["plan"]);
    expect(schema("PlanSubmit").required).toEqual(["plan"]);
    expect(Object.keys(props("PlanDecision")).sort()).toEqual(["approve", "feedback", "member", "planId"]);
    expect(schema("PlanDecision").required).toEqual(["member", "planId", "approve"]);
  });
});

describe("error vocabulary", () => {
  it("is unique and carries the codes of the four specs", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const c of [
      "hook_blocked", "hooks_untrusted", "hash_mismatch",
      "plan_not_required", "unknown_plan", "already_decided", "user_decision_required",
      "agent_not_found", "agent_untrusted", "agent_invalid", "tools_outside_template", "skills_outside_template",
      "template_invalid", "project_untrusted", "playbook_too_long", "cwd_required",
    ]) expect(ERROR_CODES, c).toContain(c);
  });

  it("template listing codes are unique and sorted; hook feedback tokens are not error codes", () => {
    expect(new Set(TEMPLATE_ERROR_CODES).size).toBe(TEMPLATE_ERROR_CODES.length);
    expect([...TEMPLATE_ERROR_CODES]).toEqual([...TEMPLATE_ERROR_CODES].sort());
    for (const c of ["template_too_large", "name_invalid", "frontmatter_invalid", "field_invalid", "hook_command_too_long", "duplicate_member", "roster_name_invalid"]) expect(TEMPLATE_ERROR_CODES).toContain(c);
    expect([...HOOK_FEEDBACK_CODES]).toEqual(["hook_busy", "hook_pending"]);
    for (const c of HOOK_FEEDBACK_CODES) expect(ERROR_CODES as readonly string[]).not.toContain(c);
  });
});

describe("mail kinds", () => {
  it("plan_request / plan_decision / hook_feedback ride agent-teams-approval; playbook rides agent-teams-playbook", () => {
    registerApprovalMailKinds();
    registerApprovalMailKinds(); // idempotent
    expect(CUSTOM_TYPE_APPROVAL).toBe("agent-teams-approval");
    expect(CUSTOM_TYPE_PLAYBOOK).toBe("agent-teams-playbook");
    expect(Object.fromEntries(APPROVAL_MAIL_KINDS)).toEqual({
      plan_request: "agent-teams-approval",
      plan_decision: "agent-teams-approval",
      hook_feedback: "agent-teams-approval",
      playbook: "agent-teams-playbook",
    });
    for (const [kind, customType] of APPROVAL_MAIL_KINDS) {
      expect(isRegisteredMailKind(kind), kind).toBe(true);
      expect(customTypeForKind(kind), kind).toBe(customType);
    }
  });

  it("the envelope helper builds and parses each kind as known", () => {
    registerApprovalMailKinds();
    for (const [kind] of APPROVAL_MAIL_KINDS) {
      const env = formatEnvelope({ kind, sender: "server" });
      expect(parseEnvelope(env)).toMatchObject({ kind, sender: "server", known: true });
    }
  });
});
