/**
 * DOX-doctrine seeding for the `project-init` skill.
 *
 * The canonical doctrine ships ONCE as `<skill>/dox-doctrine.md` (kb-indexed,
 * so `kb_search "dox doctrine"` retrieves it). It carries three delimited
 * sections:
 *   WRITE            — maintaining the per-directory AGENTS.md tree (incl. the
 *                      large-AGENTS.md split rule).
 *   READ (kb)        — retrieval via `kb agents` / `kb_search` before grep.
 *   READ (manual)    — upstream manual chain-walk wording; NO kb references.
 *
 * The seeded block = WRITE + one READ variant, chosen by whether the profile
 * wires the kb toolset. Marker-gated + idempotent: a target `AGENTS.md` that
 * already carries the `<!-- dox-doctrine -->` marker is left untouched.
 *
 * See change: project-init-skill-and-profiles.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Stable sentinel that marks an AGENTS.md as already carrying the doctrine. */
export const DOX_MARKER = "<!-- dox-doctrine -->";

const WRITE_START = "<!-- dox:write:start -->";
const WRITE_END = "<!-- dox:write:end -->";
const READ_KB_START = "<!-- dox:read:kb:start -->";
const READ_KB_END = "<!-- dox:read:kb:end -->";
const READ_MANUAL_START = "<!-- dox:read:manual:start -->";
const READ_MANUAL_END = "<!-- dox:read:manual:end -->";

/** Absolute path to the shipped canonical doctrine file. */
export function doctrinePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, "..", "..");
  return path.join(pkgRoot, ".pi", "skills", "project-init", "dox-doctrine.md");
}

/** Extract the text between two delimiter lines (exclusive), trimmed. */
function section(source: string, start: string, end: string): string {
  const s = source.indexOf(start);
  const e = source.indexOf(end);
  if (s === -1 || e === -1 || e < s) return "";
  return source.slice(s + start.length, e).trim();
}

export interface BuildDoctrineOptions {
  /** True when the profile wires the kb toolset (indexAgentsFiles etc.). */
  kbWired: boolean;
  /** Override the doctrine source text (tests). Defaults to the shipped file. */
  source?: string;
}

/**
 * Compose the seeded doctrine block for an AGENTS.md: the marker followed by
 * the WRITE discipline and the kb-appropriate READ discipline.
 */
export function buildDoctrineBlock(opts: BuildDoctrineOptions): string {
  const raw = opts.source ?? fs.readFileSync(doctrinePath(), "utf8");
  const write = section(raw, WRITE_START, WRITE_END);
  const read = opts.kbWired
    ? section(raw, READ_KB_START, READ_KB_END)
    : section(raw, READ_MANUAL_START, READ_MANUAL_END);
  return `${DOX_MARKER}\n\n${write}\n\n${read}\n`;
}

export interface SeedResult {
  /** True when the doctrine was appended; false when it was already present. */
  seeded: boolean;
}

/**
 * Append the doctrine block to `agentsMdPath` only when the file does not
 * already carry the marker. Idempotent: a present marker is a no-op.
 * Creates the file when absent.
 */
export function seedDoctrine(
  agentsMdPath: string,
  opts: BuildDoctrineOptions,
): SeedResult {
  let existing = "";
  try {
    existing = fs.readFileSync(agentsMdPath, "utf8");
  } catch {
    existing = "";
  }
  if (existing.includes(DOX_MARKER)) return { seeded: false };

  const block = buildDoctrineBlock(opts);
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const joiner = existing.length === 0 ? "" : "\n";
  fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true });
  fs.writeFileSync(agentsMdPath, `${existing}${sep}${joiner}${block}`, "utf8");
  return { seeded: true };
}
