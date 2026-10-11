/**
 * Error detection, error signatures, command heads and fixes (design M3).
 */
import type { CallEv, Ev, ResEv } from "./events.js";

const FIX_WINDOW = 15;
const SIGNATURE_MAX = 70;

const EXIT_CODE = /exited with code (\d+)/g;

/** A result is an error when `isError` is set, or a non-zero `exited with code` is in its last 300 chars. */
export function isErrorResult(r: Pick<ResEv, "isError" | "text">): boolean {
  if (r.isError) return true;
  const tail = r.text.slice(-300);
  for (const m of tail.matchAll(EXIT_CODE)) if (m[1] !== "0") return true;
  return false;
}

const ERROR_LIKE = /error|fail|exception|cannot|can't|not found|denied|invalid|unexpected|exited with code|no such|refused|abort|fatal/i;

/** First error-like line of a result text (raw, untrimmed of content), else the first non-empty line. */
function errorLine(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => ERROR_LIKE.test(l)) ?? lines[0] ?? "";
}

/** Mask quoted strings, paths, hex ids and numbers so recurrences compare equal. */
function maskLine(line: string): string {
  return line
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "Q")
    .replace(/(?:~|\.{0,2})?(?:[A-Za-z]:)?[\\/][^\s:,;()]*|\b[\w.-]+\.(?:[cm]?[jt]sx?|json|md|ya?ml|sh|py|log|db)\b/g, "P")
    .replace(/\b[0-9a-f]{7,}\b/gi, "H")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim();
}

export function signatureOf(tool: string, text: string): string {
  return `${tool}|${maskLine(errorLine(text)).slice(0, SIGNATURE_MAX)}`;
}

const GENERIC = [
  /\(no output\)/i,
  /ENOENT/,
  /could not find the exact text|oldtext|old text|no changes made/i,
  /timed? ?out|timeout/i,
  /validation failed|invalid (parameters|arguments)|must have required property|missing required|tool .*not found/i,
];

export function isGenericSignature(sig: string): boolean {
  return GENERIC.some((re) => re.test(sig));
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Command head: skips `cd x &&` and `VAR=` prefixes; two words, unless the 2nd is a flag or path. */
function bashHead(command: string): string {
  const segments = command.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter(Boolean);
  const seg = segments.find((s) => !/^cd(\s|$)/.test(s)) ?? segments[0] ?? "";
  const toks = seg.split(/\s+/).filter(Boolean);
  while (toks.length && ENV_ASSIGN.test(toks[0])) toks.shift();
  if (!toks.length) return "";
  const second = toks[1];
  if (second && !second.startsWith("-") && !/[/\\.]/.test(second)) return `${toks[0]} ${second}`;
  return toks[0];
}

function headOf(call: Pick<CallEv, "tool" | "args">): string {
  if (call.tool === "bash") return bashHead(String(call.args.command ?? ""));
  return call.tool;
}

/** Query: failing head + up to 10 words of the error line, path-like tokens dropped. */
export function faultQuery(head: string, text: string): string {
  const words = errorLine(text)
    .split(/\s+/)
    .filter((w) => w && !/[/\\]/.test(w) && !w.startsWith("~"))
    .slice(0, 10);
  return [head, ...words].join(" ").trim();
}

export interface FailureOccurrence {
  session: string;
  signature: string;
  resultIdx: number;
  result: ResEv;
  call: CallEv;
  head: string;
  /** A same-tool success within FIX_WINDOW events whose head differs. */
  fixChanged: boolean;
  /** A same-tool success within FIX_WINDOW events (any head). */
  fixed: boolean;
  /** Timestamp (epoch ms) of that fix's result; null when there is none. */
  fixMs: number | null;
}

/** Soonest same-tool success within FIX_WINDOW events after `from`; null when there is none. */
function findFix(events: Ev[], from: number, call: CallEv, results: Map<string, ResEv>): { call: CallEv; resultMs: number } | null {
  for (let j = from + 1; j <= from + FIX_WINDOW && j < events.length; j++) {
    const c = events[j];
    if (c.kind !== "call" || c.tool !== call.tool) continue;
    const r = results.get(c.id);
    if (r && !isErrorResult(r)) return { call: c, resultMs: r.ms };
  }
  return null;
}

/** Find every failure in one session's ordered events, with its fix classification. */
export function failuresIn(session: string, events: Ev[]): FailureOccurrence[] {
  const calls = new Map<string, CallEv>();
  const results = new Map<string, ResEv>();
  for (const e of events) {
    if (e.kind === "call") calls.set(e.id, e);
    else if (e.kind === "res") results.set(e.id, e);
  }
  const out: FailureOccurrence[] = [];
  events.forEach((e, i) => {
    const call = e.kind === "res" && isErrorResult(e) ? calls.get(e.id) : undefined;
    if (e.kind !== "res" || !call) return;
    const head = headOf(call);
    const fix = findFix(events, i, call, results);
    out.push({ session, signature: signatureOf(e.tool || call.tool, e.text), resultIdx: i, result: e, call, head, fixChanged: fix !== null && headOf(fix.call) !== head, fixed: fix !== null, fixMs: fix?.resultMs ?? null });
  });
  return out;
}
