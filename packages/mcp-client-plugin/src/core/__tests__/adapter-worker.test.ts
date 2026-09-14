/**
 * Default worker-thread adapter port (change extract-mcp-client-plugin,
 * task 2.5a): stalls are bounded without blocking the event loop, and the
 * worker is spawned lazily and only by the loading functions.
 */

import path from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { AdapterTimeoutError, createDefaultAdapterPort } from "../adapter-worker.js";

// Resolve beside this file, NOT process.cwd(): the root vitest run sets cwd to
// the repo root, so a cwd-relative path misses the fixtures entirely.
const FIXTURES = path.resolve(import.meta.dirname, "fixtures");
const OK_WORKER = path.join(FIXTURES, "ok-worker.mjs");
const HANG_WORKER = path.join(FIXTURES, "hang-worker.mjs");

describe("createDefaultAdapterPort", () => {
  it("spawns exactly one worker for many sequential loads (P5)", async () => {
    const created: Worker[] = [];
    const port = createDefaultAdapterPort({
      workerEntryUrl: OK_WORKER,
      workerFactory: (url, workerData) => {
        const w = new Worker(url, { workerData });
        created.push(w);
        return w;
      },
    });
    for (let i = 0; i < 20; i += 1) {
      const cfg = await port.loadMcpConfig(undefined, "/x", { timeoutMs: 2000 });
      expect(cfg.mcpServers).toEqual({});
    }
    expect(created).toHaveLength(1);
  });

  it("rejects with AdapterTimeoutError on a stalled load and terminates the worker", async () => {
    const created: Worker[] = [];
    const port = createDefaultAdapterPort({
      workerEntryUrl: HANG_WORKER,
      workerFactory: (url, workerData) => {
        const w = new Worker(url, { workerData });
        created.push(w);
        return w;
      },
    });
    await expect(port.loadMcpConfig(undefined, "/x", { timeoutMs: 120 })).rejects.toBeInstanceOf(
      AdapterTimeoutError,
    );
    expect(created).toHaveLength(1);
  });

  it("keeps the event loop free while a load stalls", async () => {
    const port = createDefaultAdapterPort({ workerEntryUrl: HANG_WORKER });
    let timerFired = false;
    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true;
        resolve();
      }, 30);
    });
    const load = port.loadMcpConfig(undefined, "/x", { timeoutMs: 200 }).catch(() => "timed-out");
    const winner = await Promise.race([timer.then(() => "timer"), load]);
    expect(winner).toBe("timer");
    expect(timerFired).toBe(true);
    await load;
  });

  it("write-only path helpers never spawn a worker", () => {
    const workerFactory = vi.fn(() => {
      throw new Error("must not spawn");
    });
    const port = createDefaultAdapterPort({ workerFactory });
    expect(typeof port.getPiGlobalConfigPath()).toBe("string");
    expect(typeof port.getProjectPiConfigPath("/x")).toBe("string");
    expect(Array.isArray(port.getConfigDiscoveryPaths(undefined, "/x"))).toBe(true);
    expect(workerFactory).not.toHaveBeenCalled();
  });
});
