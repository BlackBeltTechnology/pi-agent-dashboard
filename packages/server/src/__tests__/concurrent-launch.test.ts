/**
 * Integration test — concurrent launches.
 *
 * Simulates two dashboard startups racing for the same per-HOME lock.
 * Asserts that exactly one wins (`acquired`) and the other falls back
 * cleanly (`attach` OR `InstanceLockMismatchError`, depending on liveness
 * of the winner's probe).
 *
 * Uses real tmp dirs (not memfs) because proper-lockfile requires real
 * filesystem semantics.
 *
 * See change: single-dashboard-per-home, task 12.1.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireOrAttach, InstanceLockMismatchError } from "../lifecycle/home-lock.js";

let tmpHome: string;
let lockPath: string;
let metaPath: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-concurrent-"));
  lockPath = path.join(tmpHome, ".pi", "dashboard", "server.lock");
  metaPath = `${lockPath}.meta.json`;
});

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("concurrent launch", () => {
  it("exactly one of two parallel acquireOrAttach calls wins the lock", async () => {
    // Both attempts race. Whichever wins first gets `acquired`. The loser
    // sees ELOCKED; because our probe says the winner is "not alive" (we
    // intentionally return dead to avoid racing the probe), the loser
    // steals the stale lock and also acquires. That's not right for
    // same-HOME same-instant races — we need the loser to SEE the winner.
    //
    // To mimic reality: make isProcessAlive true (process IS alive) and
    // have the probe treat the metadata's identity as authoritative.
    const hookFactory = () => ({
      lockPath, metaPath, staleMs: 5_000,
      isProcessAlive: () => true,
      probeHealth: async () => {
        // Read the live metadata file and echo back its identity — this
        // models a working /api/health from the winner.
        try {
          const raw = fs.readFileSync(metaPath, "utf-8");
          const m = JSON.parse(raw) as { identity?: string; pid?: number };
          if (m && typeof m.identity === "string") {
            return { running: true, identity: m.identity, pid: m.pid };
          }
        } catch { /* metadata not yet written */ }
        return { running: true, pid: process.pid };
      },
    });

    const cfg = (id: string) => ({
      httpPort: 8000, piPort: 9999, version: "t",
      identity: id,
      hooks: hookFactory(),
    });

    const [a, b] = await Promise.allSettled([
      acquireOrAttach(cfg("racer-A")),
      acquireOrAttach(cfg("racer-B")),
    ]);

    // Count outcomes.
    const outcomes = [a, b].map(r => {
      if (r.status === "rejected") return "error";
      return r.value.mode;
    });

    // Exactly one winner, and the loser is either "attach" or "error"
    // (identity mismatch if the winner's identity appears in metadata
    // before the loser reads it).
    const winners = outcomes.filter(o => o === "acquired");
    expect(winners).toHaveLength(1);

    const losers = outcomes.filter(o => o !== "acquired");
    expect(losers).toHaveLength(1);
    expect(["attach", "error"]).toContain(losers[0]);

    // Cleanup: release whichever won.
    for (const r of [a, b]) {
      if (r.status === "fulfilled" && r.value.mode === "acquired") {
        await r.value.release();
      }
    }
  });

  it("the winning identity is persisted to metadata", async () => {
    const first = await acquireOrAttach({
      httpPort: 8000, piPort: 9999, version: "t",
      identity: "winner",
      hooks: { lockPath, metaPath, staleMs: 5_000 },
    });
    expect(first.mode).toBe("acquired");

    const raw = fs.readFileSync(metaPath, "utf-8");
    const meta = JSON.parse(raw) as { identity: string };
    expect(meta.identity).toBe("winner");

    if (first.mode === "acquired") await first.release();
  });
});
