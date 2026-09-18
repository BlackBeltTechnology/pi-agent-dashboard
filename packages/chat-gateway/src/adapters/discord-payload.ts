/**
 * Pure Discord payload mapping — NO `discord.js` import, no I/O, no state that
 * touches the network. Everything here is a data transform, so the interactive
 * contract can be unit-tested without a Discord connection (test-plan F1–F7).
 *
 * The transport (`discord.ts`) turns a `DiscordControlSpec` into real builders;
 * this module decides WHAT to render and owns the custom_id codec + the
 * 2000-char chunker.
 *
 * See change: add-chat-gateway.
 */

import type { InteractivePrompt } from "./base.js";

// ── Control spec ──────────────────────────────────────────────────────────

type DiscordInteractiveKind = "buttons" | "string-select" | "modal" | "message";

export interface DiscordControlSpec {
  kind: DiscordInteractiveKind;
  /** Text posted with (or instead of) the control. Always non-empty. */
  content: string;
  rows?: Array<
    Array<{
      label: string;
      value: string;
      style: "primary" | "secondary" | "success" | "danger";
      customId: string;
    }>
  >;
  modal?: {
    customId: string;
    title: string;
    inputs: Array<{
      customId: string;
      label: string;
      style: "short" | "paragraph";
      required: boolean;
      placeholder?: string;
      prefill?: string;
    }>;
  };
  select?: {
    customId: string;
    placeholder?: string;
    options: Array<{ label: string; value: string }>;
    min: number;
    max: number;
  };
}

// ── Discord platform limits ───────────────────────────────────────────────

const DISCORD_MESSAGE_LIMIT = 2000;
/** Discord rejects a select menu with more than 25 options. */
const DISCORD_SELECT_MAX_OPTIONS = 25;
/** Discord rejects a custom_id longer than 100 characters. */
export const DISCORD_CUSTOM_ID_LIMIT = 100;

const LABEL_LIMIT = 80;
const MODAL_TITLE_LIMIT = 45;
const INPUT_LABEL_LIMIT = 45;

function clamp(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

// ── custom_id codec ───────────────────────────────────────────────────────
//
// Scheme (documented, round-trippable, length-safe):
//
//   inline:  p1|<requestId>|<kind>|<subIndex?>|<value>
//   memo:    p2|<token>
//
// Fields are escaped (`%` → `%25`, `|` → `%7C`) so the separator is
// unambiguous. The inline form is used whenever it fits in Discord's 100-char
// custom_id budget. When it does not (a 32-char requestId plus a long option
// value blows the budget), the record is stored in a bounded in-process memo
// under a short deterministic token and only the token travels to Discord —
// so `parseCustomId(customIdFor(...))` still round-trips the FULL value
// instead of silently truncating it. The memo is process-local and bounded
// (FIFO, `MEMO_MAX`), which is sound because a custom_id only has to survive
// as long as the prompt it belongs to.

const INLINE_PREFIX = "p1";
const MEMO_PREFIX = "p2";
const MEMO_MAX = 1000;

export interface ParsedCustomId {
  requestId: string;
  kind: string;
  value: string;
  subIndex?: number;
}

const memo = new Map<string, ParsedCustomId>();

function enc(field: string): string {
  return field.replace(/%/g, "%25").replace(/\|/g, "%7C");
}

function dec(field: string): string {
  return field.replace(/%7C/g, "|").replace(/%25/g, "%");
}

/** FNV-1a (32-bit), base36 — short, deterministic, dependency-free. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function sameRecord(a: ParsedCustomId, b: ParsedCustomId): boolean {
  return (
    a.requestId === b.requestId &&
    a.kind === b.kind &&
    a.value === b.value &&
    a.subIndex === b.subIndex
  );
}

function memoize(record: ParsedCustomId): string {
  const base = hash(
    `${record.requestId}\u0000${record.kind}\u0000${record.subIndex ?? ""}\u0000${record.value}`,
  );
  let token = base;
  let n = 0;
  // Collision-safe: a different record never reuses a taken token.
  for (;;) {
    const existing = memo.get(token);
    if (!existing || sameRecord(existing, record)) break;
    n++;
    token = `${base}${n}`;
  }
  memo.set(token, record);
  if (memo.size > MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined && oldest !== token) memo.delete(oldest);
  }
  return token;
}

export function customIdFor(
  requestId: string,
  kind: string,
  value: string,
  subIndex?: number,
): string {
  const inline = [
    INLINE_PREFIX,
    enc(requestId),
    enc(kind),
    subIndex === undefined ? "" : String(subIndex),
    enc(value),
  ].join("|");
  if (inline.length <= DISCORD_CUSTOM_ID_LIMIT) return inline;
  return `${MEMO_PREFIX}|${memoize({ requestId, kind, value, subIndex })}`;
}

export function parseCustomId(customId: string): ParsedCustomId | null {
  if (!customId) return null;
  const parts = customId.split("|");
  if (parts[0] === MEMO_PREFIX) {
    if (parts.length !== 2) return null;
    const record = memo.get(parts[1]);
    return record ? { ...record } : null;
  }
  if (parts[0] !== INLINE_PREFIX || parts.length !== 5) return null;
  const [, requestId, kind, sub, value] = parts;
  const parsed: ParsedCustomId = {
    requestId: dec(requestId),
    kind: dec(kind),
    value: dec(value),
  };
  if (sub !== "") {
    const n = Number(sub);
    if (!Number.isInteger(n)) return null;
    parsed.subIndex = n;
  }
  return parsed;
}

// ── Prompt → control mapping ──────────────────────────────────────────────

function body(prompt: InteractivePrompt): string {
  const title = prompt.title || prompt.message || "";
  const message = prompt.message && prompt.message !== title ? `\n\n_${prompt.message}_` : "";
  return `**${title}**${message}`;
}

function notifyPrefix(prompt: InteractivePrompt): string {
  switch (prompt.notifyType) {
    case "warning":
      return "⚠️";
    case "error":
      return "❌";
    default:
      return "ℹ️";
  }
}

function asMessage(content: string): DiscordControlSpec {
  return { kind: "message", content: content || "…" };
}

function listedOptions(prompt: InteractivePrompt): string {
  const options = prompt.options ?? [];
  const numbered = options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");
  return `${body(prompt)}\n\n${numbered}\n\n_Reply with the number of your choice._`;
}

function modalSpec(prompt: InteractivePrompt, style: "short" | "paragraph"): DiscordControlSpec {
  return {
    kind: "modal",
    content: body(prompt),
    modal: {
      customId: customIdFor(prompt.requestId, "modal", prompt.method),
      title: clamp(prompt.title || "Input", MODAL_TITLE_LIMIT),
      inputs: [
        {
          customId: customIdFor(prompt.requestId, "modal-input", "value"),
          label: clamp(prompt.title || "Value", INPUT_LABEL_LIMIT),
          style,
          required: false,
          ...(prompt.placeholder ? { placeholder: clamp(prompt.placeholder, LABEL_LIMIT) } : {}),
          ...(prompt.prefill ? { prefill: prompt.prefill } : {}),
        },
      ],
    },
  };
}

/**
 * Map a platform-agnostic prompt onto the Discord control that fits it.
 * NEVER throws: an unmappable prompt degrades to a plain-text message, so an
 * unknown pi prompt method can never take the gateway down.
 */
export function toDiscordControl(prompt: InteractivePrompt): DiscordControlSpec {
  switch (prompt.method) {
    case "select": {
      const options = prompt.options ?? [];
      // No options at all, or more than Discord allows: degrade to text rather
      // than silently dropping choices the user would then never see.
      if (options.length === 0 || options.length > DISCORD_SELECT_MAX_OPTIONS) {
        return asMessage(options.length === 0 ? body(prompt) : listedOptions(prompt));
      }
      return {
        kind: "string-select",
        content: body(prompt),
        select: {
          customId: customIdFor(prompt.requestId, "select", "menu"),
          ...(prompt.placeholder ? { placeholder: clamp(prompt.placeholder, LABEL_LIMIT) } : {}),
          options: options.map((opt, i) => ({
            label: clamp(opt, LABEL_LIMIT),
            value: customIdFor(prompt.requestId, "select-option", opt, i),
          })),
          min: 1,
          max: 1,
        },
      };
    }
    case "confirm":
      return {
        kind: "buttons",
        content: body(prompt),
        rows: [
          [
            {
              label: "Yes",
              value: "yes",
              style: "primary",
              customId: customIdFor(prompt.requestId, "confirm", "yes"),
            },
            {
              label: "No",
              value: "no",
              style: "secondary",
              customId: customIdFor(prompt.requestId, "confirm", "no"),
            },
          ],
        ],
      };
    case "input":
      return modalSpec(prompt, "short");
    case "editor":
      return modalSpec(prompt, "paragraph");
    case "notify":
      return asMessage(`${notifyPrefix(prompt)} ${prompt.message || prompt.title}`.trim());
    default:
      // setStatus / setWidget / setTitle / set_editor_text and anything pi adds
      // later: plain text, never an exception.
      return asMessage(
        `${notifyPrefix(prompt)} ${prompt.message || prompt.title || prompt.method}`.trim(),
      );
  }
}

// ── Chunking ──────────────────────────────────────────────────────────────

/**
 * Split `text` into Discord-postable chunks. Lossless: `chunks.join("")` is
 * byte-identical to the input (the break character stays at the end of the
 * chunk it terminates). Prefers the last newline before the limit, then the
 * last space; a single token longer than the limit is hard-split.
 */
export function chunkForDiscord(text: string, limit: number = DISCORD_MESSAGE_LIMIT): string[] {
  if (!text) return [];
  const max = Math.max(1, limit);
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n");
    if (cut < 0) cut = window.lastIndexOf(" ");
    // No break point in range → hard-split the over-long token.
    const end = cut < 0 ? max : cut + 1;
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}
