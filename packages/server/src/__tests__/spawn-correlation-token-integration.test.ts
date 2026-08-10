/**
 * Integration: verify the kill-fork-kills-parent bug stays fixed.
 *
 * Simulates the race window where parent + fork are both registered in the
 * same cwd and bridges connect in arbitrary order. Asserts the registry
 * resolves each sessionId to its OWN PID via the three-tier link.
 *
 * See change: spawn-correlation-token.
 */
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { mintSpawnToken } from "../auth/spawn-token.js";

function mockProc() {
  return new EventEmitter() as any;
}

function tmpPidFile() {
  return join(mkdtempSync(join(tmpdir(), "spawn-corr-")), "pids.json");
}

describe("spawn-correlation-token: kill-fork-doesn't-kill-parent regression", () => {
  it("two same-cwd spawns: each session resolves to its OWN pid via token", () => {
    // Setup: simulate dashboard spawning parent, then fork, in the same cwd.
    // Each spawn mints a token; registry stores entries by pid + token.
    const registry = createHeadlessPidRegistry({ pidFilePath: tmpPidFile() });
    const tokenParent = mintSpawnToken();
    const tokenFork = mintSpawnToken();
    expect(tokenParent).not.toBe(tokenFork);

    registry.register(1000, "/proj", mockProc(), tokenParent);
    registry.register(1234, "/proj", mockProc(), tokenFork);

    // Bridge connect order is reversed (fork first, parent second) — the
    // worst-case race that produced the original bug.
    expect(registry.linkByToken(tokenFork, "S_fork")).toBe(true);
    expect(registry.linkByToken(tokenParent, "S_parent")).toBe(true);

    // Critical: each session resolves to its OWN pid. Pre-fix this would
    // have given S_fork → 1000 (parent) and S_parent → 1234 (fork) due to
    // cwd-FIFO ordering.
    expect(registry.getPid("S_fork")).toBe(1234);
    expect(registry.getPid("S_parent")).toBe(1000);
  });

  it("legacy bridge fallback: linkByPid is exact even without tokens", () => {
    const registry = createHeadlessPidRegistry({ pidFilePath: tmpPidFile() });
    // Legacy bridges don't send spawnToken; only pid.
    registry.register(1000, "/proj", mockProc()); // no token
    registry.register(1234, "/proj", mockProc()); // no token

    // Race-order register messages, but pid-link is direct lookup.
    expect(registry.linkByPid("S_fork", 1234)).toBe(true);
    expect(registry.linkByPid("S_parent", 1000)).toBe(true);

    expect(registry.getPid("S_fork")).toBe(1234);
    expect(registry.getPid("S_parent")).toBe(1000);
  });

  it("fork registry: per-token keying separates two forks in same cwd", () => {
    const forkRegistry = createPendingForkRegistry();
    const tokenA = mintSpawnToken();
    const tokenB = mintSpawnToken();

    // Two forks issued in the same cwd, each with its own token. Pre-fix
    // (cwd-keyed registry) the second recordFork would overwrite the first.
    forkRegistry.recordFork(tokenA, "parent-A");
    forkRegistry.recordFork(tokenB, "parent-B");

    // Bridge connect order arbitrary; each token resolves to its OWN parent.
    expect(forkRegistry.consumeFork(tokenB)).toBe("parent-B");
    expect(forkRegistry.consumeFork(tokenA)).toBe("parent-A");
  });

  it("stale token (server-restart-mid-spawn) degrades to lower-tier match", () => {
    const registry = createHeadlessPidRegistry({ pidFilePath: tmpPidFile() });
    // Bridge holds an env-var token from before server restart; the new
    // server has no entry for that token. linkByToken returns false; the
    // event-wiring caller falls through to linkByPid.
    registry.register(1000, "/proj", mockProc()); // post-restart entry, no token
    expect(registry.linkByToken("stale_tok_from_old_server", "S")).toBe(false);
    // Caller falls back:
    expect(registry.linkByPid("S", 1000)).toBe(true);
    expect(registry.getPid("S")).toBe(1000);
  });
});
