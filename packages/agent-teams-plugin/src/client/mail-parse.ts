/**
 * Card-side parser for mail custom rows (design D4, D5): pure, no React, built on
 * core's `parseEnvelope` — it defines NO second grammar. Everything a card shows
 * (kind, sender, urgency, text) comes from the row body alone, because mail rows
 * carry no entry id and `details` never reaches the client.
 *
 * Only the FIRST line at offset 0 is read (anti-spoofing). The host keeps the
 * last 200 lines of a row and prefixes `«N earlier lines hidden»`; a body that
 * starts with that marker lost its envelope and is reported as `truncated`.
 * A sender outside core's member-name grammar or among its reserved names
 * (`system`, `all`, `user`) makes the whole body `unrecognised` — no sender is
 * ever named from it. Parse is O(n) in the body length.
 * See change: add-agent-teams-ui.
 */
import { MEMBER_NAME_REGEXP, RESERVED_MEMBER_NAMES } from "../shared/constants.js";
import { parseEnvelope } from "../shared/mail-format.js";

export type SenderRole = "lead" | "server" | "member";
export interface MailSender {
  role: SenderRole;
  name: string;
}

export type MailParse =
  | { type: "mail"; kind: string; sender: MailSender; urgent: boolean; /** Kind is in core's registry. */ known: boolean; /** Everything after the envelope line. */ text: string }
  | { type: "truncated"; /** Lines the host dropped. */ hidden: number; body: string }
  | { type: "unrecognised"; body: string };

const TRUNCATED_RE = /^«(\d+) earlier lines? hidden»(?:\n|$)/;

/** `lead` / `server` / a member name inside core's grammar; anything else is not a sender. */
function senderOf(name: string): MailSender | null {
  if (name === "lead") return { role: "lead", name };
  if (name === "server") return { role: "server", name };
  if (!MEMBER_NAME_REGEXP.test(name) || RESERVED_MEMBER_NAMES.includes(name)) return null;
  return { role: "member", name };
}

/** A `\r\n` after the header is a line break like `\n`; only the first line terminator is normalised. */
function normaliseFirstLineBreak(body: string): string {
  const nl = body.indexOf("\n");
  return nl > 0 && body.charCodeAt(nl - 1) === 13 ? body.slice(0, nl - 1) + body.slice(nl) : body;
}

export function parseMailBody(body: string): MailParse {
  if (typeof body !== "string") return { type: "unrecognised", body: "" };
  const cut = TRUNCATED_RE.exec(body);
  if (cut) return { type: "truncated", hidden: Number(cut[1]), body };
  const envelope = parseEnvelope(normaliseFirstLineBreak(body));
  const sender = envelope ? senderOf(envelope.sender) : null;
  if (!envelope || !sender) return { type: "unrecognised", body };
  return { type: "mail", kind: envelope.kind, sender, urgent: envelope.urgent, known: envelope.known, text: envelope.body };
}

export interface NoticeItem {
  head: string;
  /** Continuation lines, `│ ` stripped, rendered as an indented quoted block inside the item. */
  cont: string[];
}

/**
 * Notice body → items (design D4): a line starting `• ` begins an item, `│ ` lines
 * continue it, any other non-blank line is one legacy item. Without core's markers
 * every line is merely its own item — less accurate, never more trusted.
 */
export function parseNoticeItems(body: string): NoticeItem[] {
  const items: NoticeItem[] = [];
  for (const line of body.split("\n")) {
    const last = items[items.length - 1];
    if (line.startsWith("• ")) items.push({ head: line.slice(2), cont: [] });
    else if (line.startsWith("│ ") && last) last.cont.push(line.slice(2));
    else if (line.trim() !== "") items.push({ head: line, cont: [] });
  }
  return items;
}
