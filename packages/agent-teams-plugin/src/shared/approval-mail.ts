/**
 * Mail kinds of the templates-hooks change, registered through core's open
 * `registerMailKind` (design D8/D3): `plan_request`, `plan_decision` and
 * `hook_feedback` ride customType `agent-teams-approval`; the lead `playbook`
 * rides `agent-teams-playbook`. Both the server (which sends them) and the
 * bridge (which maps kind → `customType` when it delivers) must register them,
 * so each entry calls `registerApprovalMailKinds()`; it is idempotent.
 * See change: add-agent-teams-templates-hooks.
 */
import { registerMailKind } from "./mail-format.js";

export const CUSTOM_TYPE_APPROVAL = "agent-teams-approval";
export const CUSTOM_TYPE_PLAYBOOK = "agent-teams-playbook";

export const MAIL_KIND_PLAN_REQUEST = "plan_request";
export const MAIL_KIND_PLAN_DECISION = "plan_decision";
export const MAIL_KIND_HOOK_FEEDBACK = "hook_feedback";
export const MAIL_KIND_PLAYBOOK = "playbook";

/** Kind → customType, in registration order. */
export const APPROVAL_MAIL_KINDS: ReadonlyArray<readonly [kind: string, customType: string]> = [
  [MAIL_KIND_PLAN_REQUEST, CUSTOM_TYPE_APPROVAL],
  [MAIL_KIND_PLAN_DECISION, CUSTOM_TYPE_APPROVAL],
  [MAIL_KIND_HOOK_FEEDBACK, CUSTOM_TYPE_APPROVAL],
  [MAIL_KIND_PLAYBOOK, CUSTOM_TYPE_PLAYBOOK],
];

export function registerApprovalMailKinds(): void {
  for (const [kind, customType] of APPROVAL_MAIL_KINDS) registerMailKind(kind, customType);
}
