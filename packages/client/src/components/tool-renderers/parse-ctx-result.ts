// Pure text-grammar parser for context-mode (`ctx_*`) MCP tool results.
// No React. Turns the raw result text into a small typed `CtxResult` union the
// CtxToolRenderer switches on. Every parse arm returns `{ kind: "raw", text }`
// on a header miss and NEVER throws — a context-mode format drift degrades the
// card to "header chip from args + linkified raw body", strictly better than
// the old generic JSON dump. See change: add-ctx-tool-renderer (design.md → Decision 3).

export type CtxErrorVariant = "validation" | "timeout" | "runtime";

/** Preview list emitted by ctx_execute / ctx_execute_file when `intent` is set. */
export interface IntentPreview {
  /** sections indexed into the knowledge base */
  indexed?: number;
  /** sections that matched the intent query */
  matched: number;
  /** the intent string */
  query: string;
  /** `- Lines …` / `- <label>` bullet previews under the match header */
  previews: string[];
}

export interface BatchSummary {
  commands: number;
  lines: number;
  size: string;
  sections: number;
  queries: number;
}

/** A `- <label> (<size>)` row under `## Indexed Sections`. */
export interface SectionRow {
  label: string;
  size?: string;
}

/** A `## <query>` block in batch/search output. */
export interface QueryBlock {
  query: string;
  /** `### <section>` sub-blocks; empty when `noResults` is true. */
  sections: { title: string; body: string }[];
  noResults: boolean;
}

/**
 * The context-mode execution shape carried by a `runtime` error body: a fenced
 * command block, an `Exit code: <n>` line, and optional `stdout:` / `stderr:`
 * sections. Every field is optional — a runtime error whose body is a plain
 * sentence leaves them all undefined and the renderer falls back to `message`.
 * See change: repair-tool-error-surfaces (design.md → D2b).
 */
export interface CtxExecutionShape {
  /** prose preceding the first recognised part, so no text is ever dropped */
  preamble?: string;
  /** the fenced block's contents, verbatim */
  command?: string;
  /** the fence's info string (e.g. "shell"), when present */
  language?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export type CtxResult =
  | ({ kind: "error"; variant: CtxErrorVariant; message: string; receivedArgs?: string } & CtxExecutionShape)
  | { kind: "execute"; stdout: string; intent?: IntentPreview }
  | { kind: "batch"; summary: BatchSummary; sections: SectionRow[]; queries: QueryBlock[] }
  | { kind: "search"; queries: QueryBlock[] }
  | { kind: "index"; sections: number; withCode?: number; source: string }
  | { kind: "fetch"; sections: number; size: string; source: string; url?: string }
  | { kind: "insight"; url?: string; log: string }
  | { kind: "raw"; text: string };

const BANNER_RE = /^⚠️ context-mode v.*$/;

/** Drop a leading context-mode upgrade banner line (+ its trailing blank line). */
export function stripNoise(text: string): string {
  const lines = text.split("\n");
  if (lines.length && BANNER_RE.test(lines[0])) {
    lines.shift();
    if (lines.length && lines[0].trim() === "") lines.shift();
  }
  return lines.join("\n");
}

function parseError(text: string): Extract<CtxResult, { kind: "error" }> {
  const validation = text.match(/^Validation failed for tool "(ctx_\w+)":/);
  if (validation) {
    const recvIdx = text.indexOf("Received arguments:");
    const message =
      recvIdx >= 0
        ? text.slice(validation[0].length, recvIdx).trim()
        : text.slice(validation[0].length).trim();
    const receivedArgs = recvIdx >= 0 ? text.slice(recvIdx + "Received arguments:".length).trim() : undefined;
    return { kind: "error", variant: "validation", message: message || text.trim(), receivedArgs };
  }
  const timeout = text.match(/MCP request timeout after \d+ms/);
  if (timeout) {
    return { kind: "error", variant: "timeout", message: text.trim() };
  }
  // Any other isError result — exit-code stdout/stderr dumps, batch failures,
  // explicit "Runtime error:" — render as a runtime error card.
  return { kind: "error", variant: "runtime", message: text.trim(), ...parseExecutionShape(text) };
}

/**
 * Extract the context-mode execution shape from a runtime error body. Returns an
 * empty object when the body does not have that shape, so the caller can spread
 * it unconditionally. Never throws: every part is matched independently and a
 * partial body simply yields fewer fields.
 */
export function parseExecutionShape(text: string): CtxExecutionShape {
  const out: CtxExecutionShape = {};
  const fence = text.match(/^```(\w*)[ \t]*\n([\s\S]*?)\n?^```[ \t]*$/m);
  if (fence) {
    out.command = fence[2];
    if (fence[1]) out.language = fence[1];
  }
  const exit = text.match(/^Exit code:\s*(-?\d+)\s*$/m);
  if (exit) out.exitCode = Number(exit[1]);
  // A stream section runs to the next stream header or the end of the body.
  // Sliced by index rather than matched with a lookahead: JS has no `\z`, and a
  // multiline `$` would cut every section at its first newline.
  //
  // A header only counts when it is preceded by a blank line (or starts the
  // body) and has not already opened, mirroring how context-mode emits the
  // dump. Without that bound a line reading `stderr:` *inside* stdout's own
  // output would split the section and strand the rest of stdout under a bogus
  // stderr label. See change: repair-tool-error-surfaces (test-plan #E9).
  const seen = new Set<string>();
  const heads = [...text.matchAll(/^(stdout|stderr):[ \t]*$/gm)].filter((h) => {
    const idx = h.index ?? 0;
    if (idx !== 0 && !text.slice(0, idx).endsWith("\n\n")) return false;
    if (seen.has(h[1])) return false;
    seen.add(h[1]);
    return true;
  });
  heads.forEach((h, i) => {
    const start = (h.index ?? 0) + h[0].length;
    const end = i + 1 < heads.length ? (heads[i + 1].index ?? text.length) : text.length;
    out[h[1] as "stdout" | "stderr"] = text.slice(start, end).replace(/^\n/, "").replace(/\s+$/, "");
  });
  // Anything before the first recognised marker (e.g. an explicit
  // "Runtime error: …" line above the dump) would otherwise be dropped by the
  // structured renderer, which shows only the parts it understands.
  const starts = [fence?.index, exit?.index, heads[0]?.index].filter((i) => i !== undefined);
  if (starts.length) {
    const preamble = text.slice(0, Math.min(...starts)).trim();
    if (preamble) out.preamble = preamble;
  }
  return out;
}

/** Split a body on lines that start a `## ` heading. Returns heading/body pairs. */
function splitHeadingBlocks(body: string): { heading: string; content: string }[] {
  const blocks: { heading: string; content: string }[] = [];
  const re = /^## (.+)$/gm;
  const matches: { title: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    matches.push({ title: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const next = i + 1 < matches.length ? matches[i + 1].start : body.length;
    blocks.push({ heading: matches[i].title, content: body.slice(matches[i].end, next).trim() });
  }
  return blocks;
}

/** Parse a single `## <query>` block content into sections or a no-results flag. */
function parseQueryBlock(query: string, content: string): QueryBlock {
  if (/^No results found\.?/m.test(content) && !content.includes("### ")) {
    return { query, sections: [], noResults: true };
  }
  const sections: { title: string; body: string }[] = [];
  const re = /^### (.+)$/gm;
  const heads: { title: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    heads.push({ title: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < heads.length; i++) {
    const next = i + 1 < heads.length ? heads[i + 1].start : content.length;
    sections.push({ title: heads[i].title, body: content.slice(heads[i].end, next).trim() });
  }
  if (sections.length === 0) {
    return { query, sections: [], noResults: /No results found/.test(content) };
  }
  return { query, sections, noResults: false };
}

function parseBatch(text: string): CtxResult {
  const summaryMatch = text.match(
    /^Executed (\d+) commands \((\d+) lines, ([\d.]+\w?B)\)\. Indexed (\d+) sections\. Searched (\d+) queries\./m,
  );
  if (!summaryMatch) return { kind: "raw", text };
  const summary: BatchSummary = {
    commands: Number(summaryMatch[1]),
    lines: Number(summaryMatch[2]),
    size: summaryMatch[3],
    sections: Number(summaryMatch[4]),
    queries: Number(summaryMatch[5]),
  };
  const blocks = splitHeadingBlocks(text);
  const sections: SectionRow[] = [];
  const queries: QueryBlock[] = [];
  for (const b of blocks) {
    if (b.heading === "Indexed Sections") {
      for (const line of b.content.split("\n")) {
        const row = line.match(/^- (.+?)(?: \(([\d.]+\w?B)\))?$/);
        if (row) sections.push({ label: row[1].trim(), size: row[2] });
      }
    } else {
      queries.push(parseQueryBlock(b.heading, b.content));
    }
  }
  return { kind: "batch", summary, sections, queries };
}

function parseSearch(text: string): CtxResult {
  const blocks = splitHeadingBlocks(text);
  if (blocks.length === 0) return { kind: "raw", text };
  const queries = blocks.map((b) => parseQueryBlock(b.heading, b.content));
  return { kind: "search", queries };
}

function parseExecute(text: string): CtxResult {
  const indexedMatch = text.match(/^Indexed (\d+) sections from "(.+?)"/m);
  const matchedMatch = text.match(/^(\d+) sections matched "(.+?)" \((\d+) lines, [\d.]+\w?B\):/m);
  if (matchedMatch) {
    const previews = text
      .split("\n")
      .filter((l) => /^\s*- /.test(l))
      .map((l) => l.trim());
    const intent: IntentPreview = {
      indexed: indexedMatch ? Number(indexedMatch[1]) : undefined,
      matched: Number(matchedMatch[1]),
      query: matchedMatch[2],
      previews,
    };
    return { kind: "execute", stdout: text, intent };
  }
  return { kind: "execute", stdout: text };
}

function parseIndex(text: string): CtxResult {
  const m = text.match(/^Indexed (\d+) sections \((\d+) with code\) from: (.+)$/m);
  if (!m) return { kind: "raw", text };
  return { kind: "index", sections: Number(m[1]), withCode: Number(m[2]), source: m[3].trim() };
}

function parseFetch(text: string): CtxResult {
  const m = text.match(/Fetched and indexed \*\*(\d+) sections\*\* \(([\d.]+\w?B)\) from: (.+?)(?:::(.+))?$/m);
  if (!m) return { kind: "raw", text };
  return { kind: "fetch", sections: Number(m[1]), size: m[2], source: m[3].trim(), url: m[4]?.trim() };
}

function parseInsight(text: string): CtxResult {
  const urls = text.match(/http:\/\/localhost:\d+\S*/g);
  return { kind: "insight", url: urls ? urls[urls.length - 1] : undefined, log: text };
}

/**
 * Parse a `ctx_*` tool result into a typed struct.
 * @param toolName  the MCP tool name (e.g. "ctx_search")
 * @param result    the raw result text (single text item from `content`)
 * @param isError   the toolResult `isError` flag
 */
export function parseCtxResult(toolName: string, result: string | undefined, isError?: boolean): CtxResult {
  const raw = result ?? "";
  const text = stripNoise(raw);
  try {
    if (isError) return parseError(text);
    switch (toolName) {
      case "ctx_batch_execute":
        return parseBatch(text);
      case "ctx_search":
        return parseSearch(text);
      case "ctx_execute":
      case "ctx_execute_file":
        return parseExecute(text);
      case "ctx_index":
        return parseIndex(text);
      case "ctx_fetch_and_index":
        return parseFetch(text);
      case "ctx_insight":
        return parseInsight(text);
      default:
        return { kind: "raw", text };
    }
  } catch {
    return { kind: "raw", text };
  }
}
