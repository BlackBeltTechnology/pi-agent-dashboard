/**
 * Supervised-mode action summary — what the operator is asked to approve.
 *
 * Built from a snapshot of `event.input` (never mutated): command text for
 * `bash`/`powershell`; target path + `+N −M` stat + byte-capped diff for
 * `edit`/`write` (create vs replace); subagent type + task for `Agent`.
 * Exported so the agent path gate can append the SAME content to its own
 * prompt (design D14) — one summary builder, one diff cap.
 *
 * Pure apart from the optional bounded read of an existing file (`write`).
 * See change: add-supervised-tool-approval (design D3, D14).
 */
import * as fs from "node:fs";
import nodePath from "node:path";

/** `metadata.diff` cap (bytes, UTF-8); a cut diff ends with {@link TRUNCATION_MARKER}. */
export const DIFF_BYTE_CAP = 16384;
export const TRUNCATION_MARKER = "… (truncated)";
/** Longest existing file read to diff a `write` replacement (bigger → no old side). */
const MAX_OLD_FILE_BYTES = 1024 * 1024;
/** Longest command / task / path text shown (agent-controlled). */
const TEXT_CAP = 8192;

export interface SupervisedSummary {
  tool: string;
  /** Card / prompt title, e.g. "Run this command?". */
  title: string;
  /** One-line action summary (also the decision-record summary seed). */
  line: string;
  cwd: string;
  command?: string;
  path?: string;
  /** `+N −M` (U+2212). */
  diffStat?: string;
  diff?: string;
  /** Extra caveat sentence (e.g. the `Agent` limit). */
  note?: string;
  /** Agent subagent type / task. */
  subagentType?: string;
}

const isShell = (t: string) => t === "bash" || t === "powershell";

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function capText(s: string): string {
  return s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)}${TRUNCATION_MARKER}` : s;
}

/** Cap `diff` at 16384 UTF-8 bytes (exact = verbatim); never splits a multi-byte character. */
export function capDiff(diff: string, cap: number = DIFF_BYTE_CAP): string {
  const buf = Buffer.from(diff, "utf8");
  if (buf.length <= cap) return diff;
  let end = cap;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8") + TRUNCATION_MARKER;
}

function splitLines(s: string): string[] {
  if (s === "") return [];
  const lines = s.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

interface Hunk {
  removed: string[];
  added: string[];
}

/** Replace hunk with the common leading / trailing lines trimmed (cheap, bounded; not a full LCS). */
function hunk(oldText: string, newText: string): Hunk {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let ea = a.length;
  let eb = b.length;
  while (ea > start && eb > start && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  return { removed: a.slice(start, ea), added: b.slice(start, eb) };
}

function renderHunks(hunks: Hunk[]): { stat: string; diff: string } {
  let plus = 0;
  let minus = 0;
  const out: string[] = [];
  for (const h of hunks) {
    for (const l of h.removed) out.push(`-${l}`);
    for (const l of h.added) out.push(`+${l}`);
    plus += h.added.length;
    minus += h.removed.length;
  }
  return { stat: `+${plus} −${minus}`, diff: out.join("\n") };
}

/** pi's `edit` input: `edits: [{oldText,newText}]` (a model may send it as a JSON string). */
function editPairs(input: Record<string, unknown>): Array<{ oldText: string; newText: string }> {
  let edits: unknown = input.edits;
  if (typeof edits === "string") {
    try {
      edits = JSON.parse(edits);
    } catch {
      edits = undefined;
    }
  }
  const list = Array.isArray(edits) ? edits : [input];
  const out: Array<{ oldText: string; newText: string }> = [];
  for (const e of list) {
    const o = (e ?? {}) as Record<string, unknown>;
    const oldText = str(o.oldText);
    const newText = str(o.newText);
    if (oldText !== undefined && newText !== undefined) out.push({ oldText, newText });
  }
  return out;
}

function readOld(abs: string): string | null | undefined {
  // null = does not exist; undefined = exists but unreadable / too big
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_OLD_FILE_BYTES) return undefined;
    return fs.readFileSync(abs, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "ENOENT" ? null : undefined;
  }
}

function shellSummary(base: SupervisedSummary, input: Record<string, unknown>): SupervisedSummary {
  const command = capText(str(input.command) ?? "");
  return { ...base, title: "Run this command?", command, line: `${base.tool}: ${command}` };
}

function editSummary(base: SupervisedSummary, input: Record<string, unknown>): SupervisedSummary {
  const p = capText(str(input.path) ?? "");
  const { stat, diff } = renderHunks(editPairs(input).map((e) => hunk(e.oldText, e.newText)));
  return { ...base, title: "Edit this file?", path: p, diffStat: stat, diff: capDiff(diff), line: `edit ${p} (${stat})` };
}

function writeSummary(base: SupervisedSummary, input: Record<string, unknown>): SupervisedSummary {
  const rawPath = str(input.path) ?? "";
  const p = capText(rawPath);
  const content = str(input.content) ?? "";
  const abs = rawPath ? nodePath.resolve(base.cwd || ".", rawPath) : "";
  const old = abs ? readOld(abs) : null;
  const created = old === null;
  // Replace: unreadable / oversized old content → show the new content as added only.
  const h: Hunk = old === null || old === undefined ? { removed: [], added: splitLines(content) } : hunk(old, content);
  const { stat, diff } = renderHunks([h]);
  return {
    ...base,
    title: created ? "Create this file?" : "Overwrite this file?",
    path: p,
    diffStat: stat,
    diff: capDiff(diff),
    line: `${created ? "create" : "overwrite"} ${p} (${stat})`,
  };
}

function agentSummary(base: SupervisedSummary, input: Record<string, unknown>): SupervisedSummary {
  const type = str(input.subagent_type) ?? str(input.type) ?? "";
  const task = capText(str(input.prompt) ?? str(input.description) ?? "");
  return {
    ...base,
    title: "Start a subagent?",
    subagentType: type,
    command: task,
    line: `Agent${type ? ` ${type}` : ""}: ${task}`,
    note: "The subagent's own commands and edits are not approved one by one.",
  };
}

/**
 * Build the summary for one tool call. Never throws for odd input — an
 * unrecognised shape degrades to the one-line `tool` summary.
 */
export function buildSupervisedSummary(tool: string, rawInput: unknown, cwd: string): SupervisedSummary {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const name = String(tool ?? "");
  const base: SupervisedSummary = { tool: name, title: `Run tool ${name}?`, line: name, cwd };
  const lower = name.toLowerCase();
  if (isShell(lower)) return shellSummary(base, input);
  if (lower === "edit") return editSummary(base, input);
  if (lower === "write") return writeSummary(base, input);
  if (lower === "agent") return agentSummary(base, input);
  return base;
}

/** Markdown block appended to / forming a prompt `message`. */
export function summaryMarkdown(s: SupervisedSummary): string {
  const parts: string[] = [];
  if (s.subagentType !== undefined) parts.push(`Subagent: \`${s.subagentType || "default"}\``);
  if (s.command !== undefined) parts.push(s.subagentType !== undefined ? `Task:\n\n${s.command}` : `Command:\n\n\`\`\`\n${s.command}\n\`\`\``);
  if (s.path !== undefined) parts.push(`Path: \`${s.path}\`${s.diffStat ? ` (${s.diffStat})` : ""}`);
  if (s.diff) parts.push(`\`\`\`diff\n${s.diff}\n\`\`\``);
  if (s.note) parts.push(s.note);
  parts.push(`Session cwd: \`${s.cwd}\``);
  return parts.join("\n\n");
}

/** Plain-text twin for a terminal (no markdown). Control characters other than newline become `?`. */
export function summaryPlain(s: SupervisedSummary): string {
  const parts: string[] = [];
  if (s.subagentType !== undefined) parts.push(`Subagent: ${s.subagentType || "default"}`);
  if (s.command !== undefined) parts.push(s.subagentType !== undefined ? `Task: ${s.command}` : `Command: ${s.command}`);
  if (s.path !== undefined) parts.push(`Path: ${s.path}${s.diffStat ? ` (${s.diffStat})` : ""}`);
  if (s.diff) parts.push(s.diff);
  if (s.note) parts.push(s.note);
  parts.push(`Session cwd: ${s.cwd}`);
  return parts.join("\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, "?");
}
