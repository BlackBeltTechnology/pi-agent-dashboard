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

export type GuardMode = "off" | "warn" | "block";

/** Tool calls that ARE search actions (raw-search tools). Bash is parsed. */
const SEARCH_TOOLS = new Set(["grep", "glob", "rg", "find", "ls", "ag", "ack"]);
/** Bash binaries that lead a counting segment (D8). */
const SEARCH_BINARIES = new Set(["grep", "egrep", "fgrep", "rg", "ripgrep", "ag", "ack", "ack-grep", "find", "fd", "fdfind", "ls"]);
/** Knowledge access — the ONLY reset (D7). */
const KB_TOOLS = new Set(["kb_search", "kb_neighbors", "kb_get"]);

/** Consecutive search actions before the first firing. */
export const CHAIN_THRESHOLD = 3;
/** Suspension clamp (D9). */
export const PAUSE_MIN = 1;
export const PAUSE_MAX = 20;

export interface GuardInput {
  command?: string;
  query?: string;
  path?: string;
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

/** Resolve the effective guard mode. Precedence: the env override wins ONLY
 *  when it selects a legal weak value (off | warn); `block` or junk in the env
 *  is ignored, so a stray CI variable can never enable blocking (D14/E22). */
export function resolveGuardMode(configMode: GuardMode | undefined, env: string | undefined): GuardMode {
  const cfg: GuardMode = configMode === "off" || configMode === "block" ? configMode : "warn";
  if (env === "off" || env === "warn") return env;
  return cfg;
}

export type GuardVerdict = string | { block: true; reason: string } | null;

export interface GuardState {
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
    if (toolName === "bash") return bashSegments(input?.command ?? "").some((seg) => SEARCH_BINARIES.has(firstToken(seg)));
    return SEARCH_TOOLS.has(toolName);
  };

  const warnText = () =>
    `[kb] ${CHAIN_THRESHOLD} consecutive searches without consulting the knowledge base. Run kb_search for what you are looking for before the next source search — the kb indexes docs this repo's markdown answers directly.`;
  const escalateText = () =>
    `[kb] Repeated source searching, still no kb consult. Stop and run kb_search (or kb agents <path> / kb get) now — if the kb has no answer, carry on; the guard only asks that you check.`;

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
    },
    suspend(turns: number | string): number {
      const n = typeof turns === "number" ? turns : Number(turns);
      if (!Number.isFinite(n) || n <= 0) return suspended; // junk / non-positive no-op
      suspended = Math.max(suspended, Math.min(PAUSE_MAX, Math.trunc(n)));
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
