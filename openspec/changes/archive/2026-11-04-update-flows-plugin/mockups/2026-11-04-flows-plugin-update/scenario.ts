// Scripted pi-flows 0.10 run used by both panes of the mock.
// Each step = one pi.events emission by pi-flows (raw channel) + the dashboard
// protocol type it becomes. Data shapes follow pi-flows 0.10.0 flow-tui.ts emits.
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface WireStep {
  channel: string; // raw pi.events channel emitted by pi-flows
  eventType: string; // dashboard protocol type after rename
  data: Record<string, unknown>;
  note: string; // one-line human label for the wire log
}

const started = (stepId: string, agentName: string, extra: Record<string, unknown> = {}): WireStep => ({
  channel: "flow:agent-started",
  eventType: "flow_agent_started",
  data: { agentName, stepId, resolvedModel: "anthropic/claude-sonnet-4-5", config: { name: agentName, model: "@default" }, ...extra },
  note: `${stepId}${extra.itemIndex !== undefined ? `[${extra.itemIndex}]` : ""} started`,
});

const done = (stepId: string, agentName: string, ok: boolean, summary: string, extra: Record<string, unknown> = {}, typedOutputs?: Record<string, string>): WireStep => ({
  channel: "flow:agent-complete",
  eventType: "flow_agent_complete",
  data: {
    agentName,
    stepId,
    ...extra,
    result: { success: ok, status: ok ? "complete" : "error", summary, tokens: { input: 4200, output: 610 }, cost: 0.021, duration: 18000, outcome: ok ? "success" : "soft", typedOutputs },
  },
  note: `${stepId}${extra.itemIndex !== undefined ? `[${extra.itemIndex}]` : ""} ${ok ? "complete" : "failed (soft)"}`,
});

const tool = (stepId: string, agentName: string, path: string, extra: Record<string, unknown> = {}): WireStep => ({
  channel: "flow:subagent-tool-call",
  eventType: "flow_tool_call",
  data: { agentName, stepId, toolName: "read", input: { path }, ...extra },
  note: `${stepId}${extra.itemIndex !== undefined ? `[${extra.itemIndex}]` : ""} read ${path}`,
});

const item = (i: number) => ({ itemIndex: i, itemCount: 3 });

export const SCENARIO: WireStep[] = [
  {
    channel: "flow:flow-started",
    eventType: "flow_started",
    note: "flow review-pr started",
    data: {
      flowName: "review-pr",
      task: "Review PR #482",
      autonomousMode: false,
      source: "project",
      steps: [
        { id: "plan", stepType: "agent", agent: "planner", blockedBy: [] },
        { id: "route", stepType: "agent-decision", agent: "flow-decision", blockedBy: ["plan"], branches: { security: "sec-review", perf: "perf-review", docs: "docs-review" } },
        { id: "sec-review", stepType: "agent", agent: "reviewer", blockedBy: [] },
        { id: "perf-review", stepType: "agent", agent: "perf-reviewer", blockedBy: [] },
        { id: "docs-review", stepType: "agent", agent: "doc-writer", blockedBy: [] },
        { id: "report", stepType: "agent", agent: "reporter", blockedBy: ["sec-review", "perf-review", "docs-review"] },
      ],
    },
  },
  started("plan", "planner"),
  tool("plan", "planner", "src/api/auth.ts"),
  done("plan", "planner", true, "3 changed files: auth.ts, billing.ts, session.ts. Touches tokens and README."),
  started("route", "flow-decision", { nodeKind: "agent-decision" }),
  done("route", "flow-decision", true, "Security-sensitive code plus docs; no hot path touched.", {}, { branches: "security, docs" }),
  {
    channel: "flow:decision",
    eventType: "flow_decision",
    note: "route chose security (x3 files) + docs",
    data: {
      stepId: "route",
      multi: true,
      labels: ["security", "docs"],
      routes: [
        { branch: "security", items: ["src/api/auth.ts", "src/api/billing.ts", "src/api/session.ts"] },
        { branch: "docs" },
      ],
    },
  },
  started("sec-review", "reviewer", item(0)),
  started("sec-review", "reviewer", item(1)),
  started("sec-review", "reviewer", item(2)),
  started("docs-review", "doc-writer"),
  tool("sec-review", "reviewer", "src/api/auth.ts", item(0)),
  tool("sec-review", "reviewer", "src/api/billing.ts", item(1)),
  done("sec-review", "reviewer", true, "auth.ts: token compare is constant-time. OK.", item(0)),
  done("sec-review", "reviewer", false, "billing.ts: timed out after 3 retries.", item(1)),
  done("docs-review", "doc-writer", true, "README updated for the new token flow."),
  done("sec-review", "reviewer", true, "session.ts: cookie flags correct. OK.", item(2)),
  started("report", "reporter"),
  done("report", "reporter", true, "2 of 3 security reviews passed; billing.ts needs a rerun."),
  { channel: "flow:complete", eventType: "flow_complete", note: "flow complete (success)", data: { status: "success" } },
];

export const toEvent = (s: WireStep, i: number): DashboardEvent =>
  ({ sessionId: "mock", eventType: s.eventType, data: s.data, timestamp: 1_700_000_000_000 + i * 1000 }) as unknown as DashboardEvent;
