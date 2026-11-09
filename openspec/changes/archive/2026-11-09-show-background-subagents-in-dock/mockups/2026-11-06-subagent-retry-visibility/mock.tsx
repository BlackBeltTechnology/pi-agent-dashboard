// Subagent retry visibility (explore mock). pi auto-retries a failed provider call INSIDE the
// subagent's child AgentSession (auto_retry_start / auto_retry_end), but the producer
// (pi-dashboard-subagents extensions/agent.ts) drops those events and never turns the failed
// message_end (stopReason "error") into a timeline entry. Today the card and the inspector keep
// showing the last activity ("writing") while the subagent sleeps in backoff.
// Proposed: show-only, never stop. The failed attempt lands as the REAL `error` timeline entry
// (a kind that already ships), and the activity line becomes the main session's retry line
// (replica of SessionBanner RetryStatusLine classes: severity-warning fg + spinning mdiLoading,
// "Retry n/max" as text so reduced motion keeps it). No retry controls: the row ■ still stops
// the whole subagent. The retry line is passed through the real `activity` slot (a node instead
// of a string) to keep every other pixel the shipped component.
// Real components: ToolCallStep + AgentToolRenderer claim (as in drop-subagent-card-stop-button's
// live mock) and SubagentDetailView (the inspector).
import { UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { ToolCallStep } from "@app/components/chat/ToolCallStep.tsx";
import { ThemeProvider } from "@app/components/settings/ThemeProvider.tsx";
import type { ToolContext } from "@app/components/tool-renderers/types.ts";
import { createHostPrimitiveRegistry } from "@app/lib/plugins/host-primitives.tsx";
import {
  AgentToolRenderer,
} from "../../../../../packages/subagents-plugin/src/client/AgentToolRenderer.tsx";
import { isAgentResultNotReceived } from "../../../../../packages/subagents-plugin/src/client/resultPending.ts";
import { SubagentDetailView } from "../../../../../packages/subagents-plugin/src/client/SubagentDetailView.tsx";
import { agentRowStatus, agentStop, agentStopLabel } from "../../../../../packages/subagents-plugin/src/client/subagentStop.ts";
import type { SubagentState, SubagentTimelineEntry } from "../../../../../packages/subagents-plugin/src/client/types.ts";
import { mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fix, Issue, type Mock } from "mock-site/kit";
import { type ReactNode, useEffect, useState } from "react";

// ---------------------------------------------------------------- real providers
const primitives = createHostPrimitiveRegistry();
const registry = createSlotRegistry();
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

// ---------------------------------------------------------------- retry line (replica)
// Same classes as SessionBanner's RetryStatusLine; attempt/max as text, countdown only while waiting.
function RetryLine({ attempt, max, waitMs }: { attempt: number; max: number; waitMs?: number }) {
  const [left, setLeft] = useState(waitMs ?? 0);
  useEffect(() => {
    if (waitMs === undefined) return;
    const t0 = Date.now();
    const id = setInterval(() => {
      const rest = waitMs - ((Date.now() - t0) % (waitMs + 1000));
      setLeft(Math.max(0, rest));
    }, 250);
    return () => clearInterval(id);
  }, [waitMs]);
  return (
    <span data-testid="agent-retry-line" className="inline-flex items-center gap-1 text-[var(--severity-warning-fg)]">
      <Icon path={mdiLoading} size={0.45} className="animate-spin shrink-0" aria-hidden="true" />
      <span>Retry {attempt}/{max}</span>
      {waitMs !== undefined ? <span>· in {Math.ceil(left / 1000)}s</span> : <span>· attempt in flight</span>}
    </span>
  );
}

// ---------------------------------------------------------------- data
const SESSION_ID = "mock-session";
const T0 = Date.now();
const RUN_MS = 2 * 60_000 + 12_000;
const ERR = '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';

const args = {
  subagent_type: "code-reviewer",
  description: "Review retry-tracker changes",
  prompt: "Review packages/extension/src/retry-tracker.ts against openspec/changes/fix-retry-delay-cap/specs and report defects by severity.",
};

const baseEntries: SubagentTimelineEntry[] = [
  { kind: "thinking", text: "Start with the tracker's observation model, then check the delay math against pi-ai retryDelayMs.", ts: T0 - 120_000 },
  { kind: "tool", toolName: "read", input: { path: "packages/extension/src/retry-tracker.ts" }, output: "(412 lines)", ts: T0 - 110_000 },
  { kind: "tool", toolName: "bash", input: { command: "rg -n retryDelayMs packages/extension/src" }, output: "retry-tracker.ts:93: export type RetryDelayFn", ts: T0 - 95_000 },
  { kind: "text", text: "The waiting-phase countdown uses `maxAgentDelayMs` as the cap; checking the spec scenario next.", ts: T0 - 80_000 },
];
const failedEntry: SubagentTimelineEntry = { kind: "error", text: `Attempt 1 failed: ${ERR}`, ts: T0 - 6_000 };

type Phase = "today" | "waiting" | "inflight" | "recovered" | "gaveup";
const activityFor = (p: Phase): ReactNode =>
  p === "today" ? "writing"
  : p === "waiting" ? <RetryLine attempt={2} max={3} waitMs={8_000} />
  : p === "inflight" ? <RetryLine attempt={2} max={3} />
  : "writing";

const details = (p: Phase) =>
  p === "gaveup"
    ? {
        displayName: "code-reviewer", description: args.description, subagentType: "code-reviewer",
        status: "error", error: `Gave up after 3 retries: ${ERR}`, modelName: "claude-sonnet-4-5",
        durationMs: RUN_MS, agentId: "agent-cr1",
      }
    : {
        displayName: "code-reviewer", description: args.description, subagentType: "code-reviewer",
        status: "running", activity: activityFor(p), modelName: "claude-sonnet-4-5", thinkingLevel: "medium",
        turnCount: 6, toolUses: 2, durationMs: RUN_MS, agentId: "agent-cr1", stoppable: true,
      };

const sub = (p: Phase): SubagentState => ({
  id: "agent-cr1",
  type: "code-reviewer",
  displayName: "code-reviewer",
  description: args.description,
  status: p === "gaveup" ? "failed" : "running",
  error: p === "gaveup" ? `Gave up after 3 retries: ${ERR}` : undefined,
  modelName: "claude-sonnet-4-5",
  thinkingLevel: "medium",
  startedAt: T0 - RUN_MS,
  activity: activityFor(p) as unknown as string,
  entries: p === "today" ? baseEntries
    : p === "recovered" ? [...baseEntries, failedEntry, { kind: "text", text: "Spec scenario matches; one defect: the cap is applied before the jitter.", ts: T0 }]
    : p === "gaveup" ? [...baseEntries, failedEntry, { kind: "error", text: `Attempt 2 failed: ${ERR}`, ts: T0 - 3_000 }, { kind: "error", text: `Attempt 3 failed: ${ERR}`, ts: T0 }]
    : [...baseEntries, failedEntry],
} as SubagentState);

const ctx = (p: Phase) =>
  ({ sessionId: SESSION_ID, session: { subagents: new Map([["agent-cr1", sub(p)]]) }, send: () => {} }) as unknown as ToolContext;

const Row = ({ p }: { p: Phase }) => (
  <ToolCallStep
    toolName="Agent"
    toolCallId={`tc-${p}`}
    args={args}
    status={p === "gaveup" ? "error" : "running"}
    startedAt={T0 - RUN_MS}
    duration={p === "gaveup" ? RUN_MS : undefined}
    toolDetails={details(p) as Record<string, unknown>}
    context={ctx(p)}
    onAbort={() => {}}
  />
);

const Inspector = ({ p }: { p: Phase }) => (
  <div className="h-[460px] flex flex-col border border-[var(--border-secondary)] rounded-xl overflow-hidden">
    <SubagentDetailView session={{ subagents: new Map([["agent-cr1", sub(p)]]) }} agentId="agent-cr1" sessionId={SESSION_ID} />
  </div>
);

// ---------------------------------------------------------------- frames
const ChatRow = ({ v }: { v: "c" | "p" }) => (
  <Shell>
    {v === "c" ? (
      <Issue n={1} tip="Says writing; it is sleeping in backoff" block><Row p="today" /></Issue>
    ) : (
      <Fix n={1} tip="Amber retry line with countdown" block><Row p="waiting" /></Fix>
    )}
  </Shell>
);

const InspectorFrame = ({ v }: { v: "c" | "p" }) => (
  <Shell>
    {v === "c" ? (
      <Issue n={2} tip="Failed attempt missing from timeline" block><Inspector p="today" /></Issue>
    ) : (
      <Fix n={2} tip="Error entry + live retry line" block><Inspector p="waiting" /></Fix>
    )}
  </Shell>
);

const mock: Mock = {
  title: "Subagent retry - show pi auto-retry on card + inspector",
  category: "Chat",
  frames: [
    {
      title: "Chat row - subagent in retry backoff",
      why: "Producer drops auto_retry_*; card keeps the stale activity. Proposed: show-only retry line, no new stop.",
      width: 1100,
      current: <ChatRow v="c" />,
      proposed: <ChatRow v="p" />,
    },
    {
      title: "Inspector - same moment",
      why: "Failed message_end becomes the shipped `error` entry; header activity carries the retry line.",
      width: 900,
      current: <InspectorFrame v="c" />,
      proposed: <InspectorFrame v="p" />,
    },
    {
      title: "Retry lifecycle - chat row",
      why: "Waiting (countdown) -> attempt in flight -> recovered (line gone) or gave up (existing error card).",
      width: 1100,
      steps: [
        { label: "waiting 2/3", proposed: <Shell><Row p="waiting" /></Shell> },
        { label: "attempt 2 in flight", proposed: <Shell><Row p="inflight" /></Shell> },
        { label: "recovered", proposed: <Shell><Row p="recovered" /></Shell> },
        { label: "gave up after 3", proposed: <Shell><Row p="gaveup" /></Shell> },
      ],
    },
    {
      title: "Retry lifecycle - inspector record",
      why: "Error entries stay as the record after recovery or give-up; the live line only exists while retrying.",
      width: 900,
      steps: [
        { label: "recovered", proposed: <Shell><Inspector p="recovered" /></Shell> },
        { label: "gave up after 3", proposed: <Shell><Inspector p="gaveup" /></Shell> },
      ],
    },
  ],
};
export default mock;
