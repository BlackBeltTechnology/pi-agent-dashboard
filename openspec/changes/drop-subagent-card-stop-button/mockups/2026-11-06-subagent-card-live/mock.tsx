// Subagent card, live: the REAL chat row (ToolCallStep) + the REAL Agent tool-renderer claim
// (AgentToolRenderer + agentRowStatus / agentStop / agentStopLabel) fed the toolDetails a
// producer 0.6.0 sends. Frame 1 reproduces the gap-miner fan-out screenshot (running S08,
// complete S09, running S10). Frame 2 is the same row while the subagent waits for a slot.
// Proposed only hides the card's own "Stop subagent" row (CSS), to show the single-stop option:
// with `stoppable: true` the row ■ already routes through the claim's per-subagent `stop`.
// See change: drop-subagent-card-stop-button (spec: subagent-queue-visibility).
import { UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { ToolCallStep } from "@app/components/chat/ToolCallStep.tsx";
import { ThemeProvider } from "@app/components/settings/ThemeProvider.tsx";
import type { ToolContext } from "@app/components/tool-renderers/types.ts";
import { createHostPrimitiveRegistry } from "@app/lib/plugins/host-primitives.tsx";
import { AgentToolRenderer } from "../../../../../packages/subagents-plugin/src/client/AgentToolRenderer.tsx";
import { isAgentResultNotReceived } from "../../../../../packages/subagents-plugin/src/client/resultPending.ts";
import { agentRowStatus, agentStop, agentStopLabel } from "../../../../../packages/subagents-plugin/src/client/subagentStop.ts";
import type { ReactNode } from "react";
import { Fix, Issue, type Mock } from "mock-site/kit";

// ---------------------------------------------------------------- real providers
const primitives = createHostPrimitiveRegistry();
const registry = createSlotRegistry();
// Same claim the manifest declares (package.json `tool-renderer` / `Agent`), wired to the real fns.
registry.addClaim({
  pluginId: "subagents",
  priority: 100,
  slot: "tool-renderer",
  toolName: "Agent",
  Component: AgentToolRenderer,
  expandWhileRunning: true,
  resultPending: isAgentResultNotReceived,
  rowStatus: agentRowStatus,
  stop: agentStop,
  stopLabel: agentStopLabel,
} as Parameters<typeof registry.addClaim>[0]);

function Shell({ children, hideCardStop }: { children: ReactNode; hideCardStop?: boolean }) {
  return (
    <UiPrimitiveProvider value={primitives}>
      <PluginContextProvider registry={registry}>
        <ThemeProvider>
          <div className={`py-2 bg-[var(--bg-primary)] ${hideCardStop ? "[&_[data-testid=agent-stop-row]]:hidden" : ""}`}>
            {children}
          </div>
        </ThemeProvider>
      </PluginContextProvider>
    </UiPrimitiveProvider>
  );
}

// ---------------------------------------------------------------- data (from the screenshot)
const SESSION_ID = "mock-session";
const session = { subagents: new Map() };
const context = { sessionId: SESSION_ID, session, send: () => {} } as unknown as ToolContext;
const T0 = Date.now();
const RUN_MS = 4 * 60_000 + 46_000; // "4m 46s…"

const args = (id: string) => ({
  subagent_type: "gap-miner",
  description: `Gap mine ${id}`,
  prompt: `Read /Users/bmiller/Projects/judo-blueprint/target/gap-mining/miner-sessions.md and follow it exactly with ID=${id} and PACK=/Users/bmiller/Projects/judo-blueprint/target/gap-mining/packs/${id}.md`,
});

const running = (id: string, turns: number, tools: number) => ({
  displayName: "gap-miner",
  description: `Gap mine ${id}`,
  subagentType: "gap-miner",
  status: "running",
  activity: "running bash",
  modelName: "mercury-3",
  thinkingLevel: "off",
  turnCount: turns,
  toolUses: tools,
  tokens: "0",
  durationMs: RUN_MS,
  agentId: `agent-${id}`,
  stoppable: true,
});

const queued = (id: string) => ({
  displayName: "gap-miner",
  description: `Gap mine ${id}`,
  subagentType: "gap-miner",
  status: "queued",
  durationMs: 38_000,
  agentId: `agent-${id}`,
  stoppable: true,
  queuePosition: 2,
  activeSlots: 4,
  maxConcurrent: 4,
});

const complete = (id: string) => ({
  displayName: "gap-miner",
  description: `Gap mine ${id}`,
  status: "completed",
  modelName: "mercury-3",
  durationMs: 4 * 60_000 + 28_000,
  agentId: `agent-${id}`,
  stoppable: true,
});

const Row = ({ id, status, details, startedAt, duration }: {
  id: string;
  status: "running" | "complete";
  details: Record<string, unknown>;
  startedAt?: number;
  duration?: number;
}) => (
  <ToolCallStep
    toolName="Agent"
    toolCallId={`tc-${id}`}
    args={args(id)}
    status={status}
    startedAt={startedAt}
    duration={duration}
    toolDetails={details}
    context={context}
    onAbort={() => {}}
  />
);

const FanOut = ({ v }: { v: "c" | "p" }) => {
  const Ring = v === "c" ? Issue : Fix;
  const tip = v === "c" ? "Row ■ and card button: same stop" : "Row ■ is the one per-subagent stop";
  return (
    <Shell hideCardStop={v === "p"}>
      <Ring n={1} tip={tip} block>
        <Row id="S08" status="running" details={running("S08", 35, 9)} startedAt={T0 - RUN_MS} />
      </Ring>
      <Row id="S09" status="complete" details={complete("S09")} duration={4 * 60_000 + 28_000} />
      <Row id="S10" status="running" details={running("S10", 39, 10)} startedAt={T0 - RUN_MS} />
    </Shell>
  );
};

const Waiting = ({ v }: { v: "c" | "p" }) => {
  const Ring = v === "c" ? Issue : Fix;
  const tip = v === "c" ? "Row ■ and card button: same removal" : "Row ■ removes it from the queue";
  return (
    <Shell hideCardStop={v === "p"}>
      <Ring n={2} tip={tip} block>
        <Row id="S11" status="running" details={queued("S11")} startedAt={T0 - 38_000} />
      </Ring>
    </Shell>
  );
};

const mock: Mock = {
  title: "Subagent card - live running + waiting rows",
  category: "Chat",
  change: "drop-subagent-card-stop-button",
  frames: [
    {
      title: "Fan-out - running S08, done S09, running S10",
      why: "Real ToolCallStep + AgentToolRenderer with the screenshot's toolDetails (producer 0.6.0, stoppable).",
      width: 1100,
      current: <FanOut v="c" />,
      proposed: <FanOut v="p" />,
    },
    {
      title: "Waiting for a slot - queued S11",
      why: "Same row while the producer queues it: #2 in queue, 4/4 slots, wait time not run time.",
      width: 1100,
      current: <Waiting v="c" />,
      proposed: <Waiting v="p" />,
    },
  ],
};
export default mock;
