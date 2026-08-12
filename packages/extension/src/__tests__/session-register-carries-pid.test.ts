/**
 * Every `session_register` the bridge sends SHALL carry `pid`.
 *
 * This is the join that makes termination strategy-agnostic. The server records
 * a spawn PID itself only for the `headless` strategy; for `tmux` / `wsl-tmux`
 * the spawn returns tmux's pid, not pi's, so `session_register.pid` is the ONLY
 * channel by which the server ever learns which process is the session.
 *
 * Without it `handleShutdown` has nothing to escalate to: it unregisters the
 * session and broadcasts `session_removed` while a ~127 MB `pi` keeps running
 * (#452 — measured 21 panes = 21 resident `pi` = 0 session records).
 *
 * Why a SOURCE-level guard: two of the three register sends live in
 * `session-sync.ts` and are reachable from unit tests, but the third — the
 * first register of a fresh session — is inline in the `session_start` handler
 * inside `createExtension`, behind pi's ExtensionRunner. That third one is
 * precisely the one that was missing `pid`, and it was missing it while both
 * testable ones had it. A guard that can only see the reachable sends would
 * have stayed green through the entire bug. This one enumerates the message
 * literals directly, so a NEW register send is covered the day it is written.
 *
 * See change: fix-tmux-session-shutdown-leak (design D6, test-plan #T2).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["bridge.ts", "session-sync.ts"];

/**
 * Extract each object literal that opens with `type: "session_register"`, by
 * brace-matching from the enclosing `{` to its close. Brace counting is enough
 * here because these literals contain no strings with unbalanced braces.
 */
function registerLiterals(source: string): string[] {
  const out: string[] = [];
  const marker = 'type: "session_register"';
  let from = 0;
  while (true) {
    const at = source.indexOf(marker, from);
    if (at === -1) return out;
    from = at + marker.length;
    // Walk back to the `{` that opens this literal.
    const open = source.lastIndexOf("{", at);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          out.push(source.slice(open, i + 1));
          break;
        }
      }
    }
  }
}

describe("session_register carries the session's pid (#452)", () => {
  const literals = FILES.flatMap((f) => registerLiterals(readFileSync(join(SRC, f), "utf8")));

  it("finds every session_register send (guard against a silently empty scan)", () => {
    // A brace-matcher that quietly matched nothing would make this whole file
    // vacuous — the failure mode the rest of this change exists to reject.
    expect(literals.length).toBeGreaterThanOrEqual(3);
  });

  it.each(FILES)("%s: every session_register includes pid", (file) => {
    const found = registerLiterals(readFileSync(join(SRC, file), "utf8"));
    expect(found.length).toBeGreaterThan(0);
    for (const literal of found) {
      expect(
        literal,
        `a session_register in ${file} omits pid — the server cannot terminate a tmux-spawned session without it (#452)`,
      ).toMatch(/\bpid:\s*process\.pid\b/);
    }
  });

  /**
   * The FIRST register of a fresh session also omitted `spawnToken`, so tier-1
   * (strong-identity) spawn correlation never fired for a dashboard-spawned
   * session: the watchdog could only match by cwd, and three concurrent spawns
   * into one directory produced false register-timeouts for two of them.
   *
   * Only the FIRST register carries it (the token is single-use and scrubbed),
   * so this asserts at least one send per file rather than all of them.
   */
  it.each(FILES)("%s: at least one session_register echoes the spawn token", (file) => {
    const found = registerLiterals(readFileSync(join(SRC, file), "utf8"));
    expect(
      found.some((literal) => /\bspawnToken\b/.test(literal)),
      `no session_register in ${file} echoes spawnToken \u2014 tier-1 spawn correlation cannot fire`,
    ).toBe(true);
  });
});
