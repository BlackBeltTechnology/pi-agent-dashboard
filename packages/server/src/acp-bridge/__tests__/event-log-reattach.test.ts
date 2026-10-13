/**
 * Durable event log (cap + truncation) and reattach sequence.
 * See change: add-acp-session-driver (test-plan #E39, #E40, + log mechanics).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ACP_SETTINGS } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, LOG_NOTICE_TYPE } from "../event-log.js";
import { startHostB } from "../main.js";
import { fakeAgentLauncher, SESSION_ID } from "./adapter-harness.js";
import { startFakeGateway } from "./fake-gateway.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-log-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const ev = (eventType: string, data: Record<string, unknown> = {}): DashboardEvent => ({ eventType, timestamp: 1, data });
const turn = (log: ReturnType<typeof createEventLog>, n: number, bytes: number) => {
  log.append(ev("agent_start"));
  log.append(ev("message_start", { message: { role: "assistant", n } }));
  log.append(ev("message_update", { pad: "x".repeat(bytes) }));
  log.append(ev("message_end", { message: { role: "assistant", n } }));
  log.append(ev("agent_end"));
  log.append(ev("agent_settled", { n }));
};
const replayAll = async (log: ReturnType<typeof createEventLog>) => {
  const out: DashboardEvent[] = [];
  await log.replay((e) => out.push(e));
  return out;
};

describe("event log", () => {
  it("appends and replays in order", async () => {
    const log = createEventLog({ file: path.join(dir, "a.events.jsonl"), maxBytes: 1 << 20 });
    log.append(ev("a"));
    log.append(ev("b"));
    expect((await replayAll(log)).map((e) => e.eventType)).toEqual(["a", "b"]);
  });

  it("E39: cap truncation keeps whole turns only, ≤50% of cap, one leading notice", async () => {
    const file = path.join(dir, "t.events.jsonl");
    const cap = 1024 * 1024;
    const log = createEventLog({ file, maxBytes: cap });
    for (let i = 0; i < 10; i++) {
      turn(log, i, 110 * 1024);
      await log.flush();
    }
    const size = fs.statSync(file).size;
    // The cap was crossed on the 10th turn; the log shrank to ≤ 512 KiB right then.
    expect(size).toBeLessThanOrEqual(cap / 2);
    const events = await replayAll(log);
    expect(events[0]?.eventType).toBe("custom_entry");
    expect(events[0]?.data.customType).toBe(LOG_NOTICE_TYPE);
    // whole turns only: starts right after the notice with agent_start, balanced message_start/end
    expect(events[1]?.eventType).toBe("agent_start");
    const count = (t: string) => events.filter((e) => e.eventType === t).length;
    expect(count("message_start")).toBe(count("message_end"));
    expect(count("agent_start")).toBe(count("agent_settled"));
    expect(events.filter((e) => e.eventType === "custom_entry")).toHaveLength(1);
    // newest turn survived
    expect(events.at(-1)?.data).toEqual({ n: 9 });
  });

  it("a second truncation merges into the single notice (dropped count accumulates)", async () => {
    const file = path.join(dir, "m.events.jsonl");
    const cap = 256 * 1024;
    const log = createEventLog({ file, maxBytes: cap });
    for (let i = 0; i < 12; i++) {
      turn(log, i, 60 * 1024);
      await log.flush();
    }
    const events = await replayAll(log);
    expect(events.filter((e) => e.eventType === "custom_entry")).toHaveLength(1);
    expect(Number(events[0]?.data.acpDroppedTurns)).toBeGreaterThan(1);
  });

  it("an in-progress (unsettled) tail is never cut", async () => {
    const file = path.join(dir, "p.events.jsonl");
    const log = createEventLog({ file, maxBytes: 64 * 1024 });
    turn(log, 0, 20 * 1024);
    turn(log, 1, 20 * 1024);
    log.append(ev("agent_start"));
    log.append(ev("message_start"));
    log.append(ev("message_update", { pad: "y".repeat(40 * 1024) }));
    await log.flush();
    const types = (await replayAll(log)).map((e) => e.eventType);
    expect(types.slice(-3)).toEqual(["agent_start", "message_start", "message_update"]);
    expect(types[0]).toBe("custom_entry");
  });

  it("replay(maxBytes) stops at the snapshot", async () => {
    const file = path.join(dir, "s.events.jsonl");
    const log = createEventLog({ file, maxBytes: 1 << 20 });
    log.append(ev("a"));
    await log.flush();
    const snap = log.size();
    log.append(ev("b"));
    await log.flush();
    const seen: string[] = [];
    await log.replay((e) => seen.push(e.eventType), snap);
    expect(seen).toEqual(["a"]);
  });
});

describe("E40: reattach after the dashboard restarts", () => {
  it("re-registers (reattach, no eventCount) → lists → model state → replay → replay_complete → pending permission", async () => {
    const gw = await startFakeGateway();
    const fake = fakeAgentLauncher({ protocol: 1, knobs: { permission: true } });
    const host = startHostB({
      agent: { id: "qmt", name: "q", command: "q", args: [], env: {}, durable: true },
      settings: { ...DEFAULT_ACP_SETTINGS },
      cwd: "/w",
      sessionId: SESSION_ID,
      endpoint: () => gw.url,
      launchAgent: fake.launch,
      log: () => {},
      onExit: () => {},
    });
    try {
      await gw.waitFor(() => gw.frames.some((f) => f.type === "models_list"));
      // turn 1 completes (permission answered), turn 2 stays pending on a permission request
      gw.send({ type: "send_prompt", sessionId: SESSION_ID, text: "one" });
      await gw.waitFor(() => gw.frames.some((f) => f.type === "prompt_request"));
      const req1 = gw.frames.find((f) => f.type === "prompt_request");
      gw.send({ type: "prompt_response", sessionId: SESSION_ID, promptId: req1?.promptId, answer: "Allow once", source: "dashboard" });
      await gw.waitFor(() => gw.frames.some((f) => f.type === "event_forward" && f.event.eventType === "agent_settled"));
      gw.send({ type: "send_prompt", sessionId: SESSION_ID, text: "two" });
      await gw.waitFor(() => gw.frames.filter((f) => f.type === "prompt_request").length === 2);
      await new Promise((r) => setTimeout(r, 60)); // let the log flush

      const connectionsBefore = gw.connections.length;
      gw.dropClients();
      await gw.waitFor(() => gw.connections.length === connectionsBefore + 1, 8000);
      const second = gw.connections[connectionsBefore] as Array<Record<string, any>>;
      await gw.waitFor(() => second.some((f) => f.type === "prompt_request"), 8000);

      const types = second.map((f) => f.type);
      expect(second[0]).toMatchObject({ type: "session_register", registerReason: "reattach", driver: "acp", sessionId: SESSION_ID });
      expect(second[0]).not.toHaveProperty("eventCount");
      const idx = (t: string) => types.indexOf(t);
      expect(idx("models_list")).toBeGreaterThan(0);
      expect(idx("commands_list")).toBeGreaterThan(idx("models_list"));
      expect(idx("model_update")).toBeGreaterThan(idx("commands_list"));
      expect(idx("event_forward")).toBeGreaterThan(idx("model_update"));
      expect(idx("replay_complete")).toBeGreaterThan(types.lastIndexOf("event_forward"));
      expect(types.lastIndexOf("prompt_request")).toBeGreaterThan(idx("replay_complete"));
      // both turns' user messages are in the replay
      const replayed = second.filter((f) => f.type === "event_forward").map((f) => f.event.eventType);
      expect(replayed.filter((t) => t === "agent_settled")).toHaveLength(1);
      expect(replayed).toContain("agent_start");
      // the agent was not relaunched
      expect(fake.state.launches).toBe(1);
    } finally {
      host.client.close();
      await gw.close();
    }
  }, 20000);
});
