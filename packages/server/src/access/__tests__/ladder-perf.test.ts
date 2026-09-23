/**
 * Denial-path cost and leak checks (change: add-access-grant-dialog, tasks
 * 10.43, 10.44; test-plan #P3, #P4).
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetCheckoutRootCache,
  CHECKOUT_ROOT_CACHE_MAX,
  CHECKOUT_ROOT_CACHE_TTL_MS,
  offeredAncestorLadder,
} from "../ancestor-ladder.js";
import { PendingGrantRegistry } from "../pending-grant-registry.js";

let home: string;
beforeEach(() => {
  __resetCheckoutRootCache();
  home = fs.mkdtempSync(path.join(os.homedir(), "ladder-perf-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0;

describe("#P3 ladder computation on the denial path", () => {
  it("a denial 12 levels deep: p95 < 5 ms over 1000 iterations", async () => {
    const deep = path.join(home, ...Array.from({ length: 12 }, (_, i) => `d${i}`));
    fs.mkdirSync(deep, { recursive: true });
    const first = await offeredAncestorLadder(deep, { homedir: home });
    expect(first.length).toBeGreaterThan(0);
    const t: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const s = performance.now();
      const ladder = await offeredAncestorLadder(deep, { homedir: home });
      t.push(performance.now() - s);
      expect(ladder).toEqual(first);
    }
    expect(p95(t)).toBeLessThan(5);
  });

  it("the cached boundary expires after the TTL, so a new repository is noticed", async () => {
    const sub = path.join(home, "work", "proj", "src");
    fs.mkdirSync(sub, { recursive: true });
    const t0 = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0);
    const before = await offeredAncestorLadder(sub, { homedir: home });
    expect(before).toContain(fs.realpathSync(path.join(home, "work")));
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "-q"], { cwd: path.join(home, "work", "proj") });
    clock.mockReturnValue(t0 + CHECKOUT_ROOT_CACHE_TTL_MS + 1);
    const after = await offeredAncestorLadder(sub, { homedir: home });
    expect(after.at(-1)).toBe(fs.realpathSync(path.join(home, "work", "proj")));
  });

  it("the cache is bounded", async () => {
    expect(CHECKOUT_ROOT_CACHE_MAX).toBe(256);
  });
});

describe("#P4 registry does not leak across settled entries", () => {
  it("10k prompt -> settle cycles: registry returns to baseline, RSS delta < 10 MB", () => {
    const reg = new PendingGrantRegistry({ onTransition: () => {} });
    const OK = { promptable: true } as const;
    const run = (n: number, t0: number) => {
      for (let i = 0; i < n; i++) {
        const now = t0 + i * 200_000; // past backoff and rate windows every cycle
        const out = reg.record(
          { plane: "filesystem", subject: `/s${i % 50}`, mode: "held", channel: `c${i % 7}`, store: "x" },
          OK,
          now,
        );
        if (out.kind === "refused") throw new Error(out.reason);
        reg.settle({ promptId: out.entry.promptId, plane: "filesystem", subject: out.entry.subject, verdict: "deny" }, now);
      }
    };
    run(1000, 0); // warm up
    global.gc?.();
    const rss0 = process.memoryUsage().rss;
    run(10_000, 1e12);
    global.gc?.();
    expect(reg.size).toBe(0);
    expect(process.memoryUsage().rss - rss0).toBeLessThan(10 * 1024 * 1024);
  });
});

describe("#P2 a denial flood from one capability (task 10.57)", () => {
  it("500 denials across 50 subjects: p95 added latency < 5 ms, <= 2 dialogs open, channel capped at 12 entries", async () => {
    const { AccessPlaneRegistry } = await import("../access-plane.js");
    const { GrantCoordinator } = await import("../grant-coordinator.js");
    const { createFilesystemPlane } = await import("../planes.js");
    const { GRANT_CHANNEL_MAX_ENTRIES } = await import("../pending-grant-registry.js");
    const planes = new AccessPlaneRegistry();
    planes.register(createFilesystemPlane());
    const open = new Set<string>();
    let maxOpen = 0;
    const coordinator = new GrantCoordinator({
      planes,
      broadcast: (m) => {
        if (m.type === "grant_request") open.add(m.promptId);
        if (m.type === "grant_dismiss") open.delete(m.promptId);
        maxOpen = Math.max(maxOpen, open.size);
      },
      hostGateMode: () => "enforce",
      promptEnabled: () => true,
      killSwitch: () => false,
      operatorChannels: () => 1,
      onTransition: () => {},
    });
    const subjects = Array.from({ length: 50 }, (_, i) => {
      const d = path.join(home, `s${i}`);
      fs.mkdirSync(d);
      return d;
    });
    const t: number[] = [];
    const holds = [];
    for (let i = 0; i < 500; i++) {
      const t0 = performance.now();
      holds.push(
        coordinator.onDenial(
          {
            plane: "filesystem",
            rawSubject: subjects[i % 50],
            origin: "p2",
            channel: "sock-1",
            requestHoldsCapability: true,
          },
          true,
        ),
      );
      t.push(performance.now() - t0);
    }
    const entries = coordinator.registry.list().filter((e) => e.channel === "sock-1");
    expect(p95(t)).toBeLessThan(5);
    expect(maxOpen).toBeLessThanOrEqual(2);
    expect(entries.length).toBeLessThanOrEqual(GRANT_CHANNEL_MAX_ENTRIES);
    expect(coordinator.registry.snapshotStats().flooded["channel-share"] ?? 0).toBeGreaterThan(0);
    for (const h of holds) h.abort();
  });
});
