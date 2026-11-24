// Live mock for add-flow-open-tool: the agent's `flow_open` tool pins a flow in the
// session's flow slot. Uses the REAL FlowDashboard in its not-started (idle) mode,
// built from a real flow.yaml via the real buildIdleFlowState.
// Open decisions this page answers (design review of add-flow-open-tool):
//   A vs B  - does an agent pin EXPAND the panel (like Open flow...) or leave it collapsed?
//   C vs D  - does the pin land on EVERY device viewing the session, or only the first?
//   E       - how a path-opened (not registered) flow reads: view-only, no Run.
// Collapse state is preset per pane with the real setFlowCollapsed (unique session ids).

import { FlowDashboard } from "@flows/client/FlowDashboard.tsx";
import { setFlowCollapsed } from "@flows/client/flow-collapse-storage.ts";
import { buildIdleFlowState } from "@flows/client/flow-idle-state.ts";
import type { FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createHostPrimitiveRegistry } from "@app/lib/plugins/host-primitives.tsx";
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { Fix, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";

const noop = () => {};
const registry = createHostPrimitiveRegistry();
const slots = createSlotRegistry();

// .pi/flows/flows/custom/update-dashboard/flow.yaml (this repo), inlined.
const YAML = `name: update-dashboard
description: Daily self-update
steps:
  - id: pull
    type: code-decision
    branches: { ok: build, diverged: rebase }
    on_error: report
  - id: rebase
    type: code-decision
    branches: { ok: build, conflict: resolve }
    on_error: resolve
  - id: resolve
    type: agent
    agent: dashboard-update-resolver
    task: "Unblock the update"
    on_error: report
  - id: check
    type: code-decision
    branches: { retry: resolve, ok: build }
    max_iterations: 3
    on_error: report
  - id: build
    type: code-decision
    branches: { ok: launch, fail: resolve }
    max_iterations: 3
    on_error: report
  - id: launch
    type: code
    outputs:
      - name: launched
    on_error: report
  - id: report
    type: code
    outputs:
      - name: status
`;

function idleState(name: string): FlowState {
  const r = buildIdleFlowState(YAML, { name });
  if (r.kind !== "ready") throw new Error(r.message);
  // flowSource dropped: the YAML popover would fetch from a live server.
  return { ...r.flowState, flowSource: undefined };
}

/** Real FlowDashboard, idle mode, collapse preset for this pane's own session id. */
function Slot({ sid, name, collapsed, viewOnly }: { sid: string; name: string; collapsed: boolean; viewOnly?: boolean }) {
  setFlowCollapsed(sid, ["dashboard"], collapsed);
  return (
    <UiPrimitiveProvider value={registry}>
    <PluginContextProvider registry={slots}>
    <div data-view-only={viewOnly ? "1" : undefined}>
      {/* Proposed view-only header: Run + autonomous toggle are hidden (drawn here with a scoped rule). */}
      {viewOnly ? <style>{`[data-view-only="1"] [data-testid="flow-idle-run"],[data-view-only="1"] button[aria-pressed]{display:none}`}</style> : null}
      <FlowDashboard
        flowState={idleState(name)}
        sessionId={sid}
        onAbort={noop}
        onToggleAutonomous={noop}
        onDismiss={noop}
        idle={{ onRun: noop, onClose: noop }}
        headerActions={viewOnly ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-tertiary)] whitespace-nowrap" title="Not registered with this session's pi-flows; parsed by the dashboard">
            view only - not registered
          </span>
        ) : undefined}
      />
    </div>
    </PluginContextProvider>
    </UiPrimitiveProvider>
  );
}

const CHAT_TODAY: Array<["user" | "assistant", string]> = [
  ["user", "Make the daily update retry the build twice before asking the resolver."],
  ["assistant", "Done: edited .pi/flows/flows/custom/update-dashboard/flow.yaml. To see it, open the flow panel menu, pick Open flow..., then choose custom:update-dashboard."],
];
const CHAT_NEXT: Array<["user" | "assistant", string]> = [
  ["user", "Make the daily update retry the build twice before asking the resolver."],
  ["assistant", "Done: edited .pi/flows/flows/custom/update-dashboard/flow.yaml. I opened it above so you can check the graph."],
];

function Chat({ rows, tool }: { rows: Array<["user" | "assistant", string]>; tool?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 p-3 text-sm">
      {rows.map(([who, text]) => (
        <div key={text} className={who === "user"
          ? "self-end max-w-[75%] rounded-xl bg-[var(--bg-tertiary)] px-3 py-2 text-[var(--text-primary)]"
          : "max-w-[85%] rounded-xl border border-[var(--border-secondary)] px-3 py-2 text-[var(--text-secondary)]"}>{text}</div>
      ))}
      {tool}
    </div>
  );
}

function ToolLine({ text }: { text: string }) {
  return (
    <div className="max-w-[85%] rounded-lg border border-[var(--border-subtle)] px-2 py-1 font-mono text-[11px] text-[var(--text-tertiary)]">
      {text}
    </div>
  );
}

function SessionShell({ slot, chat }: { slot: ReactNode; chat: ReactNode }) {
  return (
    <div className="flex flex-col min-h-[560px] bg-[var(--bg-primary)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)] shrink-0">
        <span className="text-sm font-semibold text-[var(--text-primary)]">daily-update-tweak</span>
        <span className="text-xs text-[var(--text-secondary)]">~/Projects/pi-agent-dashboard</span>
      </div>
      <div className="shrink-0 p-2">{slot}</div>
      <div className="flex-1 min-h-0 p-2">{chat}</div>
      <div className="shrink-0 m-2 rounded-xl border border-[var(--border-secondary)] px-3 py-2 text-sm text-[var(--text-secondary)]">Message...</div>
    </div>
  );
}

function Device({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <div className="text-xs text-[var(--text-tertiary)]">{label}</div>
      <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-primary)] p-2">{children}</div>
    </div>
  );
}

const NotPinned = () => (
  <div className="px-2 py-3 text-xs text-[var(--text-tertiary)]">No flow pinned on this device (Open flow... still works)</div>
);

const NAME = "custom:update-dashboard";
const PATH_NAME = "packages/engine/flows/invoicebot/update";

const mock: Mock = {
  title: "Flow panel - agent pins a flow (flow_open)",
  category: "Flows",
  change: "add-flow-open-tool",
  frames: [
    {
      title: "Option A - agent pin expands the panel",
      why: "Same as Open flow...: the user asked to see it, so it opens expanded.",
      width: 980,
      current: (
        <SessionShell
          slot={<Issue n={1} tip="Nothing shown; user must hunt" block><div className="px-2 py-3 text-xs text-[var(--text-tertiary)]">(no flow panel)</div></Issue>}
          chat={<Chat rows={CHAT_TODAY} />}
        />
      ),
      proposed: (
        <SessionShell
          slot={<Fix n={1} tip="Pinned and expanded" block><Slot sid="mock-a" name={NAME} collapsed={false} /></Fix>}
          chat={<Chat rows={CHAT_NEXT} tool={<ToolLine text={`flow_open { flow: "${NAME}" } -> shown (1 viewer)`} />} />}
        />
      ),
    },
    {
      title: "Option B - agent pin keeps the panel collapsed",
      why: "Panel never expands on its own (collapse spec kept); header shows the pinned flow.",
      width: 980,
      proposed: (
        <SessionShell
          slot={<Fix n={1} tip="Pinned, still collapsed" block><Slot sid="mock-b" name={NAME} collapsed /></Fix>}
          chat={<Chat rows={CHAT_NEXT} tool={<ToolLine text={`flow_open { flow: "${NAME}" } -> shown (1 viewer)`} />} />}
        />
      ),
    },
    {
      title: "Path-opened flow - view only",
      why: "A flow.yaml not registered with the session: graph + cards, no Run.",
      width: 980,
      current: (
        <SessionShell
          slot={<Issue n={1} tip="Unregistered flows can't be shown" block><div className="px-2 py-3 text-xs text-[var(--text-tertiary)]">(no flow panel - Open flow... lists only registered flows)</div></Issue>}
          chat={<Chat rows={[["user", "Show me the invoicebot update flow in the engine package."], ["assistant", "It is at packages/engine/flows/invoicebot/update/flow.yaml. It isn't registered with this session, so the dashboard can't show it."]]} />}
        />
      ),
      proposed: (
        <SessionShell
          slot={<Fix n={1} tip="View only: no Run, labelled" block><Slot sid="mock-e" name={PATH_NAME} collapsed={false} viewOnly /></Fix>}
          chat={<Chat rows={[["user", "Show me the invoicebot update flow in the engine package."]]} tool={<ToolLine text={`flow_open { path: "${PATH_NAME}" } -> shown (1 viewer, viewOnly)`} />} />}
        />
      ),
    },
    {
      title: "Option C - pin lands on every viewing device",
      why: "Desktop and phone both have the session open: both get the pin.",
      width: 980,
      proposed: (
        <div className="flex gap-3 p-3 bg-[var(--bg-secondary)]">
          <Device label="Desktop browser (session open)"><Fix n={1} tip="Pinned here" block><Slot sid="mock-c1" name={NAME} collapsed /></Fix></Device>
          <Device label="Phone (same session open)"><Fix n={2} tip="Pinned here too" block><Slot sid="mock-c2" name={NAME} collapsed /></Fix></Device>
        </div>
      ),
    },
    {
      title: "Option D - pin lands only on the first device",
      why: "Attachments stay strictly single-device; the other viewer is untouched.",
      width: 980,
      proposed: (
        <div className="flex gap-3 p-3 bg-[var(--bg-secondary)]">
          <Device label="Desktop browser (acked first)"><Fix n={1} tip="Pinned here only" block><Slot sid="mock-d1" name={NAME} collapsed /></Fix></Device>
          <Device label="Phone (same session open)"><Fix n={2} tip="Not pinned" block><NotPinned /></Fix></Device>
        </div>
      ),
    },
  ],
};

export default mock;
