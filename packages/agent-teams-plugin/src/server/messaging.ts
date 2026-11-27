/**
 * `SendMessage` (tasks 6.1, 6.3, 6.7; design D5/D6/D13, spec agent-teams-messaging):
 * direct and lead-only broadcast mail, the size cap (code points), the per-sender
 * token bucket, the per-pair loop breaker, the lead-only urgent interrupt and the
 * edge rules (`self_message`, empty broadcast, `kind_reserved`). The sender is the
 * lane caller, never a payload field, so the envelope's `from` is server-verified.
 * A direct message is never coalesced and always wakes; to the lead it drains the
 * notice buffer first so ordering by mail id is preserved.
 * See change: add-agent-teams-core.
 */
import { LEAD_ADDRESS } from "../shared/constants.js";
import type { OpResult, SendMessageResult } from "../shared/protocol.js";
import { codePointLength, sanitizeText } from "../shared/text.js";
import type { Mail, Team } from "../shared/types.js";
import { isRecord, own } from "./args.js";
import type { ConfigReader } from "./config.js";
import type { MemberDriver } from "./driver.js";
import type { MailEngine } from "./mail.js";
import type { MailLimits } from "./mail-limits.js";
import { fail, isLive } from "./op-util.js";
import type { TeamStore } from "./store.js";
import type { LeadItem } from "./tasks.js";
import type { Telemetry } from "./telemetry.js";
import type { Logger } from "./types.js";

export interface MessagingDeps {
  store: TeamStore;
  config: ConfigReader;
  logger: Logger;
  telemetry: Telemetry;
  limits: MailLimits;
  engine: MailEngine;
  driverFor(team: Team): MemberDriver | undefined;
  mailTo(team: Team, to: string, input: { from: string; kind: string; text: string; wake: boolean; priority?: "normal" | "urgent"; details?: Record<string, unknown> }): Mail | undefined;
  notify(team: Team, item: LeadItem): void;
  /** Flush the lead's coalesced notices now (a waking direct message to the lead). */
  drainNotices(team: Team): void;
}

interface MessagingCaller {
  role: string;
  name: string;
  team?: Team;
}

const KIND_MESSAGE = "message";

export function createMessaging(deps: MessagingDeps) {
  const { store, config, logger, limits, engine } = deps;

  function limited(team: Team, sender: string, limit: "pair" | "bucket", message: string) {
    deps.telemetry.count(team.id, "rateLimited");
    logger.info(`agent-teams: rate_limited team=${team.id} sender=${sender} limit=${limit}`);
    return fail("rate_limited", message);
  }

  function sendMessage(raw: unknown, caller: MessagingCaller): OpResult<SendMessageResult> {
    const team = caller.team;
    if (!team) return fail("not_in_team");
    if (!isRecord(raw)) return fail("invalid_args", "args must be an object");
    const cfg = config();
    const isLead = caller.role === "lead";
    const sender = isLead ? LEAD_ADDRESS : caller.name;

    // A member request may only ever carry kind `message`: reserved/unknown kinds are refused before anything is created.
    if (Object.hasOwn(raw, "kind") && raw.kind !== KIND_MESSAGE) return fail("kind_reserved", "members send kind message only");
    const to = own(raw, "to");
    const message = own(raw, "message");
    const priority = own(raw, "priority");
    const summary = own(raw, "summary");
    if (typeof to !== "string" || to === "" || to.length > 100) return fail("invalid_args", "to must be a member name, lead or *");
    if (typeof message !== "string") return fail("invalid_args", "message must be a string");
    if (priority !== undefined && priority !== "normal" && priority !== "urgent") return fail("invalid_args", "priority must be normal or urgent");
    if (summary !== undefined && typeof summary !== "string") return fail("invalid_args", "summary must be a string");
    const urgent = priority === "urgent";
    if (urgent && !isLead) return fail("urgent_lead_only");

    // Size: reject cheaply before sanitising (a code point is at most 2 UTF-16 units), then count code points.
    if (message.length > cfg.maxMessageChars * 2) return fail("message_too_long", `at most ${cfg.maxMessageChars} characters`);
    const text = sanitizeText(message, { keepNewlines: true });
    if (codePointLength(text) > cfg.maxMessageChars) return fail("message_too_long", `at most ${cfg.maxMessageChars} characters`);
    if (text.trim() === "") return fail("invalid_args", "message must not be empty");

    // Recipients.
    let targets: string[];
    if (to === "*") {
      if (!isLead) return fail("broadcast_lead_only");
      if (urgent) return fail("invalid_args", "urgent cannot be broadcast");
      targets = team.members.filter(isLive).map((m) => m.name);
    } else if (to === sender) {
      return fail("self_message");
    } else if (to === LEAD_ADDRESS) {
      targets = [LEAD_ADDRESS];
    } else {
      const member = store.member(team, to);
      if (!member) return fail("unknown_recipient", to);
      if (!isLive(member)) return fail("member_gone", to);
      targets = [to];
    }
    if (targets.length === 0) return { ok: true, data: { mailIds: [], delivered: [], queued: [] } };

    // Limits: pair loop breaker (member ↔ member only), then the sender's token bucket (one token per call).
    const pair = !isLead && to !== LEAD_ADDRESS && to !== "*" ? ([sender, to] as const) : undefined;
    if (pair) {
      const verdict = limits.checkPair(team.id, pair[0], pair[1], cfg.pairExchangeLimit);
      if (verdict === "tripped") {
        deps.notify(team, { head: `${pair[0]} and ${pair[1]} exchanged ${cfg.pairExchangeLimit} mails with no task change in between; further mails between them are rate limited until the task list changes`, wake: false });
      }
      if (verdict !== "ok") return limited(team, sender, "pair", "too many mails between these two members without task progress");
    }
    if (!limits.takeToken(team.id, sender, cfg.mailRatePerMin)) return limited(team, sender, "bucket", `at most ${cfg.mailRatePerMin} messages per minute`);
    if (pair) limits.bumpPair(team.id, pair[0], pair[1]);

    // Create + hand over.
    let degraded: "urgent_as_steer" | undefined;
    let warning: string | undefined;
    const mails: Array<{ name: string; mail: Mail }> = [];
    const kind = to === "*" ? "broadcast" : KIND_MESSAGE;
    for (const name of targets) {
      if (urgent) {
        const d = interrupt(team, name);
        degraded = d?.degraded ?? degraded;
        warning = d?.warning ?? warning;
      }
      if (name === LEAD_ADDRESS) deps.drainNotices(team);
      const mail = deps.mailTo(team, name, {
        from: sender,
        kind,
        text,
        wake: true,
        ...(urgent ? { priority: "urgent" as const } : {}),
        ...(summary ? { details: { summary: sanitizeText(summary, { keepNewlines: false }).slice(0, 200) } } : {}),
      });
      if (mail) mails.push({ name, mail });
    }
    const delivered = mails.filter((m) => engine.isHandedOver(team.id, m.mail.id)).map((m) => m.name);
    const queued = mails.filter((m) => !engine.isHandedOver(team.id, m.mail.id)).map((m) => m.name);
    logger.info(`agent-teams: SendMessage ${sender} -> ${to} (${mails.length} mail(s), ${text.length} chars)`);
    return { ok: true, data: { mailIds: mails.map((m) => m.mail.id), delivered, queued, ...(degraded ? { degraded } : {}), ...(warning ? { warning } : {}) } };
  }

  /**
   * Urgent: abort a BUSY member's run and hold delivery until its settle report
   * (D6). Returns `urgent_as_steer` when the interrupt was unavailable (the mail
   * then goes out as a normal steer wake); an idle or unconnected recipient just
   * gets the plain wake mail.
   */
  function interrupt(team: Team, name: string): { degraded: "urgent_as_steer"; warning?: string } | undefined {
    const member = store.member(team, name);
    if (!member || member.status !== "busy") return undefined;
    const driver = deps.driverFor(team);
    const ref = { teamId: team.id, member: name, ...(member.sessionId ? { sessionId: member.sessionId } : {}) };
    const res = driver?.abort(ref) ?? { ok: false, reason: "no_driver" };
    if (!res.ok) {
      logger.warn(`agent-teams: urgent interrupt of ${name} unavailable (${res.reason ?? "unknown"}); delivering as a normal steer`);
      const warning = driver?.urgentDegraded?.(ref); // a driver may count the degradation and word the warning
      return { degraded: "urgent_as_steer", ...(warning ? { warning } : {}) };
    }
    deps.telemetry.count(team.id, "urgentAborts");
    engine.holdUrgent(team, name);
    return undefined;
  }

  return { sendMessage };
}
