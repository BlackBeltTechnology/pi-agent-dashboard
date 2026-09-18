/**
 * Outbound mirror filter for the team-controls layer.
 *
 * The default level (`names-only`) mirrors assistant prose verbatim and tool
 * NAMES only — never tool arguments, results, diffs, or terminal output. The
 * filter bounds STRUCTURED payloads; it cannot bound assistant prose, which may
 * quote a diff, and this module states that boundary rather than pretending to
 * scrub it.
 *
 * `renderMirror` is pure: (MirrorEvent, level) → text | null.
 *
 * See change: add-chat-gateway-team-controls (D9).
 */
import path from "node:path";
import type { MirrorLevel } from "./team-config.js";

/** Stated, not papered over: the filter governs structured payloads only. */
export const FILTER_BOUNDARY_NOTE =
  "Mirror levels bound structured payloads (tool arguments, results, diffs, terminal output). " +
  "Assistant prose is mirrored as written and may itself quote file content.";

export type MirrorEventKind = "assistant_text" | "tool_call" | "tool_result" | "diff" | "terminal";

export interface MirrorEvent {
  kind: MirrorEventKind;
  /** Assistant prose, mirrored verbatim at every level. */
  text?: string;
  toolName?: string;
  /** File/dir a tool targeted; only its basename is ever surfaced. */
  target?: string;
  args?: unknown;
  diff?: string;
  output?: string;
}

const basename = (p: string): string => path.basename(p) || p;

/** True when this level mirrors diffs. */
const showsDiffs = (level: MirrorLevel): boolean => level !== "names-only";
/** True when this level mirrors full structured payloads. */
const showsEverything = (level: MirrorLevel): boolean => level === "full-transcript";

function renderToolCall(event: MirrorEvent, level: MirrorLevel): string {
  const name = event.toolName ?? "tool";
  const target = event.target ? ` (${basename(event.target)})` : "";
  const lines = [`🔧 ${name}${target}`];
  if (showsDiffs(level) && event.diff) lines.push(event.diff);
  if (showsEverything(level) && event.args !== undefined) {
    lines.push(typeof event.args === "string" ? event.args : JSON.stringify(event.args));
  }
  return lines.join("\n");
}

export function renderMirror(event: MirrorEvent, level: MirrorLevel): string | null {
  switch (event.kind) {
    case "assistant_text":
      // Prose is mirrored verbatim at EVERY level — the stated boundary.
      return event.text ?? "";
    case "tool_call":
      return renderToolCall(event, level);
    case "diff":
      return showsDiffs(level) ? (event.diff ?? null) : null;
    case "tool_result":
      return showsEverything(level) ? (event.output ?? null) : null;
    case "terminal":
      return showsEverything(level) ? (event.output ?? null) : null;
    default:
      return null;
  }
}

/**
 * Truncate to `maxChars`, appending an explicit elision marker. Never returns a
 * silently shortened string — a reader must be able to tell content was cut.
 */
export function elide(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n… [elided ${omitted} characters]`;
}
