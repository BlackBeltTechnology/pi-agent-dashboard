// Plugin-only rendering of the producer's `retry` timeline entry (explore mock).
// Producer pi-dashboard-subagents v0.7.0 appends { kind: "retry", attempt, maxAttempts, delayMs, text }
// per scheduled pi auto-retry, and sets details.activity to "retrying (attempt N/M) in 4s…" while the
// backoff is pending. Constraint: no subagent code in core, and MinimalChatView (client-utils) only
// knows tool | text | thinking | error.
// Current: the shipped SubagentDetailView maps the unknown kind to "(unknown entry)".
// Proposed (plugin-only): SubagentDetailView maps `retry` to the existing `error` entry with the text
// "Retry N/M in Ns: <error>". The activity text needs no code: it already shows in the existing slot.
// Real: SubagentDetailView, ToolCallStep + AgentToolRenderer claim.
import { UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { ToolCallStep } from "@app/components/chat/ToolCallStep.tsx";
import { ThemeProvider } from "@app/components/settings/ThemeProvider.tsx";
import type { ToolContext } from "@app/components/tool-renderers/types.ts";
import { createHostPrimitiveRegistry } from "@app/lib/plugins/host-primitives.tsx";
import { AgentToolRenderer } from "../../../../../packages/subagents-plugin/src/client/AgentToolRenderer.tsx";
import { isAgentResultNotReceived } from "../../../../../packages/subagents-plugin/src/client/resultPending.ts";
import { SubagentDetailView } from "../../../../../packages/subagents-plugin/src/client/SubagentDetailView.tsx";
import { agentRowStatus, agentStop, agentStopLabel } from "../../../../../packages/subagents-plugin/src/client/subagentStop.ts";
import type { SubagentState, SubagentTimelineEntry } from "../../../../../packages/subagents-plugin/src/client/types.ts";
import { Fix, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";

const primitives = createHostPrimitiveRegistry();
const registry = createSlotRegistry();
registry.addClaim({
  pluginId: "subagents", priority: 100, slot: "tool-renderer", toolName: "Agent", Component: AgentToolRenderer,
  expandWhileRunning: true, resultPending: isAgentResultNotReceived, rowStatus: agentRowStatus, stop: agentStop, stopLabel: agentStopLabel,
} as Parameters<typeof registry.addClaim>[0]);

function Shell({ children }: { children: ReactNode }) {
  return (
    <UiPrimitiveProvider value={primitives}>
      <PluginContextProvider registry={registry}>
        <ThemeProvider>
          <div className="py-2 bg-[var(--bg-primary)]">{children}</div>
        </ThemeProvider>
      </PluginContextProvider>
    </UiPrimitiveProvider>
  );
}

// ---------------------------------------------------------------- data (producer's real shapes)
const T0 = Date.now();
type RetryEntry = { kind: "retry"; attempt: number; maxAttempts: number; delayMs: number; text: string; ts: number };
type WireEntry = SubagentTimelineEntry | RetryEntry;

const before: WireEntry[] = [
  { kind: "thinking", text: "Regenerate types from the spec first, then diff the reference section by section.", ts: T0 - 90_000 },
  { kind: "tool", toolName: "bash", input: { command: "npx openapi-typescript openapi.yaml -o types.gen.ts" }, output: "wrote 1,284 lines", ts: T0 - 70_000 },
  { kind: "tool", toolName: "read", input: { path: "docs/api-reference.md" }, output: "(2,101 lines)", ts: T0 - 50_000 },
];
const retry1: RetryEntry = { kind: "retry", attempt: 1, maxAttempts: 18, delayMs: 4000, text: "503 service unavailable", ts: T0 - 8_000 };
const after: WireEntry[] = [
  { kind: "text", text: "Recovered. 11 endpoints changed; writing the diff to /tmp/api-diff.md.", ts: T0 },
];

// ---------------------------------------------------------------- the proposed plugin mapping
const formatDelay = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
/** Proposed SubagentDetailView branch: `retry` -> existing `error` entry. Plugin-only. */
const mapRetry = (entries: WireEntry[]): SubagentTimelineEntry[] =>
  entries.map((e) =>
    e.kind === "retry"
      ? { kind: "error", text: `Retry ${e.attempt}/${e.maxAttempts} in ${formatDelay(e.delayMs)}: ${e.text}`, ts: e.ts }
      : e,
  );

type Phase = "backoff" | "recovered";
function sub(p: Phase, side: "current" | "proposed"): SubagentState {
  const wire = p === "backoff" ? [...before, retry1] : [...before, retry1, ...after];
  return {
    id: "docs-1", type: "docs-writer", displayName: "docs-writer", description: "Regenerate the API reference",
    modelName: "claude-sonnet-4-5", thinkingLevel: "medium", startedAt: T0 - 100_000, stoppable: true,
    status: p === "backoff" ? "running" : "completed",
    result: p === "recovered" ? "Regenerated docs/api-reference.md: 11 endpoints changed." : undefined,
    durationMs: p === "recovered" ? 104_000 : undefined,
    // Producer's real activity text while the backoff is pending (shown by the existing slot).
    activity: p === "backoff" ? "retrying (attempt 1/18) in 4s…" : undefined,
    // Current feeds the raw wire entries (unknown kind); Proposed applies the plugin mapping.
    entries: (side === "current" ? wire : mapRetry(wire)) as SubagentTimelineEntry[],
  } as SubagentState;
}

const Inspector = ({ p, side }: { p: Phase; side: "current" | "proposed" }) => (
  <div style={{ height: 380 }} className="flex flex-col border border-[var(--border-secondary)] rounded-xl overflow-hidden">
    <SubagentDetailView session={{ subagents: new Map([["docs-1", sub(p, side)]]) }} agentId="docs-1" sessionId="mock-session" />
  </div>
);

const args = { subagent_type: "docs-writer", description: "Regenerate the API reference", prompt: "Regenerate docs/api-reference.md from openapi.yaml." };
const Card = () => {
  const s = sub("backoff", "proposed");
  return (
    <ToolCallStep
      toolName="Agent" toolCallId="tc-1" args={args} status="running" startedAt={T0 - 100_000}
      toolDetails={{ agentId: "docs-1", displayName: "docs-writer", subagentType: "docs-writer", description: args.description, status: "running", activity: s.activity, modelName: s.modelName, thinkingLevel: "medium", toolUses: 2, stoppable: true }}
      context={{ sessionId: "mock-session", session: { subagents: new Map([["docs-1", s]]) }, send: () => {} } as unknown as ToolContext}
      onAbort={() => {}}
    />
  );
};

const mock: Mock = {
  title: "Subagent retry step, plugin-only (retry -> error step)",
  category: "Chat",
  frames: [
    {
      title: "Inspector during the backoff",
      why: "Today the retry entry is \"(unknown entry)\". Plugin-only: it becomes an error step.",
      width: 900,
      current: <Shell><Issue n={1} tip="Retry shows as (unknown entry)" block><Inspector p="backoff" side="current" /></Issue></Shell>,
      proposed: <Shell><Fix n={1} tip="Error step: Retry 1/18 in 4s: 503…" block><Inspector p="backoff" side="proposed" /></Fix></Shell>,
    },
    {
      title: "Inspector after recovery",
      why: "The retry step stays in place, before the retried attempt's steps.",
      width: 900,
      current: <Shell><Issue n={2} tip="Record lost as unknown entry" block><Inspector p="recovered" side="current" /></Issue></Shell>,
      proposed: <Shell><Fix n={2} tip="Retry step kept as the record" block><Inspector p="recovered" side="proposed" /></Fix></Shell>,
    },
    {
      title: "Running card during the backoff (no code change)",
      why: "The producer's activity text already shows on the card; nothing to build.",
      width: 1100,
      proposed: <Shell><Card /></Shell>,
    },
  ],
};
export default mock;
