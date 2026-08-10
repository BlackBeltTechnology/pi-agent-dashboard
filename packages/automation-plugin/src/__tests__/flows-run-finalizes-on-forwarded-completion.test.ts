/**
 * Event-dispatched run finalization, driven through the REAL plugin.
 *
 * Boots the production `registerPlugin` (real engine, real scanner, real
 * run-store) with the REAL flows action contribution published on the
 * publish/collect bus, fires the automation through the real `plugin_action`
 * run path, then pushes forwarded events into the handler the plugin itself
 * registered via `ctx.onEvent`. Assertions are on the on-disk run record the
 * production code wrote.
 *
 * This replaces `finalize-event-dispatched.test.ts`, which re-implemented the
 * finalize branch inside the test file and therefore passed while production
 * was 100% broken. Nothing here is re-implemented.
 * See change: fix-automation-run-lifecycle.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flowsActionContributions } from "../../../flows-plugin/src/server/automation-actions.js";
import { registerPlugin } from "../server/index.js";
import { listRuns } from "../server/run-store.js";

const ENGINE_INIT_WAIT_MS = 1400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RawEvent = { eventType?: string; data?: Record<string, unknown> };

interface Harness {
  repo: string;
  /** The handler the plugin registered via ctx.onEvent. */
  onEvent: (sessionId: string, event: RawEvent) => void;
  emitted: Array<{ sessionId: string; eventType: string; data: unknown }>;
  sentPrompts: Array<{ sessionId: string; text: string }>;
  stampSession: (sessionId: string, runId: string) => void;
  fire: (name: string) => Promise<string>;
  runs: () => ReturnType<typeof listRuns>;
  run: (runId: string) => ReturnType<typeof listRuns>[number] | undefined;
  resultOf: (runId: string) => string;
}

async function boot(
  automation: { name: string; yaml: string },
  flowsForCwd: (cwd: string) => string[] = () => ["ns:demo"],
): Promise<Harness> {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "auto-finalize-"));
  const dir = path.join(repo, ".pi", "automation", automation.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "automation.yaml"), automation.yaml);

  const provided = new Map<string, unknown>();
  const sessions = new Map<string, { automationRun?: { runId?: string } }>();
  const emitted: Harness["emitted"] = [];
  const sentPrompts: Harness["sentPrompts"] = [];
  let onEvent: Harness["onEvent"] = () => {};
  let browserHandler: ((msg: unknown) => void) | undefined;
  let lastRunId = "";

  const ctx = {
    fastify: { get: () => {}, post: () => {}, delete: () => {} },
    sessionManager: {
      listAll: () => [{ cwd: repo }],
      getSession: (id: string) => sessions.get(id),
    },
    eventStore: {},
    broadcastToSubscribers: () => {},
    registerPiHandler: () => {},
    registerBrowserHandler: (_type: string, h: (msg: unknown) => void) => {
      browserHandler = h;
    },
    onEvent: (h: Harness["onEvent"]) => {
      onEvent = h;
    },
    onSessionEnded: () => {},
    sendToSession: (sessionId: string, text: string) => {
      sentPrompts.push({ sessionId, text });
    },
    emitEventToSession: (sessionId: string, eventType: string, data: unknown) => {
      emitted.push({ sessionId, eventType, data });
    },
    spawnSession: async () => ({ success: true, spawnToken: "tok" }),
    abortSession: async () => true,
    abortSpawnedRun: async () => true,
    provide: (k: string, v: unknown) => provided.set(k, v),
    consume: (k: string) => provided.get(k),
    consumeAll: (prefix: string) =>
      [...provided.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    getPluginConfig: () => ({ scanGlobalScope: false, scanFolderScope: true }),
    updatePluginConfig: async () => {},
    logger: {
      info: (m: string) => {
        const hit = /runId=(\S+)/.exec(m);
        if (hit && m.includes("automation run")) lastRunId = hit[1] ?? "";
      },
      warn: () => {},
      error: () => {},
    },
  } as unknown as Parameters<typeof registerPlugin>[0];

  // flows publishes its REAL contribution (the one shipping in production).
  ctx.provide("automation.action.flows", flowsActionContributions(flowsForCwd));
  await registerPlugin(ctx);
  await sleep(ENGINE_INIT_WAIT_MS); // plugin defers engine init

  return {
    repo,
    get onEvent() {
      return onEvent;
    },
    emitted,
    sentPrompts,
    stampSession: (sessionId, runId) => sessions.set(sessionId, { automationRun: { runId } }),
    fire: async (name) => {
      lastRunId = "";
      browserHandler?.({ pluginId: "automation", action: "run", payload: { scope: "folder", cwd: repo, name } });
      await sleep(300);
      return lastRunId;
    },
    runs: () => listRuns(repo),
    run: (runId) => listRuns(repo).find((r) => r.runId === runId),
    resultOf: (runId) => {
      const rec = listRuns(repo).find((r) => r.runId === runId);
      const file = rec ? path.join(rec.dir, "result.md") : "";
      return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    },
  };
}

const MODEL = "anthropic/claude-haiku-4-5";
const NEVER_CRON = '"0 0 1 1 *"';

const flowsRunYaml = `on: { kind: schedule, cron: ${NEVER_CRON} }
action: { kind: flows.run, payload: { flow: "ns:demo", task: "t" } }
model: "${MODEL}"
mode: local
`;

const promptYaml = `on: { kind: schedule, cron: ${NEVER_CRON} }
action: { kind: prompt, prompt: ./prompt.md }
model: "${MODEL}"
mode: local
`;

const FLOW_COMPLETE: RawEvent = {
  eventType: "flow_complete",
  data: {
    flowName: "ns:demo",
    status: "success",
    lastResult: { result: { summary: "3 invoices processed" } },
  },
};

let cleanup: string[] = [];
beforeEach(() => {
  cleanup = [];
});
afterEach(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

describe("flows.run run finalization (real handler)", () => {
  it("finalizes done on the forwarded completion event, with the action's summary", async () => {
    const h = await boot({ name: "a1", yaml: flowsRunYaml });
    cleanup.push(h.repo);

    const runId = await h.fire("a1");
    expect(runId).toBeTruthy();
    expect(h.run(runId)?.status).toBe("running");

    const sid = "sess-1";
    h.stampSession(sid, runId);
    h.onEvent(sid, { eventType: "model_change", data: {} });

    // the action dispatched by EVENT, not by prompt
    expect(h.emitted).toEqual([
      { sessionId: sid, eventType: "flow:run", data: { flowName: "ns:demo", task: "t" } },
    ]);
    expect(h.sentPrompts).toHaveLength(0);

    h.onEvent(sid, FLOW_COMPLETE);
    await sleep(50);

    expect(h.run(runId)?.status).toBe("done");
    expect(h.resultOf(runId)).toContain("3 invoices processed");
  });

  it("does NOT finalize on an unrelated forwarded flow event", async () => {
    const h = await boot({ name: "a1", yaml: flowsRunYaml });
    cleanup.push(h.repo);
    const runId = await h.fire("a1");
    const sid = "sess-1";
    h.stampSession(sid, runId);
    h.onEvent(sid, { eventType: "model_change", data: {} });

    h.onEvent(sid, { eventType: "flow_agent_complete", data: {} });
    await sleep(50);

    expect(h.run(runId)?.status).toBe("running");
  });

  it("prefers buffered assistant text over the action summarizer", async () => {
    const h = await boot({ name: "a1", yaml: flowsRunYaml });
    cleanup.push(h.repo);
    const runId = await h.fire("a1");
    const sid = "sess-1";
    h.stampSession(sid, runId);
    h.onEvent(sid, { eventType: "model_change", data: {} });

    h.onEvent(sid, {
      eventType: "turn_end",
      data: { message: { role: "assistant", content: [{ type: "text", text: "hand-written result" }] } },
    });
    h.onEvent(sid, FLOW_COMPLETE);
    await sleep(50);

    expect(h.run(runId)?.status).toBe("done");
    expect(h.resultOf(runId)).toContain("hand-written result");
  });

  it("a second terminal event after finalization is a no-op", async () => {
    const h = await boot({ name: "a1", yaml: flowsRunYaml });
    cleanup.push(h.repo);
    const runId = await h.fire("a1");
    const sid = "sess-1";
    h.stampSession(sid, runId);
    h.onEvent(sid, { eventType: "model_change", data: {} });
    h.onEvent(sid, FLOW_COMPLETE);
    await sleep(50);
    const before = JSON.stringify(h.run(runId));

    h.onEvent(sid, { eventType: "agent_end", data: {} });
    await sleep(50);

    expect(JSON.stringify(h.run(runId))).toBe(before);
    expect(h.runs().filter((r) => r.runId === runId)).toHaveLength(1);
  });

  it("a prompt-dispatch run (no declared completion) still finalizes on agent_end", async () => {
    const h = await boot({ name: "p1", yaml: promptYaml });
    cleanup.push(h.repo);
    fs.writeFileSync(path.join(h.repo, ".pi", "automation", "p1", "prompt.md"), "do the thing");

    const runId = await h.fire("p1");
    const sid = "sess-1";
    h.stampSession(sid, runId);
    h.onEvent(sid, { eventType: "model_change", data: {} });

    // prompt-dispatch seeds text, emits nothing
    expect(h.sentPrompts.map((p) => p.text)).toEqual(["do the thing"]);
    expect(h.emitted).toHaveLength(0);

    h.onEvent(sid, FLOW_COMPLETE); // not its completion signal
    await sleep(50);
    expect(h.run(runId)?.status).toBe("running");

    h.onEvent(sid, { eventType: "agent_end", data: {} });
    await sleep(50);
    expect(h.run(runId)?.status).toBe("done");
  });
});
