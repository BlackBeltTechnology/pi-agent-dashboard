// Pure DOX-doctrine logic for the kb extension (change:
// inject-dox-doctrine-and-describe, design D6). No pi imports, so it tests
// under plain vitest; extension.ts owns the thin `before_agent_start` wiring.
//
// The canonical doctrine ships as `dox-doctrine.md` (package root) with two
// delimited sections — READ (`dox:read:kb`) and WRITE (`dox:write`). The READ
// section is injected when `doctrine.inject` is `kb`; WRITE additionally when
// `doctrine.write` is true. Injection is content-idempotent on the delimiter and
// must land BEFORE pi's `\nCurrent working directory: ` anchor, because the
// dashboard bridge splice-replaces everything after that anchor.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Opening marker of the injected doctrine fragment. Presence = already injected. */
export const DOX_DELIMITER = "\u2500\u2500 dox doctrine \u2500\u2500";
/** pi's literal system-prompt anchor (mirrors dashboard-context-injector). */
export const CWD_ANCHOR = "\nCurrent working directory: ";

const WRITE_START = "<!-- dox:write:start -->";
const WRITE_END = "<!-- dox:write:end -->";
const READ_KB_START = "<!-- dox:read:kb:start -->";
const READ_KB_END = "<!-- dox:read:kb:end -->";
/** Legacy seeded delimiters: their presence means the root AGENTS.md already
 *  carries doctrine text (any variant) → skip injection to avoid a double-load. */
const LEGACY_DELIMITERS = ["<!-- dox:write:start -->", "<!-- dox:read:kb:start -->", "<!-- dox:read:manual:start -->"];

/** Absolute path to the shipped canonical doctrine. `KB_DOCTRINE_PATH` overrides
 *  (used to exercise the unreadable-doctrine fault path). */
function doctrinePath(): string {
  return process.env.KB_DOCTRINE_PATH || join(dirname(fileURLToPath(import.meta.url)), "..", "dox-doctrine.md");
}

/** Extract the text between two delimiter lines (exclusive), trimmed. */
function extract(source: string, start: string, end: string): string {
  const s = source.indexOf(start);
  const e = source.indexOf(end);
  if (s === -1 || e === -1 || e < s) return "";
  return source.slice(s + start.length, e).trim();
}

export interface DoctrineSections {
  read: string;
  write: string;
}

/** Read + split the canonical doctrine. Throws when the file is unreadable. */
export function loadDoctrineSections(path = doctrinePath()): DoctrineSections {
  const raw = readFileSync(path, "utf8");
  return { read: extract(raw, READ_KB_START, READ_KB_END), write: extract(raw, WRITE_START, WRITE_END) };
}

export interface ContextFile {
  path?: string;
  content?: string;
}

/** True when any loaded context file carries a legacy seeded doctrine section —
 *  detection is on the DELIMITER alone (a half-finished migration still trips). */
export function hasLegacySeed(contextFiles: ReadonlyArray<ContextFile> | undefined): boolean {
  if (!Array.isArray(contextFiles)) return false;
  return contextFiles.some(
    (f) => typeof f?.content === "string" && LEGACY_DELIMITERS.some((d) => (f.content as string).includes(d)),
  );
}

export interface DoctrineFragmentOpts {
  inject: "kb" | "off";
  write: boolean;
  /** Sections override (tests); defaults to reading the shipped file. */
  sections?: DoctrineSections;
}

/** Decision table: READ whenever `inject === "kb"`; WRITE additionally when
 *  `write`; `"off"` yields `""` and makes `write` inert. */
export function buildDoctrineFragment(opts: DoctrineFragmentOpts): string {
  if (opts.inject !== "kb") return "";
  const sec = opts.sections ?? loadDoctrineSections();
  const parts = [DOX_DELIMITER, sec.read];
  if (opts.write) parts.push(sec.write);
  return parts.join("\n\n");
}

/** Insert a fragment into the system prompt immediately BEFORE the last
 *  `Current working directory: ` anchor (anchor preserved verbatim), or append
 *  when the anchor is absent. Idempotent: a prompt already carrying the
 *  delimiter is returned unchanged. Empty fragment = unchanged. */
export function insertFragment(systemPrompt: string, fragment: string): string {
  if (!fragment) return systemPrompt;
  if (systemPrompt.includes(DOX_DELIMITER)) return systemPrompt;
  const idx = systemPrompt.lastIndexOf(CWD_ANCHOR);
  if (idx === -1) return `${systemPrompt}\n\n${fragment}`;
  return `${systemPrompt.slice(0, idx)}\n${fragment}${systemPrompt.slice(idx)}`;
}

/** One-time instruction: ask the user which doctrine mode to enable and record
 *  it in the PROJECT config (read-merge-write). */
export function buildFirstContactNudge(cwd: string): string {
  return [
    "[kb] DOX doctrine is not configured for this project. Ask the user (via ask_user) which mode to enable:",
    "- `kb read` \u2014 inject the kb-first READ discipline each turn (default),",
    "- `kb read + write` \u2014 also inject the directory `AGENTS.md` WRITE discipline,",
    "- `off` \u2014 inject nothing,",
    "- `ask later` \u2014 decide next session.",
    `Record a non-\`ask later\` answer by read-merge-writing the \`doctrine\` key in \`${cwd}/.pi/dashboard/knowledge_base.json\` (preserve every other key). If this run is non-interactive, proceed with defaults (\`kb read\`) and write nothing.`,
  ].join("\n");
}

/** One-time instruction for a project whose root AGENTS.md still carries a
 *  legacy doctrine copy: offer to replace it with the pointer block. */
export function buildMigrationNudge(cwd: string): string {
  return [
    "[kb] This project's `AGENTS.md` still carries a legacy copy of the DOX doctrine.",
    "Tell the user and, on confirmation, replace the block from the `<!-- dox-doctrine -->` marker (or the first `dox:*:start` delimiter) through its matching `dox:read:*:end` delimiter with the pointer block, then ask the doctrine first-contact question.",
    `Declining leaves the file untouched. The new pointer block is tuned via \`${cwd}/.pi/dashboard/knowledge_base.json\`.`,
  ].join("\n");
}
