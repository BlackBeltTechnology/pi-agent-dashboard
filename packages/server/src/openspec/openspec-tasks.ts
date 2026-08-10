/**
 * Parser + writer for an OpenSpec change's `tasks.md` file.
 *
 * Accepted shapes (top-level only — leading whitespace is rejected):
 *   ## 1. Group heading            (group context)
 *   - [ ] 1.1 Task text             (id-ed: numeric `1.1`-style id)
 *   - [x] 1.2 Done task             (id-ed, ticked)
 *   - [ ] Verify runner image       (id-less: parser synthesizes `L<line>`)
 *   - [x] Add matrix row            (id-less, ticked)
 *
 * Indented sublists and free-form prose are ignored.
 *
 * The synthesized `L<line>` id (e.g. `L17` for the 7th line of the file) is a
 * stable opaque token — it round-trips through the toggle endpoint as the
 * `id` param but is NEVER written to disk. The `line` field is the actual
 * byte-level optimistic-concurrency token; the id is just a cross-check.
 *
 * Writes rewrite exactly one line's checkbox marker character and preserve
 * everything else byte-for-byte (including the original spacing between `]`
 * and the id/text); atomic via write-then-rename.
 */
import fs from "node:fs/promises";
import path from "node:path";

export interface OpenSpecTask {
  /** e.g. "1.1", "8.3" */
  id: string;
  /** Text after the id, trimmed. */
  text: string;
  done: boolean;
  /** 1-indexed line number in `tasks.md` — used as an optimistic-concurrency token. */
  line: number;
  /** Nearest preceding `## ` heading text (without the leading "## "). Empty string if none. */
  group: string;
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(message = "tasks.md not found") {
    super(message);
  }
}
export class LineMismatchError extends Error {
  readonly code = "LINE_MISMATCH" as const;
  constructor(message = "line mismatch") {
    super(message);
  }
}
export class NotACheckboxError extends Error {
  readonly code = "NOT_A_CHECKBOX" as const;
  constructor(message = "target line is not a checkbox") {
    super(message);
  }
}

// Top-level checkbox with positional groups so the writer can rebuild the line
// byte-for-byte. Groups (1-indexed):
//   1: "- ["          (literal prefix)
//   2: " " | "x" | "X" (the marker char — the only thing the writer flips)
//   3: "] " plus any extra spaces (literal separator, preserved verbatim)
//   4: "1.1 " (numeric id + its trailing whitespace) OR "" (id-less)
//   5: the remainder of the line (the task text)
const CHECKBOX_RE = /^(- \[)([ xX])(\] +)((?:[0-9]+(?:\.[0-9]+)* +)?)(.*)$/;
const HEADING_RE = /^##\s+(.*)$/;

/** Synthesize the canonical id for an id-less line: `L<1-indexed-line>`. */
function synthesizeId(line1Indexed: number): string {
  return `L${line1Indexed}`;
}

export function parseTasksMarkdown(content: string): OpenSpecTask[] {
  // Split on \n only; trailing \r is trimmed so we handle CRLF inputs too.
  const lines = content.split("\n");
  const out: OpenSpecTask[] = [];
  let currentGroup = "";
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const h = HEADING_RE.exec(line);
    if (h) {
      currentGroup = h[1].trim();
      continue;
    }
    const m = CHECKBOX_RE.exec(line);
    if (!m) continue;
    const done = m[2] === "x" || m[2] === "X";
    const lineNo = i + 1;
    // m[4] is "" when no numeric id present, "1.1 " otherwise.
    const id = m[4] ? m[4].trimEnd() : synthesizeId(lineNo);
    out.push({
      id,
      text: m[5].trim(),
      done,
      line: lineNo,
      group: currentGroup,
    });
  }
  return out;
}

function tasksMdPath(cwd: string, change: string): string {
  return path.join(cwd, "openspec", "changes", change, "tasks.md");
}

export async function readTasks(cwd: string, change: string): Promise<OpenSpecTask[]> {
  const p = tasksMdPath(cwd, change);
  let content: string;
  try {
    content = await fs.readFile(p, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") throw new NotFoundError();
    throw err;
  }
  return parseTasksMarkdown(content);
}

export async function toggleTask(
  cwd: string,
  change: string,
  id: string,
  done: boolean,
  line: number,
): Promise<OpenSpecTask> {
  const p = tasksMdPath(cwd, change);
  let content: string;
  try {
    content = await fs.readFile(p, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") throw new NotFoundError();
    throw err;
  }

  // Preserve original line endings by splitting on \n and tracking \r individually.
  const lines = content.split("\n");
  if (line < 1 || line > lines.length) throw new LineMismatchError();

  const idx = line - 1;
  const raw = lines[idx];
  const hadCR = raw.endsWith("\r");
  const bare = hadCR ? raw.slice(0, -1) : raw;

  const m = CHECKBOX_RE.exec(bare);
  if (!m) throw new NotACheckboxError();

  // Resolve the parsed id from the source line (numeric if present, else
  // synthesized `L<line>`). The caller's `id` MUST match this exactly — a
  // mismatch (numeric-vs-synthetic, wrong synthetic line number, or genuinely
  // wrong id) is a line-mismatch.
  const parsedId = m[4] ? m[4].trimEnd() : synthesizeId(line);
  if (parsedId !== id) throw new LineMismatchError();

  const currentDone = m[2] === "x" || m[2] === "X";
  // Optimistic concurrency: the caller's `done` is the *target* state; the line
  // must currently hold the opposite state. If it already matches, we treat
  // that as a line-mismatch — the file changed under us.
  if (currentDone === done) throw new LineMismatchError();

  const marker = done ? "x" : " ";
  // Byte-for-byte rewrite: swap ONLY the marker char in group 2; preserve
  // group 1 (prefix), group 3 (separator + any extra spaces), group 4 (id +
  // trailing space, possibly empty for id-less lines), and group 5 (text).
  // This guarantees id-less lines do not acquire a synthetic id in the file,
  // and id-ed lines retain their exact spacing.
  const rewritten = m[1] + marker + m[3] + m[4] + m[5];
  lines[idx] = hadCR ? rewritten + "\r" : rewritten;

  const newContent = lines.join("\n");
  const tmp = p + ".tmp";
  await fs.writeFile(tmp, newContent, "utf-8");
  await fs.rename(tmp, p);

  return {
    id,
    text: m[5].trim(),
    done,
    line,
    group: findGroupForLine(lines, idx),
  };
}

function findGroupForLine(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    const raw = lines[i];
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const h = HEADING_RE.exec(line);
    if (h) return h[1].trim();
  }
  return "";
}
