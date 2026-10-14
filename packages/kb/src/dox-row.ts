// Linear-time DOX table-row matcher. Leaf module (no imports) so dox.ts,
// dox-triage.ts, migrate-file-index.ts and migrate-runner.ts can all share it.
// Replaces lazy-`(.*?)` regexes that were cubic/quadratic on long whitespace runs.

export interface RowMatch {
  /** Raw backtick group (untrimmed). */
  path: string;
  purpose: string;
}

// Head has no ambiguous repetition: `[^`]+` cannot cross a backtick.
const HEAD = /^\|\s*`([^`]+)`\s*\|/;
// The old `(.*?)` could never match these; `\s*` could.
const TERMINATOR = /[\n\r\u2028\u2029]/;

/** `| \`path\` | purpose |` — closing pipe required. */
export function matchRow(line: string): RowMatch | null {
  const m = HEAD.exec(line);
  if (!m) return null;
  const t = line.slice(m[0].length).trim();
  if (!t.endsWith("|")) return null;
  const purpose = t.slice(0, -1).trim();
  if (TERMINATOR.test(purpose)) return null;
  return { path: m[1], purpose };
}

/** Like `matchRow` but the closing pipe is optional (LLM output). */
export function matchRowLoose(line: string): RowMatch | null {
  const m = HEAD.exec(line);
  if (!m) return null;
  let t = line.slice(m[0].length).trim();
  if (TERMINATOR.test(t)) return null;
  if (t.endsWith("|")) t = t.slice(0, -1).trim();
  return { path: m[1], purpose: t };
}
