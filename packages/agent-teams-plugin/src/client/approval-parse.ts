/**
 * Card-side parser of the approval and playbook mail rows (pure, no React). Built
 * on `parseMailBody` (core's envelope, first line at offset 0), it reads ONLY the
 * server-built header line directly after the envelope:
 *   `plan <id> · team <teamId> · member <name>`      (kind `plan_request`)
 *   first two lines `template <name>` / `goal <text>`  (kind `playbook`)
 * Plan text, decision text and hook feedback are free text written by peers or
 * hooks: they are never parsed again, so a forged header-like line inside them
 * (line 5 of a plan, a goal) can never change which plan a button posts. Ids and
 * names are validated against the core grammar before any control is offered.
 * See change: add-agent-teams-templates-hooks (design D11).
 */

import { MAIL_KIND_HOOK_FEEDBACK, MAIL_KIND_PLAN_DECISION, MAIL_KIND_PLAN_REQUEST, MAIL_KIND_PLAYBOOK } from "../shared/approval-mail.js";
import { MEMBER_NAME_REGEXP, RESERVED_MEMBER_NAMES } from "../shared/constants.js";
import { type MailSender, parseMailBody } from "./mail-parse.js";

export interface PlanRef {
  planId: string;
  teamId: string;
  member: string;
}

const PLAN_ID_RE = /^p[0-9]{1,9}$/;
/** Core team ids are `t_<hex>`; the grammar here is a conservative superset (no `·`, space, newline, markup). */
const TEAM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const PLAN_HEADER_RE = /^plan (\S+) · team (\S+) · member (\S+)$/u;

/** First line of `text` without its terminator, and the rest after it. */
function splitFirstLine(text: string): { first: string; rest: string } {
  const nl = text.indexOf("\n");
  if (nl === -1) return { first: text.replace(/\r$/, ""), rest: "" };
  return { first: text.slice(0, nl).replace(/\r$/, ""), rest: text.slice(nl + 1) };
}

const isMemberName = (name: string): boolean => MEMBER_NAME_REGEXP.test(name) && !RESERVED_MEMBER_NAMES.includes(name);

/** The plan reference of the header line, or `null` when it is absent or out of grammar. */
export function parsePlanHeader(line: string): PlanRef | null {
  const m = PLAN_HEADER_RE.exec(line);
  if (!m) return null;
  const [, planId, teamId, member] = m as unknown as [string, string, string, string];
  if (!PLAN_ID_RE.test(planId) || !TEAM_ID_RE.test(teamId) || !isMemberName(member)) return null;
  return { planId, teamId, member };
}

export type ApprovalParse =
  | { type: "plan_request"; sender: MailSender; urgent: boolean; /** `null`: header unreadable → text only, no controls. */ ref: PlanRef | null; /** The plan text (after the header line). */ text: string }
  | { type: "plan_decision"; sender: MailSender; urgent: boolean; text: string }
  | { type: "hook_feedback"; sender: MailSender; urgent: boolean; text: string }
  | { type: "generic"; kind: string; sender: MailSender; urgent: boolean; text: string }
  | { type: "truncated"; body: string }
  | { type: "unrecognised"; body: string };

/** Drop blank lines between the header and the text. */
const stripLeadingBlank = (s: string): string => s.replace(/^(?:[ \t]*\r?\n)+/, "");

export function parseApprovalBody(body: string): ApprovalParse {
  const mail = parseMailBody(body);
  if (mail.type === "truncated") return { type: "truncated", body: mail.body };
  if (mail.type === "unrecognised") return { type: "unrecognised", body: mail.body };
  const { sender, urgent } = mail;
  if (mail.kind === MAIL_KIND_PLAN_REQUEST) {
    const { first, rest } = splitFirstLine(mail.text);
    const ref = parsePlanHeader(first);
    // The envelope sender is server-verified: a member's request must name that member.
    const consistent = ref !== null && (sender.role !== "member" || sender.name === ref.member);
    return consistent ? { type: "plan_request", sender, urgent, ref, text: stripLeadingBlank(rest) } : { type: "plan_request", sender, urgent, ref: null, text: mail.text };
  }
  if (mail.kind === MAIL_KIND_PLAN_DECISION) return { type: "plan_decision", sender, urgent, text: mail.text };
  if (mail.kind === MAIL_KIND_HOOK_FEEDBACK) return { type: "hook_feedback", sender, urgent, text: mail.text };
  return { type: "generic", kind: mail.kind, sender, urgent, text: mail.text };
}

export interface PlaybookParse {
  template: string;
  goal: string;
}

const LABELLED = (label: string): RegExp => new RegExp(`^${label}(?::\\s*|\\s+)(.*)$`, "iu");
const TEMPLATE_LINE = LABELLED("template");
const GOAL_LINE = LABELLED("goal");

/** Template and goal from the first two body lines of a `playbook` mail; `null` for any other row. */
export function parsePlaybookBody(body: string): PlaybookParse | null {
  const mail = parseMailBody(body);
  if (mail.type !== "mail" || mail.kind !== MAIL_KIND_PLAYBOOK) return null;
  const { first, rest } = splitFirstLine(mail.text);
  const second = splitFirstLine(rest).first;
  const template = (TEMPLATE_LINE.exec(first)?.[1] ?? first).trim();
  const goal = (GOAL_LINE.exec(second)?.[1] ?? second).trim();
  return template === "" ? null : { template, goal };
}
