/**
 * Golden: ACP updates → shared adapter → the REAL client reducer.
 * Proves ACP sessions render through the unchanged pi reducer.
 * See change: add-acp-session-driver (test-plan #E9, #E10, #E11, #E14).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createV1Normalizer } from "@blackbelt-technology/pi-dashboard-shared/acp/normalize-v1.js";
import { createDashboardEventAdapter } from "@blackbelt-technology/pi-dashboard-shared/acp/to-dashboard-events.js";
import { type AcpUpdate, parseSessionUpdate } from "@blackbelt-technology/pi-dashboard-shared/acp/update-model.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(resolve(__dirname, "../../../../shared/src/acp/__tests__/fixtures", name), "utf8"),
  ) as { turn: Array<{ update?: Record<string, unknown> }>; result: { stopReason?: string } };

function run(updates: AcpUpdate[], start?: SessionState) {
  let clock = 1000;
  const adapter = createDashboardEventAdapter({ agentId: "qmt", now: () => clock++ });
  const events: DashboardEvent[] = updates.flatMap((u) => adapter.push(u));
  const trail: SessionState[] = [];
  let state = start ?? createInitialState();
  for (const e of events) {
    state = reduceEvent(state, e, { isLive: true });
    trail.push(state);
  }
  return { events, state, trail };
}

const P = parseSessionUpdate;
const t = (text: string) => ({ type: "text", text });
const idle = (stopReason = "end_turn"): AcpUpdate => P({ sessionUpdate: "state_update", state: "idle", stopReason });
const running = (): AcpUpdate => P({ sessionUpdate: "state_update", state: "running" });

describe("ACP golden through the client reducer", () => {
  it("E9: streamed answer → one assistant message, clean end", () => {
    const { state } = run([
      running(),
      P({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: t("Hel") }),
      P({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: t("lo") }),
      idle(),
    ]);
    const assistant = state.messages.filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.content).toBe("Hello");
    expect(state.status).toBe("idle");
    expect(state.lastError).toBeUndefined();
  });

  it("E9: v1 querymt fixture turn renders thinking, tool card and answer", () => {
    const fx = fixture("querymt-v1.json");
    const n = createV1Normalizer();
    const updates = [
      ...n.promptDispatched(),
      ...fx.turn.flatMap((s) => (s.update ? n.update(s.update) : [])),
      ...n.promptResolved(fx.result.stopReason),
    ];
    const { state } = run(updates);
    const roles = state.messages.map((m) => m.role);
    expect(roles).toContain("thinking");
    const tool = state.messages.find((m) => m.role === "toolResult")!;
    expect(tool.toolName).toBe("Read src/a.ts");
    expect(tool.toolStatus).toBe("complete");
    expect(tool.result).toBe("export const a = 1;");
    const answer = state.messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(answer.content).toBe("The file exports a constant.");
    expect(state.status).toBe("idle");
    expect(state.lastError).toBeUndefined();
  });

  it("E9: v2 querymt fixture turn matches the v1 rendering", () => {
    const fx = fixture("querymt-v2.json");
    const { state } = run(fx.turn.flatMap((s) => (s.update ? [P(s.update)] : [])));
    expect(state.messages.filter((m) => m.role === "toolResult")).toHaveLength(1);
    expect(state.messages.filter((m) => m.role === "assistant").at(-1)!.content).toBe("The file exports a constant.");
    expect(state.status).toBe("idle");
  });

  it("E10: thinking streams live and shows 'ab' before the message ends", () => {
    const { events, trail } = run([
      running(),
      P({ sessionUpdate: "agent_thought_chunk", messageId: "th1", content: t("a") }),
      P({ sessionUpdate: "agent_thought_chunk", messageId: "th1", content: t("b") }),
    ]);
    const deltas = events
      .filter((e) => (e.data.assistantMessageEvent as any)?.type === "thinking_delta")
      .map((e) => (e.data.assistantMessageEvent as any).delta);
    expect(deltas).toEqual(["a", "b"]);
    expect(trail.at(-1)!.streamingThinking).toBe("ab");
  });

  it("E11: thought + message with different ids → one bubble with thinking and text", () => {
    const { events, state } = run([
      running(),
      P({ sessionUpdate: "agent_thought_chunk", messageId: "th1", content: t("hm") }),
      P({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: t("ok") }),
      idle(),
    ]);
    expect(events.filter((e) => e.eventType === "message_start")).toHaveLength(1);
    expect(events.filter((e) => e.eventType === "message_end")).toHaveLength(1);
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(state.messages.find((m) => m.role === "thinking")?.content).toBe("hm");
    expect(state.messages.find((m) => m.role === "assistant")?.content).toBe("ok");
  });

  it("E14: thought level change does not clobber the model", () => {
    const start = { ...createInitialState(), model: "acp:qmt/gpt" } as SessionState;
    const { events, state } = run(
      [P({ sessionUpdate: "config_option_update", configOptions: [{ configId: "tl", category: "thought_level", type: "select", currentValue: "high" }] })],
      start,
    );
    expect(events[0]!.data.model).toBeUndefined();
    expect(events[0]!.data.thinkingLevel).toBe("high");
    expect(state.model).toBe("acp:qmt/gpt");
    expect(state.thinkingLevel).toBe("high");
  });

  it("a refused turn surfaces an error anchor", () => {
    const { state } = run([running(), idle("refusal")]);
    expect(state.lastError?.message).toBe("Agent refused");
  });
});
