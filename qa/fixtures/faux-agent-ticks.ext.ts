/**
 * pi extension fixture: SYNTHETIC subagent-tick producer.
 *
 * Registers a tool named `Agent` that streams `tool_execution_update` frames
 * carrying the exact shape the bridge's subagent-tick throttle keys on
 * (`toolName === "Agent"` + `partialResult.details.agentId`), at a DETERMINISTIC
 * cadence for a DETERMINISTIC duration — WITHOUT a real nested subagent.
 *
 * Why this exists (change: reduce-bridge-tick-bandwidth):
 *   The real Agent-tick carrier is driven by `pi-dashboard-subagents`' nested
 *   `createAgentSession`, whose inner faux session cannot be scripted in the
 *   harness — it resolves a different faux core with an empty response queue, so
 *   a faux subagent dies after ~2 no-op turns and never sustains a ≥10 s tick
 *   stream (see measurement.md, Bug 2). The bridge throttle does not care WHO
 *   produced a frame — only its `toolName` + `details.agentId` — so a synthetic
 *   `Agent` tool that emits the same frame shape is a faithful, fully
 *   deterministic substrate for the L3 cadence rows (F1/P1/P2/P3/P4/F5).
 *
 * Scoping: this tool has the SAME name as `pi-dashboard-subagents`' `Agent`
 * tool. Tool-name precedence is FIRST-registration-wins
 * (`ExtensionRunner.getAllRegisteredTools`), so this file is loaded ONLY in the
 * throttle harness (gated by `PI_SYNTH_AGENT_TICKS=1` in test-entrypoint.sh,
 * which registers it INSTEAD of the subagents producer). It never coexists with
 * the real Agent tool.
 *
 * Cadence control: parsed from a sentinel in the tool-call `prompt`:
 *   `[[ticks:<count>@<intervalMs>]]`            — <count> ticks, <intervalMs> apart
 *   `[[ticks:<count>@<intervalMs>+gap<ms>@<i>]]` — insert one <ms> quiet gap
 *                                                  before tick index <i> (F5)
 * Defaults (no sentinel): 240 ticks @ 50 ms ≈ 12 s of 20 fps.
 */

import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Plain JSON-schema object (the same shape TypeBox emits at runtime), so this
// fixture carries no `@sinclair/typebox` value import — keeping `parseTickPlan`
// importable from the L1 unit test without dragging an unresolved dep in.
const AGENT_TICK_PARAMS = {
  type: "object",
  properties: {
    subagent_type: { type: "string" },
    description: { type: "string" },
    prompt: { type: "string" },
    model: { type: "string" },
  },
} as const;

const SENTINEL = /\[\[ticks:(\d+)@(\d+)(?:\+gap(\d+)@(\d+))?\]\]/;

interface TickPlan {
  count: number;
  intervalMs: number;
  gapMs: number;
  gapAt: number;
}

/** Parse the cadence plan from the prompt sentinel, or fall back to defaults. */
export function parseTickPlan(prompt: string | undefined): TickPlan {
  const m = prompt ? SENTINEL.exec(prompt) : null;
  if (!m) return { count: 240, intervalMs: 50, gapMs: 0, gapAt: -1 };
  return {
    count: Number(m[1]),
    intervalMs: Number(m[2]),
    gapMs: m[3] ? Number(m[3]) : 0,
    gapAt: m[4] ? Number(m[4]) : -1,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** Build the full AgentDetails snapshot the client hydration + throttle read. */
function details(agentId: string, subagentType: string, status: string, turn: number, elapsedMs: number) {
  return {
    agentId,
    displayName: subagentType,
    description: "synthetic tick producer",
    subagentType,
    status,
    entries: [],
    toolUses: 0,
    tokens: "0",
    tokensUsage: { input: 0, output: 0, total: 0 },
    turnCount: turn,
    durationMs: elapsedMs,
    modelName: "synthetic-ticks",
  };
}

export default function fauxAgentTicks(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "Agent",
    label: "Agent (synthetic ticks)",
    description:
      "Synthetic subagent-tick producer (throttle e2e). Streams Agent-labelled " +
      "tool_execution_update frames at a fixed cadence via a `[[ticks:N@Mms]]` sentinel.",
    parameters: AGENT_TICK_PARAMS as unknown as Record<string, unknown>,
    async execute(
      _toolCallId: string,
      params: { subagent_type?: string; description?: string; prompt?: string },
      signal: AbortSignal | undefined,
      onUpdate: ((p: unknown) => void) | undefined,
      _ctx: unknown,
    ) {
      const plan = parseTickPlan(params.prompt);
      const subagentType = params.subagent_type ?? "Explore";
      const agentId = randomUUID();
      const started = Date.now();

      for (let i = 0; i < plan.count; i++) {
        if (signal?.aborted) break;
        if (plan.gapAt === i && plan.gapMs > 0) await sleep(plan.gapMs, signal);
        onUpdate?.({
          content: [{ type: "text", text: `(running… ${i})` }],
          details: details(agentId, subagentType, "running", i, Date.now() - started),
        });
        await sleep(plan.intervalMs, signal);
      }

      return {
        content: [{ type: "text", text: "synthetic ticks complete" }],
        details: details(agentId, subagentType, "completed", plan.count, Date.now() - started),
      };
    },
  });
}
