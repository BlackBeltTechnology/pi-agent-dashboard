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
 *
 * PULL-PATH SUBSTRATE (change: verify-subagent-pull-under-load, V1). Two more
 * sentinels, both OFF unless present, so every pre-existing throttle row is
 * byte-identical:
 *   `[[entries:<start>..<end>]]`      — grow `details.entries` from <start> to
 *   `[[entries:<start>..<end>@<n>]]`    <end> over the first <n> ticks (default
 *                                       half the plan), then PLATEAU for the
 *                                       rest of the run. Each frame carries a
 *                                       FULL snapshot — never a delta (the
 *                                       pipeline is latest-supersedes).
 *   `[[bus:<intervalMs>]]`            — also emit the `subagents:*` EventBus
 *                                       frames (`created` once, `started`
 *                                       coalesced at <intervalMs>, `completed`
 *                                       at the end). DEFAULT 250 ms, matching
 *                                       the real producer's
 *                                       PROGRESS_THROTTLE_MS; deliberately
 *                                       DECOUPLED from the tick interval, since
 *                                       a per-tick bus stream would fabricate
 *                                       an inflated push arm in the P4 A/B.
 *
 * Why the bus frames matter: the bridge's strip, its `SubagentFrameBuffer`, and
 * therefore the whole RESYNC (pull) path live on the `subagents:*` channel. A
 * tick-only producer exercises none of it. The bus is shared and the bridge
 * subscribes with `on()` ("observes every emitter"), so frames emitted here
 * traverse the exact production path with no bridge change.
 *
 * FIDELITY BOUNDARY: this proves the bridge → server → client pull path. It does
 * NOT prove that `@blackbelt-technology/pi-dashboard-subagents` emits this
 * shape; that stays covered by the `subagent-spawn` faux scenario.
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
const ENTRIES_SENTINEL = /\[\[entries:(\d+)\.\.(\d+)(?:@(\d+))?\]\]/;
const BUS_SENTINEL = /\[\[bus:(\d+)\]\]/;

interface TickPlan {
  count: number;
  intervalMs: number;
  gapMs: number;
  gapAt: number;
}

/** Timeline-growth plan. `undefined` = no growth (entries stay `[]`). */
export interface EntriesPlan {
  start: number;
  end: number;
  /** Ticks over which the growth is spread; the run PLATEAUS afterwards. */
  growTicks: number;
}

// Hard bounds so a hostile/typo'd sentinel cannot wedge the loop. `\d+` with
// enough digits makes `Number()` return `Infinity` (unbounded loop), and a `0`
// interval spins the event loop; clamp both.
const MAX_TICKS = 100_000;
const MAX_INTERVAL_MS = 60_000;
const MAX_GAP_MS = 600_000;
/** Entry-count ceiling. Entries are small + fixed-size, so the serialized
 *  snapshot stays far under the store's ~256 KiB `maxEventDataSize` budget —
 *  head-tail truncation is a BYTE budget, not a count, and a fired ceiling
 *  would rewrite the timeline to head + sentinel + tail. */
const MAX_ENTRIES = 5_000;
const DEFAULT_BUS_MS = 250;
const MIN_BUS_MS = 10;
const MAX_BUS_MS = 60_000;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Parse the cadence plan from the prompt sentinel, or fall back to defaults. */
export function parseTickPlan(prompt: string | undefined): TickPlan {
  const m = prompt ? SENTINEL.exec(prompt) : null;
  if (!m) return { count: 240, intervalMs: 50, gapMs: 0, gapAt: -1 };
  return {
    count: clampInt(m[1], 240, 0, MAX_TICKS),
    intervalMs: clampInt(m[2], 50, 1, MAX_INTERVAL_MS),
    gapMs: m[3] ? clampInt(m[3], 0, 0, MAX_GAP_MS) : 0,
    gapAt: m[4] ? clampInt(m[4], -1, 0, MAX_TICKS) : -1,
  };
}

/**
 * Parse the timeline-growth plan. Returns `undefined` (no growth) when the
 * sentinel is absent, malformed, or inverted (`start > end`) — inventing a
 * growth curve from a typo'd sentinel would silently fake the substrate.
 */
export function parseEntriesPlan(
  prompt: string | undefined,
  tickCount: number,
): EntriesPlan | undefined {
  const m = prompt ? ENTRIES_SENTINEL.exec(prompt) : null;
  if (!m) return undefined;
  const start = clampInt(m[1], 0, 0, MAX_ENTRIES);
  const end = clampInt(m[2], 0, 0, MAX_ENTRIES);
  if (start > end) return undefined;
  const defaultGrow = Math.max(1, Math.ceil(tickCount / 2));
  const growTicks = m[3]
    ? Math.min(Math.max(1, clampInt(m[3], defaultGrow, 1, MAX_TICKS)), Math.max(1, tickCount))
    : defaultGrow;
  return { start, end, growTicks };
}

/** Parse the bus-emission interval. `undefined` = emit no `subagents:*` frames. */
export function parseBusIntervalMs(prompt: string | undefined): number | undefined {
  const m = prompt ? BUS_SENTINEL.exec(prompt) : null;
  if (!m) return undefined;
  return clampInt(m[1], DEFAULT_BUS_MS, MIN_BUS_MS, MAX_BUS_MS);
}

/** Entry count at tick `i`: linear over `growTicks`, then flat at `end`. */
export function entryCountAt(plan: EntriesPlan | undefined, i: number): number {
  if (!plan) return 0;
  if (i >= plan.growTicks) return plan.end;
  const span = plan.end - plan.start;
  return plan.start + Math.round((span * i) / plan.growTicks);
}

/**
 * Build the FULL timeline snapshot of length `count`. Deterministic and
 * append-only: entry `i` is byte-identical across every frame of a run, so each
 * snapshot is a prefix-superset of its predecessor (latest-supersedes holds and
 * no delta encoding can leak in).
 */
export function buildEntries(count: number, startedAt: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    out.push({ kind: "text", text: `faux-entry ${i}`, ts: startedAt + i });
  }
  return out;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** Build the full AgentDetails snapshot the client hydration + throttle read. */
function details(
  agentId: string,
  subagentType: string,
  status: string,
  turn: number,
  elapsedMs: number,
  entries: Array<Record<string, unknown>> = [],
) {
  return {
    agentId,
    displayName: subagentType,
    description: "synthetic tick producer",
    subagentType,
    status,
    entries,
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
      const entriesPlan = parseEntriesPlan(params.prompt, plan.count);
      const busIntervalMs = parseBusIntervalMs(params.prompt);
      const subagentType = params.subagent_type ?? "Explore";
      const agentId = randomUUID();
      const started = Date.now();
      const description = "synthetic tick producer";

      // TOP-LEVEL `id` is load-bearing: `SubagentFrameBuffer.agentIdOf` keys the
      // retained snapshot on `data.id`, and `resync()` looks it up by that key.
      // A frame carrying the id only inside `details` makes every resync a
      // silent no-op — i.e. the pull path would look green while never running.
      const busEmit = (channel: string, extra: Record<string, unknown>, snapshot: unknown): void => {
        if (busIntervalMs === undefined) return;
        pi.events?.emit(channel, { id: agentId, ...extra, details: snapshot });
      };

      busEmit(
        "subagents:created",
        { type: subagentType, description },
        // `"created"` is NOT in the bridge's strip allowlist (queued/running), so
        // a fat `created` frame would forward UNSTRIPPED and defeat the
        // thin-push guard. It carries no entries by construction.
        details(agentId, subagentType, "created", 0, 0),
      );

      let lastBusAt = 0;
      for (let i = 0; i < plan.count; i++) {
        if (signal?.aborted) break;
        if (plan.gapAt === i && plan.gapMs > 0) {
          await sleep(plan.gapMs, signal);
          // `sleep` also resolves on abort — re-check so an abort DURING the quiet
          // gap does not emit one extra tick.
          if (signal?.aborted) break;
        }
        const entries = buildEntries(entryCountAt(entriesPlan, i), started);
        const snapshot = details(agentId, subagentType, "running", i, Date.now() - started, entries);
        onUpdate?.({
          content: [{ type: "text", text: `(running… ${i})` }],
          details: snapshot,
        });
        // Coalesce the bus carrier on its OWN interval, independent of the tick
        // interval — mirroring the real producer's 250 ms progress throttle.
        const now = Date.now();
        if (busIntervalMs !== undefined && now - lastBusAt >= busIntervalMs) {
          lastBusAt = now;
          busEmit("subagents:started", { type: subagentType, description }, snapshot);
        }
        await sleep(plan.intervalMs, signal);
      }

      const finalEntries = buildEntries(entryCountAt(entriesPlan, plan.count), started);
      const finalDetails = details(
        agentId,
        subagentType,
        "completed",
        plan.count,
        Date.now() - started,
        finalEntries,
      );
      busEmit(
        "subagents:completed",
        {
          result: "synthetic ticks complete",
          durationMs: Date.now() - started,
          tokens: { input: 0, output: 0, total: 0 },
          toolUses: 0,
        },
        finalDetails,
      );

      return {
        content: [{ type: "text", text: "synthetic ticks complete" }],
        details: finalDetails,
      };
    },
  });
}
