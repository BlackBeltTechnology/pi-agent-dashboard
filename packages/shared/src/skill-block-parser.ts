/**
 * Skill block parser & builder.
 *
 * Pi's `_expandSkillCommand` (in `@earendil-works/pi-coding-agent`) wraps skill
 * expansions in a `<skill name="..." location="...">…</skill>\n\nargs` envelope.
 * The dashboard's bridge expander (`packages/extension/src/prompt-expander.ts`)
 * aligns to the same byte format. This module is the single source of truth for
 * both producing and recovering that envelope.
 *
 * See change: render-skill-invocations-collapsibly.
 */

export interface SkillBlock {
  /** Bare skill name (no `skill:` prefix), e.g. `"openspec-explore"`. */
  name: string;
  /** Absolute path to `SKILL.md`. */
  location: string;
  /**
   * Skill body with the `References are relative to <baseDir>.\n\n` preamble
   * stripped — what users see in the card. The preamble is bridge-internal
   * orientation for the LLM and is not interesting to users.
   *
   * Pi's own `parseSkillBlock` returns the unstripped form (calls it `content`).
   * We strip here so the renderer doesn't have to. If the preamble shape ever
   * changes upstream and stripping fails, `body` falls back to the captured
   * content verbatim.
   */
  body: string;
  /** User text after the skill name. `undefined` when no args were typed. */
  args: string | undefined;
  /** Slash-command form: `"/skill:" + name + (args ? " " + args : "")`. */
  condensed: string;
}

/**
 * Anchored, non-greedy match of a wrapped skill block.
 *
 * Why anchored: prevents a literal `<skill>` substring elsewhere in user text
 * from matching. Why non-greedy + optional trailing args at end-of-string:
 * forces the regex engine to extend the body to the last valid
 * `\n</skill>(\n\nargs)?$` boundary, so SKILL.md bodies that document the
 * `<skill>` tag (e.g. include the literal text in code samples) do not
 * terminate the match prematurely.
 */
const SKILL_BLOCK_RE =
  /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

/**
 * Parse a skill block from message text. Returns `null` when the input is not
 * a well-formed skill envelope.
 */
/**
 * Strip the `References are relative to <baseDir>.\n\n` preamble from a captured
 * `<skill>` content block. Returns the stripped body, or the input unchanged if
 * the preamble shape doesn't match.
 */
function stripReferencesPreamble(content: string): string {
  const m = content.match(/^References are relative to [^\n]+\.\n\n([\s\S]*)$/);
  return m ? m[1] : content;
}

export function parseSkillBlock(text: string): SkillBlock | null {
  const m = text.match(SKILL_BLOCK_RE);
  if (!m) return null;
  const name = m[1];
  const location = m[2];
  const body = stripReferencesPreamble(m[3]);
  const args = m[4];
  const condensed = `/skill:${name}${args ? " " + args : ""}`;
  return { name, location, body, args, condensed };
}

export interface BuildSkillBlockArgs {
  /** Bare skill name (no `skill:` prefix). */
  name: string;
  /** Absolute path to `SKILL.md`. */
  filePath: string;
  /** Skill base directory — `dirname(filePath)`. */
  baseDir: string;
  /** Skill body, frontmatter already stripped. Should be `.trim()`-ed. */
  body: string;
  /** Optional user-typed args appended after the closing tag. */
  userArgs?: string;
}

/**
 * Build a skill block in the exact byte format pi's `_expandSkillCommand`
 * produces. The output is byte-identical to pi's output for the same inputs;
 * `parseSkillBlock(buildSkillBlock(x))` round-trips for `name`, `body`, `args`.
 */
export function buildSkillBlock(input: BuildSkillBlockArgs): string {
  const wrapper =
    `<skill name="${input.name}" location="${input.filePath}">\n` +
    `References are relative to ${input.baseDir}.\n\n` +
    `${input.body}\n` +
    `</skill>`;
  return input.userArgs ? `${wrapper}\n\n${input.userArgs}` : wrapper;
}

/**
 * Condense a user-message content string for `firstMessage` / display purposes.
 *
 * If `text` parses as a `<skill>` envelope, returns the slash-command form
 * (`/skill:name args`) truncated to `maxLen` chars. Otherwise returns
 * `text.slice(0, maxLen)`. Used by session-scanner / session-discovery so the
 * 200-char `firstMessage` shows the recognisable slash form instead of the
 * front of an opaque wrapper.
 *
 * See change: render-skill-invocations-collapsibly.
 */
export function condenseForFirstMessage(text: string, maxLen: number): string {
  const block = parseSkillBlock(text);
  if (block) return block.condensed.slice(0, maxLen);
  return text.slice(0, maxLen);
}

/**
 * Parse a `/skill:<name> [args]` command. One parser for the composer, the
 * bridge and the team guard so an input cannot pass one layer and fail another.
 * Case-sensitive, no leading whitespace; name ends at the first whitespace
 * (space, tab or newline). Empty name → null. See change: add-team-skill-access.
 */
export function parseSkillCommand(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/skill:")) return null;
  const rest = text.slice("/skill:".length);
  const m = /^(\S*)([\s\S]*)$/.exec(rest);
  if (!m || !m[1]) return null;
  return { name: m[1], args: m[2].trim() };
}
