/**
 * Integration test — crash recovery.
 *
 * Simulates the "SIGKILL, no cleanup" case:
 *   1. Acquire lock
 *   2. Skip release() (simulated crash)
 *   3. Attempt to acquire again from a different caller
 *   4. Assert: stale detection fires, new caller acquires cleanly
 *
 * See change: single-dashboard-per-home, task 12.2.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireOrAttach } from "../lifecycle/home-lock.js";

let tmpHome: string;
let lockPath: string;
let metaPath: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crash-"));
  lockPath = path.join(tmpHome, ".pi", "dashboard", "server.lock");
  metaPath = `${lockPath}.meta.json`;
});

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("crash recovery", () => {
  it("steals a stale lock when the previous holder's process is dead", async () => {
    // First acquire — simulate a dead process.
    const first = await acquireOrAttach({
      httpPort: 8000, piPort: 9999, version: "t",
      identity: "dead-holder",
      hooks: { lockPath, metaPath, staleMs: 1 },
    });
    expect(first.mode).toBe("acquired");
    // INTENTIONALLY don't release.

    // Allow stale threshold to elapse.
    await new Promise(r => setTimeout(r, 50));

    const second = await acquireOrAttach({
      httpPort: 8000, piPort: 9999, version: "t",
      identity: "recovery",
      hooks: {
        lockPath, metaPath, staleMs: 1,
        isProcessAlive: () => false,           // previous holder is dead
        probeHealth: async () => ({ running: false }),
      },
    });
    expect(second.mode).toBe("acquired");

    // Metadata now reflects the new holder.
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as { identity: string };
    expect(meta.identity).toBe("recovery");

    if (second.mode === "acquired") await second.release();
  });

  it("cleans up the metadata sidecar on graceful release", async () => {
    const r = await acquireOrAttach({
      httpPort: 8000, piPort: 9999, version: "t",
      hooks: { lockPath, metaPath, staleMs: 1_000 },
    });
    expect(r.mode).toBe("acquired");
    expect(fs.existsSync(metaPath)).toBe(true);

    if (r.mode === "acquired") {
      await r.release();
      expect(fs.existsSync(metaPath)).toBe(false);
    }
  });

  it("leaves metadata in place on crash (no release called)", async () => {
    const r = await acquireOrAttach({
      httpPort: 8000, piPort: 9999, version: "t",
      hooks: { lockPath, metaPath, staleMs: 1_000 },
    });
    expect(r.mode).toBe("acquired");
    // Don't release; metadata should persist until the next successful
    // acquire clears it as part of steal.
    expect(fs.existsSync(metaPath)).toBe(true);
  });
});
