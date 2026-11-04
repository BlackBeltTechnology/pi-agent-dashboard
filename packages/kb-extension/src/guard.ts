// Pure search-guard core (arm B of add-kb-trust-verdicts-and-search-guard).
//
// Counts consecutive search actions taken without any knowledge-access call
// and escalates across firings: warn → escalate → (block mode only) refuse.
// Adapted from Heimdall's kb-guard-core.mjs (MIT) — same split: this module is
// a zero-dep state machine with NO pi imports, so it tests under plain vitest;
// extension.ts owns the thin hook wiring (5.2–5.4).
//
// Semantics fixed by the change's design:
//   D7  — only knowledge access resets (kb_search/kb_neighbors/kb_get tool
//         calls, or bash invoking the kb CLI); edits do NOT reset; resets are
//         CLEAN-SLATE (chain AND firings) and processed BEFORE counting.
//   D8  — bash is segment-parsed on `| || && ;` + newline; a segment counts
//         when it LEADS with a file-search binary. Env prefixes (FOO=1 rg) and
//         wrappers (timeout 60 rg) evade it — a nudge, not a sandbox.
//   D9  — kb_guard_pause: agent self-service suspension, 1–20 turns, ticked on
//         turn_start, expiring to a clean slate.
//   D14 — the env override can weaken, never strengthen: KB_GUARD_MODE may
//         select off/warn only; `block` requires a config-file edit.

import type { GuardMode } from "@blackbelt-technology/pi-dashboard-kb";

/** Tool calls that ARE search actions (raw-search tools). Bash is parsed. */
const SEARCH_TOOLS = new Set(["grep", "glob", "rg", "find", "ls", "ag", "ack"]);
/** Bash binaries that lead a counting segment (D8). */
const SEARCH_BINARIES = new Set(["grep", "egrep", "fgrep", "rg", "ripgrep", "ag", "ack", "ack-grep", "find", "fd", "fdfind", "ls"]);
/** File-read binaries: a segment leading with one counts only when it names a
 *  kb-indexed file (`GuardInput.isIndexedPath`). See change: fix-kb-get-roots-and-guard (D5). */
const READ_BINARIES = new Set(["cat", "head", "tail", "sed", "less", "more", "bat"]);
/** Knowledge access — the ONLY reset (D7). */
const KB_TOOLS = new Set(["kb_search", "kb_neighbors", "kb_get"]);

/** Consecutive search actions before the first firing. */
const CHAIN_THRESHOLD = 3;
/** Suspension clamp (D9). */
const PAUSE_MIN = 1;
const PAUSE_MAX = 20;

export interface GuardInput {
  command?: string;
  query?: string;
  path?: string;
  /** Injected by the extension per call (cwd-aware). Absent → file reads never
   *  count; a throw degrades to not counting. The guard never queries a store. */
  isIndexedPath?: (arg: string) => boolean;
}

/** Split a bash command into segments on `|`, `||`, `&&`, `;`, and newline (D8). */
export function bashSegments(command: string): string[] {
  return command
    .split(/\|\||&&|\||;|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstToken(segment: string): string {
  return segment.split(/\s+/)[0] ?? "";
}

const unquote = (t: string): string => t.replace(/^(['"])(.*)\1$/, "$2");

/** A read-binary segment that names an indexed file (D5). `sed -i` is a write;
 *  `sed`'s script (first non-flag token when no -e/-f) is skipped. A predicate
 *  throw counts as "not indexed". */
function isIndexedRead(segment: string, isIndexedPath: ((arg: string) => boolean) | undefined): boolean {
  if (!isIndexedPath) return false;
  const [bin, ...rest] = segment.split(/\s+/);
  if (!READ_BINARIES.has(bin ?? "")) return false;
  let args = rest;
  if (bin === "sed") {
    if (rest.some((a) => a === "-i" || a.startsWith("-i") || a === "--in-place" || a.startsWith("--in-place="))) return false;
    if (!rest.some((a) => a === "-e" || a === "-f" || a.startsWith("--expression") || a.startsWith("--file"))) {
      const script = rest.findIndex((a) => !a.startsWith("-"));
      args = rest.filter((_, i) => i !== script);
    }
  }
  return args.some((a) => {
    if (!a || a.startsWith("-")) return false;
    try {
      return isIndexedPath(unquote(a));
    } catch {
      return false;
    }
  });
}

/** Resolve the effective guard mode. Precedence: the env override wins ONLY
 *  when it selects a legal weak value (off | warn); `block` or junk in the env
 *  is ignored, so a stray CI variable can never enable blocking (D14/E22). */
export function resolveGuardMode(configMode: GuardMode | undefined, env: string | undefined): GuardMode {
  const cfg: GuardMode = configMode === "off" || configMode === "block" ? configMode : "warn";
  if (env === "off" || env === "warn") return env;
  return cfg;
}

export type GuardVerdict = string | { block: true; reason: string } | null;

interface GuardState {
  chain: number;
  firings: number;
  suspended: number;
  mode: GuardMode;
}

export interface KbGuard {
  /** Feed ONE tool invocation. Returns a warning/escalation string, a block
   *  verdict (block mode, ladder exhausted), or null. kb reset tools are
   *  processed BEFORE counting; empty kb queries still reset (an attempt to
   *  consult is a consult). */
  note(toolName: string, input?: GuardInput): GuardVerdict;
  /** Self-service suspension (D9): clamped to 1–20, junk/non-positive is a
   *  no-op, re-suspending never shortens an active pause. */
  suspend(turns: number | string): number;
  /** One model turn elapsed — decrements an active suspension; expiry
   *  restores a clean slate (chain 0, firings 0). */
  tickTurn(): void;
  state(): GuardState;
}

export function createGuard(opts: { mode?: GuardMode } = {}): KbGuard {
  let chain = 0;
  let firings = 0;
  let suspended = 0;
  const mode: GuardMode = opts.mode === "off" || opts.mode === "block" ? opts.mode : "warn";

  const reset = () => {
    chain = 0;
    firings = 0;
  };
  const isReset = (toolName: string, input?: GuardInput): boolean => {
    if (KB_TOOLS.has(toolName)) return true;
    if (toolName === "bash") return bashSegments(input?.command ?? "").some((seg) => firstToken(seg) === "kb");
    return false;
  };

  const isSearchAction = (toolName: string, input?: GuardInput): boolean => {
    if (toolName === "bash")
      return bashSegments(input?.command ?? "").some((seg) => SEARCH_BINARIES.has(firstToken(seg)) || isIndexedRead(seg, input?.isIndexedPath));
    return SEARCH_TOOLS.has(toolName);
  };

  const warnText = () =>
    `[kb] ${CHAIN_THRESHOLD} consecutive searches without consulting the knowledge base. Run kb_search for what you are looking for before the next source search — the kb indexes docs this repo's markdown answers directly.`;
  const escalateText = () =>
    `[kb] Repeated source searching, still no kb consult. Your next call should be kb_search (or kb_get <path> for a file you are about to read).`;

  /** The ladder, reached only when the chain crosses the threshold. */
  const ladder = (): GuardVerdict => {
    firings++;
    if (firings === 1) return warnText();
    if (firings === 2) return escalateText();
    if (mode === "block") {
      return {
        block: true,
        reason:
          "Search blocked by the kb read-discipline guard (mode=block): consult the knowledge base first — run kb_search for what you are looking for. A kb call or kb_guard_pause re-enables search.",
      };
    }
    return escalateText(); // warn mode never blocks (E20)
  };

  return {
    note(toolName: string, input?: GuardInput): GuardVerdict {
      if (mode === "off") return null; // inert by construction
      if (suspended > 0) return null; // D9: suspension silences everything
      // Reset BEFORE counting (spec: resets processed before the action counts).
      if (isReset(toolName, input)) {
        reset();
        return null;
      }
      if (!isSearchAction(toolName, input)) return null;
      chain++;
      if (chain % CHAIN_THRESHOLD !== 0) return null;
      return ladder();
    },
    suspend(turns: number | string): number {
      if (mode === "off") return 0; // inert mode takes no suspension state
      const n = typeof turns === "number" ? turns : Number(turns);
      if (!Number.isFinite(n) || n <= 0) return suspended; // junk / non-positive no-op
      suspended = Math.max(suspended, Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, Math.trunc(n))));
      return suspended;
    },
    tickTurn(): void {
      if (suspended > 0) {
        suspended--;
        if (suspended === 0) reset(); // expiry → clean slate
      }
    },
    state(): GuardState {
      return { chain, firings, suspended, mode };
    },
  };
}

/** Fault-isolated feed for the hook wiring (X1): any failure inside the guard
 *  leaves the caller's flow untouched — the tool call proceeds, the result is
 *  returned unmodified. */
export function guardNoteSafe(guard: KbGuard | null | undefined, toolName: string, input?: GuardInput): GuardVerdict {
  try {
    return guard ? guard.note(toolName, input) : null;
  } catch {
    return null;
  }
}
