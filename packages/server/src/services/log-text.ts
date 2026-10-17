/**
 * Pure text helpers of the logs route: single-pass secret redaction, the
 * whole-line byte cut, and the OCI stdout/stderr timestamp merge.
 * See change: add-services-settings-ui (D5).
 */
import { LOGS_MAX_BYTES, SECRET_MARK_CLOSE, SECRET_MARK_OPEN } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";

/** Smallest secret value the redactor accepts (shorter would garble every line). */
export const MIN_REDACTABLE_LENGTH = 4;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replace every occurrence of every value with `«secret:<name>»` in ONE pass
 * over the raw text: a single alternation, longest value first, so at each
 * position the longest value wins and a value cannot match inside a marker
 * already written. Values are matched on the raw text, before line splitting.
 */
export function redactSecrets(text: string, secrets: Array<{ name: string; value: string }>): string {
  const byValue = new Map<string, string>();
  for (const s of secrets) if (s.value.length > 0 && !byValue.has(s.value)) byValue.set(s.value, s.name);
  if (byValue.size === 0) return text;
  const values = [...byValue.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(values.map(escapeRegExp).join("|"), "g");
  return text.replace(re, (m) => `${SECRET_MARK_OPEN}${byValue.get(m)}${SECRET_MARK_CLOSE}`);
}

/** Lines in the longest value (a value with 2 newlines spans 3 lines). */
export function longestSecretLines(values: string[]): number {
  let n = 1;
  for (const v of values) n = Math.max(n, v.split("\n").length);
  return n;
}

/** Split into lines (CRLF tolerant), drop one trailing empty line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Keep the last `n` lines, then drop WHOLE lines from the start until the
 * response is at most `maxBytes`. The last line is always kept (cut to its tail
 * when it alone exceeds the cap).
 */
export function capLines(lines: string[], n: number, maxBytes = LOGS_MAX_BYTES): string[] {
  const out = lines.slice(-n);
  const size = (l: string) => Buffer.byteLength(l) + 1;
  let total = out.reduce((a, l) => a + size(l), 0);
  while (total > maxBytes && out.length > 1) {
    total -= size(out.shift() as string);
  }
  if (out.length === 1 && total > maxBytes) {
    const buf = Buffer.from(out[0]);
    out[0] = `…${buf.subarray(buf.length - (maxBytes - 4)).toString("utf8")}`;
  }
  return out;
}

interface Stamped {
  ts: string;
  stream: 0 | 1;
  idx: number;
  text: string;
}

const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2}) ?/;

/** Sortable key of an RFC 3339 prefix: seconds + zero-padded nanoseconds (UTC-ish; offsets are rare in docker output). */
function stampKey(m: RegExpExecArray): string {
  return `${m[1]}.${(m[2] ?? "").padEnd(9, "0")}${m[3]}`;
}

function stamped(text: string, stream: 0 | 1): Stamped[] {
  const out: Stamped[] = [];
  let last = "";
  for (const [idx, line] of splitLines(text).entries()) {
    const m = STAMP.exec(line);
    if (m) last = stampKey(m);
    out.push({ ts: m ? stampKey(m) : last, stream, idx, text: m ? line.slice(m[0].length) : line });
  }
  return out;
}

/**
 * docker / podman write container stderr to their own stderr, so a `logs`
 * invocation splits the container's streams across the runner's stdout and
 * stderr. Merge by timestamp, stdout first on equal timestamps, then strip the
 * timestamp prefix.
 */
export function mergeTimestamped(stdout: string, stderr: string): string {
  const all = [...stamped(stdout, 0), ...stamped(stderr, 1)];
  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.stream - b.stream || a.idx - b.idx));
  return all.map((e) => e.text).join("\n");
}
