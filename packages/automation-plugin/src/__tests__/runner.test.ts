/**
 * Runner concurrency-policy tests: skip-drop, queue-defer, parallel.
 * See change: add-automation-plugin.
 */
import { describe, it, expect } from "vitest";
import { createRunner } from "../server/runner.js";
import type { DiscoveredAutomation } from "../shared/automation-types.js";
import type { Concurrency } from "../shared/automation-types.js";

let counter = 0;
function automation(concurrency: Concurrency, name = "nightly"): DiscoveredAutomation {
  return {
    name,
    scope: "folder",
    dir: `/repo/.pi/automation/${name}`,
    valid: true,
    config: {
      on: { kind: "schedule", cron: "* * * * *" },
      action: { kind: "prompt", prompt: "./prompt.md" },
      model: "@fast",
      mode: "worktree",
      sandbox: "workspace-write",
      concurrency,
    },
  };
}

function makeRunner() {
  const started: string[] = [];
  const runner = createRunner({
    startRun: (a) => {
      const runId = `run-${++counter}-${a.name}`;
      started.push(runId);
      return { runId };
    },
  });
  return { runner, started };
}

describe("runner concurrency", () => {
  it("skip drops an overlapping fire while a run is active", () => {
    const { runner, started } = makeRunner();
    const a = automation("skip");
    runner.fire(a); // starts run 1
    runner.fire(a); // active → dropped
    expect(started).toHaveLength(1);
    expect(runner.queuedCount("folder:nightly")).toBe(0);

    // After the active run completes, a new fire starts again.
    runner.completeRun("folder:nightly");
    runner.fire(a);
    expect(started).toHaveLength(2);
  });

  it("queue defers an overlapping fire and starts it when the active run ends", () => {
    const { runner, started } = makeRunner();
    const a = automation("queue");
    runner.fire(a); // starts run 1
    runner.fire(a); // queued
    expect(started).toHaveLength(1);
    expect(runner.queuedCount("folder:nightly")).toBe(1);

    runner.completeRun("folder:nightly"); // drains queue → starts run 2
    expect(started).toHaveLength(2);
    expect(runner.queuedCount("folder:nightly")).toBe(0);
  });

  it("queue preserves multiple deferred fires in FIFO order", () => {
    const { runner, started } = makeRunner();
    const a = automation("queue");
    runner.fire(a); // run active
    runner.fire(a); // q1
    runner.fire(a); // q2
    expect(runner.queuedCount("folder:nightly")).toBe(2);
    runner.completeRun("folder:nightly"); // start q1
    expect(runner.queuedCount("folder:nightly")).toBe(1);
    runner.completeRun("folder:nightly"); // start q2
    expect(runner.queuedCount("folder:nightly")).toBe(0);
    expect(started).toHaveLength(3);
  });

  it("parallel starts immediately alongside the active run", () => {
    const { runner, started } = makeRunner();
    const a = automation("parallel");
    runner.fire(a);
    runner.fire(a);
    expect(started).toHaveLength(2);
    expect(runner.queuedCount("folder:nightly")).toBe(0);
  });
});
