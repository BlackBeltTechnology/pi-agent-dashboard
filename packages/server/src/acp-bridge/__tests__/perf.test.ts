/**
 * D13 budgets: adapter overhead per update, replay time at the log cap.
 * Single deterministic runs with generous-but-meaningful thresholds.
 * See change: add-acp-session-driver (test-plan #P1, #P2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createV1Normalizer } from "@blackbelt-technology/pi-dashboard-shared/acp/normalize-v1.js";
import { createDashboardEventAdapter } from "@blackbelt-technology/pi-dashboard-shared/acp/to-dashboard-events.js";
import { describe, expect, it } from "vitest";
import { createEventLog } from "../event-log.js";

describe("performance budgets", () => {
  it("P1: p95 per update (normaliser → adapter → send) < 5 ms", () => {
    const t = (x: string) => ({ type: "text", text: x });
    const updates: unknown[] = [];
    for (let i = 0; i < 10_000; i++) updates.push({ sessionUpdate: "agent_message_chunk", content: t("x".repeat(50)) });
    for (let i = 0; i < 1_000; i++) updates.push({ sessionUpdate: "tool_call_update", toolCallId: `t${i}`, title: "x", status: "completed" });
    const run = (): { p95: number; sunk: number } => {
      const n = createV1Normalizer();
      const adapter = createDashboardEventAdapter({ agentId: "qmt" });
      const sink: unknown[] = [];
      for (const u of n.promptDispatched()) adapter.push(u);
      const times: number[] = [];
      updates.forEach((raw, i) => {
        const t0 = performance.now();
        for (const u of n.update(raw)) for (const e of adapter.push(u)) sink.push(JSON.stringify(e));
        if (i >= 500) times.push(performance.now() - t0);
      });
      times.sort((a, b) => a - b);
      return { p95: times[Math.floor(times.length * 0.95)] as number, sunk: sink.length };
    };
    // Best of three: a shared CI runner under a parallel suite can stall one run;
    // a real regression is slow in every run.
    const runs = [run(), run(), run()];
    expect(Math.min(...runs.map((r) => r.p95))).toBeLessThan(5);
    expect(runs[0]?.sunk).toBeGreaterThan(10_000);
  });

  it("P2: replaying a log at the 64 MiB cap takes < 10 s", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-perf-"));
    try {
      const file = path.join(dir, "p.events.jsonl");
      // Build ~64 MiB directly (the log's own append path is covered elsewhere).
      const line = `${JSON.stringify({ eventType: "message_update", timestamp: 1, data: { pad: "z".repeat(1000) } })}\n`;
      const settle = `${JSON.stringify({ eventType: "agent_settled", timestamp: 1, data: {} })}\n`;
      const fd = fs.openSync(file, "w");
      let written = 0;
      while (written < 64 * 1024 * 1024) {
        const chunk = line.repeat(500) + settle;
        written += fs.writeSync(fd, chunk);
      }
      fs.closeSync(fd);
      const log = createEventLog({ file, maxBytes: 64 * 1024 * 1024 });
      let count = 0;
      const t0 = Date.now();
      await log.replay(() => {
        count += 1;
      });
      expect(Date.now() - t0).toBeLessThan(10_000);
      expect(count).toBeGreaterThan(60_000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
