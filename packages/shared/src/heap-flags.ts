/**
 * V8 heap FLAG plumbing — the flag tokens themselves, the provenance marker,
 * and the surgical strip. Pure string/record work, no Node imports, so every
 * package (server, extension, client tests) can use one implementation.
 *
 * Why a marker rather than sniffing for the flag (design D4): the dashboard
 * stamps `--max-old-space-size` into its OWN environment on every launch path,
 * so "is the flag present?" matches the dashboard's own stamp. A sniffing strip
 * would either never fire or would eat an operator's deliberate pin. The
 * launcher that writes the flag also records the exact token it wrote; the
 * strip fires only on an exact match.
 *
 * See change: bound-session-heap-and-gc-telemetry (D1, D4).
 */

import { MIN_HEAP_MB, type SessionHeapConfig } from "./heap-limits.js";

/**
 * Env var naming the exact `NODE_OPTIONS` token the dashboard stamped. Rides
 * the environment so it survives `/api/restart`, which re-spawns with
 * `env: process.env` — the flag and its provenance travel together or the
 * restart would silently reclassify the dashboard's own flag as operator-pinned.
 */
export const HEAP_FLAG_MARKER_ENV = "PI_DASHBOARD_HEAP_FLAG";

/** `--max-old-space-size=<mb>`. The one place this token is spelled. */
export function maxOldSpaceFlag(mb: number): string {
  return `--max-old-space-size=${mb}`;
}

/**
 * Matches EITHER spelling of the old-space flag. V8 accepts the underscore
 * form (`--max_old_space_size=1024` → 1216 MB limit, verified) and resolves a
 * repeated flag LAST-WINS, so a detector that only knows the hyphen form would
 * append the dashboard's own value after an operator's underscore pin and
 * silently defeat it.
 *
 * The source string is re-derived by `packages/server/bin/pi-dashboard.mjs`,
 * which runs before jiti and cannot import this module; a test asserts the two
 * stay in lockstep.
 */
export const MAX_OLD_SPACE_FLAG_PATTERN = "^--max[-_]old[-_]space[-_]size";

const MAX_OLD_SPACE_RE = new RegExp(MAX_OLD_SPACE_FLAG_PATTERN);

/**
 * True when `mb` may be placed into a process argv or a shell command string:
 * a finite integer at or above the floor.
 *
 * `loadConfig` already applies this, but the check is repeated AT THE BOUNDARY
 * on purpose — config-derived numbers are interpolated into a spawned argv and,
 * on the tmux path, into a shell-escaped pane command. A caller that reached
 * here with an unvalidated value must not be able to emit `--max-old-space-size=lots`.
 */
export function isValidHeapMb(mb: unknown): mb is number {
  return typeof mb === "number" && Number.isFinite(mb) && Number.isInteger(mb) && mb >= MIN_HEAP_MB;
}

/**
 * The V8 argv flags for a session heap config, in a stable order. Any field
 * that fails boundary validation is DROPPED rather than emitted — a bad value
 * costs its own flag, never a malformed token in a process argument list.
 *
 * `maxSemiSpaceMb` sizes the young generation in single-digit MB, so it is
 * validated as a plain positive integer rather than against the old-space floor.
 */
export function buildSessionHeapArgs(heap: SessionHeapConfig): string[] {
  const args: string[] = [];
  if (isValidHeapMb(heap.maxOldSpaceMb)) args.push(maxOldSpaceFlag(heap.maxOldSpaceMb));
  if (isValidHeapMb(heap.initialOldSpaceMb)) {
    args.push(`--initial-old-space-size=${heap.initialOldSpaceMb}`);
  }
  const semi = heap.maxSemiSpaceMb;
  if (typeof semi === "number" && Number.isInteger(semi) && semi > 0) {
    args.push(`--max-semi-space-size=${semi}`);
  }
  return args;
}

/**
 * The subset `NODE_OPTIONS` accepts. `--initial-old-space-size` is REJECTED by
 * the allow-list (`node: --initial-old-space-size= is not allowed in
 * NODE_OPTIONS`) and a child carrying it refuses to boot, so the env-borne
 * routes (tmux per-window `-e`, the last-resort fallback) carry only this.
 */
export function buildSessionHeapNodeOptions(heap: SessionHeapConfig): string {
  const parts: string[] = [];
  if (isValidHeapMb(heap.maxOldSpaceMb)) parts.push(maxOldSpaceFlag(heap.maxOldSpaceMb));
  const semi = heap.maxSemiSpaceMb;
  if (typeof semi === "number" && Number.isInteger(semi) && semi > 0) {
    parts.push(`--max-semi-space-size=${semi}`);
  }
  return parts.join(" ");
}

/**
 * Stamp the dashboard's own old-space ceiling into an environment, recording
 * the exact token written in the provenance marker.
 *
 * An operator-pinned `--max-old-space-size` already in `NODE_OPTIONS` is NOT
 * overridden — but only when it is genuinely theirs: a token this function
 * itself wrote (marker matches) is re-stamped, so a restart that inherits the
 * environment adopts a changed configuration instead of freezing the old value.
 */
export function stampHeapFlag<T extends Record<string, string>>(
  env: T,
  maxOldSpaceMb: number,
): T {
  if (!isValidHeapMb(maxOldSpaceMb)) return env;
  const flag = maxOldSpaceFlag(maxOldSpaceMb);
  const existing = env["NODE_OPTIONS"] ?? "";
  const ours = env[HEAP_FLAG_MARKER_ENV];
  const tokens = existing.split(/\s+/).filter(Boolean);
  const pinnedByOperator = tokens.some((t) => MAX_OLD_SPACE_RE.test(t) && t !== ours);
  if (pinnedByOperator) {
    // Leave their value alone — but still drop OUR stale token alongside the
    // marker. V8 is last-wins, so a leftover token of ours sitting after their
    // pin would override the very value this branch chose to respect.
    const keptForPin = tokens.filter((t) => t !== ours);
    if (keptForPin.length === 0) delete (env as Record<string, string>)["NODE_OPTIONS"];
    else (env as Record<string, string>)["NODE_OPTIONS"] = keptForPin.join(" ");
    delete (env as Record<string, string>)[HEAP_FLAG_MARKER_ENV];
    return env;
  }
  const kept = tokens.filter((t) => t !== ours);
  (env as Record<string, string>)["NODE_OPTIONS"] = [...kept, flag].join(" ");
  (env as Record<string, string>)[HEAP_FLAG_MARKER_ENV] = flag;
  return env;
}

/**
 * Remove the dashboard's OWN heap token — and only it — from a child
 * environment, so the server's ceiling stops reaching pi sessions and, through
 * them, every Node tool an agent runs.
 *
 * Provenance-gated: no marker, or a marker that does not match a token actually
 * present, means the operator owns whatever is there and nothing is touched.
 * Mismatch is the SAFE case (worst outcome is today's inherited-flag behavior,
 * never a wrong cap).
 *
 * The marker is dropped alongside the token it describes: leaving it would name
 * a flag that is no longer present, and a server this session later
 * bridge-launches must not read a stale marker as its own stamp.
 *
 * Mutates and returns `env` (callers already hold a defensive copy).
 */
export function stripDashboardHeapFlag(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const marker = env[HEAP_FLAG_MARKER_ENV];
  if (!marker) return env;
  const existing = env["NODE_OPTIONS"];
  if (typeof existing !== "string" || !existing.includes(marker)) {
    // Marker without a matching token: it describes a flag that is not here.
    delete env[HEAP_FLAG_MARKER_ENV];
    return env;
  }
  const kept = existing.split(/\s+/).filter((t) => t && t !== marker);
  if (kept.length === 0) delete env["NODE_OPTIONS"];
  else env["NODE_OPTIONS"] = kept.join(" ");
  delete env[HEAP_FLAG_MARKER_ENV];
  return env;
}
