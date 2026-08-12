/**
 * Stall bound for DELIVERED event-dispatched runs (real engine, real run-store,
 * injected clock).
 *
 * The defect these lock down: an event-dispatched run (an action that declares
 * an `ActionEvent.completion`) produces no `agent_end`, and its spawned session
 * is only terminated when that completion event arrives. So when the declared
 * completion is never observed — a superseded/unready bridge drops the frame —
 * the run stayed `running` until the 30-minute max-age backstop, holding its
 * `concurrency: skip` slot and reporting `running` on
 * `GET /api/plugins/automation/runs` the whole time. The undelivered reaper
 * cannot help: it skips delivered runs by design.
 *
 * A delivered event run is only alive while its forwarded event stream is
 * alive, so silence past a bound is the stall signal. A DELIVERED PROMPT run
 * has no such contract (it may legitimately think for a long time) and MUST be
 * left alone.
 * See change: bound-stalled-event-run-settle.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../server/action-registry.js";
import { createEngine } from "../server/engine.js";
import { listRuns } from "../server/run-store.js";
import type { DiscoveredAutomation } from "../shared/automation-types.js";

const UNDELIVERED_MS = 60_000;
const STALLED_MS = 120_000;
const MAX_AGE_MS = 30 * 60 * 1000;

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-stall-"));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

/** An event-dispatched automation: the action declares a completion event. */
function eventAutomation(name: string): DiscoveredAutomation {
  const dir = path.join(repo, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  return {
    name,
    scope: "folder",
    dir,
    valid: true,
    config: {
      on: { kind: "schedule", cron: "* * * * *" },
      action: { kind: "demo.run", payload: { thing: "x" } },
      model: "anthropic/claude-haiku-4-5",
      mode: "local",
      sandbox: "workspace-write",
      concurrency: "skip",
    },
  } as DiscoveredAutomation;
}

/** A prompt-dispatched automation: finalizes on `agent_end`, no completion. */
function promptAutomation(name: string): DiscoveredAutomation {
  const dir = path.join(repo, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prompt.md"), "do the thing");
  return {
    name,
    scope: "folder",
    dir,
    valid: true,
    config: {
      on: { kind: "schedule", cron: "* * * * *" },
      action: { kind: "prompt", prompt: "./prompt.md" },
      model: "anthropic/claude-haiku-4-5",
      mode: "local",
      sandbox: "workspace-write",
      concurrency: "skip",
    },
  } as DiscoveredAutomation;
}

function makeEngine() {
  let now = 1_000_000;
  const aborted: Array<{ sessionId?: string; spawnToken?: string; graceful?: boolean }> = [];
  let spawns = 0;
  const registry = new ActionRegistry({ warn: () => {} });
  registry.register({
    id: "demo.run",
    source: "demo",
    label: "Demo",
    buildEvent: () => ({
      eventType: "demo:run",
      completion: { eventType: "demo_complete" },
    }),
  });
  const engine = createEngine({
    spawnSession: async () => {
      spawns += 1;
      return { success: true, spawnToken: `tok-${spawns}` };
    },
    abortSpawnedRun: async (args) => {
      aborted.push(args);
      return true;
    },
    resolveRegistry: () => registry,
    listScopes: () => [{ base: repo, scope: "folder" }],
    config: () => ({
      defaultVisibility: "hidden",
      retention: 100,
      defaultModel: "anthropic/claude-haiku-4-5",
      scanFolder: true,
      scanGlobal: false,
      maxRunAgeMs: MAX_AGE_MS,
      undeliveredRunTimeoutMs: UNDELIVERED_MS,
      stalledRunTimeoutMs: STALLED_MS,
    }),
    now: () => now,
    warn: () => {},
  });
  return {
    engine,
    aborted,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const runs = () => listRuns(repo);
const byId = (runId: string) => runs().find((r) => r.runId === runId);

describe("a delivered event run whose completion never arrives settles on the stall bound", () => {
  it("is finalized error + terminated instead of holding the slot to max age", async () => {
    const h = makeEngine();
    const a = eventAutomation("intake");

    h.engine.runner.fire(a);
    await Promise.resolve();
    const wedged = runs()[0]!;
    expect(wedged.status).toBe("running");

    // Delivered: the session registered and received the dispatched event.
    h.engine.onSessionRegisteredForRun("sess-1", wedged.runId);

    // The undelivered bound must NOT touch it — it WAS delivered.
    h.advance(UNDELIVERED_MS + 1);
    h.engine.reapStaleRuns();
    expect(byId(wedged.runId)?.status).toBe("running");

    // Still inside the stall bound: untouched.
    h.advance(STALLED_MS - UNDELIVERED_MS - 2);
    h.engine.reapStaleRuns();
    expect(byId(wedged.runId)?.status).toBe("running");

    // Past the stall bound with no observed activity → settled.
    h.advance(2);
    h.engine.reapStaleRuns();

    const reaped = byId(wedged.runId)!;
    expect(reaped.status).toBe("error");
    expect(reaped.error).toBe("run stalled: completion event never observed");
    expect(reaped.endedAt! - reaped.startedAt).toBeLessThan(MAX_AGE_MS);
    // The orphaned rpc session is terminated, not left running.
    expect(h.aborted).toEqual([{ sessionId: "sess-1", spawnToken: "tok-1" }]);
    // The slot is free again.
    expect(h.engine.runner.activeRunId("folder:intake")).toBeNull();
  });

  it("keeps a live event run alive while its event stream keeps arriving", async () => {
    const h = makeEngine();
    const a = eventAutomation("intake");

    h.engine.runner.fire(a);
    await Promise.resolve();
    const live = runs()[0]!;
    h.engine.onSessionRegisteredForRun("sess-1", live.runId);

    // Heartbeat of forwarded activity keeps resetting the stall clock.
    for (let i = 0; i < 5; i++) {
      h.advance(STALLED_MS - 1);
      h.engine.noteRunActivity("sess-1");
      h.engine.reapStaleRuns();
      expect(byId(live.runId)?.status).toBe("running");
    }
    expect(h.aborted).toEqual([]);

    // And it still settles normally on its real completion.
    h.engine.onSessionEnded("sess-1", "- done");
    expect(byId(live.runId)?.status).toBe("done");
  });

  it("leaves a DELIVERED PROMPT run alone past the stall bound", async () => {
    const h = makeEngine();
    const a = promptAutomation("nightly");

    const started = h.engine.startRunFor(a)!;
    await Promise.resolve();
    h.engine.onSessionRegisteredForRun("sess-1", started.runId);

    h.advance(STALLED_MS * 5);
    h.engine.reapStaleRuns();

    expect(byId(started.runId)?.status).toBe("running");
    expect(h.aborted).toEqual([]);
  });
});
