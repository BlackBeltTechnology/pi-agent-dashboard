/**
 * Session heap argv normalization — the one place that decides how the
 * configured ceiling reaches a spawned pi process.
 *
 * `resolver.resolvePi()` returns either `[<node>, <entry>.js]` (the
 * node-wrapped pair) or a single `[<pi>]` entry. Heap flags are NODE flags, so
 * they only mean anything in a runtime slot ahead of the script — placed after
 * the entry they become pi's own arguments and pi rejects them. This module
 * produces `[<runtime>, …heapArgs, <entry>]` for both shapes, or reports that
 * no runtime slot exists so the caller can take the recorded fallback (D3a).
 *
 * See change: bound-session-heap-and-gc-telemetry (D2, D3a).
 */

import { closeSync, openSync, readSync } from "node:fs";
import type { ResolvedRuntime } from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-runtime.js";

/** Outcome of trying to place heap flags into a pi invocation. */
export interface HeapArgvResult {
  /** The invocation to spawn. Unchanged from the input when `fallback` is true. */
  argv: string[];
  /**
   * True when no runtime slot could be established, so the ceiling could not
   * ride argv. The caller decides what to do (record + env fallback, or refuse
   * on the headless strategy, where an env-borne cap would bind the keeper too).
   */
  fallback: boolean;
}

/**
 * True when `entry` begins with a `node` shebang, i.e. running it as
 * `<node> <entry>` is equivalent to executing it directly.
 *
 * Load-bearing for the single-element invocation. A bare `[<pi>]` is what the
 * resolver returns when the path is NOT a `.js` and does not dereference to
 * one — which covers BOTH an extensionless Node script with a shebang (safe to
 * re-point) and a `pi.cmd` shim or shell wrapper (prepending `node` would
 * produce an invocation that cannot run at all). Guessing is not acceptable
 * here, so the file says which it is.
 *
 * Any read failure answers "no" and the caller falls back — a missing or
 * unreadable entry is not something to paper over with an argv rewrite.
 *
 * Interpreter ARGS on the shebang (`#!/usr/bin/env -S node --expose-gc`) are
 * deliberately not carried over: the rewrite re-points at the resolved runtime,
 * which is the same substitution `applySpawnRuntimeToPiArgv` already makes for
 * the pair shape. pi ships a plain `node` shebang, so this is an accepted
 * equivalence rather than a silent loss.
 */
export function hasNodeShebang(entry: string, read: typeof readFirstLine = readFirstLine): boolean {
  const first = read(entry);
  if (first === null) return false;
  // `\bnode\b` would accept `#!/usr/bin/my-node` and `#!/usr/bin/env node-wrapper`
  // and then re-point that interpreter at the resolved node binary — a silent
  // behaviour change, or a session that cannot start. Require a path or space
  // BEFORE `node` and a space or end-of-line AFTER it.
  return /^#!.*(?:[/\s])node(?:\.exe)?(?:\s|$)/.test(first);
}

/** Read the first line of a file without pulling the whole file into memory. */
function readFirstLine(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(256);
    const bytes = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, bytes).toString("utf8").split("\n", 1)[0] ?? "";
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/**
 * Place `heapArgs` into a runtime slot ahead of pi's entry point.
 *
 * MUST run AFTER `applySpawnRuntimeToPiArgv`: that function detects the
 * `[<node>, <script>.js]` pair by position, and inserting flags between the two
 * elements first would destroy the detection (design D2).
 *
 * @param piCmd  the resolved (and already runtime-re-pointed) pi invocation
 * @param heapArgs  V8 flags; empty ⇒ pass-through, never a fallback
 * @param rt  resolved spawn runtime, used to supply a runtime slot for a
 *            single-element invocation
 */
export function applyHeapArgsToPiArgv(
  piCmd: string[],
  heapArgs: string[],
  rt?: ResolvedRuntime | null,
  shebangCheck: (entry: string) => boolean = hasNodeShebang,
): HeapArgvResult {
  if (heapArgs.length === 0) return { argv: piCmd, fallback: false };
  if (piCmd.length === 0) return { argv: piCmd, fallback: true };

  // The node-wrapped pair: the runtime slot already exists.
  if (piCmd.length >= 2 && /\.[cm]?js$/i.test(piCmd[1])) {
    return { argv: [piCmd[0], ...heapArgs, ...piCmd.slice(1)], fallback: false };
  }

  // Single-element invocation: a runtime slot has to be created, which is only
  // legitimate when the entry really is a Node script.
  const entry = piCmd[0];
  const runtime = rt?.nodeBinary;
  if (piCmd.length === 1 && runtime && shebangCheck(entry)) {
    return { argv: [runtime, ...heapArgs, entry], fallback: false };
  }

  return { argv: piCmd, fallback: true };
}

/**
 * Whether the last-resort `NODE_OPTIONS` fallback has been taken since the
 * server started, and on which mechanism.
 *
 * Process-lifetime state rather than per-spawn: the health endpoint answers
 * "is the fallback in use on this deployment?", which is a property of the
 * resolution environment, not of one spawn. Cleared only by a restart.
 */
let heapFallback: { used: boolean; mechanism?: string; detail?: string } = { used: false };

export function recordHeapArgvFallback(mechanism: string, detail: string): void {
  heapFallback = { used: true, mechanism, detail };
}

export function heapFallbackStatus(): { used: boolean; mechanism?: string; detail?: string } {
  return { ...heapFallback };
}

/** Test-only: forget a recorded fallback. */
export function _resetHeapFallbackForTests(): void {
  heapFallback = { used: false };
}
