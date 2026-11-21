/**
 * CLI flag parsing + validation (pure; no I/O). Invalid flags are a usage error
 * (exit 1) raised before any side effect.
 *
 * See change: add-ship-batch-orchestrator (D2, D4).
 */

export interface CliArgs {
  group?: string;
  cwd?: string;
  parallel: number;
  maxLive: number;
  model: string;
  nudges: number;
  settleMs: number;
  startTimeoutMs: number;
  dryRun: boolean;
  status: boolean;
}

export type ParseResult = { ok: true; args: CliArgs } | { ok: false; error: string };

export const DEFAULT_PARALLEL = 2;
export const DEFAULT_MODEL = "@coding";
export const DEFAULT_NUDGES = 1;
export const DEFAULT_SETTLE_MS = 30_000;
export const DEFAULT_START_TIMEOUT_MS = 5 * 60_000;

export const USAGE =
  "usage: ship-batch.ts --group <id|name> [--cwd <dir>] [--parallel N=2] [--max-live M=2N] " +
  "[--model @coding] [--nudges K=1] [--settle 30s] [--start-timeout 5m] [--dry-run] [--status]";

/** `30`, `30s`, `5m`, `1h` → ms; `null` when malformed or not positive. */
export function parseDuration(raw: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  const ms = unit === "ms" ? n : unit === "s" ? n * 1000 : unit === "m" ? n * 60_000 : n * 3_600_000;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function parseInteger(raw: string, min: number): number | null {
  if (!/^-?\d+(?:\.\d+)?$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : null;
}

const VALUE_FLAGS = new Set([
  "--group",
  "--cwd",
  "--parallel",
  "--max-live",
  "--model",
  "--nudges",
  "--settle",
  "--start-timeout",
]);

interface Scanned {
  raw: Map<string, string>;
  dryRun: boolean;
  status: boolean;
}

/** `--flag=value` → [flag, value]; anything else → [arg, undefined]. */
function splitFlag(arg: string): [string, string | undefined] {
  const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
  return eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined];
}

/** Split argv into flag values and the two boolean switches; `string` = usage error. */
function scan(argv: readonly string[]): Scanned | string {
  const out: Scanned = { raw: new Map(), dryRun: false, status: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = splitFlag(argv[i]);
    if (flag === "--dry-run") out.dryRun = true;
    else if (flag === "--status") out.status = true;
    else if (!VALUE_FLAGS.has(flag)) return `unknown argument: ${flag}\n${USAGE}`;
    else {
      const value = inline ?? argv[++i];
      if (value === undefined || (inline === undefined && value.startsWith("--"))) return `${flag} needs a value\n${USAGE}`;
      out.raw.set(flag, value);
    }
  }
  return out;
}

type Num = { ok: true; value: number } | { ok: false; error: string };

function intFlag(raw: Map<string, string>, flag: string, min: number, fallback: number, what: string): Num {
  const v = raw.get(flag);
  if (v === undefined) return { ok: true, value: fallback };
  const n = parseInteger(v, min);
  return n === null ? { ok: false, error: `${flag} must be ${what} (got "${v}")` } : { ok: true, value: n };
}

function durationFlag(raw: Map<string, string>, flag: string, fallback: number, example: string): Num {
  const v = raw.get(flag);
  if (v === undefined) return { ok: true, value: fallback };
  const n = parseDuration(v);
  return n === null ? { ok: false, error: `${flag} must be a duration like ${example} (got "${v}")` } : { ok: true, value: n };
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const scanned = scan(argv);
  if (typeof scanned === "string") return { ok: false, error: scanned };
  const { raw, dryRun, status } = scanned;

  const parallel = intFlag(raw, "--parallel", 1, DEFAULT_PARALLEL, "an integer >= 1");
  if (!parallel.ok) return parallel;
  const maxLive = intFlag(raw, "--max-live", 1, 2 * parallel.value, "an integer");
  if (!maxLive.ok) return maxLive;
  // max-live == N would stop a question from ever freeing a slot (D2).
  if (maxLive.value <= parallel.value) {
    return { ok: false, error: `--max-live (${maxLive.value}) must be greater than --parallel (${parallel.value})` };
  }
  const nudges = intFlag(raw, "--nudges", 0, DEFAULT_NUDGES, "an integer >= 0");
  if (!nudges.ok) return nudges;
  const settleMs = durationFlag(raw, "--settle", DEFAULT_SETTLE_MS, "30s");
  if (!settleMs.ok) return settleMs;
  const startTimeoutMs = durationFlag(raw, "--start-timeout", DEFAULT_START_TIMEOUT_MS, "5m");
  if (!startTimeoutMs.ok) return startTimeoutMs;

  const model = raw.get("--model") ?? DEFAULT_MODEL;
  if (!model.trim()) return { ok: false, error: "--model must not be empty" };
  const group = raw.get("--group");
  if (!group?.trim() && !status) return { ok: false, error: `--group is required\n${USAGE}` };
  if (dryRun && status) return { ok: false, error: "--dry-run and --status are mutually exclusive" };

  return {
    ok: true,
    args: {
      group,
      cwd: raw.get("--cwd"),
      parallel: parallel.value,
      maxLive: maxLive.value,
      model,
      nudges: nudges.value,
      settleMs: settleMs.value,
      startTimeoutMs: startTimeoutMs.value,
      dryRun,
      status,
    },
  };
}
